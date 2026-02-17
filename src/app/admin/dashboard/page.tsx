"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
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
  const [actionOpen, setActionOpen] = useState(true);
  const [quickViewItem, setQuickViewItem] = useState<DashboardActionItem | null>(null);

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

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Filters</CardTitle>
            <CardDescription>Desktop stays dense; mobile stacks vertically in priority order.</CardDescription>
          </CardHeader>
          <CardContent>
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
        </Card>

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
                  <CardDescription>Yesterday Sales</CardDescription>
                  <CardTitle>{money(topline.totalSales)}</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-slate-400">
                  Cash {money(topline.cashSales)} · Card {money(topline.cardSales)} · Other {money(topline.otherSales)}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Yesterday Closeout</CardDescription>
                  <CardTitle>{topline.closeoutStatus ? topline.closeoutStatus.toUpperCase() : "N/A"}</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-slate-400">
                  Variance: {money(topline.closeoutVariance)}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Open Shifts</CardDescription>
                  <CardTitle>{data?.openShifts ?? 0}</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-slate-400">Currently started and not ended.</CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Pending Approvals</CardDescription>
                  <CardTitle>{data?.pendingApprovals ?? 0}</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-slate-400">Swaps, time-off, and timesheet corrections.</CardContent>
              </Card>
            </section>

            <section className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <Card className="lg:col-span-12">
                <CardHeader className="pb-2">
                  <CardTitle>Store Health</CardTitle>
                  <CardDescription>Weighted score model (Option B) with top drag signals.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {visibleStores.map((store) => {
                      const health = data?.health[store.id];
                      const tone = gradeTone(health?.grade);
                      return (
                        <div key={store.id} className={`rounded-lg border p-3 ${tone}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-medium text-slate-100">{store.name}</div>
                              <div className="text-xs text-slate-400">Score: {health?.score ?? 0}</div>
                            </div>
                            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-current/40 text-2xl font-bold">
                              {health?.grade ?? "D"}
                            </div>
                          </div>
                          <div className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-300">
                            What's Dragging Grade
                          </div>
                          <div className="mt-2 space-y-1.5">
                            {(health?.signals ?? []).map((signal) => (
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

              <Card className="lg:col-span-5">
                <CardHeader className="pb-2">
                  <CardTitle>Immediate Action Items</CardTitle>
                  <CardDescription>Priority buckets, quick triage, and drilldown in next phase.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Collapsible open={actionOpen} onOpenChange={setActionOpen}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="destructive">People: {data?.actionCounts.people ?? 0}</Badge>
                        <Badge variant="secondary">Money: {data?.actionCounts.money ?? 0}</Badge>
                        <Badge variant="secondary">Scheduling: {data?.actionCounts.scheduling ?? 0}</Badge>
                        <Badge variant="secondary">Approvals: {data?.actionCounts.approvals ?? 0}</Badge>
                      </div>
                      <CollapsibleTrigger className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">
                        {actionOpen ? "Collapse" : "Expand"}
                      </CollapsibleTrigger>
                    </div>
                    <CollapsibleContent>
                      <Separator className="my-3" />
                      <div className="space-y-2 lg:max-h-[320px] lg:overflow-y-auto">
                        {actionRows.length === 0 ? (
                          <div className="rounded border border-slate-800 bg-slate-900/60 p-2 text-xs text-slate-400">
                            No immediate action items.
                          </div>
                        ) : (
                          actionRows.map((item) => (
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
                            </button>
                          ))
                        )}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </CardContent>
              </Card>

              <Card className="lg:col-span-7">
                <CardHeader className="pb-2">
                  <CardTitle>Sales Block</CardTitle>
                  <CardDescription>Phase 2 shell: chart/table tabs follow in next steps.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded border border-slate-800 bg-slate-900/60 p-3 text-sm text-slate-300">
                    Sales data is wired. Next: tabbed table + trend chart.
                  </div>
                </CardContent>
              </Card>
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
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
