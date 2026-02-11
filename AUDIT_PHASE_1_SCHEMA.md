# Audit Phase 1: Reconstructed Schema Map

> Generated: 2026-02-10 | Source: `src/app/sql/01` through `41` + `supabase/functions/`

---

## 1. Enum Types

| Enum | Values | Source |
|------|--------|--------|
| `shift_type` | `open`, `close`, `double`, `other` | 01_schema |
| `drawer_count_type` | `start`, `changeover`, `end` | 01_schema |
| `assignment_type` | `task`, `message` | 07_shift_assignments |
| `request_status` | `open`, `pending`, `approved`, `denied`, `cancelled`, `expired` | 22_request_enums |
| `swap_offer_type` | `cover`, `swap` | 22_request_enums |
| `audit_action` | `request_created`, `offer_submitted`, `offer_selected`, `offer_denied`, `request_approved`, `request_denied`, `request_cancelled`, `request_expired`, `timesheet_corrected` | 22_request_enums + 37 |

---

## 2. Tables

### 2.1 Core Identity

#### `stores`
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid PK | `gen_random_uuid()` |
| name | text | NOT NULL, UNIQUE |
| qr_token | text | NOT NULL, UNIQUE |
| expected_drawer_cents | integer | NOT NULL, DEFAULT 20000 |
| created_at | timestamptz | NOT NULL, DEFAULT now() |

**RLS:** Enabled. SELECT for `anon, authenticated` using `true`.

#### `profiles`
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid PK | `gen_random_uuid()` |
| auth_user_id | uuid | FK -> auth.users(id) ON DELETE SET NULL, UNIQUE WHERE NOT NULL |
| name | text | NOT NULL, UNIQUE |
| active | boolean | NOT NULL, DEFAULT true |
| employee_code | text | nullable |
| pin_hash | text | nullable (bcrypt/PBKDF2) |
| pin_fingerprint | text | nullable (HMAC), UNIQUE WHERE active=true |
| pin_locked_until | timestamptz | nullable |
| pin_failed_attempts | int | DEFAULT 0 |
| created_at | timestamptz | NOT NULL, DEFAULT now() |

**RLS:** Enabled. SELECT for `anon, authenticated` using `true` (clock-in). SELECT self via `auth.uid() = auth_user_id`.

#### `store_memberships`
| Column | Type | Constraints |
|--------|------|-------------|
| store_id | uuid | FK -> stores(id) ON DELETE CASCADE |
| profile_id | uuid | FK -> profiles(id) ON DELETE CASCADE |

**PK:** (store_id, profile_id)
**RLS:** Enabled. SELECT for managers via `store_managers` join.

#### `app_users`
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid PK | FK -> auth.users(id) ON DELETE CASCADE |
| email | text | UNIQUE |
| display_name | text | NOT NULL |
| role | text | NOT NULL, DEFAULT 'manager', CHECK IN ('manager') |
| created_at | timestamptz | NOT NULL, DEFAULT now() |

**RLS:** Enabled. SELECT/UPDATE own row via `auth.uid() = id`.

#### `store_managers`
| Column | Type | Constraints |
|--------|------|-------------|
| store_id | uuid | FK -> stores(id) ON DELETE CASCADE |
| user_id | uuid | FK -> app_users(id) ON DELETE CASCADE |
| created_at | timestamptz | NOT NULL, DEFAULT now() |

**PK:** (store_id, user_id)
**RLS:** Enabled. SELECT own rows via `auth.uid() = user_id`.

#### `store_settings`
| Column | Type | Constraints |
|--------|------|-------------|
| store_id | uuid PK | FK -> stores(id) ON DELETE CASCADE |
| v2_pin_auth_enabled | boolean | DEFAULT false |
| v2_scheduling_enabled | boolean | DEFAULT false |
| v2_user_dashboard_enabled | boolean | DEFAULT false |
| pin_max_attempts | int | DEFAULT 3 |
| pin_lockout_minutes | int | DEFAULT 30 |
| schedule_publish_lead_hours | int | DEFAULT 24 |
| drawer_variance_soft_cents | int | DEFAULT 500 |
| drawer_variance_hard_cents | int | DEFAULT 1500 |
| updated_at | timestamptz | DEFAULT now() |
| updated_by | uuid | FK -> auth.users(id) |

---

### 2.2 Shift Layer

#### `shifts`
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid PK | `gen_random_uuid()` |
| store_id | uuid | NOT NULL, FK -> stores(id) |
| profile_id | uuid | NOT NULL, FK -> profiles(id) |
| shift_type | shift_type | NOT NULL |
| planned_start_at | timestamptz | NOT NULL |
| started_at | timestamptz | NOT NULL, DEFAULT now() |
| ended_at | timestamptz | nullable |
| schedule_shift_id | uuid | FK -> schedule_shifts(id) |
| shift_source | text | DEFAULT 'scheduled', CHECK IN ('scheduled','manual','coverage','emergency') |
| shift_note | text | nullable |
| coverage_for | uuid | FK -> profiles(id) |
| requires_override | boolean | NOT NULL, DEFAULT false |
| override_at | timestamptz | nullable |
| override_by | uuid | nullable |
| override_note | text | nullable |
| manual_closed | boolean | NOT NULL, DEFAULT false |
| manual_closed_at | timestamptz | nullable |
| manual_closed_by_profile | uuid | FK -> profiles(id) ON DELETE SET NULL |
| manual_closed_review_status | text | CHECK IN ('approved','edited','removed') |
| manual_closed_reviewed_at | timestamptz | nullable |
| manual_closed_reviewed_by | uuid | FK -> auth.users(id) ON DELETE SET NULL |
| last_action | text | NOT NULL, DEFAULT 'added', CHECK IN ('added','edited','removed') |
| last_action_by | uuid | FK -> auth.users(id) ON DELETE SET NULL |
| created_at | timestamptz | NOT NULL, DEFAULT now() |

**Indexes:** store_id, profile_id, started_at, `UNIQUE(profile_id) WHERE ended_at IS NULL` (one active shift per person), requires_override partial.
**RLS:** Enabled. Manager SELECT via store_managers join. Self SELECT via profiles.auth_user_id.
**Triggers:** `trg_enforce_required_drawer_counts` (BEFORE UPDATE of ended_at), `trg_enforce_clock_windows` (BEFORE INSERT OR UPDATE of ended_at).

#### `shift_drawer_counts`
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid PK | `gen_random_uuid()` |
| shift_id | uuid | NOT NULL, FK -> shifts(id) ON DELETE CASCADE |
| count_type | drawer_count_type | NOT NULL |
| counted_at | timestamptz | NOT NULL, DEFAULT now() |
| drawer_cents | integer | NOT NULL, CHECK 0..100000 |
| change_count | integer | nullable |
| confirmed | boolean | NOT NULL, DEFAULT false |
| notified_manager | boolean | NOT NULL, DEFAULT false |
| note | text | nullable |
| count_missing | boolean | NOT NULL, DEFAULT false |
| out_of_threshold | boolean | NOT NULL, DEFAULT false |
| reviewed_at | timestamptz | nullable |
| reviewed_by | uuid | nullable |

**UNIQUE:** (shift_id, count_type) -- one count per type per shift.
**RLS:** Enabled. Manager SELECT via shifts->store_managers. Self SELECT via shifts->profiles.auth_user_id.

#### `shift_assignments`
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid PK | `gen_random_uuid()` |
| type | assignment_type | NOT NULL |
| message | text | NOT NULL |
| target_profile_id | uuid | FK -> profiles(id) ON DELETE CASCADE |
| target_store_id | uuid | FK -> stores(id) ON DELETE CASCADE |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| created_by | uuid | FK -> auth.users(id) ON DELETE SET NULL |
| delivered_at | timestamptz | nullable |
| delivered_shift_id | uuid | FK -> shifts(id) ON DELETE SET NULL |
| delivered_profile_id | uuid | FK -> profiles(id) ON DELETE SET NULL |
| delivered_store_id | uuid | FK -> stores(id) ON DELETE SET NULL |
| acknowledged_at | timestamptz | nullable |
| acknowledged_shift_id | uuid | FK -> shifts(id) ON DELETE SET NULL |
| completed_at | timestamptz | nullable |
| completed_shift_id | uuid | FK -> shifts(id) ON DELETE SET NULL |
| audit_note | text | nullable |
| audit_note_updated_at | timestamptz | nullable |
| audit_note_by | uuid | FK -> auth.users(id) ON DELETE SET NULL |
| deleted_at | timestamptz | nullable |
| deleted_by | uuid | FK -> auth.users(id) ON DELETE SET NULL |

**CHECK:** Exactly one of target_profile_id or target_store_id must be set.
**RLS:** Enabled. Employee read/update own (via JWT `profile_id` claim). Manager read via store membership.

---

### 2.3 Schedule Layer

#### `shift_templates`
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid PK | `gen_random_uuid()` |
| store_id | uuid | NOT NULL, FK -> stores(id) ON DELETE CASCADE |
| day_of_week | int | CHECK 0..6 |
| shift_type | shift_type | NOT NULL |
| start_time | time | NOT NULL |
| end_time | time | NOT NULL |
| is_overnight | boolean | DEFAULT false |

**UNIQUE:** (store_id, day_of_week, shift_type)

#### `schedules`
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid PK | `gen_random_uuid()` |
| store_id | uuid | NOT NULL, FK -> stores(id) ON DELETE CASCADE |
| period_start | date | NOT NULL |
| period_end | date | NOT NULL |
| status | text | DEFAULT 'draft', CHECK IN ('draft','published','archived') |
| published_at | timestamptz | nullable |
| published_by | uuid | FK -> auth.users(id) |
| created_by | uuid | FK -> auth.users(id) |
| created_at | timestamptz | DEFAULT now() |

**RLS:** Enabled. Manager CRUD via store_managers. Employee SELECT published only.

#### `schedule_shifts`
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid PK | `gen_random_uuid()` |
| schedule_id | uuid | NOT NULL, FK -> schedules(id) ON DELETE CASCADE |
| store_id | uuid | FK -> stores(id) |
| profile_id | uuid | NOT NULL, FK -> profiles(id) |
| shift_date | date | NOT NULL |
| shift_type | shift_type | NOT NULL |
| shift_mode | text | DEFAULT 'standard', CHECK IN ('standard','double','other') |
| scheduled_start | time | NOT NULL |
| scheduled_end | time | NOT NULL |
| template_id | uuid | FK -> shift_templates(id) |
| created_at | timestamptz | DEFAULT now() |
| updated_at | timestamptz | DEFAULT now() |

**CHECK:** other mode <-> other type mutual constraint.
**UNIQUE:** (schedule_id, profile_id, shift_date, shift_type) WHERE shift_mode != 'other'.
**RLS:** Enabled. Manager CRUD via schedules->store_managers. Employee SELECT own + published.

---

### 2.4 Checklist Layer

#### `checklist_templates`
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid PK | `gen_random_uuid()` |
| store_id | uuid | FK -> stores(id) ON DELETE CASCADE |
| name | text | NOT NULL |
| shift_type | shift_type | NOT NULL |
| created_at | timestamptz | NOT NULL, DEFAULT now() |

**UNIQUE:** (store_id, name, shift_type)

#### `checklist_items`
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid PK | `gen_random_uuid()` |
| template_id | uuid | NOT NULL, FK -> checklist_templates(id) ON DELETE CASCADE |
| label | text | NOT NULL |
| sort_order | integer | NOT NULL |
| required | boolean | NOT NULL, DEFAULT true |

#### `shift_checklist_checks`
| Column | Type | Constraints |
|--------|------|-------------|
| shift_id | uuid | FK -> shifts(id) ON DELETE CASCADE |
| item_id | uuid | FK -> checklist_items(id) ON DELETE CASCADE |
| checked_at | timestamptz | NOT NULL, DEFAULT now() |

**PK:** (shift_id, item_id)

#### `clock_windows`
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid PK | `gen_random_uuid()` |
| store_key | text | NOT NULL, CHECK IN ('LV1','LV2') |
| shift_type | text | NOT NULL, CHECK IN ('open','close') |
| dow | smallint | NOT NULL, CHECK 0..6 |
| start_min | smallint | NOT NULL, CHECK 0..1439 |
| end_min | smallint | NOT NULL, CHECK 0..1439 |
| crosses_midnight | boolean | NOT NULL, DEFAULT false |
| label | text | NOT NULL |
| created_at | timestamptz | NOT NULL, DEFAULT now() |

---

### 2.5 Request Layer

#### `shift_swap_requests`
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid PK | `gen_random_uuid()` |
| schedule_shift_id | uuid | NOT NULL, FK -> schedule_shifts(id) ON DELETE CASCADE |
| store_id | uuid | NOT NULL, FK -> stores(id) ON DELETE CASCADE |
| requester_profile_id | uuid | NOT NULL, FK -> profiles(id) ON DELETE CASCADE |
| reason | text | nullable |
| status | request_status | NOT NULL, DEFAULT 'open' |
| selected_offer_id | uuid | FK -> shift_swap_offers(id) |
| approved_by | uuid | FK -> auth.users(id) |
| approved_at | timestamptz | nullable |
| denial_reason | text | nullable |
| expires_at | timestamptz | NOT NULL |
| nudge_sent_at | timestamptz | nullable |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |

**RLS:** Enabled. Employee read own. Manager read via store.

#### `shift_swap_offers`
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid PK | `gen_random_uuid()` |
| request_id | uuid | NOT NULL, FK -> shift_swap_requests(id) ON DELETE CASCADE |
| offerer_profile_id | uuid | NOT NULL, FK -> profiles(id) ON DELETE CASCADE |
| offer_type | swap_offer_type | NOT NULL |
| swap_schedule_shift_id | uuid | FK -> schedule_shifts(id) |
| is_selected | boolean | NOT NULL, DEFAULT false |
| is_withdrawn | boolean | NOT NULL, DEFAULT false |
| note | text | nullable |
| created_at | timestamptz | NOT NULL, DEFAULT now() |

**UNIQUE:** (request_id, offerer_profile_id) -- one offer per person per request.
**CHECK:** swap type requires swap_schedule_shift_id.
**RLS:** Enabled. Employee read own offers OR offers on own requests. Manager read via request store.

#### `time_off_requests`
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid PK | `gen_random_uuid()` |
| store_id | uuid | NOT NULL, FK -> stores(id) ON DELETE CASCADE |
| profile_id | uuid | NOT NULL, FK -> profiles(id) ON DELETE CASCADE |
| start_date | date | NOT NULL |
| end_date | date | NOT NULL, CHECK >= start_date |
| reason | text | nullable |
| status | request_status | NOT NULL, DEFAULT 'pending' |
| denial_reason | text | nullable |
| reviewed_by | uuid | FK -> auth.users(id) |
| reviewed_at | timestamptz | nullable |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |

**RLS:** Enabled. Employee read own. Manager read via store.

#### `time_off_blocks`
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid PK | `gen_random_uuid()` |
| profile_id | uuid | NOT NULL, FK -> profiles(id) ON DELETE CASCADE |
| start_date | date | NOT NULL |
| end_date | date | NOT NULL, CHECK >= start_date |
| request_id | uuid | FK -> time_off_requests(id) ON DELETE CASCADE |
| created_by | uuid | FK -> auth.users(id) |
| deleted_at | timestamptz | nullable |
| deleted_by | uuid | FK -> auth.users(id) |
| created_at | timestamptz | NOT NULL, DEFAULT now() |

**RLS:** Enabled. Employee read own. Manager read via store_memberships.

#### `timesheet_change_requests`
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid PK | `gen_random_uuid()` |
| shift_id | uuid | NOT NULL, FK -> shifts(id) ON DELETE CASCADE |
| store_id | uuid | NOT NULL, FK -> stores(id) ON DELETE CASCADE |
| requester_profile_id | uuid | NOT NULL, FK -> profiles(id) ON DELETE CASCADE |
| requested_started_at | timestamptz | nullable |
| requested_ended_at | timestamptz | nullable |
| original_started_at | timestamptz | nullable |
| original_ended_at | timestamptz | nullable |
| reason | text | nullable |
| status | request_status | NOT NULL, DEFAULT 'pending' |
| denial_reason | text | nullable |
| reviewed_by | uuid | FK -> auth.users(id) |
| reviewed_at | timestamptz | nullable |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |

**CHECK:** At least one of requested_started_at or requested_ended_at must be non-null.
**RLS:** Enabled. Employee read own. Manager read via store.

#### `request_audit_logs`
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid PK | `gen_random_uuid()` |
| request_type | text | NOT NULL, CHECK IN ('shift_swap','time_off','timesheet') |
| request_id | uuid | NOT NULL |
| action | audit_action | NOT NULL |
| actor_profile_id | uuid | FK -> profiles(id) |
| actor_auth_user_id | uuid | FK -> auth.users(id) |
| snapshot | jsonb | nullable |
| created_at | timestamptz | NOT NULL, DEFAULT now() |

**RLS:** Enabled. Employee read own actions (via JWT profile_id). Manager read via store membership chain.

---

### 2.6 Cleaning Layer

#### `cleaning_tasks`
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid PK | `gen_random_uuid()` |
| name | text | NOT NULL, UNIQUE |
| category | text | NOT NULL |
| created_at | timestamptz | DEFAULT now() |

Pre-seeded: 17 tasks across Sweep, Mop, Dust, Deep Clean categories.

#### `store_cleaning_schedules`
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid PK | `gen_random_uuid()` |
| store_id | uuid | NOT NULL, FK -> stores(id) ON DELETE CASCADE |
| cleaning_task_id | uuid | NOT NULL, FK -> cleaning_tasks(id) ON DELETE CASCADE |
| day_of_week | int | NOT NULL, CHECK 0..6 |
| shift_type | text | NOT NULL, CHECK IN ('am','pm') |
| is_required | boolean | NOT NULL, DEFAULT true |
| created_at | timestamptz | DEFAULT now() |

**UNIQUE:** (store_id, cleaning_task_id, day_of_week, shift_type)

#### `cleaning_task_completions`
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid PK | `gen_random_uuid()` |
| shift_id | uuid | NOT NULL, FK -> shifts(id) ON DELETE CASCADE |
| store_cleaning_schedule_id | uuid | NOT NULL, FK -> store_cleaning_schedules(id) ON DELETE CASCADE |
| status | text | NOT NULL, CHECK IN ('completed','skipped') |
| reason | text | nullable |
| completed_by | uuid | FK -> profiles(id) |
| created_at | timestamptz | DEFAULT now() |
| updated_at | timestamptz | DEFAULT now() |

**UNIQUE:** (shift_id, store_cleaning_schedule_id)

---

### 2.7 V3 Prep Tables (File 18, not actively used)

- `coverage_requests` (schedule_shift_id, requested_by, status, filled_by)
- `time_off_requests` (V3 version in file 18 - superseded by file 24)
- `shift_edit_requests` (shift_id, requested_by, field_name, current/requested_value)

---

## 3. RPC Functions

### 3.1 Shift Swap RPCs (File 28)

| Function | Security | Locks | Auth Check |
|----------|----------|-------|------------|
| `submit_shift_swap_request(p_actor_profile_id, p_schedule_shift_id, p_reason, p_expires_hours)` | DEFINER + search_path | None | Shift ownership + schedule published |
| `submit_shift_swap_offer(p_actor_profile_id, p_request_id, p_offer_type, p_swap_schedule_shift_id, p_note)` | DEFINER + search_path | FOR UPDATE on request | Store membership + not self-offer |
| `select_shift_swap_offer(p_actor_profile_id, p_request_id, p_offer_id)` | DEFINER + search_path | FOR UPDATE on request | Request ownership |
| `decline_shift_swap_offer(p_actor_profile_id, p_request_id, p_offer_id)` | DEFINER + search_path | FOR UPDATE on request | Request ownership |
| `approve_shift_swap_or_cover(p_actor_auth_user_id, p_request_id)` | DEFINER + search_path | FOR UPDATE on request, request_shift, offer_shift | Store manager check + bilocation + solo coverage |
| `cancel_shift_swap_request(p_actor_profile_id, p_request_id)` | DEFINER + search_path | FOR UPDATE on request | Request ownership |

### 3.2 Time-Off RPCs (File 29)

| Function | Security | Locks | Auth Check |
|----------|----------|-------|------------|
| `submit_time_off_request(p_actor_profile_id, p_store_id, p_start_date, p_end_date, p_reason)` | DEFINER + search_path | None | Store membership + no schedule conflict |
| `approve_time_off_request(p_actor_auth_user_id, p_request_id)` | DEFINER + search_path | FOR UPDATE on request | Store manager |
| `cancel_time_off_request(p_actor_profile_id, p_request_id)` | DEFINER + search_path | FOR UPDATE on request | Request ownership |

### 3.3 Timesheet RPCs (File 30)

| Function | Security | Locks | Auth Check |
|----------|----------|-------|------------|
| `submit_timesheet_change_request(p_actor_profile_id, p_shift_id, ...)` | DEFINER + search_path | FOR UPDATE on shift | Shift ownership + payroll lock |
| `approve_timesheet_change_request(p_actor_auth_user_id, p_request_id)` | DEFINER + search_path | FOR UPDATE on request + shift | Store manager + staleness check |
| `cancel_timesheet_change_request(p_actor_profile_id, p_request_id)` | DEFINER + search_path | FOR UPDATE on request | Request ownership |

### 3.4 Unified Deny RPC (File 31/38)

| Function | Security | Locks | Auth Check |
|----------|----------|-------|------------|
| `deny_request(p_actor_auth_user_id, p_request_type, p_request_id, p_denial_reason)` | DEFINER + search_path | FOR UPDATE per type | Store manager per request type |

### 3.5 Cron RPCs (File 32)

| Function | Security | Locks | Notes |
|----------|----------|-------|-------|
| `process_expired_requests()` | DEFINER + search_path | FOR UPDATE SKIP LOCKED | Expires open requests past expires_at |
| `send_selection_nudges()` | DEFINER + search_path | FOR UPDATE SKIP LOCKED | Nudges requesters 24hr before expiry |

### 3.6 Validation Functions (File 27)

| Function | Security | Notes |
|----------|----------|-------|
| `check_bilocation_conflict(profile, date, start, end, exclude)` | DEFINER + search_path | Returns conflicting shifts |
| `check_time_off_schedule_conflict(profile, start, end)` | DEFINER + search_path | Returns conflicting shifts |
| `check_solo_coverage_conflict(store, date, type, start, end, exclude)` | DEFINER + search_path | Returns conflicting shifts |
| `check_payroll_lock(shift_started_at)` | DEFINER + search_path | Returns lock status + period boundaries |

### 3.7 Cleaning RPCs (File 41)

| Function | Security | Locks | Notes |
|----------|----------|-------|-------|
| `fetch_cleaning_tasks_for_shift(p_shift_id, p_actor_profile_id)` | DEFINER + search_path + `row_security = off` | None | Maps shift to am/pm schedule |
| `complete_cleaning_task(p_shift_id, p_schedule_id, p_actor_profile_id)` | DEFINER + search_path + `row_security = off` | FOR UPDATE on shift | Upsert completion |
| `skip_cleaning_task(p_shift_id, p_schedule_id, p_actor_profile_id, p_reason)` | DEFINER + search_path + `row_security = off` | FOR UPDATE on shift | Notifies managers |

### 3.8 Other Functions

| Function | Security | Notes |
|----------|----------|-------|
| `payroll_shifts_range(p_from, p_to, p_store_id)` | DEFINER + search_path | Requires auth.uid(), filters by store_managers |
| `clock_window_check(p_store_id, p_shift_type, p_time)` | DEFINER (no search_path!) | Validates time against clock windows |
| `store_key_for_id(p_store_id)` | STABLE, no security | Returns 'LV1'/'LV2' from store name |
| `enforce_required_drawer_counts()` | Trigger function | Validates start/changeover/end counts exist |
| `enforce_clock_windows()` | Trigger function | Validates clock-in/out within windows (scheduled shifts exempt) |

---

## 4. Triggers

| Trigger | Table | Event | Function |
|---------|-------|-------|----------|
| `trg_enforce_required_drawer_counts` | shifts | BEFORE UPDATE OF ended_at | `enforce_required_drawer_counts()` |
| `trg_enforce_clock_windows` | shifts | BEFORE INSERT OR UPDATE OF ended_at | `enforce_clock_windows()` |

---

## 5. Views

| View | Source Tables | Notes |
|------|-------------|-------|
| `shift_export` | shifts + profiles + stores + shift_drawer_counts | CSV export with drawer deltas |

---

## 6. Grant Summary

All RPCs: `REVOKE ALL FROM public, anon; GRANT EXECUTE TO authenticated, service_role`
Exception: `payroll_shifts_range` also revokes from anon explicitly.

---

## 7. Authentication Architecture

```
Manager Flow:
  Supabase Auth (email/password) -> auth.users JWT -> supabaseServer.auth.getUser()
    -> app_users.role check -> store_managers for store scope

Employee Flow:
  PIN entry -> Edge Function (employee-auth)
    -> PBKDF2 verify (150k iterations, SHA-256)
    -> ES256 JWT issued (4hr expiry)
    -> Claims: { profile_id, store_id, store_ids[], role: "authenticated" }
    -> Client stores in sessionStorage

API Route Verification:
  authenticateShiftRequest(req) in src/lib/shiftAuth.ts
    -> Try 1: ES256 JWT signature verify (employee)
    -> Try 2: Supabase auth.getUser() (manager)
    -> Returns: AuthContext { profileId, storeIds, authType }
```

---

## 8. Entity Relationship Diagram (Text)

```
stores ─┬─< store_memberships >── profiles
        ├─< store_managers >───── app_users ──> auth.users
        ├─< store_settings
        ├─< shifts ─┬─< shift_drawer_counts
        │           ├─< shift_checklist_checks >── checklist_items
        │           ├─< shift_assignments
        │           └─< cleaning_task_completions
        ├─< schedules ──< schedule_shifts ─┬─< shift_swap_requests ──< shift_swap_offers
        │                                  └──── shifts.schedule_shift_id
        ├─< checklist_templates ──< checklist_items
        ├─< shift_templates
        ├─< clock_windows
        ├─< time_off_requests ──< time_off_blocks
        ├─< store_cleaning_schedules >── cleaning_tasks
        └─< timesheet_change_requests >── shifts

request_audit_logs (polymorphic: request_type + request_id)
```
