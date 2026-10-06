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
