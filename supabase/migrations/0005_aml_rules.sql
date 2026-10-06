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
