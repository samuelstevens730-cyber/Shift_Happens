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
  edited_at: string | null;
  edited_by: string | null;
  edited_by_name?: string | null;
  is_historical_backfill: boolean;
};

type Store = { id: string; name: string };

type DetailResponse = {
  closeout: ListRow & {
    employee_name: string | null;
    store_name: string | null;
    drawer_count_cents: number | null;
    deposit_override_reason: string | null;
    edited_by_name?: string | null;
  };
  expenses: Array<{ id: string; amount_cents: number; category: string; note: string | null; created_at: string }>;
  photos: Array<{ id: string; photo_type: "deposit_required" | "pos_optional"; storage_path: string | null; signed_url: string | null }>;
};

function money(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "--";
  return `$${(cents / 100).toFixed(2)}`;
}

function toMoneyInput(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "";
  return (cents / 100).toFixed(2);
}

function parseMoneyInputToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

function varianceTone(absVarianceCents: number): string {
  if (absVarianceCents === 0) return "border-emerald-400/40 bg-emerald-900/20 text-emerald-200";
  if (absVarianceCents <= 100) return "border-amber-400/40 bg-amber-900/20 text-amber-200";
  return "border-red-400/40 bg-red-900/20 text-red-200";
}

function statusChip(row: ListRow) {
  const historicalBadge = row.is_historical_backfill ? (
    <span className="rounded-full border border-sky-300 bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700">HISTORICAL</span>
  ) : null;

  if (row.requires_manager_review) {
    return <div className="flex flex-wrap items-center gap-1"><span className="rounded-full border border-orange-300 bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">REVIEW NEEDED</span>{historicalBadge}</div>;
  }
  if (row.status === "pass") {
    return <div className="flex flex-wrap items-center gap-1"><span className="rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">PASS</span>{historicalBadge}</div>;
  }
  if (row.status === "warn") {
    return <div className="flex flex-wrap items-center gap-1"><span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">WARN {money(row.variance_cents)}</span>{historicalBadge}</div>;
  }
  if (row.status === "fail") {
    return <div className="flex flex-wrap items-center gap-1"><span className="rounded-full border border-red-300 bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">FAIL {money(row.variance_cents)}</span>{historicalBadge}</div>;
  }
  return <div className="flex flex-wrap items-center gap-1"><span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{row.status.toUpperCase()}</span>{historicalBadge}</div>;
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fromDateKey(key: string): Date {
  return new Date(`${key}T00:00:00`);
}

function weekdayLabel(dateKey: string): string {
  const day = fromDateKey(dateKey).getDay();
  const labels = ["SUN", "MON", "TUES", "WEDS", "THU", "FRI", "SAT"];
  return labels[day] ?? "UNK";
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
  const [isEditing, setIsEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState({
    status: "pass",
    cashSales: "",
    cardSales: "",
    otherSales: "",
    expectedDeposit: "",
    actualDeposit: "",
    drawerCount: "",
  });
  const [quickViewMode, setQuickViewMode] = useState<"week" | "month">("week");
  const [selectedWeek, setSelectedWeek] = useState<string>("1");

  const weekRanges = useMemo(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month, lastDayOfMonth);
    const cappedMonthEnd = today < monthEnd ? today : monthEnd;
    const ranges: Array<{ value: string; label: string; from: string; to: string }> = [];

    for (let week = 1; week <= 5; week += 1) {
      const startDay = (week - 1) * 7 + 1;
      const endDay = Math.min(week * 7, lastDayOfMonth);
      if (startDay > lastDayOfMonth) break;

      const start = new Date(year, month, startDay);
      let end = new Date(year, month, endDay);
      if (end > cappedMonthEnd) end = cappedMonthEnd;
      if (start > end) continue;

      ranges.push({
        value: String(week),
        label: `Week ${week} (${toDateKey(start)} to ${toDateKey(end)})`,
        from: toDateKey(start),
        to: toDateKey(end),
      });
    }

    // fallback so selector always has at least one option
    if (ranges.length === 0) {
      ranges.push({
        value: "1",
        label: `Week 1 (${toDateKey(monthStart)} to ${toDateKey(cappedMonthEnd)})`,
        from: toDateKey(monthStart),
        to: toDateKey(cappedMonthEnd),
      });
    }

    return ranges;
  }, []);

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

  async function loadDetail(token: string, closeoutId: string) {
    const res = await fetch(`/api/admin/safe-ledger/${closeoutId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || "Failed to load detail.");
    setDetail(json as DetailResponse);
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
      setIsEditing(false);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const token = await withToken();
        if (!token || !alive) return;
        setDetailLoading(true);
        await loadDetail(token, selectedId);
        if (!alive) return;
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

  useEffect(() => {
    if (!detail?.closeout) return;
    setEditForm({
      status: detail.closeout.status === "locked" ? "fail" : detail.closeout.status,
      cashSales: toMoneyInput(detail.closeout.cash_sales_cents),
      cardSales: toMoneyInput(detail.closeout.card_sales_cents),
      otherSales: toMoneyInput(detail.closeout.other_sales_cents),
      expectedDeposit: toMoneyInput(detail.closeout.expected_deposit_cents),
      actualDeposit: toMoneyInput(detail.closeout.actual_deposit_cents),
      drawerCount: toMoneyInput(detail.closeout.drawer_count_cents),
    });
  }, [detail]);

  const filteredRows = useMemo(() => {
    if (!showIssuesOnly) return rows;
    return rows.filter((r) => r.requires_manager_review || r.status === "warn" || r.status === "fail");
  }, [rows, showIssuesOnly]);

  const storeReconciliationSummaries = useMemo(() => {
    const byStore = new Map<string, {
      storeId: string;
      storeName: string;
      expectedTotalCents: number;
      actualTotalCents: number;
      denomTotalCents: number;
      denoms: Record<"1" | "2" | "5" | "10" | "20" | "50" | "100", number>;
    }>();

    for (const row of filteredRows) {
      const key = row.store_id;
      if (!byStore.has(key)) {
        byStore.set(key, {
          storeId: row.store_id,
          storeName: (row.store_name ?? "Unknown Store").toUpperCase(),
          expectedTotalCents: 0,
          actualTotalCents: 0,
          denomTotalCents: 0,
          denoms: { "1": 0, "2": 0, "5": 0, "10": 0, "20": 0, "50": 0, "100": 0 },
        });
      }
      const summary = byStore.get(key)!;
      summary.expectedTotalCents += row.expected_deposit_cents;
      summary.actualTotalCents += row.actual_deposit_cents;
      summary.denomTotalCents += row.denom_total_cents;
      summary.denoms["1"] += Number(row.denoms_jsonb?.["1"] ?? 0);
      summary.denoms["2"] += Number(row.denoms_jsonb?.["2"] ?? 0);
      summary.denoms["5"] += Number(row.denoms_jsonb?.["5"] ?? 0);
      summary.denoms["10"] += Number(row.denoms_jsonb?.["10"] ?? 0);
      summary.denoms["20"] += Number(row.denoms_jsonb?.["20"] ?? 0);
      summary.denoms["50"] += Number(row.denoms_jsonb?.["50"] ?? 0);
      summary.denoms["100"] += Number(row.denoms_jsonb?.["100"] ?? 0);
    }

    return Array.from(byStore.values()).sort((a, b) => a.storeName.localeCompare(b.storeName));
  }, [filteredRows]);

  async function copyText(text: string, successMsg: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast(successMsg);
    } catch {
      setToast("Copy failed.");
    }
  }

  function buildSalesTsv() {
    const orderedRows = [...filteredRows].sort((a, b) => a.business_date.localeCompare(b.business_date));
    const lines: string[] = [];
    for (const row of orderedRows) {
      lines.push(`${weekdayLabel(row.business_date)}\t${(row.cash_sales_cents / 100).toFixed(2)}\t${(row.card_sales_cents / 100).toFixed(2)}`);
    }
    return lines.join("\n");
  }

  function buildDenomTsv() {
    const keys: Array<"1" | "5" | "10" | "20" | "50" | "100"> = ["1", "5", "10", "20", "50", "100"];
    const totals: Record<string, number> = { "1": 0, "5": 0, "10": 0, "20": 0, "50": 0, "100": 0 };
    for (const row of filteredRows) {
      for (const key of keys) {
        totals[key] += Number(row.denoms_jsonb?.[key] ?? 0);
      }
    }
    const lines = ["NOTE\tQTY"];
    for (const key of keys) {
      lines.push(`${key}\t${totals[key]}`);
    }
    return lines.join("\n");
  }

  function applyQuickView() {
    if (quickViewMode === "month") {
      const today = new Date();
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      setFrom(toDateKey(monthStart));
      setTo(toDateKey(today));
      return;
    }

    const selectedRange = weekRanges.find((range) => range.value === selectedWeek) ?? weekRanges[0];
    setFrom(selectedRange.from);
    setTo(selectedRange.to);
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

  async function saveEdits() {
    if (!detail?.closeout?.id) return;

    const cashSalesCents = parseMoneyInputToCents(editForm.cashSales);
    const cardSalesCents = parseMoneyInputToCents(editForm.cardSales);
    const otherSalesCents = parseMoneyInputToCents(editForm.otherSales);
    const expectedDepositCents = parseMoneyInputToCents(editForm.expectedDeposit);
    const actualDepositCents = parseMoneyInputToCents(editForm.actualDeposit);
    const drawerCountCents = editForm.drawerCount.trim() ? parseMoneyInputToCents(editForm.drawerCount) : null;

    if (
      cashSalesCents == null ||
      cardSalesCents == null ||
      otherSalesCents == null ||
      expectedDepositCents == null ||
      actualDepositCents == null ||
      (editForm.drawerCount.trim() && drawerCountCents == null)
    ) {
      setError("Edit values must be valid non-negative dollar amounts.");
      return;
    }

    try {
      setSavingEdit(true);
      const token = await withToken();
      if (!token) return;

      const res = await fetch(`/api/admin/safe-ledger/${detail.closeout.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          status: editForm.status,
          cash_sales_cents: cashSalesCents,
          card_sales_cents: cardSalesCents,
          other_sales_cents: otherSalesCents,
          expected_deposit_cents: expectedDepositCents,
          actual_deposit_cents: actualDepositCents,
          drawer_count_cents: drawerCountCents,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to save closeout edits.");

      await Promise.all([loadRows(token), loadDetail(token, detail.closeout.id)]);
      setIsEditing(false);
      setToast("Closeout updated.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save closeout edits.");
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <div className="space-y-4 p-6 text-slate-100">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h1 className="text-2xl font-semibold">Safe Ledger Dashboard</h1>
        <div className="flex items-center gap-2">
          <Button className="bg-purple-600 text-white hover:bg-purple-700" onClick={() => void copyText(buildSalesTsv(), "Copied Sales TSV")}>Copy Sales TSV</Button>
          <Button className="bg-purple-600 text-white hover:bg-purple-700" onClick={() => void copyText(buildDenomTsv(), "Copied Denom TSV")}>Copy Denom TSV</Button>
        </div>
      </div>

      <div className="rounded-xl border border-cyan-400/30 bg-[#0b1220] p-4">
        <div className="grid gap-3 lg:grid-cols-4">
          <DatePicker label="Start Date" value={from} onChange={setFrom} max={to} />
          <DatePicker label="End Date" value={to} onChange={setTo} min={from} />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">Store</span>
            <select
              className="rounded-md border border-cyan-400/30 bg-slate-900/60 px-2 py-1.5"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
            >
              <option value="all">All Stores</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>{store.name}</option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">Quick View</span>
            <div className="flex items-center gap-2">
              <select
                className="rounded-md border border-cyan-400/30 bg-slate-900/60 px-2 py-1.5"
                value={quickViewMode}
                onChange={(e) => setQuickViewMode(e.target.value as "week" | "month")}
              >
                <option value="week">Weekly (Current Month)</option>
                <option value="month">Month to Date</option>
              </select>
              {quickViewMode === "week" && (
                <select
                  className="rounded-md border border-cyan-400/30 bg-slate-900/60 px-2 py-1.5"
                  value={selectedWeek}
                  onChange={(e) => setSelectedWeek(e.target.value)}
                >
                  {weekRanges.map((range) => (
                    <option key={range.value} value={range.value}>
                      {range.label}
                    </option>
                  ))}
                </select>
              )}
              <Button className="bg-purple-600 text-white hover:bg-purple-700" onClick={applyQuickView}>
                Apply
              </Button>
            </div>
          </div>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-200">
          <input type="checkbox" checked={showIssuesOnly} onChange={(e) => setShowIssuesOnly(e.target.checked)} />
          Show Issues Only
        </label>
      </div>
      <div className="rounded-xl border border-cyan-400/30 bg-[#0b1220] p-4">
        <div className="mb-3 text-sm font-semibold text-slate-200">Overall Store Reconciliation (Filtered Results)</div>
        {storeReconciliationSummaries.length === 0 ? (
          <div className="text-sm text-slate-400">No closeouts in current filter range.</div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {storeReconciliationSummaries.map((summary) => {
              const safeVariance = summary.denomTotalCents - summary.expectedTotalCents;
              return (
                <div key={summary.storeId} className="rounded border border-cyan-400/30 bg-slate-900/40 p-3">
                  <div className="mb-2 text-sm font-semibold text-cyan-200">{summary.storeName}</div>
                  <div className="grid gap-2 text-sm md:grid-cols-2">
                    <div>
                      <div className="text-xs uppercase text-slate-400">Expected Total</div>
                      <div>{money(summary.expectedTotalCents)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase text-slate-400">Actual Total</div>
                      <div>{money(summary.actualTotalCents)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase text-slate-400">Denomination Total</div>
                      <div>{money(summary.denomTotalCents)}</div>
                    </div>
                    <div className={`rounded border px-2 py-1 ${varianceTone(Math.abs(safeVariance))}`}>
                      <div className="text-xs uppercase">Variance (Denom vs Expected)</div>
                      <div className="font-semibold">{money(safeVariance)}</div>
                    </div>
                  </div>
                  <div className="mt-3 text-xs text-slate-300">
                    Denomination count: 1({summary.denoms["1"]}) 2({summary.denoms["2"]}) 5({summary.denoms["5"]}) 10({summary.denoms["10"]}) 20({summary.denoms["20"]}) 50({summary.denoms["50"]}) 100({summary.denoms["100"]})
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {error && <div className="rounded border border-red-400/50 bg-red-900/30 p-2 text-sm text-red-200">{error}</div>}
      {loading ? (
        <div className="rounded border border-cyan-400/30 bg-[#0b1220] p-4 text-sm text-slate-300">Loading safe ledger...</div>
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
                <TableHead>Edited By</TableHead>
                <TableHead>Date Edited</TableHead>
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
                  <TableCell>{row.edited_by_name ?? row.edited_by ?? "--"}</TableCell>
                  <TableCell>{row.edited_at ? new Date(row.edited_at).toLocaleString() : "--"}</TableCell>
                  <TableCell>
                    <Button variant="secondary" onClick={() => setSelectedId(row.id)}>View</Button>
                  </TableCell>
                </TableRow>
              ))}
              {filteredRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-slate-400">No closeouts for selected filters.</TableCell>
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
          {detail?.closeout?.is_historical_backfill && (
            <div className="rounded border border-sky-400/40 bg-sky-900/20 px-3 py-2 text-xs text-sky-200">
              Historical backfill row
            </div>
          )}
          {detailLoading || !detail ? (
            <div className="text-sm text-slate-300">Loading detail...</div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded border border-cyan-400/30 bg-slate-900/40 p-3 text-sm">
                  <div className="font-medium">Cash Sales</div>
                  {isEditing ? (
                    <input
                      className="mt-1 w-full rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1"
                      value={editForm.cashSales}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, cashSales: e.target.value }))}
                    />
                  ) : (
                    <div>{money(detail.closeout.cash_sales_cents)}</div>
                  )}
                </div>
                <div className="rounded border border-cyan-400/30 bg-slate-900/40 p-3 text-sm">
                  <div className="font-medium">Card Sales</div>
                  {isEditing ? (
                    <input
                      className="mt-1 w-full rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1"
                      value={editForm.cardSales}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, cardSales: e.target.value }))}
                    />
                  ) : (
                    <div>{money(detail.closeout.card_sales_cents)}</div>
                  )}
                </div>
                <div className="rounded border border-cyan-400/30 bg-slate-900/40 p-3 text-sm">
                  <div className="font-medium">Drawer Count (Float)</div>
                  {isEditing ? (
                    <input
                      className="mt-1 w-full rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1"
                      value={editForm.drawerCount}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, drawerCount: e.target.value }))}
                    />
                  ) : (
                    <div>{money(detail.closeout.drawer_count_cents)}</div>
                  )}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded border border-cyan-400/30 bg-slate-900/40 p-3 text-sm">
                  <div className="font-medium">Other Sales</div>
                  {isEditing ? (
                    <input
                      className="mt-1 w-full rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1"
                      value={editForm.otherSales}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, otherSales: e.target.value }))}
                    />
                  ) : (
                    <div>{money(detail.closeout.other_sales_cents)}</div>
                  )}
                </div>
                <div className="rounded border border-cyan-400/30 bg-slate-900/40 p-3 text-sm">
                  <div className="font-medium">Edited By</div>
                  <div>{detail.closeout.edited_by_name ?? detail.closeout.edited_by ?? "--"}</div>
                </div>
                <div className="rounded border border-cyan-400/30 bg-slate-900/40 p-3 text-sm">
                  <div className="font-medium">Date Edited</div>
                  <div>{detail.closeout.edited_at ? new Date(detail.closeout.edited_at).toLocaleString() : "--"}</div>
                </div>
              </div>

              <div className="rounded border border-cyan-400/30 bg-slate-900/40 p-3 text-sm">
                <div className="mb-2 font-medium">Expenses</div>
                {detail.expenses.length === 0 ? (
                  <div className="text-slate-400">No expenses.</div>
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
                <div className="rounded border border-cyan-400/30 bg-slate-900/40 p-3 text-sm">
                  <div className="font-medium">Expected Deposit</div>
                  {isEditing ? (
                    <input
                      className="mt-1 w-full rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1"
                      value={editForm.expectedDeposit}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, expectedDeposit: e.target.value }))}
                    />
                  ) : (
                    <div>{money(detail.closeout.expected_deposit_cents)}</div>
                  )}
                </div>
                <div className="rounded border border-cyan-400/30 bg-slate-900/40 p-3 text-sm">
                  <div className="font-medium">Actual Deposit</div>
                  {isEditing ? (
                    <input
                      className="mt-1 w-full rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1"
                      value={editForm.actualDeposit}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, actualDeposit: e.target.value }))}
                    />
                  ) : (
                    <div>{money(detail.closeout.actual_deposit_cents)}</div>
                  )}
                </div>
              </div>
              {isEditing && (
                <div className="rounded border border-cyan-400/30 bg-slate-900/40 p-3 text-sm">
                  <div className="font-medium">Status</div>
                  <select
                    className="mt-1 w-full rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1"
                    value={editForm.status}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, status: e.target.value }))}
                  >
                    <option value="pass">PASS</option>
                    <option value="warn">WARN</option>
                    <option value="fail">FAIL</option>
                    <option value="draft">DRAFT</option>
                  </select>
                </div>
              )}

              <div className="rounded border border-cyan-400/30 bg-slate-900/40 p-3 text-sm">
                <div className="mb-2 font-medium">Evidence</div>
                {detail.photos.length === 0 ? (
                  <div className="text-slate-400">No photos uploaded.</div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {detail.photos.map((photo) => (
                      <div key={photo.id} className="space-y-1">
                        <div className="text-xs uppercase text-slate-400">{photo.photo_type.replace("_", " ")}</div>
                        {photo.signed_url ? (
                          <img src={photo.signed_url} alt={photo.photo_type} className="h-48 w-full rounded border border-cyan-400/30 object-cover" />
                        ) : (
                          <div className="rounded border border-cyan-400/30 p-3 text-xs text-slate-400">Photo unavailable.</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <Button className="border border-cyan-400/40 bg-slate-900/60 text-slate-100 hover:bg-slate-800" onClick={() => setSelectedId(null)}>Close</Button>
                {isEditing ? (
                  <>
                    <Button className="bg-slate-700 text-slate-100 hover:bg-slate-600" onClick={() => setIsEditing(false)} disabled={savingEdit}>
                      Cancel Edit
                    </Button>
                    <Button className="bg-purple-600 text-white hover:bg-purple-700" onClick={() => void saveEdits()} disabled={savingEdit}>
                      {savingEdit ? "Saving..." : "Save Edit"}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button className="bg-purple-600 text-white hover:bg-purple-700" onClick={() => setIsEditing(true)}>
                      Edit
                    </Button>
                    <Button className="bg-emerald-500 text-black hover:bg-emerald-400" onClick={() => void markReviewed()} disabled={reviewing}>
                      {reviewing ? "Saving..." : "Mark as Reviewed"}
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {toast && (
        <div className="fixed right-4 top-4 z-50 rounded border border-cyan-400/40 bg-[#0b1220] px-3 py-2 text-sm text-slate-100 shadow">
          {toast}
        </div>
      )}
    </div>
  );
}
