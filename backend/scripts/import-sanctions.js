#!/usr/bin/env node
'use strict';
/**
 * Import real sanctions / PEP data. Screening cannot clear a transfer until at
 * least one list is loaded (see `sanctions.block_if_no_lists`).
 *
 * Supported inputs
 *   --source OFAC_SDN        --file sdn.csv          (US Treasury SDN, primary + alt names)
 *   --source UN_CONSOLIDATED --file consolidated.csv (UN Security Council list)
 *   --source PEP             --file peps.csv         (name,aliases,dob,nationality)
 *   --source QCB_LOCAL       --file local.csv        (your own local list)
 *   --url https://...        downloads first (e.g. https://www.treasury.gov/ofac/downloads/sdn.csv)
 *
 * Examples
 *   npm run import-sanctions -- --source OFAC_SDN --url https://www.treasury.gov/ofac/downloads/sdn.csv
 *   npm run import-sanctions -- --source PEP --file ./data/peps.csv --replace
 */
require('dotenv').config();
const fs = require('fs');
const db = require('../db/pool');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const t = argv[i];
    if (!t.startsWith('--')) continue;
    const k = t.slice(2);
    const v = argv[i + 1];
    if (v && !v.startsWith('--')) { args[k] = v; i += 1; } else { args[k] = true; }
  }
  return args;
}

/** Minimal RFC4180 CSV parser (handles quoted fields, embedded commas/newlines). */
function parseCsv(text) {
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
  return rows.filter((r) => r.some((c) => c && c.trim()));
}

function normaliseDate(value) {
  if (!value) return null;
  const clean = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  const m = clean.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
  if (m) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const idx = months.indexOf(m[2].slice(0, 3).toLowerCase());
    if (idx >= 0) return `${m[3]}-${String(idx + 1).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }
  const parsed = new Date(clean);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/** OFAC SDN "sdn.csv": ent_num,SDN_Name,SDN_Type,Program,Title,Call_Sign,Vessel_Type,Tonnage,GRT,Vessel_Flag,Vessel_Owner,Remarks */
function mapOfac(rows) {
  const byEntity = new Map();
  for (const r of rows) {
    const name = (r[1] || '').trim().replace(/"/g, '');
    if (!name) continue;
    const entityId = r[0];
    const existing = byEntity.get(entityId);
    const record = existing || {
      primary_name: name,
      aliases: [],
      entity_type: (r[2] || 'INDIVIDUAL').toUpperCase().includes('ENTITY') ? 'ENTITY' : 'INDIVIDUAL',
      program: (r[3] || '').trim(),
      reference: entityId,
      date_of_birth: null,
      nationality: null,
      remarks: (r[11] || ''),
    };
    const dobMatch = record.remarks.match(/DOB\s+([0-9]{1,2}\s+[A-Za-z]{3}\s+[0-9]{4}|[0-9]{4})/i);
    if (dobMatch) record.date_of_birth = normaliseDate(dobMatch[1]);
    if (record.primary_name.toLowerCase() !== name.toLowerCase() && !record.aliases.includes(name)) {
      record.aliases.push(name);
    }
    byEntity.set(entityId, record);
  }
  return [...byEntity.values()];
}

/** UN consolidated list export: name,aliases,dob,nationality,reference,listed_on */
function mapGeneric(rows) {
  const [header, ...data] = rows;
  const indexOf = (key) => header.findIndex((h) => String(h).trim().toLowerCase() === key);
  const iName = indexOf('name') >= 0 ? indexOf('name') : 0;
  const iAliases = indexOf('aliases');
  const iDob = indexOf('dob');
  const iNat = indexOf('nationality');
  const iRef = indexOf('reference');

  return data.map((r) => ({
    primary_name: (r[iName] || '').trim(),
    aliases: iAliases >= 0 && r[iAliases] ? r[iAliases].split('|').map((s) => s.trim()).filter(Boolean) : [],
    date_of_birth: iDob >= 0 ? normaliseDate(r[iDob]) : null,
    nationality: iNat >= 0 && /^[A-Za-z]{2}$/.test((r[iNat] || '').trim()) ? r[iNat].trim().toUpperCase() : null,
    reference: iRef >= 0 ? r[iRef] : null,
    entity_type: 'INDIVIDUAL',
    program: null,
  })).filter((r) => r.primary_name);
}

async function main() {
  const args = parseArgs(process.argv);
  const source = String(args.source || '').toUpperCase();
  if (!source) {
    console.error('Usage: npm run import-sanctions -- --source OFAC_SDN --file sdn.csv   (or --url https://...)');
    process.exit(1);
  }

  let csvText;
  if (args.url) {
    console.log(`Downloading ${args.url} ...`);
    const response = await fetch(args.url);
    if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
    csvText = await response.text();
  } else if (args.file) {
    csvText = fs.readFileSync(args.file, 'utf8');
  } else {
    throw new Error('Provide --file <path> or --url <https://...>');
  }

  const rows = parseCsv(csvText);
  const records = source === 'OFAC_SDN' ? mapOfac(rows) : mapGeneric(rows);
  if (!records.length) throw new Error('No records parsed — check the file format');

  const client = await db.pool.connect();
  try {
    await client.query('begin');
    if (args.replace) {
      await client.query('delete from sanctions_list where list_source = $1', [source]);
      console.log(`Cleared previous ${source} entries.`);
    }

    let inserted = 0;
    for (const record of records) {
      const { rowCount } = await client.query(
        `insert into sanctions_list
           (list_source, entity_type, primary_name, aliases, date_of_birth, nationality, program, reference, listed_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (list_source, primary_name, coalesce(date_of_birth,'1900-01-01'::date)) do nothing`,
        [source, record.entity_type || 'INDIVIDUAL', record.primary_name, record.aliases || [],
          record.date_of_birth, record.nationality, record.program, record.reference,
          normaliseDate(args.listed)],
      );
      inserted += rowCount;
    }
    await client.query('commit');

    const { rows: [coverage] } = await client.query(
      'select count(*)::int as total from sanctions_list where list_source = $1', [source],
    );
    console.log(`\n✔ ${source}: ${inserted} new entries inserted, ${coverage.total} total on file.`);
    console.log('  Transfers now screen against this list. Review thresholds with:');
    console.log("  select * from compliance_settings where key like 'sanctions.%';\n");
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
    await db.close();
  }
}

main().catch((err) => {
  console.error(`\n✗ Import failed: ${err.message}\n`);
  process.exit(1);
});
