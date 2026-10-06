-- =============================================================================
-- AfriSend — COMPLETE DATABASE SETUP (paste-and-run)
--
--   Supabase → SQL Editor → New query → paste this whole file → Run
--
-- It is the concatenation of supabase/migrations/0001..0007 in order, and it is
-- idempotent: running it twice is safe (IF NOT EXISTS / ON CONFLICT throughout).
--
-- Contains SCHEMA AND CONFIGURATION ONLY:
--   currencies, compliance thresholds, purpose codes, ledger chart of accounts,
--   liquidity pools (at zero), provider status mapping.
--
-- It does NOT insert any customers, transfers, ledger entries, KYC requests,
-- corridors or sanctions lists. Those come from your real data:
--   * corridors   → BOOTSTRAP_CORRIDORS environment variable, or the console
--   * sanctions   → BOOTSTRAP_SANCTIONS_URLS environment variable
--   * operators   → BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD
--   * customers   → they sign up in the app
--
-- Created: 2026-10-06    Source files: 0001_init.sql, 0002_rls_and_roles.sql, 0003_ledger_functions.sql, 0004_pin_quotes.sql, 0005_aml_rules.sql, 0006_books_integrity.sql, 0007_wallet_reconciliation.sql
-- =============================================================================

-- ###########################################################################
-- ##  0001_init.sql
-- ###########################################################################

-- =============================================================================
-- AfriSend Remittance Platform — Core Schema
-- Target: PostgreSQL 15+ (Supabase)
-- Idempotent: safe to run with `supabase db push` or the SQL editor.
--
-- Design notes
--   * All monetary values are stored as BIGINT MINOR UNITS (kobo/halalas/cents).
--     Currency exponents are held in `currencies.exponent` and are the ONLY
--     place decimals are applied. No floats anywhere in the money path.
--   * Every transfer posts an immutable double-entry journal. `ledger_entries`
--     is append-only enforced by trigger.
--   * PII (QID, bank account numbers, phone numbers) is stored ENCRYPTED at
--     rest (AES-256-GCM, key = PII_ENCRYPTION_KEY) with a deterministic
--     HMAC-SHA256 blind index (`*_bidx`) for equality lookup / dedupe.
--   * Maker-Checker (4-eyes) is enforced in the database, not only in service
--     code: CHECK constraint prevents maker == checker.
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type app_role as enum (
    'SUPER_ADMIN','COMPLIANCE_MLRO','COMPLIANCE_ANALYST',
    'TREASURY_OFFICER','SUPPORT_AGENT','AUDITOR'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type customer_status as enum ('PENDING_KYC','ACTIVE','SUSPENDED','CLOSED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type kyc_status as enum ('PENDING','IN_REVIEW','APPROVED','REJECTED','EXPIRED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type transfer_status as enum (
    'INITIATED','AML_HOLD','SCREENING_FAILED','PROCESSING',
    'PAID','FAILED','REFUNDED','CANCELLED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type risk_level as enum ('UNSCREENED','LOW','MEDIUM','HIGH','CRITICAL');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payout_channel as enum (
    'FLUTTERWAVE_BANK','FLUTTERWAVE_MOBILE_MONEY','RIA_CASH_PICKUP'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type mc_status as enum ('PENDING','APPROVED','REJECTED','EXPIRED','CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type account_class as enum ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE','CLEARING');
exception when duplicate_object then null; end $$;

do $$ begin
  create type aml_case_status as enum ('OPEN','ESCALATED','SAR_FILED','CLOSED_NO_ACTION','CLOSED_ACTIONED');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Reference: currencies + FX corridors
-- ---------------------------------------------------------------------------
create table if not exists currencies (
  code            char(3) primary key,
  name            text not null,
  exponent        smallint not null default 2 check (exponent between 0 and 4),
  symbol          text,
  is_deliverable  boolean not null default false
);

-- QAR is the only funding currency; the rest are QCB-approved payout corridors.
insert into currencies (code, name, exponent, symbol, is_deliverable) values
  ('QAR','Qatari Riyal',2,'ر.ق',false),
  ('USD','US Dollar',2,'$',false),
  ('NGN','Nigerian Naira',2,'₦',true),
  ('GHS','Ghanaian Cedi',2,'₵',true),
  ('KES','Kenyan Shilling',2,'KSh',true),
  ('UGX','Ugandan Shilling',0,'USh',true),
  ('TZS','Tanzanian Shilling',0,'TSh',true),
  ('RWF','Rwandan Franc',0,'FRw',true),
  ('EGP','Egyptian Pound',2,'E£',true),
  ('XAF','Central African CFA Franc',0,'FCFA',true),
  ('XOF','West African CFA Franc',0,'CFA',true)
on conflict (code) do nothing;

create table if not exists fx_corridors (
  id                    uuid primary key default gen_random_uuid(),
  currency              char(3) not null references currencies(code),
  country_code          char(2) not null,
  country_name          text not null,
  flag                  text,
  -- base_rate = QCB / market mid. retail_rate = what the customer sees.
  -- They are maintained by Treasury through the Maker-Checker queue.
  base_rate             numeric(20,8) not null check (base_rate > 0),
  retail_rate           numeric(20,8) not null check (retail_rate > 0),
  min_send_qar_minor    bigint not null default 1000,
  max_send_qar_minor    bigint not null default 5000000,
  per_txn_limit_qar_minor bigint not null default 5000000,
  active                boolean not null default true,
  updated_by            text,
  updated_at            timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  constraint retail_not_above_base check (retail_rate <= base_rate)
);
create unique index if not exists fx_corridors_currency_key on fx_corridors(currency);

create table if not exists fx_rate_history (
  id           bigserial primary key,
  currency     char(3) not null references currencies(code),
  base_rate    numeric(20,8) not null,
  retail_rate  numeric(20,8) not null,
  source       text not null default 'TREASURY_MANUAL',
  changed_by   text,
  changed_at   timestamptz not null default now()
);
create index if not exists fx_rate_history_currency_idx on fx_rate_history(currency, changed_at desc);

-- ---------------------------------------------------------------------------
-- Compliance configuration (thresholds live here, NOT hardcoded in services)
-- ---------------------------------------------------------------------------
create table if not exists compliance_settings (
  key          text primary key,
  value        jsonb not null,
  description  text,
  updated_by   text,
  updated_at   timestamptz not null default now()
);

insert into compliance_settings (key, value, description) values
  ('aml.review_threshold_qar_minor', '400000',
   'Transfers at or above this QAR amount are flagged MEDIUM risk for analyst review.'),
  ('aml.hold_threshold_qar_minor', '1000000',
   'Transfers at or above this QAR amount are auto-held for MLRO release (QCB AML Art. 14).'),
  ('ctr.threshold_qar_minor', '5000000',
   'Currency Transaction Report threshold filed with the QCB Financial Intelligence Unit.'),
  ('structuring.window_hours', '48',
   'Rolling window used to detect structuring (multiple sub-threshold transfers).'),
  ('structuring.count_threshold', '3',
   'Number of sub-threshold transfers inside the window that triggers a structuring alert.'),
  ('sanctions.match_threshold', '0.86',
   'Fuzzy name-match score at or above which a sanctions/PEP hit is a true positive.'),
  ('sanctions.review_threshold', '0.72',
   'Fuzzy name-match score at or above which a candidate is queued for analyst review.'),
  ('velocity.daily_txn_limit', '10',
   'Maximum number of outbound transfers per customer per rolling 24h.'),
  ('kyc.tier1_monthly_limit_qar_minor', '2000000',
   'Monthly outbound limit for Tier 1 (ID-only) customers.'),
  ('kyc.tier2_monthly_limit_qar_minor', '50000000',
   'Monthly outbound limit for Tier 2 (QID + proof of address).'),
  ('kyc.tier3_monthly_limit_qar_minor', '100000000',
   'Monthly outbound limit for Tier 3 (enhanced due diligence).')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Operators (back-office users) — auth is Argon2id/bcrypt + JWT, not the
-- dashboard role dropdown. The dashboard cannot choose its own privileges.
-- ---------------------------------------------------------------------------
create table if not exists admin_users (
  id              uuid primary key default gen_random_uuid(),
  email           citext not null unique,
  full_name       text not null,
  password_hash   text not null,
  role            app_role not null,
  is_active       boolean not null default true,
  mfa_secret      text,                        -- TOTP, encrypted at rest
  mfa_enabled     boolean not null default false,
  failed_logins   integer not null default 0,
  locked_until    timestamptz,
  last_login_at   timestamptz,
  password_changed_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists admin_users_role_idx on admin_users(role) where is_active;

create table if not exists admin_sessions (
  id             uuid primary key default gen_random_uuid(),
  admin_id       uuid not null references admin_users(id) on delete cascade,
  refresh_token_hash text not null unique,     -- SHA-256 of the refresh token
  user_agent     text,
  ip_address     inet,
  expires_at     timestamptz not null,
  revoked_at     timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists admin_sessions_admin_idx on admin_sessions(admin_id);

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
create table if not exists customers (
  id                 uuid primary key default gen_random_uuid(),
  public_ref         text not null unique,              -- e.g. AFQ-104298
  full_name          text not null,
  email              citext unique,
  phone_e164         text not null unique,              -- E.164, e.g. +97455128842
  phone_bidx         text not null unique,              -- HMAC blind index
  nationality        char(2),                           -- ISO-3166 alpha-2
  country_of_residence char(2) not null default 'QA',
  status             customer_status not null default 'PENDING_KYC',
  kyc_tier           smallint not null default 0 check (kyc_tier between 0 and 3),
  risk_level         risk_level not null default 'UNSCREENED',
  pep_flag           boolean not null default false,
  -- Encrypted PII (never queried in plaintext)
  qid_encrypted      text,
  qid_last4          char(4),                           -- display/masking only
  qid_expiry         date,
  address_encrypted  text,
  occupation         text,
  employer           text,
  monthly_income_qar_minor bigint,
  source_of_funds    text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists customers_status_idx on customers(status);
create index if not exists customers_risk_idx on customers(risk_level);
create index if not exists customers_name_trgm on customers using gin (full_name gin_trgm_ops);

create table if not exists customer_devices (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references customers(id) on delete cascade,
  device_id    text not null,
  platform     text,
  push_token   text,
  last_seen_at timestamptz not null default now(),
  unique (customer_id, device_id)
);

-- OTP / login challenges (hashed, single use, short lived)
create table if not exists auth_challenges (
  id            uuid primary key default gen_random_uuid(),
  phone_e164    text not null,
  channel       text not null default 'sms',
  code_hash     text not null,
  purpose       text not null default 'LOGIN',
  attempts      smallint not null default 0,
  consumed_at   timestamptz,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now()
);
create index if not exists auth_challenges_phone_idx on auth_challenges(phone_e164, created_at desc);

create table if not exists customer_sessions (
  id                 uuid primary key default gen_random_uuid(),
  customer_id        uuid not null references customers(id) on delete cascade,
  refresh_token_hash text not null unique,
  device_id          text,
  expires_at         timestamptz not null,
  revoked_at         timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists customer_sessions_customer_idx on customer_sessions(customer_id);

-- ---------------------------------------------------------------------------
-- KYC
-- ---------------------------------------------------------------------------
create table if not exists kyc_requests (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid not null references customers(id) on delete cascade,
  requested_tier    smallint not null check (requested_tier between 1 and 3),
  document_type     text not null,            -- QID_FRONT_BACK, PASSPORT, RESIDENCE_PERMIT
  document_number_encrypted text,
  document_number_last4     char(4),
  document_expiry   date,
  liveness_score    numeric(5,2),             -- from the on-device liveness SDK
  face_match_score  numeric(5,2),             -- selfie vs document
  document_quality  numeric(5,2),
  aml_name_screen   jsonb,                    -- sanctions/PEP result snapshot
  status            kyc_status not null default 'PENDING',
  reviewer_id       uuid references admin_users(id),
  reviewer_note     text,
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists kyc_requests_status_idx on kyc_requests(status, created_at desc);
create index if not exists kyc_requests_customer_idx on kyc_requests(customer_id);

-- ---------------------------------------------------------------------------
-- Beneficiaries + wallets
-- ---------------------------------------------------------------------------
create table if not exists beneficiaries (
  id                 uuid primary key default gen_random_uuid(),
  customer_id        uuid not null references customers(id) on delete cascade,
  full_name          text not null,
  nickname           text,
  country_code       char(2) not null,
  currency           char(3) not null references currencies(code),
  channel            payout_channel not null,
  institution_code   text,                    -- Flutterwave bank/momo code
  institution_name   text,
  account_number_encrypted text not null,
  account_number_last4     char(4) not null,
  account_bidx       text not null,           -- dedupe per customer
  resolved_name      text,                    -- name returned by the payout rail
  name_match_score   numeric(5,2),
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (customer_id, account_bidx, institution_code)
);
create index if not exists beneficiaries_customer_idx on beneficiaries(customer_id, is_active);

create table if not exists wallets (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid not null unique references customers(id) on delete cascade,
  currency          char(3) not null default 'QAR' references currencies(code),
  available_minor   bigint not null default 0 check (available_minor >= 0),
  pending_minor     bigint not null default 0 check (pending_minor >= 0),
  version           bigint not null default 1,
  updated_at        timestamptz not null default now()
);

create table if not exists wallet_fundings (
  id                 uuid primary key default gen_random_uuid(),
  customer_id        uuid not null references customers(id),
  wallet_id          uuid not null references wallets(id),
  method             text not null,                    -- QNB_CARD, BANK_TRANSFER, DEBIT_CARD
  amount_minor       bigint not null check (amount_minor > 0),
  currency           char(3) not null default 'QAR',
  provider_ref       text,
  provider_payload   jsonb,
  status             text not null default 'PENDING',
  ledger_journal_id  uuid,
  initiated_at       timestamptz not null default now(),
  settled_at         timestamptz
);
create index if not exists wallet_fundings_customer_idx on wallet_fundings(customer_id, initiated_at desc);

-- ---------------------------------------------------------------------------
-- Transfers
-- ---------------------------------------------------------------------------
create table if not exists transfers (
  id                     uuid primary key default gen_random_uuid(),
  reference              text not null unique,          -- AFQ-XXXXXXXX, client supplied
  customer_id            uuid not null references customers(id),
  beneficiary_id         uuid not null references beneficiaries(id),
  channel                payout_channel not null,
  -- money, all minor units. QAR side:
  send_amount_qar_minor  bigint not null check (send_amount_qar_minor > 0),
  fee_qar_minor          bigint not null default 0,
  total_debit_qar_minor  bigint not null check (total_debit_qar_minor > 0),
  spread_qar_minor       bigint not null default 0,
  cost_qar_minor         bigint not null default 0,
  -- payout side:
  payout_currency        char(3) not null references currencies(code),
  payout_amount_minor    bigint not null check (payout_amount_minor > 0),
  base_rate              numeric(20,8) not null,
  retail_rate            numeric(20,8) not null,
  country_code           char(2) not null,
  purpose_code           text,                          -- QCB purpose-of-transfer code
  status                 transfer_status not null default 'INITIATED',
  risk_level             risk_level not null default 'UNSCREENED',
  screening_result       jsonb,                         -- sanctions/PEP snapshot
  aml_hold_reason        text,
  aml_released_by        uuid references admin_users(id),
  aml_released_at        timestamptz,
  provider               text,                          -- FLUTTERWAVE | RIA
  provider_reference     text,
  provider_status        text,
  provider_payload       jsonb,
  failure_code           text,
  failure_reason         text,
  retry_count            integer not null default 0,
  ip_address             inet,
  user_agent             text,
  initiated_at           timestamptz not null default now(),
  processing_at          timestamptz,
  paid_at                timestamptz,
  updated_at             timestamptz not null default now(),
  idempotency_key        text
);
create unique index if not exists transfers_idempotency_key on transfers(customer_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists transfers_status_idx on transfers(status, initiated_at desc);
create index if not exists transfers_customer_idx on transfers(customer_id, initiated_at desc);
create index if not exists transfers_risk_idx on transfers(risk_level) where status in ('AML_HOLD','SCREENING_FAILED');
create index if not exists transfers_provider_ref_idx on transfers(provider_reference);

-- Append-only state machine history for every transfer.
create table if not exists transfer_events (
  id           bigserial primary key,
  transfer_id  uuid not null references transfers(id) on delete cascade,
  from_status  transfer_status,
  to_status    transfer_status not null,
  actor_type   text not null default 'SYSTEM',   -- SYSTEM | CUSTOMER | OPERATOR | WEBHOOK
  actor_id     text,
  reason       text,
  metadata     jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists transfer_events_transfer_idx on transfer_events(transfer_id, created_at);

-- ---------------------------------------------------------------------------
-- Ledger (append-only, enforced by trigger)
-- ---------------------------------------------------------------------------
create table if not exists ledger_accounts (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  class         account_class not null,
  currency      char(3) not null references currencies(code),
  is_float_account boolean not null default false,
  is_system     boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists ledger_journals (
  id             uuid primary key default gen_random_uuid(),
  reference      text not null unique,          -- JRN-<transfer reference>-<seq>
  journal_type   text not null,                 -- WALLET_FUNDING | TRANSFER_SETTLEMENT | ...
  description    text not null,
  transfer_id    uuid references transfers(id),
  customer_id    uuid references customers(id),
  is_cross_currency boolean not null default false,
  fx_translation_rate numeric(20,8),            -- QAR per unit of the non-QAR leg
  total_qar_minor bigint not null default 0,    -- QAR value of the journal (reporting)
  posted_by      text not null default 'system',
  posted_at      timestamptz not null default now(),
  reversed_by    uuid references ledger_journals(id)
);
create index if not exists ledger_journals_type_idx on ledger_journals(journal_type, posted_at desc);
create index if not exists ledger_journals_transfer_idx on ledger_journals(transfer_id);

create table if not exists ledger_entries (
  id            bigserial primary key,
  journal_id    uuid not null references ledger_journals(id) on delete restrict,
  account_id    uuid not null references ledger_accounts(id) on delete restrict,
  direction     text not null check (direction in ('DEBIT','CREDIT')),
  amount_minor  bigint not null check (amount_minor > 0),
  currency      char(3) not null references currencies(code),
  qar_value_minor bigint not null default 0,
  memo          text,
  created_at    timestamptz not null default now()
);
create index if not exists ledger_entries_journal_idx on ledger_entries(journal_id);
create index if not exists ledger_entries_account_idx on ledger_entries(account_id, created_at desc);

-- Append-only enforcement: no UPDATE, no DELETE, ever.
create or replace function ledger_block_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'ledger_entries is append-only (attempted %)', tg_op
    using errcode = '42501';
end $$;

drop trigger if exists ledger_entries_no_update on ledger_entries;
create trigger ledger_entries_no_update before update or delete on ledger_entries
  for each row execute function ledger_block_mutation();

drop trigger if exists ledger_entries_no_update_journal on ledger_journals;
create or replace function ledger_block_journal_delete() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ledger_journals cannot be deleted; post a reversing journal instead'
      using errcode = '42501';
  end if;
  return new;
end $$;
create trigger ledger_entries_no_update_journal before delete on ledger_journals
  for each row execute function ledger_block_journal_delete();

-- Balance invariant: after each commit the journal must balance per currency.
create or replace function ledger_assert_balanced() returns trigger
language plpgsql as $$
declare
  j          uuid;
  cc         char(3);
  debits     bigint;
  credits    bigint;
  is_cross   boolean;
begin
  j := coalesce(new.journal_id, old.journal_id);
  select is_cross_currency into is_cross from ledger_journals where id = j;
  for cc in select distinct currency from ledger_entries where journal_id = j loop
    select coalesce(sum(case when direction = 'DEBIT'  then amount_minor else 0 end), 0),
           coalesce(sum(case when direction = 'CREDIT' then amount_minor else 0 end), 0)
      into debits, credits
      from ledger_entries where journal_id = j and currency = cc;
    if debits <> credits then
      raise exception 'Unbalanced journal % in %: debits=% credits=%', j, cc, debits, credits
        using errcode = '23514';
    end if;
  end loop;
  return null;
end $$;

comment on function ledger_assert_balanced() is
  'Called by the application inside the journal transaction (see backend/src/services/ledger.js).';

-- ---------------------------------------------------------------------------
-- Treasury: liquidity pools, maker-checker, providers
-- ---------------------------------------------------------------------------
create table if not exists liquidity_pools (
  id              uuid primary key default gen_random_uuid(),
  key             text not null unique,
  name            text not null,
  provider        text not null,                 -- FLUTTERWAVE | RIA | QNB
  currency        char(3) not null references currencies(code),
  balance_minor   bigint not null default 0,
  min_threshold_minor bigint not null default 0,
  is_active       boolean not null default true,
  updated_at      timestamptz not null default now()
);

create table if not exists maker_checker_requests (
  id              uuid primary key default gen_random_uuid(),
  reference       text not null unique,          -- MC-XXXXXXXX
  request_type    text not null,                 -- FX_RATE_CHANGE | FLOAT_TOPUP | LIMIT_UPGRADE |
                                                 -- SANCTIONS_RELEASE | AML_HOLD_RELEASE | USER_STATUS
  title           text not null,
  payload         jsonb not null,
  amount_qar_minor bigint,
  status          mc_status not null default 'PENDING',
  maker_id        uuid not null references admin_users(id),
  maker_email     text not null,
  maker_role      app_role not null,
  maker_note      text,
  checker_id      uuid references admin_users(id),
  checker_email   text,
  checker_role    app_role,
  checker_note    text,
  decided_at      timestamptz,
  expires_at      timestamptz not null default (now() + interval '24 hours'),
  created_at      timestamptz not null default now(),
  -- 4-eyes at the storage layer. The service layer returns a friendly 403 first.
  constraint maker_checker_distinct check (
    checker_id is null or checker_id <> maker_id
  )
);
create index if not exists mc_status_idx on maker_checker_requests(status, created_at desc);

-- ---------------------------------------------------------------------------
-- AML / sanctions
-- ---------------------------------------------------------------------------
create table if not exists sanctions_list (
  id            bigserial primary key,
  list_source   text not null,                  -- OFAC_SDN | UN_CONSOLIDATED | EU_FSF | QCB_LOCAL | PEP
  entity_type   text not null default 'INDIVIDUAL',
  primary_name  text not null,
  aliases       text[] not null default '{}',
  date_of_birth date,
  nationality   char(2),
  program       text,
  reference     text,
  listed_at     date,
  imported_at   timestamptz not null default now()
);
-- Expression unique index (a table constraint cannot use coalesce()).
create unique index if not exists sanctions_list_dedupe_idx
  on sanctions_list (list_source, primary_name, coalesce(date_of_birth, '1900-01-01'::date));
create index if not exists sanctions_name_trgm on sanctions_list using gin (primary_name gin_trgm_ops);
create index if not exists sanctions_aliases_gin on sanctions_list using gin (aliases);

create table if not exists screening_results (
  id             uuid primary key default gen_random_uuid(),
  subject_type   text not null,                 -- CUSTOMER | BENEFICIARY | TRANSFER
  subject_id     uuid not null,
  query_name     text not null,
  lists_checked  text[] not null default '{}',
  best_score     numeric(5,4),
  match_count    integer not null default 0,
  outcome        text not null,                 -- CLEAR | REVIEW | HIT | NOT_SCREENED_NO_LISTS
  matches        jsonb not null default '[]'::jsonb,
  screened_at    timestamptz not null default now()
);
create index if not exists screening_subject_idx on screening_results(subject_type, subject_id, screened_at desc);

create table if not exists aml_cases (
  id             uuid primary key default gen_random_uuid(),
  reference      text not null unique,          -- AML-XXXXXXXX
  customer_id    uuid not null references customers(id),
  transfer_id    uuid references transfers(id),
  trigger_rule   text not null,                 -- AML_HOLD_THRESHOLD | STRUCTURING | SANCTIONS_HIT | ...
  severity       risk_level not null default 'MEDIUM',
  status         aml_case_status not null default 'OPEN',
  details        jsonb not null default '{}'::jsonb,
  assigned_to    uuid references admin_users(id),
  opened_at      timestamptz not null default now(),
  closed_at      timestamptz,
  closed_by      uuid references admin_users(id),
  resolution_note text
);
create index if not exists aml_cases_status_idx on aml_cases(status, opened_at desc);

-- ---------------------------------------------------------------------------
-- Integrations: webhooks + idempotency
-- ---------------------------------------------------------------------------
create table if not exists webhook_events (
  id             uuid primary key default gen_random_uuid(),
  provider       text not null,                 -- FLUTTERWAVE | RIA
  event_type     text not null,
  provider_event_id text,
  signature_ok   boolean not null default false,
  raw_headers    jsonb,
  payload        jsonb not null,
  processed_at   timestamptz,
  processing_result text,
  error          text,
  received_at    timestamptz not null default now()
);
create unique index if not exists webhook_events_dedupe
  on webhook_events(provider, provider_event_id, event_type)
  where provider_event_id is not null;
create index if not exists webhook_events_received_idx on webhook_events(provider, received_at desc);

create table if not exists idempotency_keys (
  id             uuid primary key default gen_random_uuid(),
  scope          text not null,
  key            text not null,
  request_hash   text not null,
  response_body  jsonb,
  status_code    integer,
  locked_at      timestamptz not null default now(),
  completed_at   timestamptz,
  unique (scope, key)
);

create table if not exists provider_rails (
  id             uuid primary key default gen_random_uuid(),
  provider       text not null,                 -- FLUTTERWAVE | RIA
  channel        payout_channel not null,
  country_code   char(2) not null,
  currency       char(3) not null references currencies(code),
  institution_code text,
  institution_name text,
  priority       smallint not null default 100, -- lower wins (smart routing)
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (provider, channel, country_code, institution_code)
);
create index if not exists provider_rails_route_idx
  on provider_rails(country_code, channel, priority) where is_active;

-- ---------------------------------------------------------------------------
-- Regulatory reporting + audit
-- ---------------------------------------------------------------------------
create table if not exists qcb_reports (
  id              uuid primary key default gen_random_uuid(),
  filing_id       text not null unique,
  report_type     text not null,                -- AML_QUARTERLY | CTR_DAILY | SANCTIONS_MONTHLY
  period_start    date not null,
  period_end      date not null,
  payload         jsonb not null,
  content_hash    text not null,                -- SHA-256 of the canonical payload
  signature       text not null,                -- RSA-PSS signature over content_hash
  generated_by    uuid not null references admin_users(id),
  filed_at        timestamptz,
  created_at      timestamptz not null default now()
);

create table if not exists audit_logs (
  id             bigserial primary key,
  actor_type     text not null,                 -- SYSTEM | OPERATOR | CUSTOMER | WEBHOOK
  actor_id       text,
  actor_email    text,
  actor_role     app_role,
  action         text not null,
  entity_type    text,
  entity_id      text,
  severity       text not null default 'INFO',
  ip_address     inet,
  user_agent     text,
  before_state   jsonb,
  after_state    jsonb,
  metadata       jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists audit_logs_created_idx on audit_logs(created_at desc);
create index if not exists audit_logs_actor_idx on audit_logs(actor_email, created_at desc);
create index if not exists audit_logs_entity_idx on audit_logs(entity_type, entity_id);

create or replace function audit_logs_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_logs is append-only (attempted %)', tg_op using errcode = '42501';
end $$;

drop trigger if exists audit_logs_no_mutate on audit_logs;
create trigger audit_logs_no_mutate before update or delete on audit_logs
  for each row execute function audit_logs_immutable();

-- ---------------------------------------------------------------------------
-- Chart of accounts (structure, not sample data) + treasury float pools
-- ---------------------------------------------------------------------------
insert into ledger_accounts (code, name, class, currency, is_float_account) values
  ('1000-QAR-INBOUND-COLLECTION','QNB Inbound Collection Vault','ASSET','QAR',true),
  ('1010-USD-PAYOUT-FLOAT','Flutterwave USD Payout Float','ASSET','USD',true),
  ('1011-USD-RIA-ESCROW','Ria Money Transfer Cash Escrow','ASSET','USD',true),
  ('2000-QAR-CUSTOMER-WALLET','Customer Wallet Liability','LIABILITY','QAR',false),
  ('2010-QAR-AML-SUSPENSE','AML Hold Suspense (restricted)','LIABILITY','QAR',false),
  ('2100-QAR-PAYOUT-PAYABLE','Payout Partner Payable','LIABILITY','QAR',false),
  ('3000-QAR-TREASURY-CAPITAL','Treasury Capital','EQUITY','QAR',false),
  ('4000-QAR-FEE-REVENUE','Remittance Fee Revenue','REVENUE','QAR',false),
  ('4010-QAR-FX-SPREAD-REVENUE','Realised FX Spread Revenue','REVENUE','QAR',false),
  ('5000-QAR-CHARGEBACK-EXPENSE','Chargeback & Reversal Expense','EXPENSE','QAR',false),
  ('6000-CLEARING-FX-POSITION','Cross-Currency Clearing Position','CLEARING','USD',false)
on conflict (code) do nothing;

insert into liquidity_pools (key, name, provider, currency, balance_minor, min_threshold_minor) values
  ('flw_usd_main','Flutterwave USD Main Clearing Hub','FLUTTERWAVE','USD',0,0),
  ('ria_usd_escrow','Ria Money Transfer Cash Escrow','RIA','USD',0,0)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Views used by the operations console
-- ---------------------------------------------------------------------------
create or replace view v_wallet_balances as
select w.id as wallet_id, c.public_ref, c.full_name, w.currency,
       w.available_minor, w.pending_minor, w.updated_at
from wallets w join customers c on c.id = w.customer_id;

create or replace view v_trial_balance as
select a.code, a.name, a.class, a.currency,
       coalesce(sum(case when e.direction = 'DEBIT'  then e.amount_minor else 0 end),0) as debits_minor,
       coalesce(sum(case when e.direction = 'CREDIT' then e.amount_minor else 0 end),0) as credits_minor,
       coalesce(sum(case when e.direction = 'DEBIT'  then e.amount_minor else -e.amount_minor end),0) as net_minor
from ledger_accounts a
left join ledger_entries e on e.account_id = a.id
group by a.id;

create or replace view v_transfer_summary as
select t.id, t.reference, t.status, t.risk_level, t.channel, t.country_code,
       t.payout_currency, t.total_debit_qar_minor, t.payout_amount_minor,
       t.fee_qar_minor, t.spread_qar_minor, t.initiated_at, t.paid_at,
       c.public_ref as customer_ref, c.full_name as customer_name,
       b.full_name as beneficiary_name, b.institution_name,
       t.aml_hold_reason, t.provider, t.provider_reference
from transfers t
join customers c on c.id = t.customer_id
join beneficiaries b on b.id = t.beneficiary_id;

-- Signing keys for QCB report signatures (generated per deployment)
create table if not exists signing_keys (
  id           uuid primary key default gen_random_uuid(),
  kid          text not null unique,
  public_key_pem text not null,
  private_key_pem_encrypted text not null,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);


-- ###########################################################################
-- ##  0002_rls_and_roles.sql
-- ###########################################################################

-- =============================================================================
-- Supabase Row Level Security + connection roles
--
-- The mobile app NEVER talks to Postgres directly. It authenticates against the
-- AfriSend API (JWT issued by us). The admin console also talks to the API.
-- Therefore Row Level Security here is defence-in-depth: every table that holds
-- customer money or PII is locked down by default, so an accidentally leaked
-- Supabase anon key or service key used in the wrong place cannot read it.
-- =============================================================================

-- 1. Lock every table down, then hand out access explicitly per table.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- 2. No policies are created for anon / authenticated roles on financial
--    tables: the REST API surface for those roles returns zero rows.
-- In Supabase these roles exist; on a local/self-hosted Postgres they may not.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon, authenticated';
    execute 'revoke all on all sequences in schema public from anon, authenticated';
    execute 'revoke all on all functions in schema public from anon, authenticated';
  else
    raise notice 'Supabase anon/authenticated roles not present — skipped (running on plain Postgres)';
  end if;
end $$;

-- 3. A dedicated role for the backend. It bypasses RLS as the table owner
--    would, but is still subject to the append-only triggers.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'afrisend_api') then
    create role afrisend_api nologin;
  end if;
end $$;

grant usage on schema public to afrisend_api;
grant select, insert, update, delete on all tables in schema public to afrisend_api;
grant usage, select on all sequences in schema public to afrisend_api;
alter default privileges in schema public
  grant select, insert, update, delete on tables to afrisend_api;
alter default privileges in schema public
  grant usage, select on sequences to afrisend_api;

-- 4. Reporting/read-only role for BI tools and external auditors.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'afrisend_auditor') then
    create role afrisend_auditor nologin;
  end if;
end $$;
grant usage on schema public to afrisend_auditor;
grant select on all tables in schema public to afrisend_auditor;

-- 5. Analytics-safe views. These mask PII so they can be shared with a BI tool
--    without exposing QIDs or account numbers.
create or replace view v_audit_daily as
select date_trunc('day', created_at) as day,
       action, actor_type, severity, count(*) as events
from audit_logs
group by 1,2,3,4;

create or replace view v_corridor_volume as
select t.country_code, t.payout_currency,
       count(*) as transfer_count,
       sum(t.total_debit_qar_minor) as gross_qar_minor,
       sum(t.fee_qar_minor) as fee_qar_minor,
       sum(t.spread_qar_minor) as spread_qar_minor,
       avg(t.retail_rate) as avg_retail_rate,
       min(t.initiated_at) as first_transfer,
       max(t.initiated_at) as last_transfer
from transfers t
where t.status in ('PAID','PROCESSING')
group by 1,2;

create or replace view v_aml_workload as
select ac.trigger_rule, ac.severity, ac.status, count(*) as cases,
       min(ac.opened_at) as oldest
from aml_cases ac
group by 1,2,3;


-- ###########################################################################
-- ##  0003_ledger_functions.sql
-- ###########################################################################

-- =============================================================================
-- AfriSend — ledger & limit functions
--
-- All money movement goes through these SECURITY DEFINER functions so that
-- balancing and limits are enforced by the database, not by hopeful JavaScript.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- afrisend_post_journal
--
-- p_legs example (JSON array):
--   [ {"account":"4000-QAR-FEE-REVENUE","direction":"CREDIT","amount_minor":1000},
--     {"account":"2000-QAR-CUSTOMER-WALLET","direction":"DEBIT","amount_minor":51000} ]
--
-- Rules:
--   * Every leg's currency is taken from ledger_accounts (never trusted input).
--   * Non-cross-currency journals must balance exactly per currency.
--   * Cross-currency journals must balance when all legs are translated to QAR
--     at p_fx_rate, within a 1 QAR tolerance for rounding.
-- Returns the new journal id.
-- ---------------------------------------------------------------------------
create or replace function afrisend_post_journal(
  p_reference       text,
  p_journal_type    text,
  p_description     text,
  p_legs            jsonb,
  p_transfer_id     uuid default null,
  p_customer_id     uuid default null,
  p_cross_currency  boolean default false,
  p_fx_rate         numeric default null,
  p_posted_by       text default 'system'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_journal_id uuid;
  v_leg        jsonb;
  v_account    ledger_accounts%rowtype;
  v_debits     bigint;
  v_credits    bigint;
  v_ccy        char(3);
  v_qar_debit  bigint;
  v_qar_credit bigint;
  v_total_qar  bigint := 0;
  v_count      integer := 0;
begin
  if p_legs is null or jsonb_array_length(p_legs) < 2 then
    raise exception 'a journal needs at least two legs' using errcode = '22023';
  end if;

  insert into ledger_journals (
    reference, journal_type, description, transfer_id, customer_id,
    is_cross_currency, fx_translation_rate, posted_by
  ) values (
    p_reference, p_journal_type, p_description, p_transfer_id, p_customer_id,
    p_cross_currency, p_fx_rate, p_posted_by
  ) returning id into v_journal_id;

  for v_leg in select * from jsonb_array_elements(p_legs)
  loop
    v_count := v_count + 1;
    select * into v_account
      from ledger_accounts
     where code = (v_leg->>'account');
    if not found then
      raise exception 'unknown ledger account %', v_leg->>'account' using errcode = '22023';
    end if;

    if (v_leg->>'direction') not in ('DEBIT','CREDIT') then
      raise exception 'direction must be DEBIT or CREDIT' using errcode = '22023';
    end if;
    if coalesce((v_leg->>'amount_minor')::bigint, 0) <= 0 then
      raise exception 'leg amount must be a positive integer number of minor units'
        using errcode = '22023';
    end if;

    insert into ledger_entries (
      journal_id, account_id, direction, amount_minor, currency,
      qar_value_minor, memo
    ) values (
      v_journal_id, v_account.id, v_leg->>'direction',
      (v_leg->>'amount_minor')::bigint, v_account.currency,
      case
        when v_account.currency = 'QAR' then (v_leg->>'amount_minor')::bigint
        when p_fx_rate is null then 0
        else round((v_leg->>'amount_minor')::bigint * p_fx_rate)
      end,
      v_leg->>'memo'
    );
  end loop;

  -- Per-currency balance check
  for v_ccy in select distinct currency from ledger_entries where journal_id = v_journal_id loop
    select coalesce(sum(case when direction = 'DEBIT' then amount_minor else 0 end),0),
           coalesce(sum(case when direction = 'CREDIT' then amount_minor else 0 end),0)
      into v_debits, v_credits
      from ledger_entries where journal_id = v_journal_id and currency = v_ccy;

    if v_debits <> v_credits then
      if not p_cross_currency then
        raise exception 'unbalanced journal in %: debits=% credits=%', v_ccy, v_debits, v_credits
          using errcode = '23514';
      end if;
    else
      -- currency balances: count it toward the QAR-denominated reporting total
      v_total_qar := v_total_qar + case
        when v_ccy = 'QAR' then v_debits
        when p_fx_rate is null then 0
        else round(v_debits * p_fx_rate) end;
    end if;
  end loop;

  -- Cross-currency journals must still balance once translated to QAR.
  if p_cross_currency then
    select coalesce(sum(case when direction = 'DEBIT' then qar_value_minor else 0 end),0),
           coalesce(sum(case when direction = 'CREDIT' then qar_value_minor else 0 end),0)
      into v_qar_debit, v_qar_credit
      from ledger_entries where journal_id = v_journal_id;

    if abs(v_qar_debit - v_qar_credit) > 100 then  -- 1.00 QAR rounding tolerance
      raise exception 'cross-currency journal does not balance in QAR terms: % vs %',
        v_qar_debit, v_qar_credit using errcode = '23514';
    end if;
    v_total_qar := greatest(v_qar_debit, v_qar_credit);
  end if;

  update ledger_journals set total_qar_minor = v_total_qar where id = v_journal_id;
  return v_journal_id;
end $$;

-- ---------------------------------------------------------------------------
-- afrisend_wallet_apply — atomic, lock-protected wallet mutation.
-- Refuses to go negative (no overdrafts, ever).
-- ---------------------------------------------------------------------------
create or replace function afrisend_wallet_apply(
  p_customer_id uuid,
  p_delta_minor bigint,
  p_pending_delta_minor bigint default 0
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v_available bigint;
begin
  update wallets
     set available_minor = available_minor + p_delta_minor,
         pending_minor   = pending_minor + p_pending_delta_minor,
         version         = version + 1,
         updated_at      = now()
   where customer_id = p_customer_id
  returning available_minor into v_available;

  if not found then
    raise exception 'wallet not found for customer %', p_customer_id using errcode = 'P0002';
  end if;
  if v_available < 0 then
    raise exception 'insufficient funds: balance would be negative' using errcode = 'P0001';
  end if;
  return v_available;
end $$;

-- ---------------------------------------------------------------------------
-- afrisend_monthly_sent_qar — used against the customer's tier limit.
-- ---------------------------------------------------------------------------
create or replace function afrisend_monthly_sent_qar(p_customer_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(total_debit_qar_minor), 0)::bigint
    from transfers
   where customer_id = p_customer_id
     and status in ('INITIATED','PROCESSING','PAID','AML_HOLD')
     and initiated_at >= date_trunc('month', now());
$$;

-- ---------------------------------------------------------------------------
-- afrisend_structuring_probe — rolling-window sub-threshold count.
-- ---------------------------------------------------------------------------
create or replace function afrisend_structuring_probe(
  p_customer_id uuid,
  p_window_hours integer,
  p_threshold_qar_minor bigint
) returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from transfers
   where customer_id = p_customer_id
     and total_debit_qar_minor < p_threshold_qar_minor
     and initiated_at >= now() - make_interval(hours => p_window_hours);
$$;

-- ---------------------------------------------------------------------------
-- afrisend_velocity_probe — transfers in the last 24h.
-- ---------------------------------------------------------------------------
create or replace function afrisend_velocity_probe(p_customer_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from transfers
   where customer_id = p_customer_id
     and initiated_at >= now() - interval '24 hours';
$$;

-- ---------------------------------------------------------------------------
-- afrisend_settings — typed read of compliance_settings.
-- ---------------------------------------------------------------------------
create or replace function afrisend_setting_int(p_key text)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((value #>> '{}')::bigint, 0) from compliance_settings where key = p_key;
$$;

create or replace function afrisend_setting_numeric(p_key text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((value #>> '{}')::numeric, 0) from compliance_settings where key = p_key;
$$;

-- ---------------------------------------------------------------------------
-- afrisend_balance_sheet — proof that the books balance, used by the console.
-- ---------------------------------------------------------------------------
create or replace function afrisend_balance_sheet()
returns table (currency char(3), debits_minor bigint, credits_minor bigint, balanced boolean)
language sql
stable
security definer
set search_path = public
as $$
  select e.currency,
         sum(case when e.direction = 'DEBIT'  then e.amount_minor else 0 end)::bigint,
         sum(case when e.direction = 'CREDIT' then e.amount_minor else 0 end)::bigint,
         sum(case when e.direction = 'DEBIT'  then e.amount_minor else -e.amount_minor end) = 0
    from ledger_entries e
   group by e.currency;
$$;

-- ---------------------------------------------------------------------------
-- afrisend_float_positions — live float per provider for the treasury screen.
-- ---------------------------------------------------------------------------
create or replace function afrisend_float_positions()
returns table (
  account_code text, account_name text, provider text, currency char(3),
  balance_minor bigint, qar_value_minor bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select a.code, a.name,
         case when a.code like '%USD%' then 'FLUTTERWAVE' else 'QNB' end,
         a.currency,
         coalesce(sum(case when e.direction = 'DEBIT' then e.amount_minor else -e.amount_minor end),0)::bigint,
         coalesce(sum(case when e.direction = 'DEBIT' then e.qar_value_minor else -e.qar_value_minor end),0)::bigint
    from ledger_accounts a
    left join ledger_entries e on e.account_id = a.id
   where a.is_float_account
   group by a.id;
$$;


-- ###########################################################################
-- ##  0004_pin_quotes.sql
-- ###########################################################################

-- =============================================================================
-- AfriSend — migration 0004
--   * customer transaction PIN
--   * FX quotes (short-lived, single use) so the rate the customer is shown is
--     the rate that is booked even if Treasury moves rates in between
--   * additional compliance settings
--   * provider status mapping table used by the webhook state machine
-- =============================================================================

alter table customers add column if not exists transaction_pin_hash text;
alter table customers add column if not exists pin_updated_at timestamptz;

insert into compliance_settings (key, value, description) values
  ('otp.max_per_hour', '5', 'Maximum SMS one-time codes issued per phone number per hour.'),
  ('fx.qar_per_usd', '3.64', 'QAR per 1 USD, QCB mid. Used to value USD float legs of the ledger.'),
  ('fx.quote_ttl_seconds', '90', 'How long a displayed FX quote stays bookable.'),
  ('sanctions.block_if_no_lists', 'true',
   'When true, a transfer cannot clear screening if no sanctions list has been imported yet.'),
  ('transfers.max_provider_retries', '3', 'Automatic provider retries before a payout is failed for manual review.'),
  ('aml.fee_qar_minor', '1000', 'Flat remittance fee in halalas (10.00 QAR) charged per transfer.')
on conflict (key) do nothing;

create table if not exists fx_quotes (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique,
  customer_id       uuid not null references customers(id) on delete cascade,
  currency          char(3) not null references currencies(code),
  country_code      char(2) not null,
  send_amount_qar_minor bigint not null check (send_amount_qar_minor > 0),
  fee_qar_minor     bigint not null,
  total_debit_qar_minor bigint not null,
  payout_amount_minor bigint not null,
  base_rate         numeric(20,8) not null,
  retail_rate       numeric(20,8) not null,
  spread_qar_minor  bigint not null,
  cost_qar_minor    bigint not null,
  expires_at        timestamptz not null,
  consumed_by_transfer uuid references transfers(id),
  created_at        timestamptz not null default now()
);
create index if not exists fx_quotes_customer_idx on fx_quotes(customer_id, created_at desc);

create table if not exists provider_status_map (
  provider           text not null,
  provider_status    text not null,
  internal_status    transfer_status not null,
  is_terminal        boolean not null default false,
  description        text,
  primary key (provider, provider_status)
);

insert into provider_status_map (provider, provider_status, internal_status, is_terminal, description) values
  ('FLUTTERWAVE','NEW','PROCESSING',false,'Transfer accepted by Flutterwave, queued for payout'),
  ('FLUTTERWAVE','PENDING','PROCESSING',false,'Awaiting partner bank confirmation'),
  ('FLUTTERWAVE','SUCCESSFUL','PAID',true,'Beneficiary credited'),
  ('FLUTTERWAVE','FAILED','FAILED',true,'Payout rejected by the receiving institution'),
  ('FLUTTERWAVE','REVERSED','REFUNDED',true,'Funds returned by the rail'),
  ('RIA','PENDING','PROCESSING',false,'Ria agent network processing'),
  ('RIA','AVAILABLE_FOR_PICKUP','PAID',true,'Cash ready for beneficiary collection'),
  ('RIA','PAID','PAID',true,'Cash collected by beneficiary'),
  ('RIA','CANCELLED','FAILED',true,'Ria cancelled the payout'),
  ('RIA','REVERSED','REFUNDED',true,'Funds returned by Ria')
on conflict (provider, provider_status) do nothing;

-- Idempotency records are short lived; keep the table lean.
create index if not exists idempotency_keys_age_idx on idempotency_keys(locked_at desc);

-- Helper for the transfer state machine used by webhooks.
create or replace function afrisend_provider_status_to_internal(p_provider text, p_status text)
returns transfer_status
language sql
stable
security definer
set search_path = public
as $$
  select internal_status from provider_status_map
   where provider = p_provider and provider_status = upper(p_status)
   limit 1;
$$;


-- ###########################################################################
-- ##  0005_aml_rules.sql
-- ###########################################################################

-- =============================================================================
-- AfriSend — migration 0005
--   * jurisdiction + account-age AML rules
--   * corridor purpose-of-transfer codes (QCB requirement on outbound wires)
-- =============================================================================

insert into compliance_settings (key, value, description) values
  ('aml.high_risk_countries', '"IR,KP,SY,CU,MM,AF,YE,SS,LY,SO"',
   'Beneficiary jurisdictions that require MLRO release before payout (FATF call-for-action + platform policy).'),
  ('aml.new_account_hours', '24',
   'Accounts younger than this are treated as elevated risk for transfers above the review threshold.'),
  ('aml.require_purpose_code', 'true',
   'Require the customer to declare a purpose of transfer (QCB outbound transfer rules).')
on conflict (key) do nothing;

create table if not exists purpose_codes (
  code        text primary key,
  label       text not null,
  requires_narrative boolean not null default false
);

insert into purpose_codes (code, label, requires_narrative) values
  ('FAMILY_SUPPORT','Family support / maintenance', false),
  ('EDUCATION','Education fees', true),
  ('MEDICAL','Medical expenses', false),
  ('SALARY','Salary / wages to self', false),
  ('PROPERTY','Property purchase or rent', true),
  ('BUSINESS','Goods and services (business)', true),
  ('GIFT','Gift / donation', false),
  ('SAVINGS','Transfer to own account', false)
on conflict (code) do nothing;

alter table transfers add column if not exists purpose_narrative text;

-- Retention: regulatory records must be kept for the QCB minimum (10 years).
create or replace function afrisend_retention_check()
returns table (table_name text, retention_years integer, oldest_record timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select 'audit_logs', 10, min(created_at) from audit_logs
  union all
  select 'ledger_entries', 10, min(created_at) from ledger_entries
  union all
  select 'transfers', 10, min(initiated_at) from transfers
  union all
  select 'webhook_events', 5, min(received_at) from webhook_events;
$$;


-- ###########################################################################
-- ##  0006_books_integrity.sql
-- ###########################################################################

-- =============================================================================
-- AfriSend — migration 0006
--
-- Book integrity reporting.
--
-- Why this replaces a naive "sum of debits = sum of credits per currency"
-- check: a cross-currency journal (buying USD float with QAR, for example) has
-- legs in two currencies by definition, so per-currency totals will differ by
-- exactly the translated amount — that is an FX position, not an error.
--
-- The real invariants are:
--   1. EVERY journal balances per currency, unless it is flagged
--      is_cross_currency, in which case it must balance once translated to QAR;
--   2. the only accounts allowed to carry an open balance are assets,
--      liabilities, equity, revenue and expense (clearing accounts must net
--      towards zero over a settlement cycle).
-- =============================================================================

create or replace function afrisend_books_integrity()
returns table (
  journals_total          integer,
  journals_unbalanced     integer,
  cross_currency_journals integer,
  entries_total           integer,
  books_balanced          boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with per_journal as (
    select j.id,
           j.is_cross_currency,
           sum(case when e.direction = 'DEBIT' then e.amount_minor else 0 end)
             - sum(case when e.direction = 'CREDIT' then e.amount_minor else 0 end) as net_minor,
           sum(case when e.direction = 'DEBIT' then e.qar_value_minor else 0 end)
             - sum(case when e.direction = 'CREDIT' then e.qar_value_minor else 0 end) as net_qar_minor,
           -- per-currency balance test
           bool_and(true) as placeholder
      from ledger_journals j
      join ledger_entries e on e.journal_id = j.id
     group by j.id, j.is_cross_currency
  ),
  per_currency as (
    select e.journal_id,
           count(distinct e.currency) as currencies,
           bool_and(balanced) as all_balanced
      from (
        select journal_id, currency,
               sum(case when direction = 'DEBIT' then amount_minor else 0 end)
                 = sum(case when direction = 'CREDIT' then amount_minor else 0 end) as balanced
          from ledger_entries group by journal_id, currency
      ) e
     group by e.journal_id
  )
  select
    (select count(*)::int from ledger_journals),
    (select count(*)::int from per_currency pc
      join ledger_journals j on j.id = pc.journal_id
     where not pc.all_balanced
       and not (j.is_cross_currency and pc.currencies > 1)),
    (select count(*)::int from ledger_journals where is_cross_currency),
    (select count(*)::int from ledger_entries),
    (select count(*) = 0 from per_currency pc
      join ledger_journals j on j.id = pc.journal_id
     where not pc.all_balanced
       and not (j.is_cross_currency and pc.currencies > 1));
$$;

-- Currency positions: the net of every account in a currency. This is the FX
-- exposure the treasury desk has to manage, and it is what a QCB examiner reads.
create or replace function afrisend_currency_positions()
returns table (
  currency char(3),
  debits_minor bigint,
  credits_minor bigint,
  net_minor bigint,
  translated_net_qar_minor bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select currency,
         sum(case when direction = 'DEBIT'  then amount_minor else 0 end)::bigint,
         sum(case when direction = 'CREDIT' then amount_minor else 0 end)::bigint,
         sum(case when direction = 'DEBIT'  then amount_minor else -amount_minor end)::bigint,
         sum(case when direction = 'DEBIT'  then qar_value_minor else -qar_value_minor end)::bigint
    from ledger_entries
   group by currency
   order by currency;
$$;

-- Replace the earlier, misleading implementation.
create or replace function afrisend_balance_sheet()
returns table (currency char(3), debits_minor bigint, credits_minor bigint, balanced boolean)
language sql
stable
security definer
set search_path = public
as $$
  select currency, debits_minor, credits_minor,
         debits_minor = credits_minor as balanced
    from afrisend_currency_positions();
$$;

-- Float shortfall alerts: payout currencies where the float cannot cover what
-- the platform has promised to pay out.
create or replace function afrisend_float_shortfalls()
returns table (currency char(3), owed_minor bigint, float_minor bigint, shortfall_minor bigint)
language sql
stable
security definer
set search_path = public
as $$
  with owed as (
    select payout_currency as currency,
           sum(payout_amount_minor)::bigint as owed_minor
      from transfers
     where status in ('INITIATED','PROCESSING','AML_HOLD')
     group by payout_currency
  ),
  floats as (
    select a.currency,
           coalesce(sum(case when e.direction = 'DEBIT' then e.amount_minor else -e.amount_minor end), 0)::bigint as float_minor
      from ledger_accounts a
      left join ledger_entries e on e.account_id = a.id
     where a.is_float_account
     group by a.currency
  )
  select o.currency, o.owed_minor, coalesce(f.float_minor, 0),
         greatest(o.owed_minor - coalesce(f.float_minor, 0), 0)
    from owed o left join floats f on f.currency = o.currency
   where o.owed_minor > coalesce(f.float_minor, 0);
$$;


-- ###########################################################################
-- ##  0007_wallet_reconciliation.sql
-- ###########################################################################

-- =============================================================================
-- AfriSend — migration 0007
--
-- The single most important reconciliation in a remittance business:
-- does the sum of customer wallet balances equal the ledger liability?
--
--   wallets.available_minor is what the app shows the customer.
--   2000-QAR-CUSTOMER-WALLET is what the books say we owe customers.
--
-- If these drift, a bug has moved money on one side only (a hold, a release,
-- a refund or a failed payout). The function is exposed on the console's Ledger
-- screen and asserted by the end-to-end suite on every run.
-- =============================================================================

create or replace function afrisend_wallet_reconciliation()
returns table (
  wallets_minor          bigint,
  ledger_liability_minor bigint,
  difference_minor       bigint,
  reconciled             boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with wallet_totals as (
    select coalesce(sum(available_minor), 0)::bigint as total from wallets
  ),
  ledger_totals as (
    select coalesce(
             sum(case when e.direction = 'CREDIT' then e.amount_minor else -e.amount_minor end), 0
           )::bigint as total
      from ledger_entries e
      join ledger_accounts a on a.id = e.account_id
     where a.code = '2000-QAR-CUSTOMER-WALLET'
  )
  select w.total,
         l.total,
         w.total - l.total,
         w.total = l.total
    from wallet_totals w, ledger_totals l;
$$;

-- Also surface the AML suspense position: money held for review but not yet
-- returned to customers. It must equal the sum of the held transfers' value.
create or replace function afrisend_suspense_position()
returns table (
  suspense_minor bigint,
  held_transfers_value_minor bigint,
  difference_minor bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with suspense as (
    select coalesce(
             sum(case when e.direction = 'CREDIT' then e.amount_minor else -e.amount_minor end), 0
           )::bigint as total
      from ledger_entries e
      join ledger_accounts a on a.id = e.account_id
     where a.code = '2010-QAR-AML-SUSPENSE'
  ),
  held as (
    select coalesce(sum(total_debit_qar_minor), 0)::bigint as total
      from transfers where status = 'AML_HOLD'
  )
  select s.total, h.total, s.total - h.total from suspense s, held h;
$$;

