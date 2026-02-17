# Future Projects

## Immediate Action Items UX
- Upgrade from inline row actions to a dedicated Quick View Drawer (Option 2).
- Add per-item detail fetch + context-rich action panel.
- Support in-drawer actions for approvals, closeout review, and override/manual-close workflows.
- Ensure list/count/state refresh consistency after each action.

## Action Items Queue
- Build a full `Action Items Queue` page with category/store/severity/status filters.
- Add `GET /api/admin/dashboard/queue` for paginated queue data.
- Support inline resolve/review/approve actions and optional bulk actions.
- Add deep-link support from dashboard cards to pre-filter/highlight specific queue items.

## Shift Sales Tracker (Employee of the Month)
- Build shift-level sales dashboard and leaderboard for EOM calculations.
- Readiness gate: implement only after we have at least 4 full weeks of complete shift-level sales capture across stores.
- Keep historical EOD-only backfill excluded from shift leaderboard math.

## UI System Migration
- Migrate remaining pages to `shadcn/ui` incrementally.
- Preserve current behavior while standardizing components and visual language.

## Clock Architecture
- Refactor `ClockPageClient` into smaller, testable modules/components.
- Keep payroll rounding and CST handling behavior unchanged during refactor.

## Security Hardening
- Harden RLS policies and endpoint security.
- Audit privileged paths and tighten role-based access checks.
- Standardize auth validation patterns across admin/employee APIs.
