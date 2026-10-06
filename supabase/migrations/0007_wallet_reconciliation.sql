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
