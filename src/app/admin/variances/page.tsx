"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type VarianceRow = {
  id: string;
  shiftId: string;
  storeName: string | null;
  expectedDrawerCents: number | null;
  employeeName: string | null;
  shiftType: string | null;
  countType: "start" | "changeover" | "end";
  countedAt: string;
  drawerCents: number;
  confirmed: boolean;
  notifiedManager: boolean;
  note: string | null;
};

type VarianceResponse = { rows: VarianceRow[] } | { error: string };
type ReviewResponse = { ok: true } | { error: string };

function formatMoney(cents: number | null) {
  if (cents == null || !Number.isFinite(cents)) return "--";
  return `$${(cents / 100).toFixed(2)}`;
}

export default function VarianceReviewPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAuthed, setIsAuthed] = useState(false);
  const [rows, setRows] = useState<VarianceRow[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!alive) return;
        if (!user) {
          router.replace("/login?next=/admin/variances");
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
    return () => {
      alive = false;
    };
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
          router.replace("/login?next=/admin/variances");
          return;
        }

        const res = await fetch("/api/admin/variances", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await res.json()) as VarianceResponse;
        if (!alive) return;
        if (!res.ok || "error" in json) {
          const msg = "error" in json ? json.error : "Failed to load variances.";
          setError(msg);
          setRows([]);
          return;
        }
        setRows(json.rows);
      } catch (e: unknown) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load variances.");
        setRows([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [isAuthed, router]);

  const deltaById = useMemo(() => {
    const map = new Map<string, number | null>();
    rows.forEach(r => {
      const expected = r.expectedDrawerCents;
      map.set(r.id, expected == null ? null : r.drawerCents - expected);
    });
    return map;
  }, [rows]);

  async function markReviewed(countId: string) {
    if (savingIds.has(countId)) return;
    setSavingIds(prev => new Set(prev).add(countId));
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      if (!token) {
        router.replace("/login?next=/admin/variances");
        return;
      }

      const reviewNote = notes[countId];
      const res = await fetch(`/api/admin/variances/${countId}/review`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reviewNote }),
      });
      const json = (await res.json()) as ReviewResponse;
      if (!res.ok || "error" in json) {
        const msg = "error" in json ? json.error : "Failed to mark reviewed.";
        setError(msg);
        return;
      }

      setRows(prev => prev.filter(r => r.id !== countId));
      setNotes(prev => {
        const copy = { ...prev };
        delete copy[countId];
        return copy;
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to mark reviewed.");
    } finally {
      setSavingIds(prev => {
        const copy = new Set(prev);
        copy.delete(countId);
        return copy;
      });
    }
  }

  if (loading) return <div className="app-shell">Loading...</div>;
  if (!isAuthed) return null;

  return (
    <div className="app-shell">
      <div className="max-w-5xl mx-auto space-y-6">
        <h1 className="text-2xl font-semibold">Variance Review</h1>

        {error && <div className="banner banner-error text-sm">{error}</div>}

        <div className="space-y-3">
          {rows.map(r => {
            const delta = deltaById.get(r.id);
            return (
              <div key={r.id} className="card card-pad space-y-2">
                <div className="flex flex-wrap gap-3 items-center justify-between">
                  <div className="text-sm muted">
                    <b>{r.storeName || "Unknown Store"}</b>{" "}
                    {r.expectedDrawerCents != null && (
                      <span>(expected {formatMoney(r.expectedDrawerCents)})</span>
                    )}
                  </div>
                  <div className="text-xs muted">
                    {new Date(r.countedAt).toLocaleString()}
                  </div>
                </div>

                <div className="text-sm">
                  Employee: <b>{r.employeeName || "Unknown"}</b>{" "}
                  {r.shiftType && <span>- Shift: {r.shiftType}</span>}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                  <div>Type: <b>{r.countType}</b></div>
                  <div>Drawer: <b>{formatMoney(r.drawerCents)}</b></div>
                  <div>
                    Delta: <b>{delta == null ? "--" : formatMoney(delta)}</b>
                  </div>
                </div>

                <div className="text-xs muted">
                  Confirmed: {r.confirmed ? "Yes" : "No"} - Notified: {r.notifiedManager ? "Yes" : "No"}
                </div>

                {r.note && (
                  <div className="text-sm card card-muted card-pad">
                    Note: {r.note}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                  <input
                    className="input text-sm"
                    placeholder="Review note (optional)"
                    value={notes[r.id] ?? ""}
                    onChange={e => setNotes(prev => ({ ...prev, [r.id]: e.target.value }))}
                  />
                  <button
                    className="btn-primary px-3 py-2 text-sm disabled:opacity-50"
                    onClick={() => markReviewed(r.id)}
                    disabled={savingIds.has(r.id)}
                  >
                    {savingIds.has(r.id) ? "Saving..." : "Mark Reviewed"}
                  </button>
                </div>
              </div>
            );
          })}

          {!rows.length && (
            <div className="card card-pad text-center text-sm muted">
              No open variances.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

