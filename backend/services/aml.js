'use strict';
/**
 * AML risk engine.
 *
 * Deterministic, explainable rules — every decision returns the list of rules
 * that fired so an analyst can see *why* a transfer was held, and so the QCB
 * filing can report rule-level statistics. Thresholds come from
 * `compliance_settings`, never from source code constants.
 */
const db = require('../db/pool');
const screening = require('./screening');
const { badRequest, forbidden } = require('../lib/errors');

const RISK_ORDER = ['UNSCREENED', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

async function settings(client = db) {
  const { rows } = await client.query(
    `select key, value #>> '{}' as value from compliance_settings
      where key like 'aml.%' or key like 'ctr.%' or key like 'structuring.%'
         or key like 'velocity.%' or key like 'kyc.tier%'`,
  );
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    reviewThreshold: Number(map['aml.review_threshold_qar_minor'] ?? 400000),
    holdThreshold: Number(map['aml.hold_threshold_qar_minor'] ?? 1000000),
    ctrThreshold: Number(map['ctr.threshold_qar_minor'] ?? 5000000),
    structuringWindowHours: Number(map['structuring.window_hours'] ?? 48),
    structuringCount: Number(map['structuring.count_threshold'] ?? 3),
    dailyTxnLimit: Number(map['velocity.daily_txn_limit'] ?? 10),
    tierLimits: {
      1: Number(map['kyc.tier1_monthly_limit_qar_minor'] ?? 2000000),
      2: Number(map['kyc.tier2_monthly_limit_qar_minor'] ?? 50000000),
      3: Number(map['kyc.tier3_monthly_limit_qar_minor'] ?? 100000000),
    },
    highRiskCountries: String(map['aml.high_risk_countries'] ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    newAccountHours: Number(map['aml.new_account_hours'] ?? 24),
  };
}

function worst(a, b) {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b;
}

/**
 * Assess a transfer BEFORE any provider call.
 * Returns { decision: 'ALLOW'|'HOLD'|'BLOCK', riskLevel, rules[], screening }
 */
async function assessTransfer({ customer, beneficiary, corridor, amountQarMinor, client = db }) {
  const config = await settings(client);
  const rules = [];
  let risk = 'LOW';
  let decision = 'ALLOW';

  const fire = (rule, level, effect, detail) => {
    rules.push({ rule, level, effect, detail });
    risk = worst(risk, level);
    if (effect === 'HOLD') decision = decision === 'BLOCK' ? 'BLOCK' : 'HOLD';
    if (effect === 'BLOCK') decision = 'BLOCK';
  };

  // ---- Sanctions / PEP screening of both parties -------------------------
  const customerScreen = await screening.screenAndPersist({
    subjectType: 'CUSTOMER', subjectId: customer.id, name: customer.full_name, client,
  });
  if (customerScreen.outcome === 'HIT') {
    fire('SANCTIONS_HIT_CUSTOMER', 'CRITICAL', 'BLOCK',
      `Customer name matched ${customerScreen.matches[0].listSource} entry "${customerScreen.matches[0].name}" at ${customerScreen.bestScore}`);
  } else if (customerScreen.outcome === 'REVIEW') {
    fire('SANCTIONS_REVIEW_CUSTOMER', 'HIGH', 'HOLD',
      `Possible customer match (${customerScreen.bestScore}) requires analyst confirmation`);
  } else if (customerScreen.outcome === 'NOT_SCREENED_NO_LISTS') {
    fire('SANCTIONS_LISTS_UNAVAILABLE', 'HIGH', 'HOLD',
      'No sanctions list has been imported into the platform; screening cannot clear the transfer');
  }

  if (beneficiary?.full_name) {
    const beneficiaryScreen = await screening.screenAndPersist({
      subjectType: 'BENEFICIARY', subjectId: beneficiary.id, name: beneficiary.full_name, client,
    });
    if (beneficiaryScreen.outcome === 'HIT') {
      fire('SANCTIONS_HIT_BENEFICIARY', 'CRITICAL', 'BLOCK',
        `Beneficiary matched ${beneficiaryScreen.matches[0].listSource} entry "${beneficiaryScreen.matches[0].name}"`);
    } else if (beneficiaryScreen.outcome === 'REVIEW') {
      fire('SANCTIONS_REVIEW_BENEFICIARY', 'HIGH', 'HOLD',
        `Possible beneficiary match (${beneficiaryScreen.bestScore}) requires analyst confirmation`);
    }
    // Name mismatch between what the rail resolved and what the customer typed
    // is a common authorised-push-payment / mule indicator.
    if (beneficiary.resolved_name && beneficiary.name_match_score != null
        && Number(beneficiary.name_match_score) < 60) {
      fire('BENEFICIARY_NAME_MISMATCH', 'MEDIUM', 'ALLOW',
        `Rail resolved "${beneficiary.resolved_name}" vs entered "${beneficiary.full_name}"`);
    }
  }

  // ---- Amounts -----------------------------------------------------------
  if (amountQarMinor >= config.holdThreshold) {
    fire('AML_HOLD_THRESHOLD', 'HIGH', 'HOLD',
      `Transfer at or above the ${config.holdThreshold / 100} QAR auto-hold threshold`);
  } else if (amountQarMinor >= config.reviewThreshold) {
    fire('AML_REVIEW_THRESHOLD', 'MEDIUM', 'ALLOW',
      `Transfer at or above the ${config.reviewThreshold / 100} QAR review threshold`);
  }
  if (amountQarMinor >= config.ctrThreshold) {
    fire('CTR_FILING_REQUIRED', 'HIGH', 'ALLOW',
      `Transfer at or above the ${config.ctrThreshold / 100} QAR CTR filing threshold for the QCB FIU`);
  }

  // ---- Velocity / structuring -------------------------------------------
  const { rows: [velocity] } = await client.query(
    'select afrisend_velocity_probe($1) as count', [customer.id],
  );
  if (velocity.count >= config.dailyTxnLimit) {
    fire('VELOCITY_DAILY_LIMIT', 'HIGH', 'HOLD',
      `${velocity.count} transfers in the last 24h (limit ${config.dailyTxnLimit})`);
  }

  const { rows: [structure] } = await client.query(
    'select afrisend_structuring_probe($1,$2,$3) as count',
    [customer.id, config.structuringWindowHours, config.holdThreshold],
  );
  if (structure.count >= config.structuringCount) {
    fire('STRUCTURING_PATTERN', 'HIGH', 'HOLD',
      `${structure.count} sub-threshold transfers inside ${config.structuringWindowHours}h`);
  }

  // ---- Tier limit and corridor limits -----------------------------------
  const { rows: [monthly] } = await client.query(
    'select afrisend_monthly_sent_qar($1) as sent', [customer.id],
  );
  const tierLimit = config.tierLimits[customer.kyc_tier] || 0;
  const projected = Number(monthly.sent) + amountQarMinor;
  if (projected > tierLimit) {
    fire('TIER_LIMIT_EXCEEDED', 'MEDIUM', 'BLOCK',
      `Projected month-to-date ${projected / 100} QAR exceeds the Tier ${customer.kyc_tier} limit of ${tierLimit / 100} QAR`);
  }
  if (corridor && amountQarMinor > Number(corridor.per_txn_limit_qar_minor)) {
    fire('CORRIDOR_PER_TXN_LIMIT', 'MEDIUM', 'BLOCK',
      `Corridor limit is ${corridor.per_txn_limit_qar_minor / 100} QAR per transfer`);
  }

  // ---- Jurisdiction and account age -------------------------------------
  if (config.highRiskCountries.includes(beneficiary?.country_code)) {
    fire('HIGH_RISK_JURISDICTION', 'HIGH', 'HOLD',
      `${beneficiary.country_code} is on the platform's high-risk jurisdiction list`);
  }
  const accountAgeHours = (Date.now() - new Date(customer.created_at).getTime()) / 3.6e6;
  if (accountAgeHours < config.newAccountHours && amountQarMinor >= config.reviewThreshold) {
    fire('NEW_ACCOUNT_LARGE_TRANSFER', 'HIGH', 'HOLD',
      `Account is ${accountAgeHours.toFixed(1)}h old and the transfer is above the review threshold`);
  }
  if (customer.pep_flag) {
    fire('PEP_CUSTOMER', 'HIGH', 'ALLOW',
      'Customer is flagged as a politically exposed person: enhanced monitoring applied');
  }

  // ---- Final mapping -----------------------------------------------------
  if (decision !== 'BLOCK' && risk === 'CRITICAL') decision = 'HOLD';
  if (decision === 'ALLOW' && risk === 'LOW') risk = rules.length ? 'MEDIUM' : 'LOW';

  return { decision, riskLevel: risk, rules, config, screening: customerScreen };
}

/** Turn a rule list into a human-readable hold reason for the console. */
function holdReason(rules) {
  const holding = rules.filter((r) => r.effect !== 'ALLOW');
  if (!holding.length) return null;
  return holding.map((r) => `${r.rule}: ${r.detail}`).join(' | ');
}

async function openCase({ customerId, transferId, triggerRule, severity, details = {}, client = db }) {
  const reference = `AML-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;
  const { rows } = await client.query(
    `insert into aml_cases (reference, customer_id, transfer_id, trigger_rule, severity, details)
     values ($1,$2,$3,$4,$5,$6) returning *`,
    [reference, customerId, transferId, triggerRule, severity, details],
  );
  return rows[0];
}

async function listCases({ status = 'OPEN', limit = 100 } = {}) {
  const { rows } = await db.query(
    `select ac.*, c.public_ref as customer_ref, c.full_name as customer_name, c.risk_level,
            t.reference as transfer_reference, t.total_debit_qar_minor, t.payout_currency
       from aml_cases ac
       join customers c on c.id = ac.customer_id
       left join transfers t on t.id = ac.transfer_id
      where ($1 = 'ALL' or ac.status::text = $1)
      order by ac.opened_at desc
      limit $2`,
    [status, Math.min(Number(limit) || 100, 500)],
  );
  return rows;
}

module.exports = { settings, assessTransfer, holdReason, openCase, listCases, RISK_ORDER };
