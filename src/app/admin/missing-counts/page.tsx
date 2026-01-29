"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type MissingCountRow = {
  id: string;
  shiftId: string;
  storeName: string | null;
  employeeName: string | null;
  shiftType: string | null;
  countType: "start" | "changeover" | "end";
  countedAt: string;
  drawerCents: number;
  note: string | null;
};

type MissingCountsResponse = { rows: MissingCountRow[] } | { error: string };

function formatMoney(cents: number | null) {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

function formatWhen(value: string | null) {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString();
}

export default function MissingCountsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<MissingCountRow[]>([]);
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!alive) return;
        if (!user) {
          router.replace("/login?next=/admin/missing-counts");
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

  useEffect(() => {
    if (!isAuthed) return;
    let alive = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token || "";
        if (!token || !alive) return;

        const res = await fetch("/api/admin/missing-counts", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await res.json()) as MissingCountsResponse;
        if (!alive) return;
        if (!res.ok || "error" in json) {
          setError("error" in json ? json.error : "Failed to load missing counts.");
          return;
        }
        setRows(json.rows);
      } catch (e: unknown) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load missing counts.");
      }
    })();
    return () => { alive = false; };
  }, [isAuthed]);

  if (loading) return <div className="app-shell">Loading...</div>;
  if (!isAuthed) return null;

  return (
    <div className="app-shell">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Missing Drawer Counts</h1>
          <span className="text-sm muted">Admin overrides</span>
        </div>

        {error && <div className="banner banner-error text-sm">{error}</div>}

        <div className="space-y-3">
          {rows.map(r => (
            <div key={r.id} className="card card-pad space-y-2">
              <div className="flex flex-wrap gap-2 text-sm muted">
                <span>Store: {r.storeName ?? "—"}</span>
                <span>Employee: {r.employeeName ?? "—"}</span>
                <span>Type: {r.shiftType ?? "—"}</span>
              </div>
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <div>Count type: <span className="text-white">{r.countType}</span></div>
                <div>Counted at: <span className="text-white">{formatWhen(r.countedAt)}</span></div>
                <div>Drawer: <span className="text-white">{formatMoney(r.drawerCents)}</span></div>
                <div>Note: <span className="text-white">{r.note ?? "—"}</span></div>
              </div>
            </div>
          ))}

          {!rows.length && (
            <div className="card card-pad text-center text-sm muted">
              No missing drawer counts.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
