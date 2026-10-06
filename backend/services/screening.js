'use strict';
/**
 * Sanctions / PEP / adverse-media name screening.
 *
 * The engine scores names against whatever lists the compliance team has
 * imported into `sanctions_list`. Nothing is hard-coded and nothing is
 * "simulated". Import real data with:
 *
 *     npm run import-sanctions -- --source OFAC_SDN --file ./data/sdn.csv
 *     npm run import-sanctions -- --source UN_CONSOLIDATED --file ./data/un.csv
 *
 * If the tables are empty the outcome is NOT_SCREENED_NO_LISTS and a transfer
 * will NOT be auto-cleared while `sanctions.block_if_no_lists` is true. That is
 * deliberate: an empty list must never look like a clean screen.
 *
 * ── Matching policy (documented so an examiner can test it) ───────────────
 *
 *   normalize   diacritics folded, punctuation/initials punctuation removed,
 *               honorifics dropped, whitespace collapsed, upper-cased
 *   compare     score = max(exact, token_sort_ratio, token_set_ratio × overlap)
 *               — token_sort_ratio: same tokens in any order, LCS-based
 *               — token_set_ratio: tolerant of extra tokens (middle names)
 *               — overlap: matched ÷ (matched + unmatched) tokens, so a single
 *                 shared token cannot ride a 1.0 set score
 *   two-token   a score is capped at 0.80 when FEWER THAN TWO name components
 *   rule        match. A single shared component ("John Smith" vs "Mohammed
 *               Smith") therefore lands in the review band and reaches a human
 *               instead of auto-blocking or auto-clearing on its own.
 *
 *   outcome     score ≥ sanctions.match_threshold  (0.86) → HIT
 *               score ≥ sanctions.review_threshold (0.72) → REVIEW
 *               otherwise → CLEAR
 */
const db = require('../db/pool');

const HONORIFICS = new Set([
  'MR', 'MRS', 'MS', 'MISS', 'DR', 'ENG', 'PROF', 'SIR', 'MADAM', 'SHEIKH',
  'SHEIK', 'SHAIKH', 'HAJI', 'HAJJ', 'ALHAJI', 'CHIEF', 'HON', 'BARR',
]);

/** Diacritic folding + punctuation removal + token normalisation. */
function normalizeName(name) {
  if (!name) return '';
  return String(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'`]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token && !HONORIFICS.has(token))
    .join(' ')
    .trim();
}

function tokens(name) {
  const normalized = normalizeName(name);
  return normalized ? normalized.split(' ').filter(Boolean) : [];
}

/** Longest common subsequence length (dynamic programming, short strings only). */
function lcsLength(a, b) {
  if (!a.length || !b.length) return 0;
  let previous = new Array(b.length + 1).fill(0);
  let current = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = a[i - 1] === b[j - 1]
        ? previous[j - 1] + 1
        : Math.max(previous[j], current[j - 1]);
    }
    [previous, current] = [current, previous];
    current.fill(0);
  }
  return previous[b.length];
}

/** Indel similarity: 2·LCS ÷ total length. Order sensitive. */
function ratio(a, b) {
  if (!a && !b) return 0;
  if (a === b) return 1;
  const total = a.length + b.length;
  if (!total) return 0;
  return (2 * lcsLength(a, b)) / total;
}

/** Same tokens, any order — catches "Diallo Muhammad" vs "Muhammad Diallo". */
function tokenSortRatio(a, b) {
  const ta = tokens(a).sort().join(' ');
  const tb = tokens(b).sort().join(' ');
  if (!ta || !tb) return 0;
  return ratio(ta, tb);
}

/**
 * Tolerant of extra tokens (middle names, initials) but penalised by how much
 * unmatched material there is, so one shared token cannot score 1.0.
 */
function tokenSetRatio(a, b) {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;

  const inter = [...ta].filter((token) => tb.has(token)).sort();
  const diffA = [...ta].filter((token) => !tb.has(token)).sort();
  const diffB = [...tb].filter((token) => !ta.has(token)).sort();
  if (!inter.length) return 0;

  const matched = inter.length;
  const unmatched = diffA.length + diffB.length;
  const overlap = matched / (matched + unmatched);

  const setScore = Math.max(
    1,
    ratio([...inter, ...diffA].join(' '), inter.join(' ')),
    ratio(inter.join(' '), [...inter, ...diffB].join(' ')),
  );
  return setScore * overlap;
}

/** Number of whole name components shared by both names. */
function matchedTokenCount(a, b) {
  const tb = new Set(tokens(b));
  return tokens(a).filter((token) => tb.has(token)).length;
}

const SINGLE_TOKEN_CEILING = 0.80; // review band, never a blocking confidence

/**
 * Composite score in [0,1]. `matchedTokens` is returned for the audit trail so
 * an analyst can see why a candidate was surfaced.
 */
function nameScore(a, b, { returnDetail = false } = {}) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return returnDetail ? { score: 0, matchedTokens: 0, reason: 'EMPTY_NAME' } : 0;

  if (na === nb) return returnDetail ? { score: 1, matchedTokens: tokens(na).length, reason: 'EXACT' } : 1;

  const sorted = tokenSortRatio(na, nb);
  const set = tokenSetRatio(na, nb);
  const matched = matchedTokenCount(na, nb);

  let score = Math.max(sorted, set);
  let reason = sorted >= set ? 'TOKEN_SORT' : 'TOKEN_SET';

  if (matched < 2) {
    score = Math.min(score, SINGLE_TOKEN_CEILING);
    reason = matched === 0 ? 'NO_TOKEN_OVERLAP' : 'SINGLE_TOKEN_MATCH';
  }

  const rounded = Number(score.toFixed(4));
  return returnDetail ? { score: rounded, matchedTokens: matched, reason } : rounded;
}

async function getThresholds(client = db) {
  const { rows } = await client.query(
    `select key, value #>> '{}' as value from compliance_settings
      where key in ('sanctions.match_threshold','sanctions.review_threshold','sanctions.block_if_no_lists')`,
  );
  const map = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return {
    match: Number(map['sanctions.match_threshold'] ?? 0.86),
    review: Number(map['sanctions.review_threshold'] ?? 0.72),
    blockIfNoLists: String(map['sanctions.block_if_no_lists'] ?? 'true') === 'true',
  };
}

/**
 * Screen a name. Returns a persistable snapshot:
 *   { outcome, bestScore, matchCount, listsChecked, matches[] }
 */
async function screenName(name, { client = db, limit = 40 } = {}) {
  const normalized = normalizeName(name);
  const detail = nameScore(normalized, normalized, { returnDetail: true });
  const thresholds = await getThresholds(client);

  if (normalized.replace(/\s/g, '').length < 4) {
    return {
      outcome: 'REVIEW',
      bestScore: 0,
      matchCount: 0,
      listsChecked: [],
      matches: [],
      reason: 'NAME_TOO_SHORT_TO_SCREEN',
      queryName: normalized,
      thresholds,
    };
  }

  const { rows: listRows } = await client.query('select distinct list_source from sanctions_list');
  const listsChecked = listRows.map((row) => row.list_source);

  if (!listsChecked.length) {
    return {
      outcome: thresholds.blockIfNoLists ? 'NOT_SCREENED_NO_LISTS' : 'CLEAR',
      bestScore: 0,
      matchCount: 0,
      listsChecked: [],
      matches: [],
      reason: 'NO_SANCTIONS_LISTS_IMPORTED',
      queryName: normalized,
      thresholds,
    };
  }

  // Candidate retrieval: trigram similarity (GIN indexed) on the whole name and
  // on the surname, on both the primary name and every alias. Scoring happens in
  // JS so the policy above is testable and auditable.
  const queryTokens = tokens(normalized);
  const surname = queryTokens[queryTokens.length - 1] || normalized;

  const { rows: candidates } = await client.query(
    `select id, list_source, entity_type, primary_name, aliases, date_of_birth,
            nationality, program, reference,
            greatest(
              similarity(primary_name, $1),
              coalesce((select max(similarity(alias, $1)) from unnest(aliases) as alias), 0)
            ) as pg_score
       from sanctions_list
      where primary_name % $1
         or exists (select 1 from unnest(aliases) as alias where alias % $1)
         or primary_name ilike '%' || $2 || '%'
         or exists (select 1 from unnest(aliases) as alias where alias ilike '%' || $2 || '%')
      order by pg_score desc
      limit $3`,
    [normalized, surname, limit],
  );

  const matches = [];
  for (const candidate of candidates) {
    const names = [candidate.primary_name, ...(candidate.aliases || [])];
    let best = { score: 0, matchedTokens: 0, reason: 'NO_MATCH', matchedOn: candidate.primary_name };
    for (const candidateName of names) {
      const scored = nameScore(normalized, candidateName, { returnDetail: true });
      if (scored.score > best.score) best = { ...scored, matchedOn: candidateName };
    }
    if (best.score >= thresholds.review) {
      matches.push({
        listSource: candidate.list_source,
        entityType: candidate.entity_type,
        name: candidate.primary_name,
        matchedOn: best.matchedOn,
        score: best.score,
        matchedTokens: best.matchedTokens,
        reason: best.reason,
        dateOfBirth: candidate.date_of_birth,
        nationality: candidate.nationality,
        program: candidate.program,
        reference: candidate.reference,
      });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  const bestScore = matches[0]?.score || 0;
  const outcome = matches.some((entry) => entry.score >= thresholds.match)
    ? 'HIT'
    : matches.length ? 'REVIEW' : 'CLEAR';

  return {
    outcome,
    bestScore,
    matchCount: matches.length,
    listsChecked,
    matches: matches.slice(0, 10),
    queryName: normalized,
    thresholds,
    detail,
  };
}

/**
 * Persist a screening snapshot for the audit trail.
 *
 * Note the JSON.stringify on `matches`: it is a jsonb column, and node-postgres
 * serialises a plain JS array as a PostgreSQL array literal ("{...}") rather
 * than JSON, which the server rejects with 22P02. `lists_checked` really is a
 * text[] column, so it is passed as an array on purpose.
 */
async function persist({
  subjectType, subjectId, result, client = db,
}) {
  const { rows } = await client.query(
    `insert into screening_results
       (subject_type, subject_id, query_name, lists_checked, best_score, match_count, outcome, matches)
     values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     returning id, screened_at`,
    [subjectType, subjectId, result.queryName || '', result.listsChecked || [],
      result.bestScore || 0, result.matchCount || 0, result.outcome,
      JSON.stringify(result.matches || [])],
  );
  return rows[0];
}

async function screenAndPersist({
  subjectType, subjectId, name, client = db,
}) {
  const result = await screenName(name, { client });
  const stored = await persist({
    subjectType, subjectId, result, client,
  });
  return { ...result, screeningId: stored.id, screenedAt: stored.screened_at };
}

async function stats(client = db) {
  const { rows } = await client.query(
    `select list_source, count(*)::int as entries, max(imported_at) as last_import
       from sanctions_list group by list_source order by list_source`,
  );
  return rows;
}

module.exports = {
  normalizeName, tokens, lcsLength, ratio, tokenSortRatio, tokenSetRatio,
  matchedTokenCount, nameScore, screenName, screenAndPersist, persist, stats,
  getThresholds, SINGLE_TOKEN_CEILING,
};
