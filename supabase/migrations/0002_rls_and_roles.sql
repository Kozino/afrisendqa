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
