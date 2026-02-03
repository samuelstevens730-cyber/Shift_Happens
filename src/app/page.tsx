/**
 * Home Page - Access Mode Selector
 *
 * Landing page that routes users to either:
 * - Employee flow (/clock) - no auth required, for clock-in/out
 * - Admin flow (/admin) - requires authentication
 *
 * Employees can access manually if they missed the store QR code scan.
 */

import Link from "next/link";

export default function Home() {
  return (
    <div className="app-shell">
      <div className="max-w-md mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Shift Happens</h1>
          <p className="text-sm muted">Choose your access mode to continue.</p>
        </div>

        <div className="card card-pad space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <Link href="/clock" className="btn-primary px-4 py-3 text-center">
              Time Clock
            </Link>
            <Link href="/dashboard" className="btn-secondary px-4 py-3 text-center">
              Dashboard
            </Link>
          </div>

          <Link href="/login?next=/admin" className="segment text-center">
            Admin
          </Link>

          <div className="text-xs muted">
            Employees can clock in manually if they missed the QR scan. Admins review variances, payroll, and open shifts.
          </div>
        </div>
      </div>
    </div>
  );
}
