"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type OverrideRow = {
  id: string;
  storeId: string | null;
  storeName: string | null;
  employeeName: string | null;
  shiftType: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationHours: number | null;
};

type OverridesResponse = { rows: OverrideRow[] } | { error: string };
type SimpleResponse = { ok: true } | { error: string };

function formatWhen(value: string | null) {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString();
}

export default function OverridesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAuthed, setIsAuthed] = useState(false);
  const [rows, setRows] = useState<OverrideRow[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!alive) return;
        if (!user) {
          router.replace("/login?next=/admin/overrides");
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
        setError(null);
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token || "";
        if (!token) {
          router.replace("/login?next=/admin/overrides");
          return;
        }

        const res = await fetch("/api/admin/overrides", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await res.json()) as OverridesResponse;
        if (!alive) return;
        if (!res.ok || "error" in json) {
          const msg = "error" in json ? json.error : "Failed to load overrides.";
          setError(msg);
          setRows([]);
          return;
        }
        setRows(json.rows);
      } catch (e: unknown) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load overrides.");
        setRows([]);
      }
    })();
    return () => { alive = false; };
  }, [isAuthed, router]);

  async function approveShift(shiftId: string) {
    if (savingIds.has(shiftId)) return;
    setSavingIds(prev => new Set(prev).add(shiftId));
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      if (!token) {
        router.replace("/login?next=/admin/overrides");
        return;
      }

      const note = (notes[shiftId] || "").trim();
      if (!note) {
        setError("Approval note is required.");
        return;
      }

      const res = await fetch(`/api/admin/overrides/${shiftId}/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ note }),
      });
      const json = (await res.json()) as SimpleResponse;
      if (!res.ok || "error" in json) {
        const msg = "error" in json ? json.error : "Failed to approve override.";
        setError(msg);
        return;
      }

      setRows(prev => prev.filter(r => r.id !== shiftId));
      setNotes(prev => {
        const copy = { ...prev };
        delete copy[shiftId];
        return copy;
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to approve override.");
    } finally {
      setSavingIds(prev => {
        const copy = new Set(prev);
        copy.delete(shiftId);
        return copy;
      });
    }
  }

  if (loading) return <div className="app-shell">Loading...</div>;
  if (!isAuthed) return null;

  return (
    <div className="app-shell">
      <div className="max-w-5xl mx-auto space-y-6">
        <h1 className="text-2xl font-semibold">Long Shift Overrides</h1>

        {error && <div className="banner banner-error text-sm">{error}</div>}

        <div className="space-y-3">
          {rows.map(r => (
            <div key={r.id} className="card card-pad space-y-2">
              <div className="flex flex-wrap gap-3 items-center justify-between">
                <div className="text-sm muted">
                  <b>{r.storeName || "Unknown Store"}</b>
                </div>
                <div className="text-xs muted">
                  Ended: {formatWhen(r.endedAt)}
                </div>
              </div>

              <div className="text-sm">
                Employee: <b>{r.employeeName || "Unknown"}</b>{" "}
                {r.shiftType && <span>- Shift: {r.shiftType}</span>}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                <div>Started: <b>{formatWhen(r.startedAt)}</b></div>
                <div>Duration: <b>{r.durationHours != null ? `${r.durationHours} hrs` : "--"}</b></div>
                <div>Status: <b>Requires override</b></div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <input
                  className="input text-sm"
                  placeholder="Approval note (required)"
                  value={notes[r.id] ?? ""}
                  onChange={e => setNotes(prev => ({ ...prev, [r.id]: e.target.value }))}
                />
                <button
                  className="btn-primary px-3 py-2 text-sm disabled:opacity-50"
                  onClick={() => approveShift(r.id)}
                  disabled={savingIds.has(r.id)}
                >
                  {savingIds.has(r.id) ? "Saving..." : "Approve"}
                </button>
              </div>
            </div>
          ))}

          {!rows.length && (
            <div className="card card-pad text-center text-sm muted">
              No shifts require override.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
