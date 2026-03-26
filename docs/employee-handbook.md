# Shift Happens Employee Handbook

Last updated: 2026-03-25

This guide explains how employees use the Shift Happens app based on the current code and app behavior.

## What This App Is For

Employees use Shift Happens to:

- sign in with a PIN
- clock in and clock out
- complete shift tasks, checklist items, and cleaning
- enter drawer counts
- submit safe closeouts when required
- enter rollover sales when required
- view schedules and past shifts
- submit requests like time off, shift swaps, timesheet corrections, advances, and coverage shifts
- track Google review submissions

## Signing In

Most employee pages use employee PIN sign-in.

How it works:

1. Open the app home page or clock page.
2. Choose the employee sign-in option if prompted.
3. Select your store if the app asks for it.
4. Enter your PIN.
5. After successful PIN entry, the app stores your employee session for employee pages and shift actions.

Notes:

- Managers can also access some employee views if their manager account is linked to an employee profile.
- If your session expires, the app may send you back to the clock page or ask you to sign in again.

## Home Page

The home page is your main employee hub.

From here you can usually access:

- Time Clock
- My Schedule
- Current Hours / My Shifts
- Requests
- Coverage Shift
- Reviews
- Scoreboard

The page may also show:

- your current open shift, if you are clocked in
- employee messages that need to be dismissed or acknowledged
- quick links to requests and reviews

## Clocking In

Route: `/clock`

Use this page to start a shift.

### Standard Clock-In Steps

1. Open the clock page.
2. If you scanned a store QR code, the store may already be locked in for you.
3. If not, choose your store.
4. Enter your employee code / complete the employee authentication flow shown on the page.
5. Confirm your planned start time.
6. Review the confirmation screen.
7. Submit clock-in.

After a successful clock-in, the app sends you to your active shift page.

### Important Clock-In Rules

- The app rounds payroll time to the nearest 30 minutes internally.
- If you are already clocked in at the same store, the app may reuse the existing shift instead of creating a new one.
- If you are already clocked in at a different store, clock-in is blocked.
- If you are not scheduled for that shift, the app warns that the shift will require management approval.
- Shift type may be set automatically from the schedule, but the app can also support a manual shift-type override.

## Active Shift Page

Route: `/shift/[id]`

This is the main page you use while working.

Depending on the shift and store settings, it can include:

- start, changeover, and end drawer counts
- checklist items
- tasks
- messages
- cleaning tasks
- safe closeout
- rollover entry

## Messages and Tasks During a Shift

Managers can assign messages or tasks to your shift.

What you need to do:

- acknowledge messages
- complete tasks assigned to your shift

Important:

- You cannot clock out while messages are still unacknowledged or tasks are still incomplete.

## Checklist Items

Checklist items appear on the active shift page.

How to use them:

1. Open your shift page.
2. Find the checklist section.
3. Tap or click the action to mark each item complete.

Important:

- Required checklist items must be completed before clock-out.
- Optional checklist items can still be tracked, but they do not block clock-out.
- For double shifts, both open-side and close-side requirements can matter.

## Cleaning Tasks

Cleaning tasks may appear during the active shift.

For each task, you can usually:

- mark it complete
- skip it with a reason

Important:

- If you skip a cleaning task, a skip reason is required.
- Follow store expectations carefully because these tasks are tracked.

## Drawer Counts

Drawer counts are used during shift workflows.

The app can collect:

- start drawer count
- changeover drawer count for double shifts
- end drawer count
- change drawer count

### Variance Rules

If a drawer count is outside the allowed threshold:

- the app may require you to confirm the count
- the app may require that you notify your manager

If the change drawer is not exactly `$200.00` when required:

- the app requires manager notification before clock-out

## Double Shift Changeover

Double shifts require a mid-shift changeover entry.

What you must enter:

- X report total
- drawer count
- change count
- transaction count for the AM half

You can also add:

- a note
- a confirmation if the count is outside threshold
- manager notification status

Important:

- Double shifts require the changeover drawer count before clock-out.
- The app expects all required changeover fields for double shifts.

## Safe Closeout

Safe closeout appears only when:

- the store has safe ledger enabled
- your shift is eligible for safe closeout
- the closeout window is open

The app uses a 5-step safe closeout wizard.

### Safe Closeout Steps

1. Enter the prior X report total.
2. Enter financials:
   cash sales, card sales, and any expenses.
3. Verify the bill counts by denomination.
4. Enter the drawer count.
5. Upload evidence and submit.

### Safe Closeout Evidence

Required:

- deposit slip photo

Optional:

- Z-report photo

### Safe Closeout Rules

- The bill count is checked against the required deposit.
- If the deposit count does not match, you must report a variance before continuing.
- If you report a variance, you must enter a reason.
- If total sales are unusually large, the app asks you to confirm the numbers before submission.
- A closeout can be submitted as pass, warn, or fail.
- Some closeouts are flagged for manager review.

## Rollover Entry

Rollover entry appears only on rollover workflows.

Example use:

- an opener may need to enter the rollover amount from the previous night using the printed report

How to use it:

1. Find the rollover card on the shift page.
2. Enter the rollover amount from the printed report.
3. Submit it.

Important:

- This is a blind verification entry.
- If the app detects a mismatch, it may ask you to submit again to save the mismatch for manager review.

## Clocking Out

Clock-out happens from the active shift page.

### Standard Clock-Out Steps

1. Open your active shift.
2. Make sure all required checklist items are complete.
3. Make sure all shift messages are acknowledged.
4. Make sure all assigned tasks are complete.
5. Complete any required changeover step if it is a double shift.
6. Open the clock-out modal.
7. Enter your end time.
8. Enter the ending drawer count.
9. Enter the change drawer count.
10. Add a note if needed.
11. Check the final confirmation box.
12. Submit clock-out.

### Clock-Out Rules

For most shift types, the app requires:

- end drawer count
- change drawer count

For `other` shifts:

- end drawer count and change drawer count can be optional

Clock-out is blocked when:

- required checklist items are missing
- tasks are incomplete
- messages are unacknowledged
- required drawer information is missing
- the count is outside threshold and not confirmed
- the change drawer is not `$200.00` and manager notification has not been marked

### After Clock-Out

After the shift ends, the app shows the shift completion page at `/shift/[id]/done`.

This page shows a summary of:

- store
- employee
- shift type
- counts and notes

## My Schedule

Route: `/schedule` which redirects to the employee schedule page

Use this page to:

- view upcoming scheduled shifts
- see shifts grouped by day
- check time windows and store locations
- see swap status on scheduled shifts

The schedule view can show:

- date
- store
- shift type
- scheduled time range
- whether a shift is upcoming, currently active, or complete

## My Shifts / Timecard

Route: `/shifts` which redirects to the employee timecard page

Use this page to:

- review past shifts
- filter by store
- filter by pay period
- view coverage-shift hours once approved

The page includes:

- regular shifts
- approved coverage shifts
- hours grouped into pay-period totals

Important:

- Approved coverage shifts appear in your history after manager approval.

## Requests

Route: `/dashboard/requests`

This page has separate tabs for:

- Swaps
- Open Requests
- Time Off
- Timesheets
- Advances

## Shift Swaps

Use the Swaps tab to request a swap for one of your scheduled shifts.

How to create a swap request:

1. Open Requests.
2. Go to the Swaps tab.
3. Tap Create.
4. Select the shift you want to swap.
5. Add a reason if you want.
6. Set how many hours before the request expires.
7. Submit the request.

You can also:

- view your open or pending swap requests
- cancel an open swap request

## Covering or Swapping Into Someone Else's Shift

The requests page also shows open swap requests from other employees.

You can respond in two ways:

- offer to cover the shift
- offer one of your own shifts as a swap

If you choose swap:

- you must select one of your own eligible shifts

## Time Off Requests

Use the Time Off tab to request dates off.

How to submit:

1. Choose the store.
2. Enter the start date.
3. Enter the end date.
4. Add an optional reason.
5. Submit the request.

Important:

- The app checks requests against published schedules.
- If your request conflicts with a published shift, the app can reject it and show a conflict error.
- The page also shows upcoming approved or manager-added time-off blocks.

## Timesheet Correction Requests

Use the Timesheets tab to request corrections to a shift record.

How to submit:

1. Select the shift that needs correction.
2. Enter the corrected start time if needed.
3. Enter the corrected end time if needed.
4. Enter the reason.
5. Submit the request.

Important:

- A reason is required.
- The page shows your recent timesheet correction requests.
- If payroll for that period is locked, the request can be blocked.

## Advance Requests

Use the Advances tab to log an advance you received.

How to submit:

1. Select the store.
2. Choose the date.
3. Enter advance hours.
4. Enter cash amount if there was cash involved.
5. Add an optional note.
6. Submit the advance.

Important:

- Advances are logged as pending verification first.
- Management verifies them before payroll.
- The page shows your previous advance entries and their status.

## Coverage Shift Requests

Route: `/coverage-shift/new`

Use this page when you worked hours at another store and need them reviewed.

How to submit:

1. Choose the date worked.
2. Choose the coverage store.
3. Enter time in.
4. Enter time out.
5. Add optional notes.
6. Submit the request.

Important:

- Time out must be after time in.
- The request is submitted as pending.
- The hours appear on your timecard after manager approval.

## Reviews

Route: `/reviews`

Use this page to track and submit Google review screenshots.

The page includes:

- a monthly scoreboard
- your recent review submissions
- store filtering
- employee selection for earned credit

### How to Submit a Review Screenshot

1. Open Reviews.
2. Choose a specific store. You cannot submit from the `All Stores` view.
3. Select the employee who should receive credit.
4. Choose the review date.
5. Upload the screenshot.
6. Submit the review.

Important:

- The screenshot must be uploaded before final submission.
- The review date must be within the current month.
- The credited employee must belong to that store.
- Your submission usually enters a pending review state for manager review.

## Scoreboard

Route: `/scoreboard`

Use this page to view employee rankings and performance standings.

The home page may also show:

- your current rank
- your score

## Avatar / Character Creator

Route: `/avatar`

Use this page to create or update your character/avatar for the app.

This is mainly a profile and presentation feature and does not affect payroll or shift actions.

## Common Reasons the App Blocks an Action

Clock-in may fail when:

- you are not assigned to that store
- your employee profile is inactive
- you already have an active shift somewhere else

Clock-out may fail when:

- checklist items are incomplete
- messages are not acknowledged
- tasks are not complete
- required drawer fields are missing
- double-shift changeover is missing

Safe closeout may fail when:

- the closeout window is not open yet
- required sales fields are missing
- the deposit slip photo is missing
- denomination counts do not match and no variance reason was entered

Requests may fail when:

- you enter invalid dates or times
- the request conflicts with schedule or payroll rules
- your session has expired

## Best Practices for Employees

- Use your own PIN only.
- Double-check store selection before clocking in.
- Read manager messages before trying to clock out.
- Complete checklist and cleaning tasks as you go instead of waiting until the end.
- Keep printed reports handy for changeover and rollover entries.
- Take clear photos for safe closeout evidence.
- Submit requests as early as possible, especially time off and swaps.

## Best Practices for Managers Using This Handbook

If you use this document for training, walk employees through these flows first:

1. PIN sign-in
2. clock-in
3. active shift page
4. clock-out
5. requests page
6. coverage shifts
7. reviews

That covers nearly all employee-facing actions in the current app.
