# Future Projects

## UI System Migration
- Migrate remaining pages to `shadcn/ui` incrementally.
- Preserve current behavior while standardizing components and visual language.

## Clock Architecture
- Refactor `ClockPageClient` into smaller, testable modules/components.
- Keep payroll rounding and CST handling behavior unchanged during refactor.

## Security Hardening — Deferred Items (2026-02 audit complete, advisory items remaining)

### Employee JWT Claim Verification
- `authenticateShiftRequest()` currently trusts `profile_id` and `store_ids` from the ES256 PIN JWT without a live DB cross-check.
- If a token is issued with stale or incorrect claims, the error propagates silently through all employee routes.
- Future fix: add a lightweight DB lookup (`profiles` + `store_memberships`) on the first authenticated request per session to confirm the claimed profile still exists and belongs to the claimed stores. Cache the result for the request lifetime to avoid N+1.

### Cron Route Secondary Origin Check
- Both cron routes (`/api/cron/expire-requests`, `/api/cron/send-nudges`) validate `CRON_SECRET` via `Authorization: Bearer` header.
- Vercel sets an `x-vercel-cron: 1` header on all legitimate cron invocations.
- Future fix: add `if (!req.headers.get('x-vercel-cron')) return 401` as a secondary check so the endpoints reject requests that know the secret but don't originate from Vercel's scheduler.

### Rate Limiting on PIN-Authenticated Routes
- No request rate limiting exists at the API layer.
- High-frequency endpoints (`start-shift`, `end-shift`, `closeout/submit`) could be abused.
- Future fix: add Vercel Edge Middleware for IP-based rate limiting on employee PIN-authenticated routes.

### Verify `clock_window_check()` search_path in Production DB
- Migration `16_clock_windows.sql` originally defined `clock_window_check()` without `SET search_path = public`.
- Migration `42_security_and_timezone_fixes.sql` re-creates it with the correct `search_path`.
- Spot-check: run `SELECT prosrc FROM pg_proc WHERE proname = 'clock_window_check'` in the Supabase SQL editor and confirm `SET search_path` is present in the function body.
