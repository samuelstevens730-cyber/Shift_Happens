"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function AdminIndex() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [isAuthed, setIsAuthed] = useState(false);

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

  if (loading) return <div className="p-6">Loading…</div>;
  if (error)   return <div className="p-6 text-red-600">{error}</div>;
  if (!isAuthed) return null; // redirected

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Admin</h1>
          <span className="text-sm text-gray-500">No Cap Smoke Shop</span>
        </header>

        <section className="grid gap-4 sm:grid-cols-2">
          {/* Payroll */}
          <Link href="/admin/payroll" className="block rounded-2xl border p-5 shadow-sm hover:shadow transition">
            <div className="text-lg font-medium">Payroll</div>
            <p className="mt-1 text-sm text-gray-600">
              View finished shifts and export for payroll.
            </p>
          </Link>

          {/* Open Shifts (placeholder; wire when ready) */}
          <button
            className="rounded-2xl border p-5 text-left shadow-sm opacity-60 cursor-not-allowed"
            title="Coming soon"
            disabled
          >
            <div className="text-lg font-medium">Open Shifts</div>
            <p className="mt-1 text-sm text-gray-600">
              See and close any in-progress or stale shifts.
            </p>
          </button>

          {/* Users (placeholder) */}
          <button
            className="rounded-2xl border p-5 text-left shadow-sm opacity-60 cursor-not-allowed"
            title="Coming soon"
            disabled
          >
            <div className="text-lg font-medium">Users</div>
            <p className="mt-1 text-sm text-gray-600">
              Manage access to stores and roles.
            </p>
          </button>

          {/* Settings (placeholder) */}
          <button
            className="rounded-2xl border p-5 text-left shadow-sm opacity-60 cursor-not-allowed"
            title="Coming soon"
            disabled
          >
            <div className="text-lg font-medium">Settings</div>
            <p className="mt-1 text-sm text-gray-600">
              Store config, checklists, payroll options.
            </p>
          </button>
        </section>
      </div>
    </div>
  );
}
