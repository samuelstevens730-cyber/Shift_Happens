/**
 * Variance Review Page - Review and resolve out-of-threshold drawer counts
 *
 * This administrative page displays drawer counts that have exceeded the acceptable variance
 * threshold (difference between expected and actual drawer amounts). Managers use this page
 * to review discrepancies, add notes, and mark them as reviewed for audit purposes.
 *
 * Features:
 * - View all unreviewed drawer variances with store, employee, and shift details
 * - Display expected vs actual drawer amounts and calculated delta
 * - Filter by date range, store, and employee
 * - Add review notes before marking a variance as reviewed
 * - Separate section for admin-closed shifts that had no drawer count (missing counts)
 * - Paginated views for both variance list and missing counts list
 *
 * Business Logic:
 * - Variances include start, changeover, and end drawer counts
 * - Each variance shows confirmation status and whether manager was notified
 * - Employee notes from the original count are displayed for context
 * - Reviewing a variance removes it from the active list and records the review in audit history
 * - Missing counts section helps identify shifts closed by admin without proper drawer reconciliation
 */
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

type ReviewResponse = { ok: true } | { error: string };

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

type MissingCountsResponse =
  | { rows: MissingCountRow[]; page: number; pageSize: number; total: number }
  | { error: string };

type VarianceListResponse =
  | { rows: VarianceRow[]; page: number; pageSize: number; total: number }
  | { error: string };

type Store = { id: string; name: string };
type Profile = { id: string; name: string | null };

function formatMoney(cents: number | null) {
  if (cents == null || !Number.isFinite(cents)) return "--";
  return `$${(cents / 100).toFixed(2)}`;
}

function formatWhen(value: string) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function VarianceReviewPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAuthed, setIsAuthed] = useState(false);
  const [rows, setRows] = useState<VarianceRow[]>([]);
  const [missingRows, setMissingRows] = useState<MissingCountRow[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [filterFrom, setFilterFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [filterTo, setFilterTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [filterStore, setFilterStore] = useState("all");
  const [filterProfile, setFilterProfile] = useState("all");
  const [page, setPage] = useState(1);
  const [missingPage, setMissingPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [missingTotal, setMissingTotal] = useState(0);
  const pageSize = 25;

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
        const { data: storeData } = await supabase
          .from("stores")
          .select("id, name")
          .order("name", { ascending: true });
        if (alive) setStores(storeData ?? []);

        const { data: profileData } = await supabase
          .from("profiles")
          .select("id, name")
          .order("name", { ascending: true });
        if (alive) setProfiles(profileData ?? []);

        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token || "";
        if (!token) {
          router.replace("/login?next=/admin/variances");
          return;
        }

        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
          from: new Date(filterFrom).toISOString(),
          to: new Date(filterTo).toISOString(),
        });
        if (filterStore !== "all") params.set("storeId", filterStore);
        if (filterProfile !== "all") params.set("profileId", filterProfile);

        const missingParams = new URLSearchParams({
          page: String(missingPage),
          pageSize: String(pageSize),
          from: new Date(filterFrom).toISOString(),
          to: new Date(filterTo).toISOString(),
        });
        if (filterStore !== "all") missingParams.set("storeId", filterStore);
        if (filterProfile !== "all") missingParams.set("profileId", filterProfile);

        const [varianceRes, missingRes] = await Promise.all([
          fetch(`/api/admin/variances?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`/api/admin/missing-counts?${missingParams.toString()}`, { headers: { Authorization: `Bearer ${token}` } }),
        ]);

        const varianceJson = (await varianceRes.json()) as VarianceListResponse;
        const missingJson = (await missingRes.json()) as MissingCountsResponse;
        if (!alive) return;

        if (!varianceRes.ok || "error" in varianceJson) {
          const msg = "error" in varianceJson ? varianceJson.error : "Failed to load variances.";
          setError(msg);
          setRows([]);
        } else {
          setRows(varianceJson.rows);
          setTotal(varianceJson.total);
          setPage(varianceJson.page);
        }

        if (!missingRes.ok || "error" in missingJson) {
          const msg = "error" in missingJson ? missingJson.error : "Failed to load missing counts.";
          setError(prev => prev ?? msg);
          setMissingRows([]);
        } else {
          setMissingRows(missingJson.rows);
          setMissingTotal(missingJson.total);
          setMissingPage(missingJson.page);
        }
      } catch (e: unknown) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load variances.");
        setRows([]);
        setMissingRows([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [isAuthed, router, page, missingPage, filterFrom, filterTo, filterStore, filterProfile]);

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

        <div className="card card-pad space-y-4">
          <div className="text-lg font-medium">Filters</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <label className="text-sm muted">From</label>
              <input type="date" className="input" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm muted">To</label>
              <input type="date" className="input" value={filterTo} onChange={e => setFilterTo(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm muted">Store</label>
              <select className="select" value={filterStore} onChange={e => setFilterStore(e.target.value)}>
                <option value="all">All</option>
                {stores.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm muted">Employee</label>
              <select className="select" value={filterProfile} onChange={e => setFilterProfile(e.target.value)}>
                <option value="all">All</option>
                {profiles.map(p => (
                  <option key={p.id} value={p.id}>{p.name || p.id.slice(0, 8)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-primary px-4 py-2"
              onClick={() => {
                setPage(1);
                setMissingPage(1);
              }}
            >
              Apply Filters
            </button>
          </div>
        </div>

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
                    {formatWhen(r.countedAt)}
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

        {total > pageSize && (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
          />
        )}

        <div className="pt-4">
          <h2 className="text-xl font-semibold">Admin-Closed Without Count</h2>
        </div>

        <div className="space-y-3">
          {missingRows.map(r => (
            <div key={r.id} className="card card-pad space-y-2">
              <div className="flex flex-wrap gap-3 items-center justify-between">
                <div className="text-sm muted">
                  <b>{r.storeName || "Unknown Store"}</b>
                </div>
                <div className="text-xs muted">{formatWhen(r.countedAt)}</div>
              </div>

              <div className="text-sm">
                Employee: <b>{r.employeeName || "Unknown"}</b>{" "}
                {r.shiftType && <span>- Shift: {r.shiftType}</span>}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                <div>Type: <b>{r.countType}</b></div>
                <div>Drawer: <b>{formatMoney(r.drawerCents)}</b></div>
                <div>Note: <b>{r.note ?? "--"}</b></div>
              </div>
            </div>
          ))}

          {!missingRows.length && (
            <div className="card card-pad text-center text-sm muted">
              No admin-closed shifts without a count.
            </div>
          )}
        </div>

        {missingTotal > pageSize && (
          <Pagination
            page={missingPage}
            pageSize={pageSize}
            total={missingTotal}
            onPageChange={setMissingPage}
          />
        )}
      </div>
    </div>
  );
}

function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;

  const pages: number[] = [];
  for (let i = 1; i <= totalPages; i += 1) pages.push(i);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className="btn-secondary px-3 py-1.5" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        Prev
      </button>
      {pages.map(p => (
        <button
          key={p}
          className={p === page ? "btn-primary px-3 py-1.5" : "btn-secondary px-3 py-1.5"}
          onClick={() => onPageChange(p)}
        >
          {p}
        </button>
      ))}
      <button className="btn-secondary px-3 py-1.5" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
        Next
      </button>
    </div>
  );
}

