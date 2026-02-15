"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ListRow = {
  id: string;
  store_id: string;
  store_name: string | null;
  business_date: string;
  shift_id: string | null;
  profile_id: string;
  employee_name: string | null;
  status: "draft" | "pass" | "warn" | "fail" | "locked";
  requires_manager_review: boolean;
  validation_attempts: number;
  cash_sales_cents: number;
  card_sales_cents: number;
  other_sales_cents: number;
  variance_cents: number;
  expected_deposit_cents: number;
  actual_deposit_cents: number;
  denom_total_cents: number;
  denoms_jsonb: Record<string, number | undefined>;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
};

type Store = { id: string; name: string };

type DetailResponse = {
  closeout: ListRow & {
    employee_name: string | null;
    store_name: string | null;
    drawer_count_cents: number | null;
    deposit_override_reason: string | null;
  };
  expenses: Array<{ id: string; amount_cents: number; category: string; note: string | null; created_at: string }>;
  photos: Array<{ id: string; photo_type: "deposit_required" | "pos_optional"; storage_path: string | null; signed_url: string | null }>;
};

function money(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "--";
  return `$${(cents / 100).toFixed(2)}`;
}

function statusChip(row: ListRow) {
  if (row.requires_manager_review) {
    return <span className="rounded-full border border-orange-300 bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">REVIEW NEEDED</span>;
  }
  if (row.status === "pass") {
    return <span className="rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">PASS</span>;
  }
  if (row.status === "warn") {
    return <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">WARN {money(row.variance_cents)}</span>;
  }
  if (row.status === "fail") {
    return <span className="rounded-full border border-red-300 bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">FAIL {money(row.variance_cents)}</span>;
  }
  return <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{row.status.toUpperCase()}</span>;
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function SafeLedgerDashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ListRow[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState<string>("all");
  const [from, setFrom] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return toDateKey(d);
  });
  const [to, setTo] = useState<string>(() => toDateKey(new Date()));
  const [showIssuesOnly, setShowIssuesOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function withToken() {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token ?? "";
    if (!token) {
      router.replace("/login?next=/admin/safe-ledger");
      return null;
    }
    return token;
  }

  async function loadStores(token: string) {
    const res = await fetch("/api/admin/settings", { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || "Failed to load stores.");
    const nextStores: Store[] = (json?.stores ?? []).map((s: { id: string; name: string }) => ({ id: s.id, name: s.name }));
    setStores(nextStores);
    if (nextStores.length > 0 && storeId === "all") return;
    if (nextStores.length > 0 && !nextStores.some((s) => s.id === storeId)) {
      setStoreId("all");
    }
  }

  async function loadRows(token: string) {
    const qs = new URLSearchParams({ from, to });
    if (storeId !== "all") qs.set("storeId", storeId);
    if (showIssuesOnly) qs.set("review_needed", "true");
    const res = await fetch(`/api/admin/safe-ledger?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || "Failed to load safe ledger.");
    setRows((json?.rows ?? []) as ListRow[]);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setError(null);
        setLoading(true);
        const token = await withToken();
        if (!token || !alive) return;
        await Promise.all([loadStores(token), loadRows(token)]);
      } catch (e: unknown) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load safe ledger.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [storeId, from, to, showIssuesOnly]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const token = await withToken();
        if (!token || !alive) return;
        setDetailLoading(true);
        const res = await fetch(`/api/admin/safe-ledger/${selectedId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Failed to load detail.");
        if (!alive) return;
        setDetail(json as DetailResponse);
      } catch (e: unknown) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load detail.");
      } finally {
        if (alive) setDetailLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [selectedId]);

  const filteredRows = useMemo(() => {
    if (!showIssuesOnly) return rows;
    return rows.filter((r) => r.requires_manager_review || r.status === "warn" || r.status === "fail");
  }, [rows, showIssuesOnly]);

  async function copyText(text: string, successMsg: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast(successMsg);
    } catch {
      setToast("Copy failed.");
    }
  }

  function buildSalesTsv() {
    const lines = ["Date\tCash\tCard"];
    for (const row of filteredRows) {
      lines.push(`${row.business_date}\t${(row.cash_sales_cents / 100).toFixed(2)}\t${(row.card_sales_cents / 100).toFixed(2)}`);
    }
    return lines.join("\n");
  }

  function buildDenomTsv() {
    const keys: Array<"100" | "50" | "20" | "10" | "5" | "1"> = ["100", "50", "20", "10", "5", "1"];
    const totals: Record<string, number> = { "100": 0, "50": 0, "20": 0, "10": 0, "5": 0, "1": 0 };
    for (const row of filteredRows) {
      for (const key of keys) {
        totals[key] += Number(row.denoms_jsonb?.[key] ?? 0);
      }
    }
    const lines = ["Denom\tQty\tAmount"];
    for (const key of keys) {
      const qty = totals[key];
      const amount = qty * Number(key);
      lines.push(`$${key}\t${qty}\t${amount.toFixed(2)}`);
    }
    return lines.join("\n");
  }

  async function markReviewed() {
    if (!detail?.closeout?.id) return;
    try {
      setReviewing(true);
      const token = await withToken();
      if (!token) return;
      const res = await fetch(`/api/admin/safe-ledger/${detail.closeout.id}/review`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reviewed: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to mark as reviewed.");
      setToast("Marked as reviewed.");
      setSelectedId(null);
      await loadRows(token);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to mark reviewed.");
    } finally {
      setReviewing(false);
    }
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h1 className="text-2xl font-semibold">Safe Ledger Dashboard</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => void copyText(buildSalesTsv(), "Copied Sales TSV")}>Copy Sales TSV</Button>
          <Button variant="outline" onClick={() => void copyText(buildDenomTsv(), "Copied Denom TSV")}>Copy Denom TSV</Button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <DatePicker label="Start Date" value={from} onChange={setFrom} max={to} />
          <DatePicker label="End Date" value={to} onChange={setTo} min={from} />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Store</span>
            <select
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
            >
              <option value="all">All Stores</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>{store.name}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 self-end pb-1 text-sm">
            <input type="checkbox" checked={showIssuesOnly} onChange={(e) => setShowIssuesOnly(e.target.checked)} />
            Show Issues Only
          </label>
        </div>
      </div>

      {error && <div className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">{error}</div>}
      {loading ? (
        <div className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-600">Loading safe ledger...</div>
      ) : (
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Store</TableHead>
                <TableHead>Closer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Variance ($)</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.business_date}</TableCell>
                  <TableCell>{row.store_name ?? "--"}</TableCell>
                  <TableCell>{row.employee_name ?? "--"}</TableCell>
                  <TableCell>{statusChip(row)}</TableCell>
                  <TableCell>{money(row.variance_cents)}</TableCell>
                  <TableCell>
                    <Button variant="secondary" onClick={() => setSelectedId(row.id)}>View</Button>
                  </TableCell>
                </TableRow>
              ))}
              {filteredRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-slate-500">No closeouts for selected filters.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={Boolean(selectedId)} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Safe Closeout Detail</DialogTitle>
            <DialogDescription>
              {detail?.closeout?.store_name ?? "--"} · {detail?.closeout?.business_date ?? "--"} · {detail?.closeout?.employee_name ?? "--"}
            </DialogDescription>
          </DialogHeader>

          {detailLoading || !detail ? (
            <div className="text-sm text-slate-600">Loading detail...</div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded border border-slate-200 p-3 text-sm">
                  <div className="font-medium">Cash Sales</div>
                  <div>{money(detail.closeout.cash_sales_cents)}</div>
                </div>
                <div className="rounded border border-slate-200 p-3 text-sm">
                  <div className="font-medium">Card Sales</div>
                  <div>{money(detail.closeout.card_sales_cents)}</div>
                </div>
                <div className="rounded border border-slate-200 p-3 text-sm">
                  <div className="font-medium">Drawer Count (Float)</div>
                  <div>{money(detail.closeout.drawer_count_cents)}</div>
                </div>
              </div>

              <div className="rounded border border-slate-200 p-3 text-sm">
                <div className="mb-2 font-medium">Expenses</div>
                {detail.expenses.length === 0 ? (
                  <div className="text-slate-500">No expenses.</div>
                ) : (
                  <ul className="space-y-1">
                    {detail.expenses.map((expense) => (
                      <li key={expense.id} className="flex items-center justify-between">
                        <span>{expense.note || expense.category}</span>
                        <span>{money(expense.amount_cents)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded border border-slate-200 p-3 text-sm">
                  <div className="font-medium">Expected Deposit</div>
                  <div>{money(detail.closeout.expected_deposit_cents)}</div>
                </div>
                <div className="rounded border border-slate-200 p-3 text-sm">
                  <div className="font-medium">Actual Deposit</div>
                  <div>{money(detail.closeout.actual_deposit_cents)}</div>
                </div>
              </div>

              <div className="rounded border border-slate-200 p-3 text-sm">
                <div className="mb-2 font-medium">Evidence</div>
                {detail.photos.length === 0 ? (
                  <div className="text-slate-500">No photos uploaded.</div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {detail.photos.map((photo) => (
                      <div key={photo.id} className="space-y-1">
                        <div className="text-xs uppercase text-slate-500">{photo.photo_type.replace("_", " ")}</div>
                        {photo.signed_url ? (
                          <img src={photo.signed_url} alt={photo.photo_type} className="h-48 w-full rounded border border-slate-200 object-cover" />
                        ) : (
                          <div className="rounded border border-slate-200 p-3 text-xs text-slate-500">Photo unavailable.</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setSelectedId(null)}>Close</Button>
                <Button onClick={() => void markReviewed()} disabled={reviewing}>
                  {reviewing ? "Saving..." : "Mark as Reviewed"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {toast && (
        <div className="fixed right-4 top-4 z-50 rounded border border-slate-300 bg-white px-3 py-2 text-sm shadow">
          {toast}
        </div>
      )}
    </div>
  );
}
