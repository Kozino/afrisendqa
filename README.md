# AfriSend — Qatar → Africa remittance platform

Production repository: **Expo mobile app** (iOS + Android), **Node/Express API**,
**Supabase Postgres** schema, and a **compliance operations console** served by
the API. Built for QCB-regulated outbound remittance from Qatar to African
corridors, with Flutterwave v3 (bank + mobile money) and Ria (cash pickup) payout
rails.

```
afrisend/
├── App.js, index.js, app.json, eas.json      # Expo app (EAS build config)
├── screens/            33 screens (send, fund, KYC, recipients, profile…)
├── LanguageContext.js  6 languages: en, fr, ar, sw, lg, tw   (t() hooks)
├── WalletContext.js    wallet + transfers + corridors, always from the API
├── AuthContext.js      phone → SMS OTP → JWT session
├── services/api.js     the ONLY network client in the app (no provider keys)
├── backend/            Express API: ledger, AML, maker-checker, webhooks, admin
├── admin-dashboard/    operator console (served at /admin by the API)
├── supabase/migrations 7 SQL migrations — the whole schema
├── docker-compose.yml  local stack (Postgres + API)
├── render.yaml         Render Blueprint (Docker web service)
└── .github/workflows/  CI (schema + smoke test) and EAS builds
```

---

## 1. What is real here (and what you must supply)

**Working end-to-end, verified by an automated test suite that runs on every push:**

* SMS-OTP customer authentication with refresh-token rotation
* Server-side FX pricing → **quote** → transfer → **double-entry ledger**
* AML risk engine (thresholds, structuring, velocity, jurisdiction, new-account,
  tier limits) with automatic holds and AML cases
* Sanctions/PEP screening engine with list imports (no lists = no auto-clear)
* Flutterwave webhook verification (`verif-hash` **and** HMAC signature), dedupe,
  status machine, reversals and refunds
* Four-eyes maker-checker on rates, float, limits, status changes, AML releases
* Immutable audit trail (append-only, enforced by a database trigger)
* RSA-signed QCB AML returns with a verification endpoint, CTR extract
* Treasury float guard: payouts queue when the float can't cover them, with an
  operator action to re-dispatch once the float is funded
* Failed payouts are fully unwound: customer refunded **and** the USD/partner
  floats restored, so the books stay clean
* Wallet↔ledger and suspense↔holds reconciliation checks exposed on the console
  and asserted on every test run
* Screening policy that is documented, tested, and defensible in a review:
  word-order and middle-name variants still hit; a single shared name component
  can only ever reach a human, never auto-block or auto-clear
* Operations console with live SSE telemetry

**You supply (no code changes needed):** Flutterwave live keys + webhook secret,
a Twilio number, a Supabase project, and your own Treasury rates. There is **no
demo data anywhere**: every list in the app and the console is empty until real
records exist, and the API refuses to boot with placeholder secrets.

---

## 2. Local development

```bash
git clone <your-repo> afrisend && cd afrisend

# --- backend -------------------------------------------------------------
cd backend
cp .env.example .env          # fill in: DATABASE_URL, JWT_*, PII_*, FLW_*
npm install
npm run migrate               # applies supabase/migrations/*.sql
npm run create-admin -- --email you@company.qa --name "You" --role SUPER_ADMIN
npm run provision:corridors -- --rate NGN=421.06 --rate GHS=4.28 --rate KES=35.55
npm run import-sanctions -- --source OFAC_SDN --url https://www.treasury.gov/ofac/downloads/sdn.csv
npm start                     # API + console on http://localhost:4000/admin

# --- mobile app ----------------------------------------------------------
cd ..
cp .env.example .env          # EXPO_PUBLIC_API_URL=http://<your-lan-ip>:4000/api/v1
npm install
npx expo start                # scan the QR with Expo Go, or press i / a
```

Or run the whole backend stack with Docker (same image Render builds):

```bash
docker compose up -d db
docker compose run --rm migrate
docker compose up api         # http://localhost:4000/admin
```

### Verify everything works

```bash
cd backend
# needs two operators (maker@test.local / checker@test.local, see scripts/smoke-test.js)
DEV_OTP_CODE=123456 npm run smoke
```

The suite walks the real paths: OTP login → PIN → quote → beneficiary → wallet
funding → transfer (including idempotent replay) → high-value AML hold →
suspense sweep → four-eyes release → float controls → audit trail → signed QCB
report → webhook signature rejection → a live sanctions hit that blocks a
transfer. **82 checks, all passing** on a clean database.

Unit tests (no database required) cover the money arithmetic, pricing
invariants, name-matching policy, TOTP against the RFC 6238 vectors, the RBAC
matrix and PII crypto:

```bash
cd backend && npm test        # 57 tests
```

---

> **No terminal?** `docs/DEPLOY-NO-CLI.md` walks through the entire first
> deployment — database, API, console, Flutterwave and the iOS/Android builds —
> using only browser interfaces. The sections below are the same steps for people
> who prefer a shell.

## 3. Deploy the backend (Render + Supabase)

### 3.1 Supabase

1. Create a project → **SQL Editor** → paste the contents of
   `supabase/migrations/0001…0006` in order (or run `npm run migrate` against the
   connection string).
2. **Project Settings → Database → Connection string → Session pooler** — copy it
   (Render's free tier has no IPv6, the pooler gives you IPv4).
3. Optionally enable Point-in-Time Recovery (recommended for a regulated ledger).

### 3.2 Render

1. Push this repository to GitHub.
2. Render → **New → Blueprint** → select the repo (`render.yaml` is detected).
3. Fill the secrets Render asks for:
   `DATABASE_URL` (Supabase pooler), `JWT_SECRET`, `JWT_REFRESH_SECRET`
   (`openssl rand -hex 32`), `FLW_SECRET_KEY`, `FLW_PUBLIC_KEY`,
   `FLW_WEBHOOK_HASH`, `TWILIO_*`, and `BOOTSTRAP_ADMIN_EMAIL`/`PASSWORD` for the
   first operator (delete those two after the first boot).
   `PII_ENCRYPTION_KEY` and `PII_HMAC_KEY` are generated by Render.
4. Deploy. Health check: `/api/v1/public/healthz`. Console: `https://<service>/admin`.

> **Do not lose `PII_ENCRYPTION_KEY`.** It decrypts QID numbers and account
> numbers. Rotating it without a re-encryption migration makes those fields
> unreadable (the API degrades to "unavailable" rather than crashing).

### 3.3 Dashboard-driven first-run setup (no terminal required)

Set these in Render → **Environment** and redeploy. Each runs only while its
table is empty:

| Variable | Effect |
| --- | --- |
| `BOOTSTRAP_ADMIN_EMAIL` / `_PASSWORD` / `_NAME` | creates the first `SUPER_ADMIN` |
| `BOOTSTRAP_CORRIDORS` | provisions corridors, e.g. `NGN=421.06, GHS=4.28` (`CODE=BASE` or `CODE=BASE/RETAIL`) |
| `BOOTSTRAP_CORRIDOR_SPREAD` | margin kept over the base rate (default 1.5%) |
| `BOOTSTRAP_SANCTIONS_URLS` | imports screening lists, e.g. `OFAC_SDN|https://…/sdn.csv` |

The API logs a bootstrap summary on every boot and warns loudly if an operator
account or corridors are still missing. Operator accounts beyond the first are
created in the console (**Security → Add operator**), where a SUPER_ADMIN can
also enrol in TOTP.

### 3.3b After the first deploy (CLI equivalent)

```bash
# from the Render shell, or locally against the production DATABASE_URL
node backend/scripts/migrate.js
node backend/scripts/create-admin.js --email mlro@yourco.qa --name "MLRO" --role COMPLIANCE_MLRO
node backend/scripts/provision-corridors.js --rate NGN=421.06 --rate GHS=4.28 --rate KES=35.55
node backend/scripts/import-sanctions.js --source OFAC_SDN --url https://www.treasury.gov/ofac/downloads/sdn.csv
```

Then in the Flutterwave dashboard:

* **Settings → API Keys** → copy the live secret/public keys into Render.
* **Settings → Webhooks** → URL `https://<your-api>/api/v1/webhooks/flutterwave`,
  secret hash = the value you set as `FLW_WEBHOOK_HASH`, events
  `charge.completed`, `transfer.completed`, `transfer.failed`, `transfer.reversed`.
* Ria: set `RIA_API_KEY`, `RIA_API_SECRET`, `RIA_AGENT_ID`,
  `RIA_WEBHOOK_SECRET` and point Ria's callback at `/api/v1/webhooks/ria`.

---

## 4. Build the apps (EAS) — preview, simulator and production links

One-time setup:

```bash
npm install -g eas-cli
eas login
eas init                      # writes the real projectId into app.json
eas build:configure
```

Then produce every artifact your team needs. Each command prints a
`https://expo.dev/accounts/<you>/projects/afrisend/builds/<id>` page that contains
the **installable download link**:

| What | Command | Artifact |
| --- | --- | --- |
| **Android preview (APK)** — install directly on a phone | `eas build -p android --profile preview` | `*.apk` |
| **iOS preview** — internal distribution to registered devices | `eas build -p ios --profile preview` | `*.ipa` |
| **iOS Simulator** — run on a Mac simulator without a device | `eas build -p ios --profile simulator` | `*.app` / `*.tar.gz` |
| **Android production (Play)** | `eas build -p android --profile production` | `*.aab` |
| **iOS production (App Store)** | `eas build -p ios --profile production` | `*.ipa` (archive) |
| **Everything at once** | `npm run build:preview` / `npm run build:production` | all of the above |

Or from GitHub: **Actions → EAS Build → Run workflow**, choose profile and
platform. The workflow prints a table of build pages and artifact URLs into the
job summary, and can submit to the stores (`submit: true`).

Store submission:

```bash
eas submit -p android --profile production --latest   # needs secrets/play-service-account.json
eas submit -p ios --profile production --latest       # needs an App Store Connect API key
```

Point the app at your deployed API with the `EXPO_PUBLIC_API_URL` secret (used by
the workflow) or `EXPO_PUBLIC_API_URL` in `.env` for local builds. Default:
`https://afrisend-api.onrender.com/api/v1`.

---

## 5. API surface

Customer (JWT `aud: afrisend-app`):

```
POST /api/v1/auth/otp/request          POST /api/v1/auth/otp/verify
POST /api/v1/auth/pin                  POST /api/v1/auth/refresh
GET  /api/v1/me/profile                PATCH /api/v1/me/profile
GET  /api/v1/me/beneficiaries          POST /api/v1/me/beneficiaries
POST /api/v1/me/beneficiaries/resolve  DELETE /api/v1/me/beneficiaries/:id
POST /api/v1/me/kyc                    GET  /api/v1/me/kyc
POST /api/v1/me/wallet/fundings        GET  /api/v1/me/wallet/fundings
GET  /api/v1/me/transfers              GET  /api/v1/me/transfers/:reference
POST /api/v1/transfers/quotes          POST /api/v1/transfers      (Idempotency-Key)
```

Public: `GET /public/healthz`, `/public/readyz`, `/public/corridors`,
`/public/rates/:currency`, `/public/institutions?country=NG`, `/public/purpose-codes`.

Webhooks: `POST /api/v1/webhooks/flutterwave`, `POST /api/v1/webhooks/ria`.

Operator (JWT `aud: afrisend-admin` + permission per route):

```
POST /api/v1/auth/admin/login          POST /api/v1/auth/admin/refresh
POST /api/v1/auth/admin/logout          GET  /api/v1/auth/config
GET  /api/v1/admin/me                  POST /api/v1/admin/me/mfa   (TOTP enrolment)
GET  /api/v1/admin/overview            GET  /api/v1/admin/stream        (SSE)
GET  /api/v1/admin/transfers           GET  /api/v1/admin/transfers/:ref
POST /api/v1/admin/transfers/:ref/aml-action
GET  /api/v1/admin/aml-cases           POST /api/v1/admin/aml-cases/:ref/action
GET  /api/v1/admin/kyc                 POST /api/v1/admin/kyc/:id/review
GET  /api/v1/admin/maker-checker       POST /api/v1/admin/maker-checker
POST /api/v1/admin/maker-checker/:ref/decide
GET  /api/v1/admin/ledger              GET  /api/v1/admin/ledger/journals/:id
GET  /api/v1/admin/fx                  POST /api/v1/admin/fx/rate-change
GET  /api/v1/admin/liquidity           POST /api/v1/admin/liquidity/topup
POST /api/v1/admin/liquidity/retry-queued
GET  /api/v1/admin/customers           POST /api/v1/admin/customers/:ref/wallet-credit
POST /api/v1/admin/customers/:ref/status
GET  /api/v1/admin/audit-logs          GET  /api/v1/admin/webhooks
POST /api/v1/admin/webhooks/:id/replay
POST /api/v1/admin/reports/qcb         GET  /api/v1/admin/reports
POST /api/v1/admin/reports/qcb/verify  GET  /api/v1/admin/reports/ctr/extract
GET  /api/v1/admin/sanctions
```

Money POSTs require `Idempotency-Key`; customer writes are rate-limited; the
transfer endpoint additionally requires the 6-digit transaction PIN.

---

## 6. Operations console

`https://<your-api>/admin` (or the optional static site in `render.yaml`).

* **Overview** — 24h volume, fee/spread revenue, AML holds, approval queue, float
  positions, sanctions coverage, webhook health, latest audit entries
* **Transfers** — filter/search, inspect any transfer with its screening records,
  timeline, ledger journals **and the AML rules that fired**; release (four-eyes)
  or block with a reason
* **AML cases, Maker-checker, KYC queue** — review workflows
* **Ledger** — journals, journal legs, trial balance, currency positions, float
  shortfalls, integrity flag
* **Treasury** — corridor pricing, market-rate lookup, liquidity pools, top-ups
* **Customers** — directory, monthly usage, wallet credit (bank settlement
  matching), suspend/reactivate via four-eyes
* **Compliance** — generate and open signed QCB returns, CTR extract, sanction
  list coverage, webhook replay
* **Audit trail** — filterable, exportable, read-only by design

The console authenticates with a JWT and the role comes from the token: there is
no role selector. Navigation is scoped to the signed-in role — a tab the role
cannot read is not rendered at all, rather than shown and then failing with a
403. Live updates arrive over SSE (`/admin/stream`); a 30-second poll is the
fallback when the stream drops.

Signing in:

```
https://<your-api>/admin            → login screen
https://<your-api>/admin/index.html → the console (requires a session)
```

TOTP is enrolled in two steps against the same secret (the pending secret is
stored encrypted until the first code confirms it), so a half-finished enrolment
can never lock an operator out:

```bash
curl -X POST .../admin/me/mfa -H "Authorization: Bearer $TOKEN" -d '{}'
#   → { secret, otpauthUrl, nextStep }
curl -X POST .../admin/me/mfa -H "Authorization: Bearer $TOKEN" \
     -d '{"confirmCode":"123456"}'
#   → { mfaEnabled: true } and every later sign-in requires the code
```

---

## 7. Testing, CI and housekeeping

* `.github/workflows/ci.yml` — real Postgres service, migrations, corridor
  provisioning, two operators, API boot, the 42-check smoke test, plus mobile
  bundle parse and import-graph validation.
* `npm run smoke` — the same suite locally.
* `node backend/scripts/housekeeping.js` — expires stale approvals, re-dispatches
  float-queued payouts, alerts on ledger-integrity or missing sanctions lists.
  The API runs this in-process every 5 minutes; `render.yaml` has a commented cron
  for extra resilience.

## 8. Security posture

* Provider secrets never leave the server; the app has no key material.
* PII encrypted at rest (AES-256-GCM) with HMAC blind indexes for lookups.
* Helmet + strict CSP, CORS allow-list, per-route rate limits, JWT audience/type
  checks, bcrypt (cost 12) operator passwords, optional TOTP, account lockout.
* Append-only ledger and audit tables; signed regulatory filings.
* Idempotent money endpoints and webhook dedupe.

## 9. Documentation

* `docs/LEDGER.md` — chart of accounts, journal types, balance invariants,
  reversal journals, float control and the reconciliation functions
* `docs/COMPLIANCE.md` — roles, four-eyes, AML rules, screening, KYC, filing, day-one checklist

## 10. Known limits / next steps

* SSE uses an in-process registry; for more than one API instance add a Postgres
  `LISTEN/NOTIFY` bridge in `services/sse.js` (the event contract stays identical).
* Document images are not uploaded to object storage yet — `ScanIDScreen` captures
  on device and submits the extracted fields; wire `supabase.storage` if you want
  the images retained for the 10-year record.
* Corridor decimal exponents are duplicated in `currencies` (SQL) and
  `lib/money.js`; keep them in sync when adding a currency.
* Real-money go-live still requires: an approved QCB licence, signed partner
  agreements, an independent security review and a penetration test.
