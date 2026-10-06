# Compliance controls (QCB-aligned)

This is what the platform actually enforces, where it is enforced, and what an
operator has to do to make it real on day one.

## 1. Roles are server-side, not a dropdown

| Role | Can read | Can do |
| --- | --- | --- |
| `SUPER_ADMIN` | everything | everything, still bound by four-eyes |
| `COMPLIANCE_MLRO` | transfers, KYC, ledger, audit, customers | **release AML holds**, file QCB returns, raise/approve maker-checker |
| `COMPLIANCE_ANALYST` | transfers, KYC, ledger, audit | investigate, escalate, raise requests (cannot release funds) |
| `TREASURY_OFFICER` | transfers, ledger, FX, liquidity | propose rate/float changes only |
| `SUPPORT_AGENT` | overview, transfers, customers, KYC | read only |
| `AUDITOR` | everything read-only | read, verify filings |

Enforced by `config/permissions.js` + `middleware/auth.js` on every `/admin/*`
route. The former dashboard role switcher has been removed: the role lives in the
JWT and is signed by the server.

## 2. Four-eyes (maker-checker)

Request types that **cannot execute on the operator's own authority**:

`FX_RATE_CHANGE`, `FLOAT_TOPUP`, `FLOAT_RECONCILIATION`,
`CUSTOMER_LIMIT_UPGRADE`, `CUSTOMER_STATUS_CHANGE`, `AML_HOLD_RELEASE`,
`SANCTIONS_MATCH_CLEAR`, `PROVIDER_RAIL_CHANGE` (see `MAKER_CHECKER_REQUIRED`).

* raised with a mandatory note, expire in 24h
* a **different** operator must decide (`maker_checker_distinct` CHECK constraint
  in the database; the API returns 403 and writes a `MAKER_CHECKER_SELF_APPROVAL_BLOCKED`
  audit row at CRITICAL severity — that row is written on a separate connection so
  it survives the rollback)
* approving executes the effect inside the same transaction and stamps the checker

## 3. AML risk engine

Deterministic, explainable rules in `services/aml.js`. Every decision returns the
list of rules that fired, which is stored on the transfer and shown to the analyst.
Thresholds come from `compliance_settings` — never from source code:

| Rule | Default | Effect |
| --- | --- | --- |
| `aml.review_threshold_qar_minor` | 4,000 QAR | MEDIUM, analyst review |
| `aml.hold_threshold_qar_minor` | 10,000 QAR | HIGH, funds to AML suspense |
| `ctr.threshold_qar_minor` | 50,000 QAR | CTR filing flag |
| `structuring.*` | 3 sub-threshold transfers / 48h | HIGH hold |
| `velocity.daily_txn_limit` | 10 transfers / 24h | HIGH hold |
| `aml.high_risk_countries` | IR,KP,SY,CU,MM,… | HIGH hold |
| `aml.new_account_hours` | 24h + above review threshold | HIGH hold |
| `kyc.tier{1,2,3}_monthly_limit_qar_minor` | 20k / 500k / 1M QAR | BLOCK |

Sanctions/PEP screening runs on the customer **and** the beneficiary before any
payout instruction. If no list has been imported, the outcome is
`NOT_SCREENED_NO_LISTS` and the transfer is held — an empty list must never look
like a clean screen.

## 4. Sanctions / PEP data

```
npm run import-sanctions -- --source OFAC_SDN --url https://www.treasury.gov/ofac/downloads/sdn.csv
npm run import-sanctions -- --source UN_CONSOLIDATED --file ./data/un_consolidated.csv
npm run import-sanctions -- --source PEP --file ./data/peps.csv --replace
```

Candidate retrieval is `pg_trgm`-indexed (GIN) over the primary name and every
alias, plus a surname probe; scoring then happens in JS so the policy is
testable and auditable. Thresholds come from `compliance_settings`:
`sanctions.match_threshold` (0.86) → **HIT**, `sanctions.review_threshold`
(0.72) → **REVIEW**, below that → **CLEAR**.

### Matching policy

| Step | Behaviour |
| --- | --- |
| Normalise | Diacritics folded (`José` → `JOSE`), apostrophes/punctuation removed, honorifics dropped (`Mr`, `Sheikh`, `Alhaji`, `Chief`…), case and whitespace collapsed |
| Score | `max(exact, token_sort_ratio, token_set_ratio × overlap)` — LCS-based (indel similarity), so word order and extra middle names do not hide a match |
| Extra tokens | Penalised by the Jaccard overlap of the token sets, so one shared token cannot ride a 1.0 set score |
| **Two-token rule** | Fewer than two matching name components caps the score at **0.80**, so a single shared component (e.g. a common surname) always lands in the review band and reaches a human — it can neither auto-block nor auto-clear |
| Evidence | Every stored result keeps the matched list, the matched alias, the score, the matched-token count and the rule that produced it (`EXACT`, `TOKEN_SORT`, `TOKEN_SET`, `SINGLE_TOKEN_MATCH`, `NO_TOKEN_OVERLAP`) |

Worked examples (locked by `backend/tests/screening.test.js`):

| Query | Listed name | Score | Outcome |
| --- | --- | --- | --- |
| `Muhammad A. Diallo` | `Diallo Muhammad` | 0.94 | HIT |
| `Ivan P. Sanctionov` | `Sanctionov Ivan Petrov` | 0.94 | HIT |
| `Abubakar Sani` | `Abubakr Sani` | 0.80 | REVIEW (spelling variant → human) |
| `John Smith` | `Mohammed Smith` | 0.67 | CLEAR (one shared surname only) |
| `Chinedu Okafor` | `Fatima Al Zahra` | 0.28 | CLEAR |

Clearing a hit requires a written justification and a second operator
(`SANCTIONS_MATCH_CLEAR`). A transfer whose beneficiary is a HIT is blocked
outright (`422 AML_BLOCKED`, nothing moves, and the attempt is audited).

## 5. KYC

* Tiers 1–3 with monthly limits enforced at transfer time
* Document number and address stored **encrypted** (AES-256-GCM); the console and
  the app only ever show the last four digits
* Liveness / face-match scores come from the capture flow; when they are absent the
  request is forced into manual review instead of auto-approval
* Decisions are audited with the reviewer identity and the note

## 6. Audit trail

`audit_logs` is append-only (trigger-enforced, no `UPDATE`/`DELETE` permitted).
Recorded with actor, role, IP, user agent and before/after state: sign-ins,
failed sign-ins, MFA failures, every transfer, every AML decision, every KYC
decision, every maker-checker raise/decision/blocked self-approval, wallet
credits, rate and float changes, report generation, and rejected webhook
signatures.

## 7. Regulatory reporting

* `POST /api/v1/admin/reports/qcb` computes an AML return from the live database:
  transfer counts and volume by corridor, fee and spread revenue, AML cases and
  SARs filed, KYC throughput, sanctions-list coverage, currency positions, float
  positions, and the liquidity coverage ratio.
* The payload is hashed (SHA-256) and signed (RSA-PSS-3072) with a key held in
  `signing_keys` (private half encrypted). `POST /reports/qcb/verify` re-verifies
  years later.
* `GET /api/v1/admin/reports/ctr/extract?date=YYYY-MM-DD` produces the daily CTR
  extract for transfers at or above the CTR threshold.

## 8. Payment security

* Provider secrets exist only in the backend environment; the mobile bundle
  contains no provider key of any kind.
* Flutterwave webhooks are verified twice: the `verif-hash` header compared in
  constant time, and the `flutterwave-signature` HMAC-SHA256 computed over the
  **raw** request body. Failed signatures are rejected with 401 and audited.
* Every accepted webhook is stored in `webhook_events` with a dedupe key, so a
  provider retry cannot double-apply a status change.
* Webhook payloads are never trusted for amounts: the transfer is looked up by
  **our** reference and only a status transition is applied.
* Money POSTs require an `Idempotency-Key`; replays return the original response
  (`Idempotency-Replayed: true`) and a key reused with a different body is a 409.

## 9. What an operator must do before going live

1. Import at least one sanctions list (§4) — otherwise every transfer holds.
2. Provision corridors with real Treasury rates (§README, step 4).
3. Connect Twilio so OTP delivery works in production.
4. Set the Flutterwave webhook URL to
   `https://<your-api>/api/v1/webhooks/flutterwave` and copy the same secret hash
   into `FLW_WEBHOOK_HASH`.
5. Register the QCB licence number and MLRO name so filings print them.
6. Enable TOTP for every operator:

   ```bash
   POST /api/v1/admin/me/mfa {}                      # → secret + otpauth URL (stored, not yet active)
   POST /api/v1/admin/me/mfa { "confirmCode": "…" }  # → mfaEnabled: true
   ```

   The pending secret is persisted encrypted between the two calls, so the code
   from the secret you were shown is the code that activates it. MFA stays off
   until confirmed, so an interrupted enrolment cannot lock you out.
