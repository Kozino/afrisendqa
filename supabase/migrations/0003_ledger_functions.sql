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
