# Shift Happens — Pass 2 of 4: Frontend Architecture & Logic Audit

**Date:** 2025-02-10
**Role:** Senior Frontend Architect
**Scope:** State management, data fetching, error handling, security, business logic leaks
**Exclusions:** CSS, Tailwind class names, accessibility (ARIA)
**Depends on:** AUDIT_PHASE_1_FINDINGS.md (Pass 1 backend findings)

---

## Executive Summary

The frontend centers on a single 1,518-line "God Component" (`ClockPageClient.tsx`) that owns the entire clock-in flow: store selection, employee authentication, shift creation, drawer counting, clock-window enforcement, stale-shift resolution, and six modal types. It uses **50+ `useState` variables**, **11 `useEffect` hooks** with cascading dependency chains, and **14+ `useMemo` derivations**. There is no `useReducer`, no state machine library, no global error boundary, no data-fetching library, and no client-side schema validation despite Zod schemas existing server-side.

The component works — but it is fragile, untestable in isolation, and accumulating technical debt at a rate that will block feature work within 1-2 sprints.

**Risk Rating: HIGH** — Not because of immediate user-facing bugs, but because the architecture has no safety net for regressions, no isolation for testing, and several silent correctness issues (timezone rounding, token expiry, missing debounce) that could cause data integrity problems under real-world conditions.

---

## Findings Table

| # | Severity | Category | File : Lines | Issue | Recommended Fix |
|---|----------|----------|-------------|-------|-----------------|
| FE-01 | CRITICAL | State | `ClockPageClient.tsx:163-231` | **50+ `useState` variables** with no grouping beyond comments. State transitions are implicit — any handler can set any variable, making it impossible to reason about valid state combinations. No `useReducer`, no state machine. | Migrate to `useReducer` with a discriminated-union `ClockState` type (see REFACTOR_PLAN). Invalid transitions become type errors. |
| FE-02 | HIGH | Effects | `ClockPageClient.tsx:300-598` | **11 `useEffect` hooks** forming 5 dependency chains: (a) `storeId`→shiftKind inference (L300), (b) sessionStorage restore→state hydration (L422), (c) manager session→profile load (L443), (d) `activeStoreId`→PIN modal toggle (L502), (e) `profileId`→open-shift fetch (L536). Chain (e) depends on outputs from chains (b) and (c), creating a waterfall that causes 3-4 render cycles on mount. | Extract data-fetching effects into custom hooks (`useStores`, `useOpenShift`, `useManagerProfile`). Replace derived-state effects with `useMemo` where possible (e.g., L300 shiftKind inference is a pure derivation, not a side effect). |
| FE-03 | HIGH | Duplication | `ClockPageClient.tsx:1197-1374` vs `PinGate.tsx:1-317` | **Inline PIN modal** (178 lines) duplicates the already-extracted `PinGate.tsx` component almost line-for-line. `PinGate` is used on the home page but NOT on the clock page. Both contain identical auth flow, identical sessionStorage keys, identical UI. | Replace inline PIN modal with `<PinGate>` import. Extend PinGate props if needed (e.g., add `onAuthenticated` callback for profile name). |
| FE-04 | HIGH | Security | `ClockPageClient.tsx:422-441, 642-647` | **No client-side JWT expiry tracking.** The 4-hour PIN token is stored in `sessionStorage` and used until the server returns 401. No proactive expiry check, no countdown timer, no refresh mechanism. Employee could work a 6-hour shift and silently lose API access mid-operation. | Decode JWT `exp` claim on auth, set a timer to warn at T-15min, force re-auth at expiry. Consider storing `exp` alongside token in sessionStorage. |
| FE-05 | HIGH | Security | `ClockPageClient.tsx:1288-1358` | **No PIN input debouncing.** Every 4-digit PIN entry immediately fires a network request to `employee-auth`. The only rate limiting is server-side 429. A malicious or confused user can spam attempts from the UI with no client-side cooldown. | Add client-side rate limiting: disable submit for 2s after failure, exponential backoff after 3 failures, match server lockout (5 attempts → lockout). |
| FE-06 | HIGH | Timezone | `ClockPageClient.tsx:50-57`, `kioskRules.ts:52-69` | **`roundTo30Minutes()` operates on local Date**, not CST. Both the inline copy (L50) and the lib copy use `nd.getMinutes()` and `nd.setMinutes()` which operate in the browser's local timezone. If an employee's device is set to EST and they enter 8:45 AM CST, rounding happens on the EST interpretation (9:45 AM EST → 10:00 AM) instead of the CST value (8:45 AM → 9:00 AM). The `toCstDateFromLocalInput()` function correctly converts to UTC, but `roundTo30Minutes()` is called on the result using local-time methods. | Change `roundTo30Minutes()` to extract CST hours/minutes via `Intl.DateTimeFormat` before rounding, then reconstruct a UTC Date. Or round inside `toCstDateFromLocalInput()` before the UTC conversion. |
| FE-07 | HIGH | Logic Leak | `ClockPageClient.tsx:130-142, 256-277`, `kioskRules.ts:26-41` | **Business logic duplicated** between client and server. `inferShiftKind()` (client-only, L130), `isOutOfThreshold()` / `thresholdMessage()` (shared via import but also duplicated in end-shift API logic), store hours mapping (client L108-128 vs DB clock_windows table). Client logic can drift from server truth. | Canonicalize: move `inferShiftKind` to a shared util or return shift_type from the server. Keep `isOutOfThreshold` in kioskRules.ts as single source, import on both sides. Remove hardcoded store hours from client; use clock_windows DB table via API. |
| FE-08 | HIGH | Error | Global | **No global error boundary.** No `ErrorBoundary` component anywhere in the app. An unhandled exception in any component (e.g., `JSON.parse` on a malformed API response, accessing `.id` on null) crashes the entire React tree with a white screen. No recovery path. | Add `<ErrorBoundary>` in root layout wrapping children. Add route-level error boundaries for `/clock`, `/admin`, `/run`. Implement `error.tsx` files per Next.js App Router convention. |
| FE-09 | MEDIUM | Data Fetch | `ClockPageClient.tsx:368-420, 536-586`, hooks/*.ts | **No data-fetching library.** All data fetching uses raw `useEffect` + `fetch` with manual `loading`/`error` state. No request deduplication, no caching, no stale-while-revalidate, no automatic retry, no background refetch. The custom hooks (`useShiftSwapRequests`, etc.) improve structure but still use the same manual pattern internally. | Adopt SWR or TanStack Query. Start with the clock page data fetches (stores, open shift check, manager profile). Migrate hooks incrementally. |
| FE-10 | MEDIUM | Error | `ClockPageClient.tsx:812-814` | **No toast/notification system.** All errors are shown as inline `<div className="banner banner-error">` banners. These can be off-screen if the form is scrolled. Success feedback is a redirect — no confirmation of "shift started" before navigation. | Add a lightweight toast system (e.g., Sonner, react-hot-toast). Show success toasts before redirect. Show error toasts for non-blocking errors. Keep inline banners for field-level validation. |
| FE-11 | MEDIUM | Validation | `schemas/requests.ts:1-47`, all frontend forms | **Zod schemas unused on frontend.** Six schemas defined (`submitSwapRequestSchema`, `submitSwapOfferSchema`, `selectOfferSchema`, `submitTimeOffRequestSchema`, `submitTimesheetChangeSchema`, `denyRequestSchema`) but imported in zero frontend files. All form data is sent directly to API routes without client-side validation. Users get server error messages ("Failed to start shift") instead of field-level feedback. | Import and call `.safeParse()` on form data before API submission. Display `ZodError` field paths as inline validation messages. Create corresponding schemas for clock-in form data. |
| FE-12 | MEDIUM | State | `ClockPageClient.tsx:407-409, 527-533` | **localStorage reads without validation.** `localStorage.getItem("sh_store")` and `localStorage.getItem("sh_profile")` values are used directly as store/profile IDs with only an existence check against the stores array. No type validation, no expiry, no integrity check. Corrupted or stale values silently select wrong store/profile. | Validate localStorage values with Zod schemas on read. Add a `version` key to detect schema changes. Clear stale data when store list changes. |
| FE-13 | MEDIUM | Performance | `ClockPageClient.tsx:1448-1516` | **`StaleShiftConfirmations` defined inside module** but outside `ClockPageClient`. While this avoids re-creation per render (it's a separate function), it contains a `useEffect` (L1475) that calls `setConfirm`/`setNotify` parent setters on every threshold change, potentially causing unnecessary parent re-renders. | Extract to `src/components/StaleShiftConfirmations.tsx`. Memoize with `React.memo`. Consider lifting the threshold-reset logic to the parent via a callback or the reducer. |
| FE-14 | MEDIUM | Performance | `ClockPageClient.tsx:237-316` | **14+ `useMemo` values** with complex dependency arrays. Many are trivially cheap computations (e.g., `selectedStoreName` at L279 is a `.find()` on a 2-element array). Premature memoization adds cognitive overhead and can mask bugs when dependency arrays are wrong. | Profile with React DevTools. Remove `useMemo` for O(1) lookups. Keep only for genuinely expensive computations (CST date conversion, threshold calculation chains). |
| FE-15 | MEDIUM | Security | `ClockPageClient.tsx:1344-1348` | **sessionStorage PIN token accessible to XSS.** Any same-origin script can read `sessionStorage.getItem("sh_pin_token")`. While this is standard for SPAs, the kiosk context (shared physical device, potentially untrusted browser extensions) makes this higher risk than typical. No Content-Security-Policy headers observed. | Add strict CSP headers via `next.config.js`. Consider HttpOnly cookie transport for the PIN token (requires API route proxy). At minimum, document the XSS risk in AGENTS.md. |
| FE-16 | MEDIUM | Data Flow | `src/app/page.tsx` (home dashboard) | **Pay period calculation duplicated.** The home dashboard calculates current pay period boundaries (bi-weekly, starting from a known anchor date) in client-side JavaScript. The same calculation exists in `payroll_shifts_range` RPC on the server. No shared utility. | Extract pay period calculation to `src/lib/payPeriod.ts`. Import in both home page and server-side. Single source of truth. |
| FE-17 | MEDIUM | Error | `ClockPageClient.tsx:685-708` | **Orphaned shift recovery is fragile.** On start-shift 409 conflict, the component fetches the open shift and shows a modal. But if the second fetch fails (L705 catch), it falls through to a generic error message with no indication that an open shift exists. The user may attempt to start another shift, hitting 409 repeatedly. | On 409, always show the open-shift modal using the `shiftId` from the 409 response (already available in `json.shiftId`). Don't require a second fetch. Add a "Try Again" button with exponential backoff. |
| FE-18 | LOW | Convention | `ClockPageClient.tsx:600-733` | **Mixed async patterns.** `startShift()` uses try/catch (L650-732). The PIN auth handler uses try/catch. But some inline handlers use `.then()/.catch()` implicitly via `void startShift()`. Inconsistent but functional. | Standardize on async/await + try/catch throughout. Avoid `void` prefix — use proper error boundaries or `.catch()` at call sites. |
| FE-19 | LOW | Types | `ClockPageClient.tsx:672, 1311, 1328-1330` | **`any` type assertions in API responses.** `json?.token as string`, `json?.profile?.id as string`, `json.shiftType as ShiftKind`. No runtime validation that API responses match expected shapes. | Define response types. Validate with Zod schemas at the fetch boundary. Use type guards instead of `as` casts. |
| FE-20 | LOW | State | `ClockPageClient.tsx:159-161` | **URL search params read-only.** `useSearchParams()` reads `?t=` for QR token but never syncs state back to URL. Selecting a different store doesn't update the URL. Browser back/forward doesn't restore state. Minor UX issue in kiosk context. | For kiosk mode this is acceptable. Document as intentional. If multi-tab usage ever needed, sync `storeId` to URL params. |
| FE-21 | LOW | Convention | `ClockPageClient.tsx:1448-1516` | **`StaleShiftConfirmations` should be in its own file.** Currently defined at module scope after the main export. While technically fine, it violates the one-component-per-file convention used everywhere else in the codebase. | Move to `src/components/StaleShiftConfirmations.tsx`. |
| FE-22 | INFO | Timezone | `clockWindows.ts:78-96`, `ClockPageClient.tsx:71-89` | **Client and server timezone handling is consistent.** Both use `America/Chicago` — client via `Intl.DateTimeFormat`, server via `AT TIME ZONE 'America/Chicago'`. `getCstDowMinutes()` correctly handles DST transitions. Cross-midnight window logic (LV2 Fri/Sat close) is correctly implemented. | No fix needed. Document as verified in AGENTS.md. |

---

## Answers to Specific Audit Questions

### Q1: State Complexity — "Inventory every `useState` in ClockPageClient. Group by domain. Which should be `useReducer`?"

**Full Inventory (50+ variables):**

| Domain | Variables | Lines |
|--------|-----------|-------|
| Loading/Error | `loading`, `submitting`, `error` | 163-165 |
| Stores | `stores`, `storeId`, `tokenStore`, `tokenError` | 167-168, 179-180 |
| Employee Auth | `employeeCode`, `profileId`, `authenticatedProfileName`, `managerSession`, `managerAccessToken`, `managerProfile`, `managerProfileError` | 171-173, 221-224 |
| Shift | `shiftKind`, `plannedStartLocal` | 174, 183 |
| Drawer (Start) | `startDrawer`, `changeDrawer`, `startConfirmThreshold`, `startNotifiedManager` | 188-191 |
| Confirmation | `confirmOpen`, `confirmChecked` | 192-193 |
| Clock Window | `clockWindowModal` (object with `open` + `label`) | 194-197 |
| Unscheduled | `unscheduledPrompt` (object or null) | 175-178 |
| Open Shift | `openShiftPrompt`, `openShiftInfo` (complex object), `openShiftKey` | 198-207 |
| Stale Shift | `staleShiftPrompt`, `staleEndLocal`, `staleDrawer`, `staleChangeDrawer`, `staleConfirm`, `staleNotify`, `staleNote`, `staleDoubleCheck`, `staleSaving` | 208-216 |
| PIN Modal | `pinToken`, `pinStoreId`, `pinModalOpen`, `pinLockedSelection`, `pinProfileId`, `pinValue`, `pinError`, `pinLoading`, `pinShake` | 218-230 |
| Ref | `pinInputRef` | 231 |

**Verdict:** The entire component should use a single `useReducer` with a discriminated union state type. The phases (store-select → pin-auth → shift-form → confirming → submitting → complete) map naturally to state machine nodes. At minimum, the stale-shift domain (9 variables) and PIN domain (9 variables) should each be their own `useReducer` or extracted components with internal state.

---

### Q2: Effect Tangles — "Map every `useEffect` dependency chain. Which effects trigger cascading state updates?"

**11 Effects, 5 Dependency Chains:**

| Effect | Lines | Dependencies | Triggers | Chain |
|--------|-------|-------------|----------|-------|
| Store load + QR validate | 368-420 | `[]` (mount) | `setStores`, `setStoreId`, `setTokenStore` | A (root) |
| SessionStorage restore | 422-441 | `[]` (mount) | `setPinToken`, `setPinStoreId`, `setProfileId`, `setStoreId` | B (root) |
| Manager session check | 443-500 | `[]` (mount) | `setManagerSession`, `setManagerProfile`, `setProfileId` | C (root) |
| PIN modal toggle | 502-517 | `[activeStoreId, pinToken, pinStoreId, pinProfileId, managerSession, loading]` | `setPinModalOpen` | D ← A,B,C |
| PIN modal reset | 519-524 | `[pinModalOpen]` | `setPinValue`, `setPinError` | E ← D |
| ShiftKind inference | 300-304 | `[plannedStartLocal, tokenStore, stores, storeId]` | `setShiftKind` | F ← A |
| Persist store to LS | 527-529 | `[storeId]` | localStorage write | G ← A,B |
| Persist profile to LS | 531-533 | `[profileId]` | localStorage write | H ← B,C |
| Open shift check | 536-586 | `[profileId, openShiftKey, managerSession, managerAccessToken, pinToken]` | `setOpenShiftInfo`, `setOpenShiftPrompt` | I ← B,C |
| Confirm reset | 589-592 | `[storeId, profileId, plannedStartLocal, shiftKind]` | `setConfirmChecked`, `setConfirmOpen` | J ← A,B,F |
| Manager notify reset | 594-598 | `[requiresManagerNotify]` | `setStartNotifiedManager` | K (leaf) |

**Cascading chains on mount:**
1. Effects A, B, C fire simultaneously (all `[]` deps)
2. A sets `stores` + `storeId` → triggers F (shiftKind), G (localStorage), D (PIN modal), J (confirm reset)
3. B sets `profileId` → triggers H (localStorage), I (open shift check), J (confirm reset)
4. C sets `managerSession` → triggers D (PIN modal), I (open shift check)
5. D sets `pinModalOpen` → triggers E (PIN reset)

**Result:** 3-4 render cycles on mount. Effects F (shiftKind) and J (confirm reset) are pure derivations masquerading as effects — they should be `useMemo`.

---

### Q3: Logic Leaks — "List every piece of business logic in the frontend that also exists on the backend."

| # | Logic | Client Location | Server Location | Risk |
|---|-------|-----------------|-----------------|------|
| 1 | Drawer threshold check | `kioskRules.ts:26-28` (imported in ClockPageClient) | `end-shift/route.ts` + `enforce_required_drawer_counts` trigger | LOW — shared import, but server has different thresholds per store_settings |
| 2 | `roundTo30Minutes()` | `kioskRules.ts:52-69` + `ClockPageClient.tsx:50-57` (duplicated!) | Payroll export logic (server-side) | HIGH — two copies on client alone, plus server copy. Client version is not CST-aware (FE-06) |
| 3 | `inferShiftKind()` | `ClockPageClient.tsx:130-142` | `start-shift/route.ts` determines shift_type from schedule or hint | MEDIUM — client sends `shiftTypeHint`, server may override. Client uses hardcoded store hours (L108-128) that don't match the DB `clock_windows` table |
| 4 | Clock window validation | `ClockPageClient.tsx:323-337` via `clockWindows.ts` | `enforce_clock_windows` trigger + `clock_window_check()` RPC | LOW — intentional double-check (UX pre-validation + DB enforcement). Client uses same rules as DB. |
| 5 | Pay period boundaries | `src/app/page.tsx` (home dashboard) | `payroll_shifts_range` RPC | MEDIUM — anchor date hardcoded in both places. If it changes in one, the other breaks silently. |
| 6 | Shift type → requires drawer | `ClockPageClient.tsx:234` (`shiftKind !== "other"`) | `enforce_required_drawer_counts` trigger checks shift_type | LOW — simple boolean, unlikely to drift. But "double" shift behavior is implicit on client. |

---

### Q4: Error Recovery — "What happens when start-shift API returns 409? When end-shift fails? When the PIN JWT expires mid-form?"

**Start-shift 409 (Open Shift Conflict):**
- L685-708: Component catches 409, extracts `json.shiftId`, makes a **second** fetch to `/api/shift/open` to get full shift details.
- If second fetch succeeds → shows `OpenShiftModal` with "Return to open shift" / "End previous shift" options.
- **Gap:** If second fetch fails (L705), falls through to generic error. User sees "Failed to start shift" with no indication an open shift exists. The `json.shiftId` from the 409 response is discarded.
- **Gap:** No retry mechanism. User must manually re-attempt.

**Start-shift drawer failure (backend, Pass 1 F-14):**
- Backend `start-shift/route.ts:322-388` creates shift, then creates drawer count. If drawer insert fails, manually DELETEs the shift.
- **Frontend impact:** User sees generic "Failed to start shift" error. No indication that a shift was created and rolled back. If the DELETE also fails (network issue), an orphaned shift exists in the database — but the client doesn't know about it. Next attempt may hit 409.

**End-shift failure (stale shift close):**
- L1172-1173: Generic throw on `!res.ok`. Error shown in banner.
- **No rollback path.** If end-shift partially completes (e.g., shift updated but drawer count insert fails), the shift may be in an inconsistent state.
- **No retry.** User must dismiss error and try again.

**PIN JWT expires mid-form:**
- Token is read from `sessionStorage` at submit time (L642-647).
- Server validates `exp` claim via `jose` library and returns 401.
- Client shows: "Session expired. Please refresh." (for manager) or "Please authenticate with your PIN." (for employee).
- **Gap:** No proactive warning. Employee could spend 5 minutes filling out the stale-shift close form, then lose all input on submit when token is expired.
- **Gap:** After re-auth, all form state is preserved (it lives in React state), but the user must manually re-submit. This is actually good — no data loss, just an extra step.

---

### Q5: Auth Handling — "How does the frontend handle dual auth (manager Supabase vs employee PIN)? Where is the token stored? Any expiry gaps?"

**Dual Auth Architecture:**
- **Employee path:** `employee-auth` edge function → ES256 JWT (4hr) → stored in `sessionStorage` under keys `sh_pin_token`, `sh_pin_store_id`, `sh_pin_profile_id`.
- **Manager path:** Supabase `auth.getSession()` → auto-refreshing access token → stored in `localStorage` by Supabase client (`supabaseClient.ts:persistSession: true`).
- **Token selection:** At API call time, `managerSession ? managerAccessToken : pinToken` (L643). The custom hooks use `getAuthToken()` (in `useShiftSwapRequests.ts:21-28`) which checks `sessionStorage` first, then Supabase session.

**Storage Security:**
- `sessionStorage` (PIN): Cleared on tab close. Good for kiosk — prevents token persistence across sessions. But accessible to any same-origin script (XSS vector in kiosk context with shared device).
- `localStorage` (Supabase): Persistent. Auto-refreshed by Supabase client. Less concerning for managers (personal devices).

**Expiry Gaps:**
- PIN JWT: 4-hour hard expiry set in edge function. No refresh mechanism. No client-side expiry tracking. Server's `jose` library validates `exp` automatically.
- Supabase token: Auto-refreshed by client. No gap.
- **Risk scenario:** Employee authenticates at 8:55 AM for opening shift. Token expires at 12:55 PM. If they haven't navigated away, any API call after 12:55 PM fails silently until they see the error on submit.

---

### Q6: Date Handling — "Trace every `new Date()`, `toLocaleDateString`, and CST conversion. Are there DST bugs?"

**Date Construction Points:**

| Location | Code | CST-Aware? | Risk |
|----------|------|-----------|------|
| L40-48 | `toLocalInputValue(d = new Date())` | NO — uses `d.getFullYear()`, `d.getMonth()` etc. (local TZ) | Low — only used to pre-fill `<input type="datetime-local">` which expects local time |
| L50-57 | `roundTo30Minutes(d)` | NO — uses `nd.getMinutes()`, `nd.setMinutes()` (local TZ) | **HIGH** — see FE-06. If device TZ ≠ CST, rounding happens on wrong minute value |
| L59-69 | `formatDateTime(dt)` | NO — `toLocaleString` without `timeZone` option → browser local TZ | Medium — only used in stale shift display (L967, L1014). Shows local time, not CST. Misleading. |
| L71-89 | `getCstOffsetMinutes(isoLike)` | YES — extracts CST offset via `Intl.DateTimeFormat` with `timeZone: "America/Chicago"` | Safe — correctly handles DST |
| L91-100 | `toCstDateFromLocalInput(value)` | YES — converts `datetime-local` input to UTC Date representing CST time | Safe — DST-correct |
| L102-106 | `toCstMinutes(dt)` | YES — delegates to `getCstDowMinutes` from clockWindows.ts | Safe |
| L144-155 | `formatCst(dt)` | YES — `toLocaleString` with `timeZone: "America/Chicago"` | Safe |
| `clockWindows.ts:78-96` | `getCstDowMinutes(dt)` | YES — `Intl.DateTimeFormat` with `timeZone: "America/Chicago"`, `hour12: false` | Safe — DST-correct |

**DST Bug Risk:**
- The critical path is: user enters time → `toCstDateFromLocalInput` → `roundTo30Minutes` → submit.
- `toCstDateFromLocalInput` returns a UTC Date correctly adjusted for CST offset.
- `roundTo30Minutes` then calls `nd.getMinutes()` which extracts minutes in **the browser's local timezone**, not CST.
- If browser TZ is CST → no bug (getMinutes returns CST minutes from a UTC date correctly because the local TZ IS CST).
- If browser TZ is anything else → the rounding is wrong. Example: 8:14 AM CST (= 9:14 AM EST). `getMinutes()` returns 14 (from the UTC date's representation in EST). Rounds to :00. But the CST minutes are also 14, so coincidentally correct in this case. **However**, the hour component is wrong after `setMinutes(0,0,0)` — the Date is modified in local TZ terms, not CST terms.
- **Practical risk:** Low-to-medium because these stores appear to be in the CST timezone (Texas-based). But if any employee uses a phone with automatic timezone set to a different zone (traveling, VPN, incorrect settings), the rounding will be wrong by the timezone offset delta.

---

### Q7: Zod Validation — "Where are Zod schemas defined? Where are they imported? What frontend forms lack validation?"

**Schemas Defined:** `src/schemas/requests.ts` (47 lines)
- `submitSwapRequestSchema` — validates `scheduleShiftId` (UUID), optional `reason`, optional `expiresHours`
- `submitSwapOfferSchema` — validates `requestId` (UUID), `offerType` (cover|swap), conditional `swapScheduleShiftId`
- `selectOfferSchema` — validates `offerId` (UUID)
- `submitTimeOffRequestSchema` — validates `storeId` (UUID), `startDate`, `endDate`, optional `reason`
- `submitTimesheetChangeSchema` — validates `shiftId` (UUID), optional timestamps, required `reason`
- `denyRequestSchema` — validates optional `reason`

**Schemas Imported:** 0 frontend files. All 6 schemas are only imported by API route handlers.

**Frontend Forms Lacking Validation:**

| Form | Location | Fields Sent Without Validation |
|------|----------|-------------------------------|
| Clock-in | `ClockPageClient.tsx:651-670` | `storeId`, `profileId`, `plannedStartAt`, `startDrawerCents`, `changeDrawerCents`, `shiftTypeHint` — validated by `canStart` useMemo but not schema-validated |
| Stale shift close | `ClockPageClient.tsx:1154-1169` | `shiftId`, `endAt`, `endDrawerCents`, `changeDrawerCents`, `note` — checkbox-gated but not schema-validated |
| Shift swap request | Dashboard forms | All fields — no Zod validation despite schema existing |
| Time off request | Dashboard forms | All fields — no Zod validation despite schema existing |
| Timesheet change | Dashboard forms | All fields — no Zod validation despite schema existing |

**Impact:** Users get server error messages ("Failed to start shift", "Invalid request") instead of field-level feedback ("Start time is required", "Drawer amount must be a positive number"). Server-side validation catches everything, so data integrity is not at risk — but UX suffers.

---

## Pass 3 Handoff: Backend ↔ Frontend Integration Surface

### For the Integration Auditor (Pass 3)

**Critical integration points to verify:**

1. **Clock-in payload shape** — `ClockPageClient.tsx:657-669` sends JSON body to `POST /api/start-shift`. Verify every field matches what the API route destructures. Key fields: `qrToken`, `storeId`, `profileId`, `shiftTypeHint`, `plannedStartAt` (ISO string), `startDrawerCents` (integer cents), `changeDrawerCents`, `confirmed`, `notifiedManager`, `note`, `force`.

2. **Stale shift close payload** — `ClockPageClient.tsx:1160-1169` sends to `POST /api/end-shift`. Note `manualClose: true` flag which triggers auto-checklist-completion (Pass 1 finding F-02).

3. **Auth header contract** — All API calls use `Authorization: Bearer <token>`. Server's `authenticateShiftRequest()` tries ES256 JWT first, then Supabase `auth.getUser()`. Frontend selects token via `managerSession ? managerAccessToken : pinToken`.

4. **409 conflict recovery** — Frontend expects `{ shiftId }` in 409 response body (L685). Verify `start-shift` route returns this consistently.

5. **Error code contract** — Frontend handles specific codes: `UNSCHEDULED` (L674), `CLOCK_WINDOW_VIOLATION` (L681), HTTP 409 (L685). Any new error codes added server-side need corresponding frontend handling.

6. **CST rounding mismatch risk** — Frontend rounds via `roundTo30Minutes()` (local TZ) before sending `plannedStartAt`. Server receives ISO string. If frontend and server round differently, `planned_start_at` in the DB won't match what the employee confirmed on screen.

7. **Drawer cents precision** — Frontend converts dollars to cents via `Math.round(dollars * 100)`. Verify no floating-point issues (e.g., `1.005 * 100 = 100.49999...`). Server should validate integer-ness.

8. **Open shift fetch** — `/api/shift/open?profileId=X` is called from two places: (a) initial profile selection effect (L549), (b) 409 recovery (L688). Verify both use the same query param contract.

9. **Token in custom hooks** — `getAuthToken()` in hooks (e.g., `useShiftSwapRequests.ts:21-28`) checks sessionStorage before Supabase. Verify this matches the priority in ClockPageClient.

10. **Vercel 10s timeout** — Complex operations (stale shift close → end-shift → start-shift sequential calls, L1180) may approach the timeout. Verify total wall time under load.
