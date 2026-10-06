'use strict';
/**
 * First-run bootstrap from environment variables.
 *
 * This exists so a first deployment can be completed entirely from a hosting
 * dashboard (Render → Environment) with no terminal and no scripts. Everything
 * here is:
 *
 *   * one-time  — it only runs while the relevant table is still EMPTY, so it
 *                 can stay in the environment forever without overwriting data;
 *   * idempotent — re-running it changes nothing;
 *   * audited   — each action writes a CRITICAL/HIGH row to the immutable trail;
 *   * loud      — it logs exactly what it did, so there is no doubt afterwards.
 *
 * Configured by:
 *   BOOTSTRAP_CORRIDORS="NGN=421.06, GHS=4.28, KES=35.55"      (base rates)
 *   BOOTSTRAP_CORRIDORS="NGN=421.06/415.00"                     (base/retail)
 *   BOOTSTRAP_CORRIDOR_SPREAD=1.5                               (% margin, default)
 *   BOOTSTRAP_CORRIDOR_LIMIT_QAR=20000                          (per-transfer cap)
 *   BOOTSTRAP_SANCTIONS_URLS="OFAC_SDN|https://.../sdn.csv"
 *   BOOTSTRAP_ADMIN_EMAIL / _PASSWORD / _NAME                   (first operator)
 *
 * Corridor rates are a commercial decision: supply YOUR Treasury numbers. If you
 * leave BOOTSTRAP_CORRIDORS empty the corridors stay empty, transfers to every
 * corridor are refused, and the console says so — nothing is invented.
 */
const db = require('../db/pool');
const { env } = require('../config/env');
const audit = require('./audit');
const log = require('../lib/logger');
const money = require('../lib/money');

/** "NGN=421.06, GHS=4.28/4.20" → [{currency, base, retail?}] */
function parseCorridors(raw) {
  return String(raw)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [pair, retailPart] = entry.split('/');
      const [currency, base] = pair.split('=').map((part) => (part || '').trim());
      if (!currency || !base) {
        throw new Error(`BOOTSTRAP_CORRIDORS entry "${entry}" must look like NGN=421.06 or NGN=421.06/415.00`);
      }
      const baseRate = Number(base);
      if (!Number.isFinite(baseRate) || baseRate <= 0) {
        throw new Error(`BOOTSTRAP_CORRIDORS ${currency} has an invalid rate "${base}"`);
      }
      const retailRate = retailPart ? Number(retailPart.trim()) : null;
      if (retailRate !== null && (!Number.isFinite(retailRate) || retailRate <= 0)) {
        throw new Error(`BOOTSTRAP_CORRIDORS ${currency} has an invalid retail rate "${retailPart}"`);
      }
      if (retailRate !== null && retailRate > baseRate) {
        throw new Error(`BOOTSTRAP_CORRIDORS ${currency}: retail rate (${retailRate}) cannot exceed the base rate (${baseRate})`);
      }
      return { currency: currency.toUpperCase(), baseRate, retailRate };
    });
}

/** "OFAC_SDN|https://host/file.csv, PEP|https://host/pep.csv" */
function parseSanctionsSources(raw) {
  return String(raw)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [first, second] = entry.split('|').map((part) => (part || '').trim());
      const source = second ? first.toUpperCase() : 'IMPORTED';
      const url = second || first;
      if (!/^https?:\/\//i.test(url)) throw new Error(`BOOTSTRAP_SANCTIONS_URLS entry "${entry}" must contain an http(s) URL`);
      return { source, url };
    });
}

async function corridorCatalogue() {
  const { rows } = await db.query(
    `select f.currency, f.country_code, f.country_name, f.flag
       from fx_corridors f`,
  );
  return rows;
}

/** Country/flag metadata for the currencies we ship corridors for. */
const CORRIDOR_META = {
  NGN: { country: 'Nigeria', code: 'NG', flag: '🇳🇬' },
  GHS: { country: 'Ghana', code: 'GH', flag: '🇬🇭' },
  KES: { country: 'Kenya', code: 'KE', flag: '🇰🇪' },
  UGX: { country: 'Uganda', code: 'UG', flag: '🇺🇬' },
  TZS: { country: 'Tanzania', code: 'TZ', flag: '🇹🇿' },
  RWF: { country: 'Rwanda', code: 'RW', flag: '🇷🇼' },
  XOF: { country: 'Senegal', code: 'SN', flag: '🇸🇳' },
  XAF: { country: 'Cameroon', code: 'CM', flag: '🇨🇲' },
  EGP: { country: 'Egypt', code: 'EG', flag: '🇪🇬' },
};

async function bootstrapCorridors() {
  if (!env.BOOTSTRAP_CORRIDORS) return { skipped: 'BOOTSTRAP_CORRIDORS not set' };

  const { rows: [existing] } = await db.query('select count(*)::int as count from fx_corridors');
  if (existing.count > 0) {
    return { skipped: `already provisioned (${existing.count} corridors)` };
  }

  const entries = parseCorridors(env.BOOTSTRAP_CORRIDORS);
  const spread = Number(env.BOOTSTRAP_CORRIDOR_SPREAD || 1.5);
  const limitMinor = money.toMinor(env.BOOTSTRAP_CORRIDOR_LIMIT_QAR || '20000', 'QAR');
  const created = [];
  const skipped = [];

  for (const entry of entries) {
    const meta = CORRIDOR_META[entry.currency];
    if (!meta) {
      skipped.push(`${entry.currency} (no country metadata; provision it from the console instead)`);
      continue;
    }
    const retail = entry.retailRate ?? Number((entry.baseRate * (1 - spread / 100)).toFixed(6));
    const { rows } = await db.query(
      `insert into fx_corridors
         (currency, country_code, country_name, flag, base_rate, retail_rate,
          min_send_qar_minor, max_send_qar_minor, per_txn_limit_qar_minor, active, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,'env-bootstrap')
       on conflict (currency) do nothing
       returning currency`,
      [entry.currency, meta.code, meta.country, meta.flag, entry.baseRate, retail, 1000, limitMinor, limitMinor],
    );
    if (rows.length) {
      await db.query(
        `insert into fx_rate_history (currency, base_rate, retail_rate, source, changed_by)
         values ($1,$2,$3,'ENV_BOOTSTRAP','environment')`,
        [entry.currency, entry.baseRate, retail],
      );
      created.push(`${entry.currency} base ${entry.baseRate} → retail ${retail}`);
    }
  }

  if (created.length) {
    await audit.record({
      actorType: 'SYSTEM', action: 'CORRIDORS_BOOTSTRAPPED', entityType: 'fx_corridors',
      severity: 'HIGH',
      metadata: { created, skipped, source: 'BOOTSTRAP_CORRIDORS' },
    });
  }
  return { created, skipped };
}

/** Parse a CSV of sanctions entries (header: name,aliases,dob,nationality,reference). */
function parseSanctionsCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else field += char;
    } else if (char === '"') inQuotes = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (char !== '\r') field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }

  const clean = rows.filter((r) => r.some((cell) => cell && cell.trim()));
  if (!clean.length) return [];
  const header = clean[0].map((h) => String(h).trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  const iName = idx('name') >= 0 ? idx('name') : 0;
  const iAliases = idx('aliases');
  const iDob = idx('dob');
  const iNat = idx('nationality');
  const iRef = idx('reference');

  return clean.slice(1).map((r) => ({
    name: (r[iName] || '').trim().toUpperCase(),
    aliases: iAliases >= 0 && r[iAliases] ? r[iAliases].split('|').map((s) => s.trim().toUpperCase()).filter(Boolean) : [],
    dob: iDob >= 0 && /^\d{4}-\d{2}-\d{2}$/.test((r[iDob] || '').trim()) ? r[iDob].trim() : null,
    nationality: iNat >= 0 && /^[A-Za-z]{2}$/.test((r[iNat] || '').trim()) ? r[iNat].trim().toUpperCase() : null,
    reference: iRef >= 0 ? (r[iRef] || '').trim() : null,
  })).filter((entry) => entry.name);
}

async function bootstrapSanctions() {
  if (!env.BOOTSTRAP_SANCTIONS_URLS) return { skipped: 'BOOTSTRAP_SANCTIONS_URLS not set' };

  const { rows: [existing] } = await db.query('select count(*)::int as count from sanctions_list');
  if (existing.count > 0) {
    return { skipped: `sanctions list already loaded (${existing.count} entries)` };
  }

  const sources = parseSanctionsSources(env.BOOTSTRAP_SANCTIONS_URLS);
  const results = [];

  for (const source of sources) {
    try {
      const response = await fetch(source.url, {
        headers: { 'User-Agent': 'AfriSend-Compliance/1.0 (+compliance screening import)' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      const entries = parseSanctionsCsv(text);
      if (!entries.length) throw new Error('no parsable rows (expected a CSV with a name column)');

      let inserted = 0;
      for (const entry of entries) {
        const { rowCount } = await db.query(
          `insert into sanctions_list
             (list_source, entity_type, primary_name, aliases, date_of_birth, nationality, reference)
           values ($1,'INDIVIDUAL',$2,$3,$4,$5,$6)
           on conflict (list_source, primary_name, coalesce(date_of_birth,'1900-01-01'::date)) do nothing`,
          [source.source, entry.name, entry.aliases, entry.dob, entry.nationality, entry.reference],
        );
        inserted += rowCount;
      }
      results.push({ source: source.source, url: source.url, parsed: entries.length, inserted });
    } catch (err) {
      results.push({ source: source.source, url: source.url, error: err.message });
      log.error('sanctions bootstrap source failed', { url: source.url, err: err.message });
    }
  }

  const loaded = results.filter((r) => r.inserted > 0);
  if (loaded.length) {
    await audit.record({
      actorType: 'SYSTEM', action: 'SANCTIONS_LIST_BOOTSTRAPPED', entityType: 'sanctions_list',
      severity: 'HIGH', metadata: { results },
    });
  }
  return { results };
}

async function bootstrapAdmin() {
  if (!env.BOOTSTRAP_ADMIN_EMAIL || !env.BOOTSTRAP_ADMIN_PASSWORD) {
    return { skipped: 'BOOTSTRAP_ADMIN_EMAIL / _PASSWORD not set' };
  }
  const { rows: [existing] } = await db.query('select count(*)::int as count from admin_users');
  if (existing.count > 0) return { skipped: `operators already exist (${existing.count})` };

  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash(env.BOOTSTRAP_ADMIN_PASSWORD, 12);
  const { rows } = await db.query(
    `insert into admin_users (email, full_name, password_hash, role)
     values ($1,$2,$3,'SUPER_ADMIN') returning id, email`,
    [env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase(), env.BOOTSTRAP_ADMIN_NAME, hash],
  );
  await audit.record({
    actorType: 'SYSTEM', action: 'ADMIN_BOOTSTRAPPED', entityType: 'admin_user', entityId: rows[0].id,
    severity: 'CRITICAL',
    metadata: { email: rows[0].email, note: 'Change this password in the console immediately.' },
  });
  return { created: rows[0].email };
}

/**
 * Run every configured bootstrap step. Never throws: a failure here must not
 * stop the API from starting (the console is how you would diagnose it).
 */
async function run() {
  const summary = {};
  for (const [name, fn] of [
    ['operators', bootstrapAdmin],
    ['corridors', bootstrapCorridors],
    ['sanctions', bootstrapSanctions],
  ]) {
    try {
      // eslint-disable-next-line no-await-in-loop
      summary[name] = await fn();
    } catch (err) {
      summary[name] = { error: err.message };
      log.error('bootstrap step failed', { step: name, err: err.message });
    }
  }
  const didSomething = Object.values(summary).some((entry) => entry && (entry.created || entry.results));
  if (didSomething) log.info('first-run bootstrap complete', summary);
  return summary;
}

module.exports = {
  run, bootstrapAdmin, bootstrapCorridors, bootstrapSanctions,
  parseCorridors, parseSanctionsCsv, CORRIDOR_META,
};
