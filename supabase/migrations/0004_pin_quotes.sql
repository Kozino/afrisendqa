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
