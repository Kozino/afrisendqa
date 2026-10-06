#!/usr/bin/env node
'use strict';
/**
 * Provision the payout corridors.
 *
 * Corridors are *configuration*, not demo data: nothing is shipped hard-coded,
 * because the rates you launch with are a commercial decision and must be
 * signed off by your Treasury team.
 *
 * Rates are taken from, in order of preference:
 *   1. --rate NGN=421.06 (explicit values supplied by Treasury)
 *   2. the live Flutterwave /rates endpoint (real market data)
 * If neither is available for a currency, that corridor is skipped — the script
 * never invents a rate.
 *
 *   # From live market data (needs working FLW keys):
 *   npm run provision:corridors -- --spread 1.5
 *
 *   # Explicit Treasury rates:
 *   npm run provision:corridors -- --rate NGN=421.06 --rate GHS=4.28 --rate KES=35.55
 *
 *   # Update rates that already exist (otherwise existing rows are left alone):
 *   npm run provision:corridors -- --force --rate NGN=419.80
 */
require('dotenv').config();
const db = require('../db/pool');
const engine = require('../services/remittanceEngine');

const CATALOGUE = [
  { currency: 'NGN', countryCode: 'NG', country: 'Nigeria', flag: '🇳🇬', rail: 'FLUTTERWAVE_BANK' },
  { currency: 'GHS', countryCode: 'GH', country: 'Ghana', flag: '🇬🇭', rail: 'FLUTTERWAVE_MOBILE_MONEY' },
  { currency: 'KES', countryCode: 'KE', country: 'Kenya', flag: '🇰🇪', rail: 'FLUTTERWAVE_MOBILE_MONEY' },
  { currency: 'UGX', countryCode: 'UG', country: 'Uganda', flag: '🇺🇬', rail: 'FLUTTERWAVE_MOBILE_MONEY' },
  { currency: 'TZS', countryCode: 'TZ', country: 'Tanzania', flag: '🇹🇿', rail: 'FLUTTERWAVE_MOBILE_MONEY' },
  { currency: 'RWF', countryCode: 'RW', country: 'Rwanda', flag: '🇷🇼', rail: 'FLUTTERWAVE_MOBILE_MONEY' },
  { currency: 'XOF', countryCode: 'SN', country: 'Senegal', flag: '🇸🇳', rail: 'RIA_CASH_PICKUP' },
  { currency: 'XAF', countryCode: 'CM', country: 'Cameroon', flag: '🇨🇲', rail: 'RIA_CASH_PICKUP' },
  { currency: 'EGP', countryCode: 'EG', country: 'Egypt', flag: '🇪🇬', rail: 'FLUTTERWAVE_BANK' },
];

function parseArgs(argv) {
  const args = { rate: {} };
  for (let i = 2; i < argv.length; i += 1) {
    const t = argv[i];
    if (!t.startsWith('--')) continue;
    const key = t.slice(2);
    const value = argv[i + 1];
    if (key === 'rate' && value && value.includes('=')) {
      const [currency, rate] = value.split('=');
      args.rate[currency.toUpperCase()] = Number(rate);
      i += 1;
    } else if (value && !value.startsWith('--')) {
      args[key] = value; i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const spreadPercent = Number(args.spread || 1.5);           // margin kept on top of the mid rate
  const perTxnLimitQar = Number(args.limit || 20000);
  const minSendQar = Number(args.min || 10);
  const maxSendQar = Number(args.max || 20000);
  const force = Boolean(args.force);

  const { rows: currencies } = await db.query('select code, exponent from currencies');
  const known = new Set(currencies.map((c) => c.code));

  console.log('\nProvisioning corridors');
  console.log(`  spread ${spreadPercent}%  •  per-transfer cap ${perTxnLimitQar} QAR  •  ${force ? 'overwrite existing rates' : 'keep existing rates'}\n`);

  const results = [];
  for (const corridor of CATALOGUE) {
    if (!known.has(corridor.currency)) {
      results.push({ ...corridor, status: 'SKIPPED', reason: `currency ${corridor.currency} not in the currencies table` });
      continue;
    }

    let base = args.rate[corridor.currency];
    let source = 'TREASURY_EXPLICIT';

    if (!base) {
      const market = await engine.getRate('QAR', corridor.currency, 1000);
      if (market.ok) {
        base = market.rate;
        source = 'FLUTTERWAVE_MARKET';
      } else {
        results.push({
          ...corridor, status: 'SKIPPED',
          reason: `no --rate supplied and the market rate is unavailable (${market.error})`,
        });
        continue;
      }
    }

    const retail = Number((base * (1 - spreadPercent / 100)).toFixed(6));

    const { rows: existing } = await db.query('select id, base_rate, retail_rate from fx_corridors where currency = $1', [corridor.currency]);
    if (existing[0] && !force) {
      results.push({
        ...corridor, status: 'EXISTS',
        detail: `base ${existing[0].base_rate} / retail ${existing[0].retail_rate} (use --force to update)`,
      });
      continue;
    }

    await db.query(
      `insert into fx_corridors
         (currency, country_code, country_name, flag, base_rate, retail_rate,
          min_send_qar_minor, max_send_qar_minor, per_txn_limit_qar_minor, active, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,'provision-corridors')
       on conflict (currency) do update
         set base_rate = excluded.base_rate, retail_rate = excluded.retail_rate,
             per_txn_limit_qar_minor = excluded.per_txn_limit_qar_minor,
             updated_by = excluded.updated_by, updated_at = now()`,
      [corridor.currency, corridor.countryCode, corridor.country, corridor.flag, base, retail,
        Math.round(minSendQar * 100), Math.round(maxSendQar * 100), Math.round(perTxnLimitQar * 100)],
    );
    await db.query(
      `insert into fx_rate_history (currency, base_rate, retail_rate, source, changed_by)
       values ($1,$2,$3,$4,'provision-corridors')`,
      [corridor.currency, base, retail, source],
    );

    results.push({ ...corridor, status: existing[0] ? 'UPDATED' : 'CREATED', detail: `base ${base} → retail ${retail} (${source})` });
  }

  for (const r of results) {
    const icon = r.status === 'CREATED' ? '✔' : r.status === 'UPDATED' ? '↑' : r.status === 'EXISTS' ? '=' : '•';
    console.log(`  ${icon} ${r.currency.padEnd(4)} ${r.country.padEnd(10)} ${r.status.padEnd(8)} ${r.detail || r.reason}`);
  }

  await db.query(
    `insert into audit_logs (actor_type, actor_email, action, entity_type, severity, metadata)
     values ('SYSTEM','cli','CORRIDORS_PROVISIONED','fx_corridors','HIGH',$1)`,
    [JSON.stringify({ spreadPercent, perTxnLimitQar, force, results })],
  );

  const { rows: [active] } = await db.query('select count(*)::int as count from fx_corridors where active');
  console.log(`\n  ${active.count} active corridor(s). Edit rates through the console (Treasury → FX):`);
  console.log('  rate changes are queued as maker-checker requests, never applied silently.\n');
  await db.close();
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
});
