# Refactor Plan: ClockPageClient.tsx Decomposition

**Date:** 2025-02-10
**Status:** Proposed (pending approval)
**Risk Level:** Medium — refactoring a working 1,518-line component with no test coverage
**Depends on:** AUDIT_PHASE_2_FRONTEND.md (findings inform extraction priorities)

---

## 1. Current Architecture Diagnosis

### Why This Refactor Is Needed

`ClockPageClient.tsx` is a 1,518-line single-file component that handles the entire clock-in flow. It has:

- **50+ `useState` variables** with implicit state transitions
- **11 `useEffect` hooks** with cascading dependency chains causing 3-4 render cycles on mount
- **7 API calls** scattered throughout the component body
- **6 modal types** rendered inline with `createPortal`
- **178 lines of PIN auth UI** (L1197-1374) duplicating an existing `PinGate.tsx` component
- **Business logic mixed with rendering** — `roundTo30Minutes`, `inferShiftKind`, `toCstDateFromLocalInput`, `checkClockWindow` are all defined in the same file

The component is untestable in isolation. Any change to the PIN flow risks breaking the drawer count flow. Any change to the stale-shift modal risks breaking the confirmation modal. There are no snapshot tests, no integration tests, and no unit tests for the business logic functions.

### Current State Machine (Implicit)

The component moves through these phases, but the phases are not represented in the type system:

```
STORE_LOADING → STORE_READY → PIN_AUTH → AUTHENTICATED → SHIFT_FORM → CONFIRMING → SUBMITTING → REDIRECTING
                                                            ↓                              ↓
                                                    OPEN_SHIFT_DETECTED           CLOCK_WINDOW_VIOLATION
                                                            ↓                              ↓
                                                    STALE_SHIFT_CLOSE              ALARM_MODAL
                                                            ↓
                                                    END_AND_RESTART
```

Currently, the phase is determined by checking 5-10 boolean/nullable state variables simultaneously. Example: "we're in PIN auth" = `pinModalOpen && !pinToken && !managerSession`. This is the root cause of most bugs and complexity.

---

## 2. Target Architecture

### Component Tree

```
src/app/clock/
├── page.tsx                          (server component - EXISTS, no change)
├── ClockPageClient.tsx               (orchestrator - REWRITE to ~250 lines)
├── components/
│   ├── StoreSelector.tsx             (NEW - ~80 lines)
│   ├── ShiftForm.tsx                 (NEW - ~200 lines)
│   ├── DrawerCountFields.tsx         (NEW - ~120 lines)
│   ├── ConfirmationModal.tsx         (NEW - ~80 lines)
│   ├── OpenShiftModal.tsx            (NEW - ~100 lines)
│   ├── StaleShiftCloseModal.tsx      (NEW - ~180 lines)
│   ├── ClockWindowAlarmModal.tsx     (NEW - ~50 lines)
│   ├── UnscheduledPromptModal.tsx    (NEW - ~60 lines)
│   └── StaleShiftConfirmations.tsx   (MOVE from ClockPageClient L1448-1516)
├── hooks/
│   ├── useClockReducer.ts           (NEW - state machine)
│   ├── useStores.ts                 (NEW - store data fetching)
│   ├── useOpenShift.ts              (NEW - open shift detection)
│   └── useShiftActions.ts           (NEW - start/end shift API calls)
└── lib/
    └── clockHelpers.ts              (NEW - extracted pure functions)
```

### Props Interfaces

```typescript
// ─── StoreSelector ───
interface StoreSelectorProps {
  stores: Store[];
  selectedStoreId: string;
  onStoreSelect: (storeId: string) => void;
  disabled: boolean;
  qrToken: string;
  tokenStore: Store | null;
  tokenError: string | null;
}

// ─── ShiftForm ───
interface ShiftFormProps {
  storeId: string;
  profileId: string;
  profileName: string;
  storeName: string;
  shiftKind: ShiftKind;
  plannedStartLocal: string;
  onPlannedStartChange: (value: string) => void;
  plannedStartRoundedLabel: string;
  requiresDrawer: boolean;
  onSubmit: () => void;
  submitting: boolean;
  disabled: boolean;
  error: string | null;
  children: React.ReactNode; // slot for DrawerCountFields
}

// ─── DrawerCountFields ───
interface DrawerCountFieldsProps {
  startDrawer: string;
  changeDrawer: string;
  onStartDrawerChange: (value: string) => void;
  onChangeDrawerChange: (value: string) => void;
  expectedCents: number;
  requiresDrawer: boolean;
  confirmThreshold: boolean;
  onConfirmThresholdChange: (checked: boolean) => void;
  notifiedManager: boolean;
  onNotifiedManagerChange: (checked: boolean) => void;
  disabled: boolean;
}

// ─── ConfirmationModal ───
interface ConfirmationModalProps {
  open: boolean;
  profileName: string;
  storeName: string;
  plannedStartLabel: string;
  plannedStartRoundedLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  submitting: boolean;
}

// ─── OpenShiftModal ───
interface OpenShiftModalProps {
  open: boolean;
  profileName: string;
  shiftInfo: OpenShiftInfo;
  qrToken: string;
  onReturnToShift: () => void;
  onEndPreviousShift: () => void;
  onClose: () => void;
}

// ─── StaleShiftCloseModal ───
interface StaleShiftCloseModalProps {
  open: boolean;
  profileName: string;
  shiftInfo: OpenShiftInfo;
  onClose: () => void;
  onReturnToShift: () => void;
  onEndAndStart: (data: StaleShiftCloseData) => Promise<void>;
  saving: boolean;
  error: string | null;
}

interface StaleShiftCloseData {
  endAt: string;           // ISO string
  endDrawerCents: number | null;
  changeDrawerCents: number | null;
  confirmed: boolean;
  notifiedManager: boolean;
  note: string | null;
}

// ─── ClockWindowAlarmModal ───
interface ClockWindowAlarmModalProps {
  open: boolean;
  windowLabel: string;
  onClose: () => void;
}

// ─── UnscheduledPromptModal ───
interface UnscheduledPromptModalProps {
  open: boolean;
  storeName: string;
  plannedLabel: string;
  onCancel: () => void;
  onContinue: () => void;
}

// ─── StaleShiftConfirmations (already exists, just needs types) ───
interface StaleShiftConfirmationsProps {
  isOther: boolean;
  expectedCents: number;
  drawerValue: string;
  changeDrawerValue: string;
  confirm: boolean;
  notify: boolean;
  setConfirm: (next: boolean) => void;
  setNotify: (next: boolean) => void;
}
```

---

## 3. State Machine Design

### ClockState Discriminated Union

```typescript
// src/app/clock/hooks/useClockReducer.ts

type Store = { id: string; name: string; expected_drawer_cents: number };
type ShiftKind = "open" | "close" | "double" | "other";

interface OpenShiftInfo {
  id: string;
  started_at: string;
  shift_type: ShiftKind;
  store_id: string | null;
  store_name: string | null;
  expected_drawer_cents: number | null;
}

// ─── State Phases ───

type ClockState =
  | { phase: "loading" }
  | {
      phase: "pin-auth";
      stores: Store[];
      storeId: string;
      qrToken: string;
      tokenStore: Store | null;
    }
  | {
      phase: "shift-form";
      stores: Store[];
      storeId: string;
      profileId: string;
      profileName: string;
      token: string;          // PIN JWT or Supabase access token
      authMode: "pin" | "manager";
      shiftKind: ShiftKind;
      plannedStartLocal: string;
      startDrawer: string;
      changeDrawer: string;
      confirmThreshold: boolean;
      notifiedManager: boolean;
      openShift: OpenShiftInfo | null;
    }
  | {
      phase: "confirming";
      // ...all shift-form fields plus:
      stores: Store[];
      storeId: string;
      profileId: string;
      profileName: string;
      token: string;
      authMode: "pin" | "manager";
      shiftKind: ShiftKind;
      plannedStartLocal: string;
      startDrawer: string;
      changeDrawer: string;
      confirmThreshold: boolean;
      notifiedManager: boolean;
      confirmChecked: boolean;
    }
  | {
      phase: "submitting";
      // same fields as confirming
      stores: Store[];
      storeId: string;
      profileId: string;
      profileName: string;
      token: string;
      authMode: "pin" | "manager";
      shiftKind: ShiftKind;
      plannedStartLocal: string;
      startDrawer: string;
      changeDrawer: string;
    }
  | {
      phase: "open-shift-detected";
      stores: Store[];
      storeId: string;
      profileId: string;
      profileName: string;
      token: string;
      authMode: "pin" | "manager";
      openShift: OpenShiftInfo;
    }
  | {
      phase: "stale-shift-close";
      stores: Store[];
      storeId: string;
      profileId: string;
      profileName: string;
      token: string;
      authMode: "pin" | "manager";
      openShift: OpenShiftInfo;
      staleEndLocal: string;
      staleDrawer: string;
      staleChangeDrawer: string;
      staleConfirm: boolean;
      staleNotify: boolean;
      staleNote: string;
      staleDoubleCheck: boolean;
      staleSaving: boolean;
    }
  | {
      phase: "clock-window-alarm";
      windowLabel: string;
      returnPhase: "shift-form" | "stale-shift-close";
      // preserve form state for return
      stores: Store[];
      storeId: string;
      profileId: string;
      profileName: string;
      token: string;
      authMode: "pin" | "manager";
    }
  | {
      phase: "unscheduled-prompt";
      storeName: string;
      plannedLabel: string;
      // preserve form state for return
      stores: Store[];
      storeId: string;
      profileId: string;
      profileName: string;
      token: string;
      authMode: "pin" | "manager";
      shiftKind: ShiftKind;
      plannedStartLocal: string;
      startDrawer: string;
      changeDrawer: string;
    }
  | { phase: "error"; error: string; returnPhase: ClockState["phase"] }
  | { phase: "complete"; redirectUrl: string };

// ─── Actions ───

type ClockAction =
  | { type: "STORES_LOADED"; stores: Store[]; storeId: string; tokenStore: Store | null }
  | { type: "SELECT_STORE"; storeId: string }
  | { type: "AUTH_SUCCESS"; token: string; profileId: string; profileName: string; authMode: "pin" | "manager" }
  | { type: "AUTH_FAIL"; error: string }
  | { type: "SET_PLANNED_START"; value: string }
  | { type: "SET_SHIFT_KIND"; kind: ShiftKind }
  | { type: "SET_START_DRAWER"; value: string }
  | { type: "SET_CHANGE_DRAWER"; value: string }
  | { type: "SET_CONFIRM_THRESHOLD"; checked: boolean }
  | { type: "SET_NOTIFIED_MANAGER"; checked: boolean }
  | { type: "OPEN_CONFIRM" }
  | { type: "CLOSE_CONFIRM" }
  | { type: "SET_CONFIRM_CHECKED"; checked: boolean }
  | { type: "SUBMIT" }
  | { type: "SUBMIT_SUCCESS"; shiftId: string; shiftType: ShiftKind; reused: boolean; startedAt?: string }
  | { type: "SUBMIT_ERROR"; error: string }
  | { type: "OPEN_SHIFT_DETECTED"; shift: OpenShiftInfo }
  | { type: "RETURN_TO_OPEN_SHIFT" }
  | { type: "START_STALE_CLOSE" }
  | { type: "STALE_CLOSE_UPDATE"; field: string; value: unknown }
  | { type: "STALE_CLOSE_SUBMIT" }
  | { type: "STALE_CLOSE_SUCCESS" }
  | { type: "STALE_CLOSE_ERROR"; error: string }
  | { type: "CLOCK_WINDOW_VIOLATION"; label: string }
  | { type: "DISMISS_CLOCK_WINDOW" }
  | { type: "UNSCHEDULED"; storeName: string; plannedLabel: string }
  | { type: "UNSCHEDULED_CONTINUE" }
  | { type: "UNSCHEDULED_CANCEL" }
  | { type: "DISMISS_OPEN_SHIFT" }
  | { type: "RESET" };
```

### Reducer Benefits

| Current Problem | Reducer Solution |
|----------------|-----------------|
| 50+ independent `useState` calls → any combination possible | Discriminated union → TypeScript enforces valid field combinations per phase |
| Implicit phase detection (`pinModalOpen && !pinToken && ...`) | Explicit `state.phase === "pin-auth"` |
| State transitions scattered across 11 effects + handlers | All transitions in single `clockReducer` function |
| Can't unit test state logic | Export reducer, test with `expect(clockReducer(state, action))` |
| Cascading re-renders from effect chains | Single dispatch triggers one state update |

---

## 4. Extraction Order (10 Steps)

Steps are ordered by risk (lowest first) and dependency (prerequisites first). Each step is independently deployable — the component works after every step.

### Step 1: Extract Pure Functions → `clockHelpers.ts`

**Risk:** None — no behavioral change
**Lines removed from ClockPageClient:** ~100

Move to `src/app/clock/lib/clockHelpers.ts`:
- `toLocalInputValue()` (L40-48)
- `roundTo30Minutes()` (L50-57) — the inline copy
- `formatDateTime()` (L59-69)
- `getCstOffsetMinutes()` (L71-89)
- `toCstDateFromLocalInput()` (L91-100)
- `toCstMinutes()` (L102-106)
- `getStoreShiftStarts()` (L108-128)
- `inferShiftKind()` (L130-142)
- `formatCst()` (L144-155)

**Test:** Write unit tests for each function. Verify `roundTo30Minutes` and `toCstDateFromLocalInput` handle DST boundaries.

### Step 2: Extract `StaleShiftConfirmations` → Own File

**Risk:** Minimal — already a separate function at module scope
**Lines moved:** 70 (L1448-1516)

Move to `src/app/clock/components/StaleShiftConfirmations.tsx`. Add `React.memo`. Export the props interface.

**Test:** Mount with React Testing Library. Verify threshold checkbox appears/disappears based on `isOutOfThreshold`.

### Step 3: Extract `ClockWindowAlarmModal`

**Risk:** Minimal — self-contained modal
**Lines moved:** ~20 (L1424-1443)

Create `src/app/clock/components/ClockWindowAlarmModal.tsx`.

```typescript
// Props: { open, windowLabel, onClose }
// Renders: createPortal alarm modal with "CONTACT MANAGER" message
// Side effect: calls stopAlarm() on close (move alarm import here)
```

**Test:** Mount, verify portal renders when `open=true`.

### Step 4: Extract `UnscheduledPromptModal`

**Risk:** Minimal — self-contained modal
**Lines moved:** ~30 (L748-777)

Create `src/app/clock/components/UnscheduledPromptModal.tsx`.

**Test:** Mount, verify Cancel/Continue callbacks.

### Step 5: Extract `ConfirmationModal`

**Risk:** Low — straightforward modal with checkbox
**Lines moved:** ~45 (L1377-1422)

Create `src/app/clock/components/ConfirmationModal.tsx`.

**Test:** Mount, verify confirm button disabled until checkbox checked.

### Step 6: Extract `OpenShiftModal`

**Risk:** Low — contains navigation logic (router.replace)
**Lines moved:** ~45 (L959-1004)

Create `src/app/clock/components/OpenShiftModal.tsx`. Accept `onReturnToShift`, `onEndPreviousShift`, `onClose` callbacks — keep `router.replace` logic in parent.

**Test:** Mount, verify three button callbacks.

### Step 7: Extract `StaleShiftCloseModal`

**Risk:** Medium — contains inline async handler (L1105-1186) with validation logic
**Lines moved:** ~190 (L1006-1195)

Create `src/app/clock/components/StaleShiftCloseModal.tsx`. Move form state (staleEndLocal, staleDrawer, etc.) INTO this component — it's self-contained. Accept `onEndAndStart: (data) => Promise<void>` callback.

**Test:** Mount, verify drawer validation, threshold checkbox logic, submit callback shape.

### Step 8: Reuse `PinGate.tsx` — Delete Inline PIN Modal

**Risk:** Medium — must verify PinGate's props interface covers all ClockPageClient needs
**Lines deleted:** ~178 (L1197-1374)

Replace inline PIN modal with:
```tsx
import PinGate from "@/components/PinGate";
// ...
{needsAuth && (
  <PinGate
    loading={loading}
    stores={stores}
    qrToken={qrToken}
    tokenStore={tokenStore}
    storeId={storeId}
    setStoreId={setStoreId}
    profileId={profileId}
    setProfileId={setProfileId}
    onLockChange={locked => setPinLockedSelection(locked)}
    onAuthorized={token => {
      setPinToken(token);
      // ... additional state updates
    }}
  />
)}
```

**Gap to resolve:** ClockPageClient's inline modal also sets `authenticatedProfileName` (L1342) and stores profile name in sessionStorage (L1348). PinGate currently doesn't expose profile name. **Fix:** Add `onProfileInfo?: (name: string) => void` callback to PinGate.

**Test:** Verify clock-in flow end-to-end after swap. Verify sessionStorage contains correct keys.

### Step 9: Extract `DrawerCountFields` + `ShiftForm`

**Risk:** Medium — involves moving validation logic and multiple useMemo values
**Lines moved:** ~200 (form rendering + drawer fields from L816-956)

`DrawerCountFields` owns: start drawer input, change drawer input, threshold message, confirm/notify checkboxes.
`ShiftForm` owns: employee display, shift type display, planned start input, submit button. Takes `DrawerCountFields` as children.

**Test:** Mount ShiftForm, verify `canStart` logic through disabled button state.

### Step 10: Introduce `useClockReducer` + Rewire Orchestrator

**Risk:** HIGH — replaces all 50+ useState + 11 useEffect with reducer + 3-4 focused effects
**Approach:** Big-bang replacement of state layer. Do NOT mix old useState with reducer.

Create `src/app/clock/hooks/useClockReducer.ts` with the `ClockState` / `ClockAction` / `clockReducer` from Section 3.

Rewrite `ClockPageClient.tsx` to:
1. Call `useClockReducer()`
2. Call `useStores(dispatch)` — fires `STORES_LOADED`
3. Call `useOpenShift(state, dispatch)` — fires `OPEN_SHIFT_DETECTED`
4. Render child components based on `state.phase`

**Target orchestrator size:** ~250 lines (phase switch + component props wiring).

**Test:** Unit test `clockReducer` with action sequences. Integration test full flow with React Testing Library.

---

## 5. Data Fetching Hooks

### `useStores.ts`

```typescript
// Replaces: ClockPageClient.tsx L368-420 (store load + QR validation)
export function useStores(qrToken: string) {
  // Returns: { stores, tokenStore, tokenError, loading }
  // Dispatches: STORES_LOADED action
  // Handles: QR token validation, localStorage restore
}
```

### `useOpenShift.ts`

```typescript
// Replaces: ClockPageClient.tsx L536-586 (open shift detection)
export function useOpenShift(profileId: string, token: string | null) {
  // Returns: { openShift, loading }
  // Fetches: GET /api/shift/open?profileId=X
  // Debounces: only fetches when profileId changes AND token is available
}
```

### `useShiftActions.ts`

```typescript
// Replaces: ClockPageClient.tsx L600-733 (startShift function)
export function useShiftActions(token: string | null) {
  return {
    startShift: async (data: StartShiftPayload) => StartShiftResult,
    endShift: async (data: EndShiftPayload) => EndShiftResult,
  };
  // Centralizes: error code handling (UNSCHEDULED, CLOCK_WINDOW_VIOLATION, 409)
  // Returns: typed result objects instead of throwing
}
```

---

## 6. Risk Assessment

### What Could Break

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| PIN auth regression after PinGate swap (Step 8) | Medium | HIGH — employees can't clock in | Test on staging with real PIN flow before deploy. Add Playwright e2e test. |
| Stale shift close flow breaks during modal extraction (Step 7) | Medium | MEDIUM — employees can't resolve stale shifts | Keep inline version as fallback behind feature flag during rollout. |
| State machine transition bugs (Step 10) | High | HIGH — invalid states cause crashes | Write reducer unit tests for every valid transition path. Add `default` case that logs unexpected actions. |
| Drawer validation drift during extraction | Low | MEDIUM — incorrect threshold alerts | Test `isOutOfThreshold` and `thresholdMessage` with edge cases (exact boundary values, negative cents, NaN). |
| localStorage/sessionStorage keys change during refactor | Low | LOW — employees need to re-authenticate | Keep same key constants. Import from shared module. |

### Rollback Plan

- Each step is independently deployable and revertable
- Steps 1-6 are purely additive (new files) — old code still works if imports are reverted
- Steps 7-8 modify ClockPageClient directly — tag a release before starting
- Step 10 (reducer) is a complete rewrite — implement on a feature branch, merge only after e2e tests pass

### Testing Strategy

| Level | Tool | What to Test |
|-------|------|-------------|
| Unit | Vitest | `clockReducer` state transitions, `clockHelpers` pure functions, `isOutOfThreshold` edge cases |
| Component | React Testing Library | Each extracted component in isolation with mocked props |
| Integration | React Testing Library | Full `ClockPageClient` with mocked API routes |
| E2E | Playwright | Complete clock-in flow: store select → PIN auth → drawer → confirm → redirect |

---

## 7. Migration Timeline (Suggested)

| Sprint | Steps | Effort | Risk |
|--------|-------|--------|------|
| Sprint 1 | Steps 1-4 (pure functions + safe modals) | 2-3 hours | None |
| Sprint 2 | Steps 5-6 (remaining modals) | 1-2 hours | Low |
| Sprint 3 | Steps 7-8 (stale shift + PinGate swap) | 3-4 hours | Medium |
| Sprint 4 | Steps 9-10 (form extraction + reducer) | 6-8 hours | High |

Total estimated effort: **12-17 hours** of focused work.

**Recommendation:** Complete Steps 1-6 immediately (low risk, high readability improvement). Steps 7-10 should be done on a feature branch with staging deployment verification before merge.
