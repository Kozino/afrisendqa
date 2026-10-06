# AfriSend ledger model

Every movement of money in AfriSend is recorded as a **double-entry journal**.
The balance customers see is derived from the ledger, not stored as a mutable
number, and `ledger_entries` is append-only at the database level (a trigger
raises `42501` on `UPDATE` or `DELETE`).

## Units

All amounts are `BIGINT` **minor units** (halalas, kobo, cents…) with the
exponent held in `currencies.exponent`. The API and the mobile app display
formatted strings; no float arithmetic exists anywhere in the money path —
`backend/lib/money.js` converts rates to exact rationals before multiplying.

## Chart of accounts

| Code | Class | Currency | Purpose |
| --- | --- | --- | --- |
| `1000-QAR-INBOUND-COLLECTION` | ASSET | QAR | QNB collection vault — money actually received from customers |
| `1010-USD-PAYOUT-FLOAT` | ASSET | USD | Float held with Flutterwave to fund payouts |
| `1011-USD-RIA-ESCROW` | ASSET | USD | Float held with Ria for cash payouts |
| `1012-<CCY>-PAYOUT-FLOAT` | ASSET | local | Per-corridor float, created on first use |
| `2000-QAR-CUSTOMER-WALLET` | LIABILITY | QAR | What we owe customers (their wallet balances) |
| `2010-QAR-AML-SUSPENSE` | LIABILITY | QAR | Funds quarantined by compliance |
| `2100-QAR-PAYOUT-PAYABLE` | LIABILITY | QAR | What we owe the payout partner for a given transfer |
| `3000-QAR-TREASURY-CAPITAL` | EQUITY | QAR | Treasury capital / reconciliation counterpart |
| `4000-QAR-FEE-REVENUE` | REVENUE | QAR | Flat remittance fee |
| `4010-QAR-FX-SPREAD-REVENUE` | REVENUE | QAR | Realised spread (retail vs interbank) |
| `6000-<CCY>-FX-CLEARING` | CLEARING | any | Cross-currency position, created per currency |

## Journals written per transfer

Assume the customer sends **500.00 QAR**, fee **10.00 QAR**, retail rate
**415.00 NGN/QAR**, base rate **421.06 NGN/QAR**:

```
payout  = 500.00 × 415.00      = 207,500.00 NGN
cost    = 207,500.00 ÷ 421.06  = 492.43 QAR
spread  = 500.00 − 492.43      = 7.57 QAR
total   = 500.00 + 10.00       = 510.00 QAR   (= cost + spread + fee)
```

1. **`TRANSFER_SETTLEMENT`** (QAR — balances exactly)

   | Account | Dr | Cr |
   | --- | --- | --- |
   | `2000-QAR-CUSTOMER-WALLET` | 510.00 | |
   | `2100-QAR-PAYOUT-PAYABLE` | | 492.43 |
   | `4010-QAR-FX-SPREAD-REVENUE` | | 7.57 |
   | `4000-QAR-FEE-REVENUE` | | 10.00 |

2. **`PAYOUT_CLEARING`** (cross-currency, validated in translated QAR)

   | Account | Dr | Cr |
   | --- | --- | --- |
   | `6000-USD-FX-CLEARING` | 135.28 USD | |
   | `2100-QAR-PAYOUT-PAYABLE` | | 492.43 QAR |

   `135.28 × 3.64 (QAR/USD) ≈ 492.43` — the journal is accepted because both
   legs translate to the same QAR value within the rounding tolerance.

3. **`PAYOUT_DISBURSEMENT`** (NGN — balances exactly)

   | Account | Dr | Cr |
   | --- | --- | --- |
   | `6000-NGN-FX-CLEARING` | 207,500.00 | |
   | `1012-NGN-PAYOUT-FLOAT` | | 207,500.00 |

Other journal types: `WALLET_FUNDING`, `AML_HOLD_SWEEP`, `AML_HOLD_RELEASE`,
`AML_HOLD_REFUND`, `FLOAT_TOPUP`, `FLOAT_RECONCILIATION`, and the three
reversals below.

## When a payout does not complete

A rejected or returned payout must undo **three** things, not just refund the
customer. `ledger.postProviderReversal()` posts all three:

| # | Journal | Legs | Effect |
| --- | --- | --- | --- |
| 1 | `PROVIDER_REVERSAL` | Dr `2100-QAR-PAYOUT-PAYABLE` (cost) · Dr `4010` spread · Dr `4000` fee · Cr `2000` wallet liability (total) | Settlement unwound, revenue reversed, **customer refunded in full** |
| 2 | `PAYOUT_CLEARING_REVERSAL` | Dr `1010-USD-PAYOUT-FLOAT` · Cr `2100-QAR-PAYOUT-PAYABLE` | USD float restored (cross-currency, validated in translated QAR) |
| 3 | `PAYOUT_DISBURSEMENT_REVERSAL` | Dr `1012-<CCY>-PAYOUT-FLOAT` · Cr `6000-<CCY>-FX-CLEARING` | Partner float restored |

Skipping 2 and 3 leaves the float permanently wrong: the partner shows as paid
while the customer has been refunded, so reconciliation and the QCB liquidity
ratio drift apart. Skipping 1 is worse — the customer's money disappears.

## Reconciliation invariants

Two SQL functions exist so these can never silently drift, and both are shown on
the console's Ledger screen and asserted by the end-to-end suite on every run:

```sql
select * from afrisend_wallet_reconciliation();
--   wallets_minor | ledger_liability_minor | difference_minor | reconciled
--   sum of every wallet balance vs the 2000-QAR-CUSTOMER-WALLET liability

select * from afrisend_suspense_position();
--   AML suspense balance vs the value of the transfers on AML_HOLD
```

A non-zero difference means a code path moved money on one side only — exactly
what happened during development with AML releases (the wallet was debited twice)
and with failed payouts (the wallet was never credited back). Both are now fixed
and both are guarded.

## What "the books balance" means here

`afrisend_books_integrity()` answers the question an examiner actually asks:

* `journals_unbalanced` — journals that fail the balance test (must be **0**)
* `cross_currency_journals` — journals whose legs span currencies, validated in
  translated QAR terms
* `books_balanced` — `journals_unbalanced = 0`

`afrisend_currency_positions()` then shows the resulting **FX position per
currency** (`QAR −X` against `USD +X` for an unfunded float, for example). A
cross-currency journal legitimately leaves a per-currency difference; that is a
position to be managed by Treasury, not an accounting error. That is why a naive
"sum of debits = sum of credits per currency" check is *not* the invariant.

## Float controls

* `afrisend_float_shortfalls()` lists corridors where committed payouts exceed
  the funded float.
* `dispatchToProvider()` refuses to instruct a payout when the float cannot cover
  it: the transfer is marked `AWAITING_FLOAT`, an alert is pushed to the console,
  and housekeeping re-dispatches it automatically after Treasury funds the float
  (through the maker-checker top-up flow).

## Immutability and corrections

* Entries are never edited. A mistake is corrected by posting a **reversing
  journal** (`reversed_by` on `ledger_journals`), which is itself audited.
* Audit rows and ledger rows share the same retention: 10 years
  (`afrisend_retention_check()` reports the oldest record per table).
