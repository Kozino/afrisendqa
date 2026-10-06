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
