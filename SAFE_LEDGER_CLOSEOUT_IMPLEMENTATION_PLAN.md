# Closeout + Safe Ledger Implementation Plan

Status: planning only (no execution yet)  
Owner: Shift Happens team  
Scope: replace WhatsApp nightly cash/deposit reporting with in-app structured closeout, validation, review, and export.

---

## 1) Objective

Move end-of-day closeout reporting from unstructured WhatsApp messages/photos into the app with:

- structured data entry
- hard/soft validation gates
- manager exception review
- week-level copy/paste exports to existing spreadsheet format
- temporary photo retention (evidence, not permanent storage)

Primary outcome: reduce correction workload and math errors while preserving current ownership reporting workflow.

---

## 2) Product Requirements (V1)

### Employee closeout flow

1. Start Closeout (store + date + shift context)
2. Enter sales totals:
   - cash sales
   - card sales
   - optional misc/other
3. Enter expenses:
   - amount
   - category/detail
4. Enter denomination counts:
   - 100, 50, 20, 10, 5, 1
   - optional coins
5. Deposit amount:
   - default to denomination total
   - if overridden, require reason + flag
6. Upload photos:
   - required: deposit/cash photo
   - optional: POS/slip photo
7. Validation gate:
   - denom total vs actual deposit (tight tolerance)
   - expected deposit vs actual deposit (default ±$1 store-configurable)
   - PASS: submit
   - WARN: submit + flag
   - FAIL: force recount
   - FAIL twice: submit allowed but auto-flag for manager review (incident system deferred to Phase 2)

### Manager flow

1. Safe Ledger dashboard by store/date
2. Exception-first filters:
   - WARN/FAIL only
   - high variance
   - missing required photo
3. Drill-in to closeout details + evidence photos (if still retained)
4. V1 is read-only + review-focused (edit/correction workflows deferred to Phase 2)

### Export flow (V1)

Two copy-to-clipboard TSV outputs for selected store + week:

1. Sales block:
   - Date | Cash | Card (optional DOW if needed)
2. Denomination weekly totals:
   - Denom | Qty | Amount | Total

Goal: two pastes per week per store.

---

## 3) Architecture Fit (this codebase)

- Frontend: Next.js App Router + React client pages/components
- Backend: Supabase PostgreSQL + API routes
- Auth:
  - employees via PIN JWT (`authenticateShiftRequest`)
  - managers via Supabase auth + store manager scopes
- Timezone: use existing CST handling helpers/patterns (no new date libs)
- Migrations: add forward-numbered SQL files in `src/app/sql/` (and mirror supabase migrations flow)

---

## 4) Data Model Plan

## 4.1 New tables

1. `safe_closeouts`
- `id uuid pk`
- `store_id uuid not null`
- `business_date date not null` (CST day)
- `shift_id uuid null` (close shift reference if available)
- `profile_id uuid not null` (submitter)
- `status text` (`draft|pass|warn|fail|locked`)
- `cash_sales_cents int not null default 0`
- `card_sales_cents int not null default 0`
- `other_sales_cents int not null default 0`
- `expected_deposit_cents int not null default 0`
- `actual_deposit_cents int not null default 0`
- `denom_total_cents int not null default 0`
- `denoms_jsonb jsonb not null default '{}'::jsonb` (V1 denominations payload)
- `deposit_override_reason text null`
- `variance_cents int not null default 0`
- `validation_attempts int not null default 0`
- `requires_manager_review boolean not null default false` (manual/escalation marker; not a duplicate pass/fail source)
- `reviewed_at timestamptz null`
- `reviewed_by uuid null`
- `created_at/updated_at timestamptz`
- unique key: `(store_id, business_date)` (single canonical closeout row per store/day; starts as `draft`)

2. `safe_closeout_expenses`
- `id uuid pk`
- `closeout_id uuid fk`
- `amount_cents int not null`
- `category text not null`
- `note text null`
- `created_at`

3. `safe_closeout_photos`
- `id uuid pk`
- `closeout_id uuid fk`
- `photo_type text` (`deposit_required|pos_optional`)
- `storage_path text null` (nullable to support retention purge while keeping audit metadata)
- `thumb_path text null` (optional, nullable)
- `created_at`
- `purge_after timestamptz`

4. `safe_month_closures` (Phase 2)
- `id uuid pk`
- `store_id uuid`
- `month_key text` (`YYYY-MM`)
- `closed_at`
- `closed_by`
- unique `(store_id, month_key)`

## 4.2 Settings additions (`store_settings`)

- `safe_deposit_tolerance_cents int default 100` (±$1)
- `safe_denom_tolerance_cents int default 0` (usually exact)
- `safe_photo_retention_days int default 45`
- `safe_ledger_enabled boolean default false`

### 4.3 Canonical status model (single source of truth)

To avoid overlapping truth fields:

- Canonical persisted state: `status` (`DRAFT|PASS|WARN|FAIL|LOCKED`)
- Canonical persisted state: `status` (`DRAFT|PASS|WARN|FAIL|LOCKED`)
- Persisted operational fields: `variance_cents`, `validation_attempts`, optional `requires_manager_review`
- Derived in API response (not authoritative columns): `denom_ok`, `deposit_ok`, `needs_review`

UI must treat `status` as authoritative.

---

## 5) SQL/DB Logic Plan

Create validation function(s), e.g.:

- `compute_expected_deposit(cash_sales, expenses_total)`  
- `evaluate_closeout(closeout_id)` sets:
  - expected deposit
  - denom/deposit match booleans
  - variance
  - status pass/warn/fail
  - recomputed `denom_total_cents` from `denoms_jsonb` (server-authoritative)

Add transaction-safe RPC for submission:

- `submit_safe_closeout(...)`
  - writes sales + expenses + denoms_jsonb + photos metadata
  - increments validation attempts on fail
  - if fail twice -> marks requires review (incident row optional in Phase 2)
  - returns result payload for UI (`PASS|WARN|FAIL|FAIL_ESCALATED`)

Keep server-side validation authoritative (client can pre-check, but DB decides).

### 5.1 Bills-only deposit rounding rule (critical business rule)

You do **not** deposit coins; only bills are deposited.  
So expected deposit must be rounded to whole dollars before validation:

- `raw_expected_cents = cash_sales_cents - expenses_total_cents`
- `expected_deposit_cents = round_to_nearest_dollar(raw_expected_cents)`

Rounding policy:

- cents ending in `.49` or lower -> round **down**
- cents ending in `.50` or higher -> round **up**

Equivalent cents implementation:

- let `remainder = abs(raw_expected_cents) % 100`
- if `remainder <= 49` round toward zero/down-dollar
- if `remainder >= 50` round up-dollar

Clamp rule (V1):

- If `raw_expected_cents < 0`, set `expected_deposit_cents = 0` and flag for manager review.

Validation and variance must use the rounded expected value:

- `variance_cents = actual_deposit_cents - expected_deposit_cents`
- deposit match checks compare against rounded expected deposit.

UI should show both:

- `Raw expected` (for transparency)
- `Rounded expected (bills-only)` (authoritative target)

### 5.2 Denomination payload shape (V1)

Use JSONB payload in `safe_closeouts.denoms_jsonb`:

```json
{
  "100": 0,
  "50": 0,
  "20": 43,
  "10": 18,
  "5": 73,
  "1": 28,
  "coin_cents": 0
}
```

Notes:
- Good fit for fixed, small, per-closeout payload.
- If denom analytics become a major need, migrate to normalized rows in Phase 2/3.

---

## 6) API Plan

### Employee routes

1. `GET /api/closeout/context`
- fetch existing draft/final for store/date
- return settings thresholds + required fields

2. `POST /api/closeout/save-draft`
- upsert draft sections (sales/expenses/denoms)

3. `POST /api/closeout/submit`
- call RPC submit
- return pass/warn/fail outcome and required next action

4. `POST /api/closeout/upload-url`
- generate signed upload URL (Supabase storage)
- enforce photo type rules

### Manager routes

1. `GET /api/admin/safe-ledger`
- list closeouts with filters (store/date/status/variance/photos)

2. `GET /api/admin/safe-ledger/[id]`
- detail row + expenses + denoms + photos

3. `POST /api/admin/safe-ledger/month-close` (Phase 2)
- lock month for store + set purge schedule marker

4. `GET /api/admin/safe-ledger/export`
- returns TSV blocks for:
  - sales table
  - denom weekly totals

---

## 7) UI Plan

## 7.1 Employee UI

Create `Closeout` page/section with steps:

- Sales
- Expenses
- Denominations
- Deposit
- Photos
- Validation + Submit

Behavior:

- mobile-first form controls
- inline calculator totals
- sticky submit bar
- clear validation feedback:
  - PASS (green)
  - WARN (amber)
  - FAIL (red + recount)

## 7.2 Manager UI

Create `Admin > Safe Ledger` page:

- daily table + status chips
- exception filters first
- drill-in panel/modal for row details
- V1 actions:
  - mark reviewed
  - export/copy
- Phase 2 actions:
  - correct values (audit entry)
  - resolve incidents
  - month close

## 7.3 Export UI

On Safe Ledger page:

- select store + week
- button: `Copy Sales TSV`
- button: `Copy Denomination TSV`
- preview textarea for confidence before copy

---

## 8) Validation Rules (V1 defaults)

1. `denom_total == actual_deposit` within `safe_denom_tolerance_cents`
2. `actual_deposit == expected_deposit` within `safe_deposit_tolerance_cents`
3. Required photo exists before final submit
4. Override deposit amount requires reason
5. Two FAIL submits auto-flag `requires_manager_review=true` (incident table deferred to Phase 2)

---

## 9) Security + Compliance

- Employee routes use `authenticateShiftRequest`
- Manager routes enforce managed store scope
- Store photo paths only; no public bucket listing
- V1 purge timing: `created_at + safe_photo_retention_days` (month-close dependency deferred to Phase 2)
- Keep audit metadata for manager edits

Photo purge implementation rule:
- Query rows where `purge_after < now()` and `storage_path IS NOT NULL`
- Delete files using **Supabase Storage API** (not SQL against storage internals)
- Set `storage_path = NULL` (and `thumb_path = NULL` if present) after successful deletion
- Keep metadata row for audit/history

---

## 10) Rollout Strategy

Phase 1 (safe launch):

- build schema + API + employee entry + manager read-only + exports
- enable per store via `safe_ledger_enabled` toggle
- use canonical status model + JSONB denoms + nullable photo paths
- defer incident subsystem + month close lock + manager edit workflow

Phase 2:

- manager edit/review actions
- month close lock + purge job
- optional normalized denomination table migration (if analytics require it)

Phase 3:

- spreadsheet template mapping presets
- richer incident analytics

---

## 11) Execution Checklist (tomorrow-ready)

1. Add migration(s) for tables/settings/indexes
2. Add RPC + validation SQL
3. Build employee context/save/submit/upload APIs
4. Build closeout UI (mobile first)
5. Build manager ledger list/detail APIs + UI
6. Build export endpoint + copy UI
7. Add retention purge job (cron/worker) using Storage API + nullable path cleanup
8. Add tests + manual test script
9. Enable on one pilot store, compare against WhatsApp for 1 week, then roll out
10. Plan Phase 2 backlog (month close + incidents + manager corrections)

---

## 12) Test Matrix (must pass)

Employee:
- valid closeout pass
- warn closeout submits and flags
- fail closeout forces recount
- second fail auto-flags `requires_manager_review=true`
- required photo missing blocks submit

Manager (V1):
- sees exception filters correctly
- can mark reviewed
- export outputs paste cleanly

Manager (Phase 2):
- can resolve incidents
- month close prevents edits

Export:
- weekly TSV pastes cleanly into current spreadsheet structure

Timezone:
- closeouts are stored/evaluated by CST business date

---

## 13) Open Decisions (confirm before build)

1. One closeout per store/day, or per close shift with daily rollup?
2. Coin handling detail (single `coin_cents` vs detailed coin breakdown)?
   - V1 default: single `coin_cents`
3. Warn vs fail thresholds by store (default OK, custom allowed)?
4. Month close authority: manager-only or admin-only?
5. Photo purge timing: fixed days after close vs configurable per store?

---

This plan is intentionally execution-focused and mapped to current project constraints so implementation can start immediately in small, safe slices.
