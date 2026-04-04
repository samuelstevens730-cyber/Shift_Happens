# Shift Mobile UI Tightening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the shift-detail mobile layout so the sticky clock-out CTA stays reachable, cleaning-task rows fit cleanly on narrow phones, and the clock-out modal remains usable when the mobile keyboard is open.

**Architecture:** Keep the existing shift page and clock-out flow intact, and solve the issues with targeted spacing, overflow, and responsive layout adjustments. Most changes should live in shared shift-page CSS classes in `src/app/globals.css`, with only light JSX changes in `src/app/shift/[id]/page.tsx` where the current structure forces cramped rows or inaccessible action areas.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Tailwind CSS v4 plus shared global CSS utilities in `src/app/globals.css`

---

## File Map

- **Modify:** `src/app/shift/[id]/page.tsx`
  - Shift-detail page, cleaning-task markup, sticky CTA section, and clock-out modal markup.
- **Modify:** `src/app/globals.css`
  - Shared shift page layout classes: `.app-shell`, `.sticky-cta`, `.shift-cta-bar`, `.shift-item-row`, `.shift-item-actions`, `.shift-modal-shell`, `.modal-under-header`.
- **Review for regression only:** `src/app/shift/[id]/components/SafeCloseoutWizard.tsx`
  - Uses the same modal shell classes; confirm shared CSS changes do not break it.
- **Review for regression only:** `src/app/shift/[id]/done/page.tsx`
  - Uses related mobile modal patterns and sticky CTA patterns; confirm shared CSS changes remain safe.

## Risks and Mitigations

- **Risk:** Shared modal class changes could unintentionally affect Safe Closeout or other shift overlays.
  - **Mitigation:** Keep shared class changes minimal, verify `SafeCloseoutWizard` and `shift/[id]/done` visually after the CSS pass, and avoid changing modal semantics or business logic.
- **Risk:** Adding bottom padding to the shift page could create excessive dead space on desktop.
  - **Mitigation:** Scope extra padding to small screens and safe-area-aware values; use a tighter desktop override.
- **Risk:** Cleaning row reflow could make action buttons harder to scan on tablet/desktop.
  - **Mitigation:** Stack rows only on narrow screens and preserve the current horizontal layout at larger breakpoints.
- **Risk:** Keyboard-friendly modal changes could still fail on iOS Safari if the scroll container is wrong.
  - **Mitigation:** Keep the backdrop scrollable, make the modal body independently scrollable, and add bottom padding within the modal content so the final inputs are reachable above the keyboard.

## Implementation Tasks

### Task 1: Add Mobile Bottom Breathing Room For The Shift CTA

**Files:**
- Modify: `src/app/globals.css`
- Review: `src/app/shift/[id]/page.tsx:1515-1564`

- [ ] **Step 1: Adjust the shared page/CTA spacing rules**

Update the existing shared shift page spacing so the sticky CTA has reserved room on small devices.

Target selectors:

```css
.app-shell {
  min-height: 100vh;
  padding: 24px 16px calc(112px + env(safe-area-inset-bottom, 0px));
}

.sticky-cta {
  position: sticky;
  bottom: 0;
  padding: 12px 0 calc(8px + env(safe-area-inset-bottom, 0px));
  background: linear-gradient(180deg, rgba(13, 15, 18, 0), rgba(13, 15, 18, 0.92) 24%, rgba(13, 15, 18, 0.98));
}

.shift-cta-bar {
  display: grid;
  gap: 10px;
  padding-bottom: 8px;
}

@media (min-width: 1024px) {
  .app-shell {
    padding: 24px 16px 28px;
  }

  .sticky-cta {
    padding-bottom: 4px;
    background: transparent;
  }
}
```

- [ ] **Step 2: Verify the shift page uses the shared sticky CTA without structural changes**

Confirm the current sticky CTA markup in `src/app/shift/[id]/page.tsx` remains:

```tsx
<div className="sticky-cta shift-cta-bar">
  {/* existing safe closeout + clock out buttons */}
</div>
```

No business-logic changes should be made in this task.

- [ ] **Step 3: Run TypeScript check**

Run: `npx tsc --noEmit`

Expected: PASS

- [ ] **Step 4: Manual mobile check**

Verify on a narrow phone viewport:
- the last content section is not hidden under the CTA
- `Clock Out` is fully visible without rotating to landscape
- the CTA still feels anchored at the bottom while scrolling

### Task 2: Reflow Cleaning Rows For Narrow Screens

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/shift/[id]/page.tsx:1362-1404`

- [ ] **Step 1: Add responsive cleaning/task row CSS**

Update the shared shift item classes so narrow screens stack content cleanly.

Target additions:

```css
.shift-item-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 16px;
  border-top: 1px solid rgba(64, 214, 255, 0.18);
}

.shift-item-actions {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

@media (max-width: 640px) {
  .shift-item-row {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }

  .shift-item-actions {
    width: 100%;
    gap: 8px;
  }

  .shift-item-actions > * {
    flex: 1 1 0;
  }
}
```

- [ ] **Step 2: Tighten the cleaning row JSX so status and body wrap gracefully**

Adjust the cleaning row wrapper in `src/app/shift/[id]/page.tsx` from:

```tsx
<div className="flex items-start justify-between gap-3">
  <div>
    <div className="shift-item-title">{task.task_name}</div>
    <div className="shift-item-meta">
      {task.cleaning_shift_type.toUpperCase()} · {task.task_category ?? "cleaning"}
    </div>
  </div>
  <div className="shift-item-status">
    ...
  </div>
</div>
```

to a mobile-friendlier variant:

```tsx
<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
  <div className="min-w-0">
    <div className="shift-item-title break-words">{task.task_name}</div>
    <div className="shift-item-meta">
      {task.cleaning_shift_type.toUpperCase()} · {task.task_category ?? "cleaning"}
    </div>
  </div>
  <div className="shift-item-status self-start sm:self-auto">
    ...
  </div>
</div>
```

- [ ] **Step 3: Keep the action buttons visible and full-width on mobile**

Retain the existing button behavior, but ensure the action container stays:

```tsx
<div className="shift-item-actions">
  <button className={isCompleted ? "shift-button-secondary" : "shift-button"} ...>
    {isCompleted ? "Done" : "Complete"}
  </button>
  <button className="shift-button-secondary disabled:opacity-50" ...>
    Skip
  </button>
</div>
```

The CSS from Step 1 should handle width/wrapping.

- [ ] **Step 4: Run TypeScript check**

Run: `npx tsc --noEmit`

Expected: PASS

- [ ] **Step 5: Manual cleaning-list check**

Verify on a 375px-wide screen:
- long task names wrap instead of pushing sideways
- status pill stays visible
- buttons remain fully visible and tappable
- skipped-reason banners do not overflow horizontally

### Task 3: Make The Clock-Out Modal Keyboard-Friendly

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/shift/[id]/page.tsx:2346-2592`

- [ ] **Step 1: Strengthen the shared modal shell sizing**

Update the shared modal shell rules for better mobile keyboard behavior.

Target selectors:

```css
.modal-under-header {
  padding-top: 72px;
  padding-bottom: calc(96px + env(safe-area-inset-bottom, 0px));
}

.shift-modal-shell {
  width: 100%;
  max-width: 32rem;
  max-height: min(85vh, 85dvh);
  border-radius: 24px;
  border: 2px solid rgba(147, 51, 234, 0.44);
  background: linear-gradient(180deg, rgba(18, 21, 20, 0.98), rgba(10, 12, 11, 0.99));
  color: var(--text-strong);
  padding: 18px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

@media (max-width: 640px) {
  .shift-modal-shell {
    max-height: min(88vh, 88dvh);
    border-radius: 20px;
    padding: 16px;
  }
}
```

- [ ] **Step 2: Give the clock-out modal extra bottom room for keyboard overlap**

Update the clock-out modal shell in `src/app/shift/[id]/page.tsx` from:

```tsx
<div className="shift-modal-shell space-y-3 max-h-[85vh] overflow-y-auto overscroll-contain">
```

to:

```tsx
<div className="shift-modal-shell space-y-3 pb-28 sm:pb-20">
```

This keeps the final fields and confirm controls reachable when the keyboard opens.

- [ ] **Step 3: Stack the modal action row on small screens**

Change the action row from:

```tsx
<div className="flex gap-2 justify-end">
```

to:

```tsx
<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
```

This keeps `Confirm End Shift` reachable without horizontal compression.

- [ ] **Step 4: Add mobile-friendly spacing around dense clock-out sections**

For the sales panel and thermostat panel blocks in `src/app/shift/[id]/page.tsx`, keep the content order but add or preserve:

```tsx
<div className="employee-panel space-y-2">
```

and ensure any nested control groups use stacked layout on mobile rather than relying on horizontal alignment.

- [ ] **Step 5: Run TypeScript check**

Run: `npx tsc --noEmit`

Expected: PASS

- [ ] **Step 6: Manual keyboard check**

Verify on mobile:
- open `Clock Out`
- focus `Prior X Report`, `Z Report`, and transaction count inputs
- with the keyboard open, the active input remains visible
- the modal can scroll naturally without closing the keyboard between fields
- the final confirm controls remain reachable

### Task 4: Regression Check Shared Shift Overlays

**Files:**
- Review: `src/app/shift/[id]/components/SafeCloseoutWizard.tsx`
- Review: `src/app/shift/[id]/done/page.tsx`
- Review: `src/app/globals.css`

- [ ] **Step 1: Verify shared modal changes do not break Safe Closeout**

Open `SafeCloseoutWizard` and confirm it still relies on:

```tsx
<div className="fixed inset-0 z-50 bg-black/50 p-3 sm:p-4 overflow-y-auto modal-under-header">
  <div className="shift-modal-shell shift-modal-shell-wide mx-auto">
```

No file changes are needed unless the new `shift-modal-shell` sizing causes clipping.

- [ ] **Step 2: Verify shared sticky/modal changes do not regress the shift done page**

Check `src/app/shift/[id]/done/page.tsx` for any use of `sticky-cta`, `modal-under-header`, or `shift-modal-shell`.

If any mobile regression appears during testing, apply only the smallest follow-up tweak required.

- [ ] **Step 3: Manual regression sweep**

Smoke test:
- active shift page
- cleaning expanded
- clock-out modal
- safe closeout wizard
- shift done page

Expected: no horizontal overflow, no clipped controls, no unreachable bottom actions.

### Task 5: Final Verification And Docs Check

**Files:**
- Review: `REPO_CONTEXT.md`
- Review: `README.md`

- [ ] **Step 1: Confirm docs do not need updates**

This work changes layout only, not architecture or workflow rules. Verify:
- `REPO_CONTEXT.md` does not need a new flow description
- `README.md` does not need user-facing setup changes

- [ ] **Step 2: Run final TypeScript check**

Run: `npx tsc --noEmit`

Expected: PASS

- [ ] **Step 3: Optional build check**

Run: `npm run build`

Expected:
- ignore external font/network failures if they appear
- no new app-code build errors introduced by the mobile UI changes

- [ ] **Step 4: Prepare commit**

Suggested commit:

```bash
git add src/app/globals.css src/app/shift/[id]/page.tsx docs/superpowers/plans/2026-04-04-shift-mobile-ui.md
git commit -m "fix: tighten shift mobile layout and clock-out modal"
```

## Self-Review Notes

- **Spec coverage:** Covers all three reported issues: blocked clock-out CTA, rough cleaning list overflow, and keyboard-obscured clock-out modal fields.
- **Placeholder scan:** No TBD/TODO placeholders remain.
- **Type consistency:** The plan keeps the existing component boundaries and class names, and only adjusts layout classes already used by the shift page.
