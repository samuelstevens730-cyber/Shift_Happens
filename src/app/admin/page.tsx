/**
 * Admin Dashboard - Main Navigation Hub
 *
 * Entry point for all admin functionality. Requires authentication.
 * Shows navigation tiles for all admin modules with quick access.
 *
 * Features:
 * - Auth check: redirects to login if not authenticated
 * - Variance badge: shows count of unreviewed drawer variances
 * - Module navigation: payroll, variances, shifts, overrides, users, assignments, settings
 *
 * Authorization is enforced at the API level - this page only checks
 * if user is logged in, not if they have admin privileges.
 */

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type VarianceCountResponse = { rows: unknown[] } | { error: string };

export default function AdminIndex() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [isAuthed, setIsAuthed] = useState(false);
  // Badge count for unreviewed drawer variances
  const [varianceCount, setVarianceCount] = useState<number | null>(null);

  // Auth check - redirect to login if not authenticated
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!alive) return;
        if (!user) {
          router.replace("/login?next=/admin");
          return;
        }
        setIsAuthed(true);
      } catch (e: unknown) {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [router]);

  // Fetch variance count for badge display
  useEffect(() => {
    if (!isAuthed) return;
    let alive = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token || "";
        if (!token || !alive) return;

        const res = await fetch("/api/admin/variances", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await res.json()) as VarianceCountResponse;
        if (!alive) return;
        if (!res.ok || "error" in json) {
          setVarianceCount(null);
          return;
        }
        setVarianceCount(Array.isArray(json.rows) ? json.rows.length : null);
      } catch {
        if (!alive) return;
        setVarianceCount(null);
      }
    })();
    return () => { alive = false; };
  }, [isAuthed]);

  if (loading) return <div className="app-shell">Loading...</div>;
  if (error)   return <div className="app-shell"><div className="banner banner-error">{error}</div></div>;
  if (!isAuthed) return null; // redirected

  return (
    <div className="app-shell">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Admin</h1>
          <span className="text-sm muted">No Cap Smoke Shop</span>
        </header>

        <section className="grid gap-4 sm:grid-cols-2">
          {/* Command Center Dashboard - primary at-a-glance operations view */}
          <Link href="/admin/dashboard" className="tile">
            <div className="flex items-center gap-2">
              <span className="tile-dot" />
              <div className="text-lg font-medium">Command Center</div>
            </div>
            <p className="mt-2 text-sm muted">
              Live dashboard for sales, health, and priority actions.
            </p>
          </Link>

          {/* Requests - approval queue for swaps, time off, timesheets */}
          <Link href="/admin/requests" className="tile">
            <div className="flex items-center gap-2">
              <span className="tile-dot" />
              <div className="text-lg font-medium">Requests</div>
            </div>
            <p className="mt-2 text-sm muted">
              Review swap, time off, and timesheet requests.
            </p>
          </Link>
          {/* Payroll - export shift data for payroll processing */}
          <Link href="/admin/payroll" className="tile">
            <div className="flex items-center gap-2">
              <span className="tile-dot" />
              <div className="text-lg font-medium">Payroll</div>
            </div>
            <p className="mt-2 text-sm muted">
              View finished shifts and export for payroll.
            </p>
          </Link>

          {/* Variance Review - drawer counts outside threshold requiring review */}
          <Link href="/admin/variances" className="tile">
            <div className="flex items-center gap-2">
              <span className="tile-dot" />
              <div className="text-lg font-medium">Variance Review</div>
              {/* Badge shows count of pending variances */}
              {typeof varianceCount === "number" && varianceCount > 0 && (
                <span className="text-xs rounded-full bg-black text-white px-2 py-0.5">
                  {varianceCount}
                </span>
              )}
            </div>
            <p className="mt-2 text-sm muted">
              Review out-of-threshold drawer counts.
            </p>
          </Link>

          {/* Open Shifts - monitor and close stale/abandoned shifts */}
          <Link href="/admin/open-shifts" className="tile">
            <div className="flex items-center gap-2">
              <span className="tile-dot" />
              <div className="text-lg font-medium">Open Shifts</div>
            </div>
            <p className="mt-2 text-sm muted">
              See and close any in-progress or stale shifts.
            </p>
          </Link>

          {/* Shifts - full CRUD for all shift records */}
          <Link href="/admin/shifts" className="tile">
            <div className="flex items-center gap-2">
              <span className="tile-dot" />
              <div className="text-lg font-medium">Shifts</div>
            </div>
            <p className="mt-2 text-sm muted">
              View, edit, add, or remove shifts.
            </p>
          </Link>

          {/* Safe Ledger - audit closeouts, evidence, and review workflow */}
          <Link href="/admin/safe-ledger" className="tile">
            <div className="flex items-center gap-2">
              <span className="tile-dot" />
              <div className="text-lg font-medium">Safe Ledger</div>
            </div>
            <p className="mt-2 text-sm muted">
              Audit safe closeouts, view evidence, and export ledger data.
            </p>
          </Link>

          {/* Shift Sales - per-shift sales formulas and leaderboard source data */}
          <Link href="/admin/shift-sales" className="tile">
            <div className="flex items-center gap-2">
              <span className="tile-dot" />
              <div className="text-lg font-medium">Shift Sales</div>
            </div>
            <p className="mt-2 text-sm muted">
              View all shifts with AM/PM sales math and rollover handling.
            </p>
          </Link>

          {/* Manual Shift Closures - review employee-ended shifts */}
          <Link href="/admin/shifts?review=manual" className="tile">
            <div className="flex items-center gap-2">
              <span className="tile-dot" />
              <div className="text-lg font-medium">Manual Closures</div>
            </div>
            <p className="mt-2 text-sm muted">
              Review shifts closed manually by employees.
            </p>
          </Link>

          {/* Long Shift Overrides - approve shifts >13 hours */}
          <Link href="/admin/overrides" className="tile">
            <div className="flex items-center gap-2">
              <span className="tile-dot" />
              <div className="text-lg font-medium">Long Shift Overrides</div>
            </div>
            <p className="mt-2 text-sm muted">
              Approve shifts that exceed 13 hours.
            </p>
          </Link>

          {/* Users - employee profile management */}
          <Link href="/admin/users" className="tile">
            <div className="flex items-center gap-2">
              <span className="tile-dot" />
              <div className="text-lg font-medium">Users</div>
            </div>
            <p className="mt-2 text-sm muted">
              Manage employee profiles and store assignments.
            </p>
          </Link>

          {/* Tasks & Messages - assign work to employees for next shift */}
          <Link href="/admin/assignments" className="tile">
            <div className="flex items-center gap-2">
              <span className="tile-dot" />
              <div className="text-lg font-medium">Tasks & Messages</div>
            </div>
            <p className="mt-2 text-sm muted">
              Assign tasks or messages for the next shift.
            </p>
          </Link>

          {/* Settings - store configuration and checklists */}
          <Link href="/admin/settings" className="tile">
            <div className="flex items-center gap-2">
              <span className="tile-dot" />
              <div className="text-lg font-medium">Settings</div>
            </div>
            <p className="mt-2 text-sm muted">
              Store config and checklists.
            </p>
          </Link>

          {/* Cleaning Tasks - per-store/day/shift cleaning matrix */}
          <Link href="/admin/cleaning" className="tile">
            <div className="flex items-center gap-2">
              <span className="tile-dot" />
              <div className="text-lg font-medium">Cleaning Tasks</div>
            </div>
            <p className="mt-2 text-sm muted">
              Configure cleaning requirements by store, day, and shift.
            </p>
          </Link>

          {/* Scheduler - build weekly schedules */}
          <Link href="/admin/scheduler" className="tile">
            <div className="flex items-center gap-2">
              <span className="tile-dot" />
              <div className="text-lg font-medium">Scheduler</div>
            </div>
            <p className="mt-2 text-sm muted">
              Build and publish schedules for each store.
            </p>
          </Link>

          {/* Employee Schedules - view individual schedules */}
          <Link href="/admin/employee-schedules" className="tile">
            <div className="flex items-center gap-2">
              <span className="tile-dot" />
              <div className="text-lg font-medium">Employee Schedules</div>
            </div>
            <p className="mt-2 text-sm muted">
              View individual schedules by employee, store, and pay period.
            </p>
          </Link>
        </section>
      </div>
    </div>
  );
}

