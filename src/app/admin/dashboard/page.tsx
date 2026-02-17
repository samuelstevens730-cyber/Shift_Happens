"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  MessageSquare,
  Send,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DashboardActionItem, DashboardResponse } from "@/types/adminDashboard";

function cstDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function dateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return cstDateKey(date);
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function shortMoney(cents: number): string {
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1000000) return `$${(dollars / 1000000).toFixed(1)}M`;
  if (Math.abs(dollars) >= 1000) return `$${(dollars / 1000).toFixed(1)}k`;
  return `$${dollars.toFixed(0)}`;
}

function buildYAxisTicks(maxValueCents: number, stepCents: number): number[] {
  const safeMax = Math.max(0, maxValueCents);
  const roundedMax = Math.ceil(safeMax / stepCents) * stepCents;
  const domainMax = Math.max(stepCents * 2, roundedMax + stepCents);
  const ticks: number[] = [];
  for (let value = 0; value <= domainMax; value += stepCents) {
    ticks.push(value);
  }
  return ticks;
}

function weekdayLabel(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00`);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
  })
    .format(date)
    .toUpperCase();
}

function gradeTone(grade: "A" | "B" | "C" | "D" | undefined) {
  if (grade === "A") return "border-emerald-500/60 bg-emerald-950/20 text-emerald-200";
  if (grade === "B") return "border-sky-500/60 bg-sky-950/20 text-sky-200";
  if (grade === "C") return "border-amber-500/60 bg-amber-950/20 text-amber-200";
  return "border-red-500/60 bg-red-950/20 text-red-200";
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [storeId, setStoreId] = useState<string>("all");
  const [from, setFrom] = useState<string>(() => dateDaysAgo(6));
  const [to, setTo] = useState<string>(() => cstDateKey(new Date()));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [isMobileChart, setIsMobileChart] = useState(false);
  const [chartMode, setChartMode] = useState<"total" | "detailed">("detailed");
  const [actionOpen, setActionOpen] = useState(true);
  const [actionFilter, setActionFilter] = useState<"all" | "people" | "money" | "scheduling" | "approvals">("all");
  const [quickViewItem, setQuickViewItem] = useState<DashboardActionItem | null>(null);
  const [users, setUsers] = useState<Array<{ id: string; name: string; active: boolean; storeIds: string[] }>>([]);
  const [sendingAssignment, setSendingAssignment] = useState(false);
  const [quickSend, setQuickSend] = useState<{
    type: "task" | "message";
    targetType: "store" | "employee";
    targetStoreId: string;
    targetProfileId: string;
    message: string;
  }>({
    type: "message",
    targetType: "store",
    targetStoreId: "",
    targetProfileId: "",
    message: "",
  });

  const topline = useMemo(() => {
    if (!data) {
      return { totalSales: 0, cashSales: 0, cardSales: 0, otherSales: 0, closeoutStatus: null as string | null, closeoutVariance: 0 };
    }
    const rows =
      storeId === "all"
        ? Object.values(data.topline)
        : [data.topline[storeId]].filter((row): row is NonNullable<typeof row> => Boolean(row));

    return rows.reduce(
      (acc, row) => ({
        totalSales: acc.totalSales + row.totalSales,
        cashSales: acc.cashSales + row.cashSales,
        cardSales: acc.cardSales + row.cardSales,
        otherSales: acc.otherSales + row.otherSales,
        closeoutStatus: row.closeoutStatus ?? acc.closeoutStatus,
        closeoutVariance: acc.closeoutVariance + row.closeoutVariance,
      }),
      { totalSales: 0, cashSales: 0, cardSales: 0, otherSales: 0, closeoutStatus: null as string | null, closeoutVariance: 0 }
    );
  }, [data, storeId]);

  const visibleStores = useMemo(() => {
    if (!data) return [];
    if (storeId === "all") return data.stores;
    return data.stores.filter((store) => store.id === storeId);
  }, [data, storeId]);

  const actionRows = useMemo(() => {
    if (!data) return [];
    const labels: Record<string, string> = {
      people: "People",
      money: "Money",
      scheduling: "Scheduling",
      approvals: "Approvals",
    };
    return (Object.entries(data.actions) as Array<[keyof DashboardResponse["actions"], DashboardActionItem[]]>).flatMap(
      ([category, items]) =>
        items.map((item) => ({
          ...item,
          categoryLabel: labels[category],
        }))
    );
  }, [data]);

  const filteredActionRows = useMemo(() => {
    if (actionFilter === "all") return actionRows;
    return actionRows.filter((item) => item.category === actionFilter);
  }, [actionFilter, actionRows]);

  const actionCountsTotal = useMemo(() => {
    if (!data) return 0;
    return (
      (data.actionCounts.people ?? 0) +
      (data.actionCounts.money ?? 0) +
      (data.actionCounts.scheduling ?? 0) +
      (data.actionCounts.approvals ?? 0)
    );
  }, [data]);

  const salesRows = useMemo(() => {
    if (!data) return [];
    const storeNameById = new Map(data.stores.map((store) => [store.id, store.name]));
    const rows: Array<{
      date: string;
      storeId: string;
      storeName: string;
      cash: number;
      card: number;
      other: number;
      total: number;
      status: string;
    }> = [];
    const targetStoreIds = storeId === "all" ? data.stores.map((store) => store.id) : [storeId];

    for (const sid of targetStoreIds) {
      const historyRows = data.salesHistory[sid] ?? [];
      for (const row of historyRows) {
        rows.push({
          date: row.date,
          storeId: sid,
          storeName: storeNameById.get(sid) ?? "Unknown Store",
          cash: row.cash,
          card: row.card,
          other: row.other,
          total: row.total,
          status: row.status,
        });
      }
    }

    return rows.sort((a, b) => {
      const dateCmp = b.date.localeCompare(a.date);
      if (dateCmp !== 0) return dateCmp;
      return a.storeName.localeCompare(b.storeName);
    });
  }, [data, storeId]);

  const tableTotals = useMemo(
    () =>
      salesRows.reduce(
        (acc, row) => ({
          cash: acc.cash + row.cash,
          card: acc.card + row.card,
          other: acc.other + row.other,
          total: acc.total + row.total,
        }),
        { cash: 0, card: 0, other: 0, total: 0 }
      ),
    [salesRows]
  );

  const chartData = useMemo(() => {
    if (!data) return [];
    const storeNameById = new Map(data.stores.map((store) => [store.id, store.name]));
    const targetStoreIds = storeId === "all" ? data.stores.map((store) => store.id) : [storeId];
    const byDate = new Map<string, Record<string, number | string>>();

    for (const sid of targetStoreIds) {
      const rows = data.salesHistory[sid] ?? [];
      const safeKey = `store_${sid.replace(/-/g, "_")}`;
      for (const row of rows) {
        const existing = byDate.get(row.date) ?? {
          date: row.date.slice(5),
          total: 0,
          cash: 0,
          card: 0,
        };
        existing.total = Number(existing.total) + row.total;
        existing.cash = Number(existing.cash) + row.cash;
        existing.card = Number(existing.card) + row.card;
        existing[safeKey] = row.total;
        existing[`${safeKey}_label`] = storeNameById.get(sid) ?? sid;
        byDate.set(row.date, existing);
      }
    }

    return Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, value]) => value);
  }, [data, storeId]);

  const chartYAxis = useMemo(() => {
    const tickStepCents = 50000; // $500 standardized increments
    if (!data) {
      const fallbackTicks = buildYAxisTicks(0, tickStepCents);
      return { domainMax: fallbackTicks.at(-1) ?? 100000, ticks: fallbackTicks };
    }

    let maxValue = 0;
    const totalByDate = new Map<string, number>();
    for (const store of data.stores) {
      const rows = data.salesHistory[store.id] ?? [];
      for (const row of rows) {
        maxValue = Math.max(maxValue, row.total, row.cash, row.card, row.other);
        totalByDate.set(row.date, (totalByDate.get(row.date) ?? 0) + row.total);
      }
    }
    for (const total of totalByDate.values()) {
      maxValue = Math.max(maxValue, total);
    }

    const ticks = buildYAxisTicks(maxValue, tickStepCents);
    return { domainMax: ticks.at(-1) ?? tickStepCents * 2, ticks };
  }, [data]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const { data: auth } = await supabase.auth.getSession();
        const token = auth.session?.access_token ?? "";
        if (!token) {
          router.replace("/login?next=/admin/dashboard");
          return;
        }

        const qs = new URLSearchParams({ from, to, storeId });
        const res = await fetch(`/api/admin/dashboard?${qs.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Failed to load dashboard.");
        if (!alive) return;
        setData(json as DashboardResponse);

        const usersRes = await fetch("/api/admin/users", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const usersJson = await usersRes.json();
        if (!usersRes.ok) throw new Error(usersJson?.error || "Failed to load dashboard users.");
        if (!alive) return;
        setUsers((usersJson?.users ?? []) as Array<{ id: string; name: string; active: boolean; storeIds: string[] }>);
      } catch (e: unknown) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load dashboard.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [from, to, storeId, router]);

  useEffect(() => {
    if (!data) return;
    setQuickSend((prev) => ({
      ...prev,
      targetStoreId: prev.targetStoreId || data.stores[0]?.id || "",
    }));
  }, [data]);

  useEffect(() => {
    const onResize = () => setIsMobileChart(window.innerWidth < 640);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const visibleUsers = useMemo(() => {
    if (storeId === "all") return users.filter((u) => u.active);
    return users.filter((u) => u.active && u.storeIds.includes(storeId));
  }, [users, storeId]);

  const selectedStoreLabel = useMemo(() => {
    if (storeId === "all") return "All Stores";
    return data?.stores.find((store) => store.id === storeId)?.name ?? "Selected Store";
  }, [data, storeId]);

  async function sendQuickAssignment() {
    try {
      if (!quickSend.message.trim()) {
        setError("Quick Send message is required.");
        return;
      }
      if (quickSend.targetType === "store" && !quickSend.targetStoreId) {
        setError("Select a store target.");
        return;
      }
      if (quickSend.targetType === "employee" && !quickSend.targetProfileId) {
        setError("Select an employee target.");
        return;
      }

      setSendingAssignment(true);
      setError(null);
      const { data: auth } = await supabase.auth.getSession();
      const token = auth.session?.access_token ?? "";
      if (!token) {
        router.replace("/login?next=/admin/dashboard");
        return;
      }

      const res = await fetch("/api/admin/assignments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          type: quickSend.type,
          message: quickSend.message.trim(),
          targetStoreId: quickSend.targetType === "store" ? quickSend.targetStoreId : undefined,
          targetProfileId: quickSend.targetType === "employee" ? quickSend.targetProfileId : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to send assignment.");
      setQuickSend((prev) => ({ ...prev, message: "" }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to send assignment.");
    } finally {
      setSendingAssignment(false);
    }
  }

  function actionDestination(item: DashboardActionItem): string {
    switch (item.category) {
      case "people":
        return "/admin/overrides";
      case "money":
        return "/admin/safe-ledger";
      case "scheduling":
        return "/admin/open-shifts";
      case "approvals":
        return "/admin/requests";
      default:
        return "/admin";
    }
  }

  function actionButtonLabel(item: DashboardActionItem): string {
    switch (item.category) {
      case "people":
        return "Review Shift";
      case "money":
        return "Review Closeout";
      case "scheduling":
        return "Review Scheduling";
      case "approvals":
        return "Approve / Deny";
      default:
        return "Open";
    }
  }

  return (
    <div className="app-shell p-3 sm:p-4 lg:p-6">
      <div className="mx-auto w-full max-w-[1600px] space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">Command Center</h1>
            <p className="text-sm text-slate-400">Daily operations snapshot across your stores.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/admin" className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">
              Back to Admin Hub
            </Link>
          </div>
        </div>

        <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
          <Card>
            <CardHeader className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle>Filters</CardTitle>
                  <CardDescription>{from} to {to} Â· {selectedStoreLabel}</CardDescription>
                </div>
                <CollapsibleTrigger className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">
                  {filtersOpen ? "Hide" : "Expand"}
                </CollapsibleTrigger>
              </div>
            </CardHeader>
            <CollapsibleContent>
              <Separator />
              <CardContent className="pt-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="flex flex-col gap-1 text-sm text-slate-300">
                    Start Date
                    <input
                      type="date"
                      className="h-10 rounded-md border border-slate-700 bg-slate-900 px-3 text-slate-100"
                      value={from}
                      max={to}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-slate-300">
                    End Date
                    <input
                      type="date"
                      className="h-10 rounded-md border border-slate-700 bg-slate-900 px-3 text-slate-100"
                      value={to}
                      min={from}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </label>
                  <div className="flex flex-col gap-1 text-sm text-slate-300">
                    <span>Store</span>
                    <Select value={storeId} onValueChange={setStoreId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select store" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Stores</SelectItem>
                        {(data?.stores ?? []).map((store) => (
                          <SelectItem key={store.id} value={store.id}>
                            {store.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {error && (
          <Card className="border-red-500/40">
            <CardContent className="pt-4 text-sm text-red-300">{error}</CardContent>
          </Card>
        )}

        {loading ? (
          <Card>
            <CardContent className="pt-4 text-sm text-slate-300">Loading dashboard...</CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-cyan-300" /> Yesterday Sales</CardDescription>
                  <CardTitle>{money(topline.totalSales)}</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-slate-400">
                  Cash {money(topline.cashSales)} Â· Card {money(topline.cardSales)} Â· Other {money(topline.otherSales)}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-2"><Wallet className="h-4 w-4 text-emerald-300" /> Yesterday Closeout</CardDescription>
                  <CardTitle>{topline.closeoutStatus ? topline.closeoutStatus.toUpperCase() : "N/A"}</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-slate-400">
                  Variance: {money(topline.closeoutVariance)}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-amber-300" /> Open Shifts</CardDescription>
                  <CardTitle>{data?.openShifts ?? 0}</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-slate-400">Currently started and not ended.</CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-sky-300" /> Pending Approvals</CardDescription>
                  <CardTitle>{data?.pendingApprovals ?? 0}</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-slate-400">Swaps, time-off, and timesheet corrections.</CardContent>
              </Card>
            </section>

            <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5 text-cyan-300" /> Sales Block</CardTitle>
                    <CardDescription>Sales by date for selected store scope and date range.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Tabs defaultValue="table" className="w-full">
                      <TabsList>
                        <TabsTrigger value="table">Table</TabsTrigger>
                        <TabsTrigger value="chart">Chart</TabsTrigger>
                      </TabsList>
                      <TabsContent value="table">
                        <div className="max-h-[320px] overflow-auto rounded border border-slate-800">
                          <table className="min-w-full text-sm">
                            <thead className="sticky top-0 bg-slate-900 text-slate-300">
                              <tr>
                                <th className="px-3 py-2 text-left">Date</th>
                                <th className="px-3 py-2 text-left">Store</th>
                                <th className="px-3 py-2 text-left">Day</th>
                                <th className="px-3 py-2 text-right">Cash</th>
                                <th className="px-3 py-2 text-right">Card</th>
                                <th className="px-3 py-2 text-right">Other</th>
                                <th className="px-3 py-2 text-right">Total</th>
                                <th className="px-3 py-2 text-left">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {salesRows.map((row) => (
                                <tr key={`${row.date}-${row.storeId}`} className="border-t border-slate-800 text-slate-100">
                                  <td className="px-3 py-2">{row.date}</td>
                                  <td className="px-3 py-2">{row.storeName}</td>
                                  <td className="px-3 py-2">{weekdayLabel(row.date)}</td>
                                  <td className="px-3 py-2 text-right">{money(row.cash)}</td>
                                  <td className="px-3 py-2 text-right">{money(row.card)}</td>
                                  <td className="px-3 py-2 text-right">{money(row.other)}</td>
                                  <td className="px-3 py-2 text-right font-semibold">{money(row.total)}</td>
                                  <td className="px-3 py-2">
                                    <Badge
                                      variant={
                                        row.status === "fail"
                                          ? "destructive"
                                          : row.status === "warn"
                                            ? "outline"
                                            : "secondary"
                                      }
                                    >
                                      {row.status.toUpperCase()}
                                    </Badge>
                                  </td>
                                </tr>
                              ))}
                              {salesRows.length === 0 ? (
                                <tr>
                                  <td colSpan={8} className="px-3 py-4 text-center text-slate-400">
                                    No sales rows in selected range.
                                  </td>
                                </tr>
                              ) : null}
                              {salesRows.length > 0 ? (
                                <tr className="border-t-2 border-cyan-700/50 bg-slate-900/80 text-slate-100">
                                  <td className="px-3 py-2 font-semibold">TOTAL</td>
                                  <td className="px-3 py-2 text-slate-400">{storeId === "all" ? "All Stores" : "Selected Store"}</td>
                                  <td className="px-3 py-2 text-slate-400">--</td>
                                  <td className="px-3 py-2 text-right font-semibold">{money(tableTotals.cash)}</td>
                                  <td className="px-3 py-2 text-right font-semibold">{money(tableTotals.card)}</td>
                                  <td className="px-3 py-2 text-right font-semibold">{money(tableTotals.other)}</td>
                                  <td className="px-3 py-2 text-right font-bold">{money(tableTotals.total)}</td>
                                  <td className="px-3 py-2 text-slate-400">--</td>
                                </tr>
                              ) : null}
                            </tbody>
                          </table>
                        </div>
                      </TabsContent>
                      <TabsContent value="chart">
                        <div className="rounded border border-slate-800 bg-slate-900/60 p-3">
                          <div className="mb-3 flex justify-end">
                            <Select value={chartMode} onValueChange={(value) => setChartMode(value as "total" | "detailed")}>
                              <SelectTrigger className="w-[220px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="detailed">Detailed View</SelectItem>
                                <SelectItem value="total">Total Only</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          {chartData.length === 0 ? (
                            <div className="py-8 text-center text-sm text-slate-400">
                              No chart data in selected range.
                            </div>
                          ) : (
                            <div className="h-[320px] w-full">
                              <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                  <defs>
                                    <linearGradient id="totalGradient" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.35} />
                                      <stop offset="100%" stopColor="#22d3ee" stopOpacity={0.02} />
                                    </linearGradient>
                                  </defs>
                                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                                  <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 12 }} axisLine={{ stroke: "#334155" }} tickLine={{ stroke: "#334155" }} />
                                  <YAxis
                                    tickFormatter={(value) => shortMoney(Number(value))}
                                    tick={{ fill: "#94a3b8", fontSize: isMobileChart ? 11 : 12 }}
                                    axisLine={{ stroke: "#334155" }}
                                    tickLine={{ stroke: "#334155" }}
                                    width={isMobileChart ? 42 : 70}
                                    domain={[0, chartYAxis.domainMax]}
                                    ticks={chartYAxis.ticks}
                                  />
                                  <Tooltip
                                    contentStyle={{
                                      backgroundColor: "#0f172a",
                                      border: "1px solid #334155",
                                      borderRadius: 10,
                                      color: "#e2e8f0",
                                    }}
                                    formatter={(value) => money(Number(value ?? 0))}
                                  />
                                  <Legend wrapperStyle={{ color: "#cbd5e1" }} />
                                  <Area
                                    type="monotone"
                                    dataKey="total"
                                    name="Total"
                                    stroke="#22d3ee"
                                    fill="url(#totalGradient)"
                                    strokeWidth={2}
                                  />
                                  {chartMode === "detailed" ? (
                                    storeId === "all" ? (
                                      (data?.stores ?? []).map((store, idx) => {
                                        const key = `store_${store.id.replace(/-/g, "_")}`;
                                        const colors = ["#34d399", "#a78bfa", "#f59e0b", "#f43f5e", "#60a5fa"];
                                        return (
                                          <Line
                                            key={store.id}
                                            type="monotone"
                                            dataKey={key}
                                            name={store.name}
                                            stroke={colors[idx % colors.length]}
                                            strokeWidth={2.2}
                                            dot={false}
                                          />
                                        );
                                      })
                                    ) : (
                                      <>
                                        <Line type="monotone" dataKey="cash" name="Cash" stroke="#34d399" strokeWidth={2} dot={false} />
                                        <Line type="monotone" dataKey="card" name="Card" stroke="#a78bfa" strokeWidth={2} dot={false} />
                                      </>
                                    )
                                  ) : null}
                                </ComposedChart>
                              </ResponsiveContainer>
                            </div>
                          )}
                        </div>
                      </TabsContent>
                    </Tabs>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2"><MessageSquare className="h-5 w-5 text-violet-300" /> Quick Send: Message / Task</CardTitle>
                    <CardDescription>Send a task or message to a store or an individual employee.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5">
                      <div className="flex flex-col gap-1 text-sm text-slate-300">
                        <span>Type</span>
                        <Select value={quickSend.type} onValueChange={(value) => setQuickSend((prev) => ({ ...prev, type: value as "task" | "message" }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="message">Message</SelectItem>
                            <SelectItem value="task">Task</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex flex-col gap-1 text-sm text-slate-300">
                        <span>Target Type</span>
                        <Select value={quickSend.targetType} onValueChange={(value) => setQuickSend((prev) => ({ ...prev, targetType: value as "store" | "employee" }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="store">Store</SelectItem>
                            <SelectItem value="employee">Employee</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {quickSend.targetType === "store" ? (
                        <div className="flex flex-col gap-1 text-sm text-slate-300">
                          <span>Store</span>
                          <Select value={quickSend.targetStoreId} onValueChange={(value) => setQuickSend((prev) => ({ ...prev, targetStoreId: value }))}>
                            <SelectTrigger><SelectValue placeholder="Select store" /></SelectTrigger>
                            <SelectContent>
                              {(data?.stores ?? []).map((store) => (
                                <SelectItem key={store.id} value={store.id}>{store.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1 text-sm text-slate-300">
                          <span>Employee</span>
                          <Select value={quickSend.targetProfileId} onValueChange={(value) => setQuickSend((prev) => ({ ...prev, targetProfileId: value }))}>
                            <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                            <SelectContent>
                              {visibleUsers.map((user) => (
                                <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      <div className="md:col-span-2 lg:col-span-2 flex flex-col gap-1 text-sm text-slate-300">
                        <span>Message / Task Details</span>
                        <textarea
                          className="min-h-[42px] rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100"
                          value={quickSend.message}
                          onChange={(e) => setQuickSend((prev) => ({ ...prev, message: e.target.value }))}
                          placeholder="Type what should be done or communicated..."
                        />
                      </div>
                    </div>
                    <div className="mt-3 flex justify-end">
                      <button
                        className="inline-flex items-center gap-2 rounded-md bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-60"
                        onClick={() => void sendQuickAssignment()}
                        disabled={sendingAssignment}
                      >
                        <Send className="h-4 w-4" />
                        {sendingAssignment ? "Sending..." : "Send"}
                      </button>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-4 lg:col-span-1">
                <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5 text-cyan-300" /> Store Health</CardTitle>
                  <CardDescription>Weighted score model (Option B) with top drag signals.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-2">
                    {visibleStores.map((store) => {
                      const health = data?.health[store.id];
                      const tone = gradeTone(health?.grade);
                      return (
                        <div key={store.id} className={`rounded-lg border p-2.5 ${tone}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-medium text-slate-100">{store.name}</div>
                              <div className="text-xs text-slate-400">Score: {health?.score ?? 0}</div>
                            </div>
                            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-current/40 text-2xl font-bold">
                              {health?.grade ?? "D"}
                            </div>
                          </div>
                          <div className="mt-2 text-[11px] font-medium uppercase tracking-wide text-slate-300">
                            What's Dragging Grade
                          </div>
                          <div className="mt-1.5 space-y-1.5">
                            {(health?.signals ?? []).slice(0, 2).map((signal) => (
                              <div key={signal.name} className="text-xs">
                                <div className="mb-1 flex items-center justify-between text-slate-200">
                                  <span>{signal.name}</span>
                                  <span>{signal.score}/{signal.maxScore}</span>
                                </div>
                                <div className="h-1.5 w-full rounded bg-slate-800">
                                  <div
                                    className="h-1.5 rounded bg-current/70"
                                    style={{ width: `${Math.max(0, Math.min(100, (signal.score / signal.maxScore) * 100))}%` }}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
                </Card>
                <Card className="h-[400px]">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-300" /> Immediate Action Items</CardTitle>
                    <CardDescription>Filter a bucket and jump straight to the fix path.</CardDescription>
                  </CardHeader>
                  <CardContent className="h-[calc(100%-80px)] overflow-y-auto">
                    <Collapsible open={actionOpen} onOpenChange={setActionOpen}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => setActionFilter("all")} className="cursor-pointer">
                            <Badge variant={actionFilter === "all" ? "default" : "outline"}>All: {actionCountsTotal}</Badge>
                          </button>
                          <button onClick={() => setActionFilter("people")} className="cursor-pointer">
                            <Badge variant={actionFilter === "people" ? "destructive" : "secondary"}>People: {data?.actionCounts.people ?? 0}</Badge>
                          </button>
                          <button onClick={() => setActionFilter("money")} className="cursor-pointer">
                            <Badge variant={actionFilter === "money" ? "default" : "secondary"}>Money: {data?.actionCounts.money ?? 0}</Badge>
                          </button>
                          <button onClick={() => setActionFilter("scheduling")} className="cursor-pointer">
                            <Badge variant={actionFilter === "scheduling" ? "default" : "secondary"}>Scheduling: {data?.actionCounts.scheduling ?? 0}</Badge>
                          </button>
                          <button onClick={() => setActionFilter("approvals")} className="cursor-pointer">
                            <Badge variant={actionFilter === "approvals" ? "default" : "secondary"}>Approvals: {data?.actionCounts.approvals ?? 0}</Badge>
                          </button>
                        </div>
                        <CollapsibleTrigger className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">
                          {actionOpen ? "Collapse" : "Expand"}
                        </CollapsibleTrigger>
                      </div>
                      <CollapsibleContent>
                        <Separator className="my-3" />
                        <div className="space-y-2 lg:max-h-[320px] lg:overflow-y-auto">
                          {filteredActionRows.length === 0 ? (
                            <div className="rounded border border-slate-800 bg-slate-900/60 p-2 text-xs text-slate-400">
                              No immediate action items.
                            </div>
                          ) : (
                            filteredActionRows.map((item) => (
                              <button
                                key={item.id}
                                className="w-full rounded border border-slate-800 bg-slate-900/60 p-2 text-left hover:bg-slate-800/70"
                                onClick={() => setQuickViewItem(item)}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-sm font-medium text-slate-100">{item.title}</div>
                                  <Badge variant={item.severity === "high" ? "destructive" : "outline"}>
                                    {item.severity.toUpperCase()}
                                  </Badge>
                                </div>
                                <div className="mt-1 text-xs text-slate-400">
                                  {item.categoryLabel} · {item.description}
                                </div>
                                <div className="mt-2 flex justify-end gap-2">
                                  <Link
                                    href={actionDestination(item)}
                                    className="rounded border border-cyan-700/60 px-2 py-1 text-xs text-cyan-300 hover:bg-cyan-900/20"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {actionButtonLabel(item)}
                                  </Link>
                                </div>
                              </button>
                            ))
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </CardContent>
                </Card>
              </div>
            </section>
          </div>
        )}
      </div>

      <Dialog open={Boolean(quickViewItem)} onOpenChange={(open) => !open && setQuickViewItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Quick View (Stub)</DialogTitle>
            <DialogDescription>This will become the unified action drilldown in Phase 2.</DialogDescription>
          </DialogHeader>
            {quickViewItem ? (
              <div className="space-y-2 text-sm text-slate-200">
                <div><span className="text-slate-400">Title:</span> {quickViewItem.title}</div>
                <div><span className="text-slate-400">Category:</span> {quickViewItem.category}</div>
                <div><span className="text-slate-400">Severity:</span> {quickViewItem.severity}</div>
                <div><span className="text-slate-400">Details:</span> {quickViewItem.description}</div>
                <div><span className="text-slate-400">Store ID:</span> {quickViewItem.store_id ?? "N/A"}</div>
                <div><span className="text-slate-400">Created:</span> {quickViewItem.created_at ?? "N/A"}</div>
                <div className="pt-2">
                  <Link
                    href={actionDestination(quickViewItem)}
                    className="inline-flex rounded border border-cyan-700/60 px-2 py-1 text-xs text-cyan-300 hover:bg-cyan-900/20"
                  >
                    {actionButtonLabel(quickViewItem)}
                  </Link>
                </div>
              </div>
            ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

