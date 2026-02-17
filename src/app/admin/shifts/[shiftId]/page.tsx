"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/lib/supabaseClient";
import type { ShiftDetailResponse } from "@/types/adminShiftDetail";

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "--";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "--";
  return dt.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return "--";
  const dt = new Date(`${value}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
}

function fmtMoney(cents: number | null | undefined): string {
  if (cents == null) return "--";
  return `$${(cents / 100).toFixed(2)}`;
}

function durationLabel(startedAt: string, endedAt: string | null): string {
  const startMs = Date.parse(startedAt);
  const endMs = endedAt ? Date.parse(endedAt) : Date.now();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return "--";
  const minutes = Math.round((endMs - startMs) / (1000 * 60));
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${String(mins).padStart(2, "0")}m`;
}

export default function AdminShiftDetailPage() {
  const params = useParams<{ shiftId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ShiftDetailResponse | null>(null);

  const shiftId = params.shiftId;
  const backHref = useMemo(() => {
    const source = searchParams.get("source");
    if (source === "dashboard") return "/admin/dashboard";
    return "/admin/shifts";
  }, [searchParams]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const token = session?.access_token ?? "";
        if (!token) {
          router.replace(`/login?next=/admin/shifts/${shiftId}`);
          return;
        }

        const res = await fetch(`/api/admin/shifts/${shiftId}/detail`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Failed to load shift detail.");
        if (!active) return;
        setData(json as ShiftDetailResponse);
      } catch (e: unknown) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Failed to load shift detail.");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [router, shiftId]);

  if (loading) return <div className="app-shell">Loading shift detail...</div>;

  if (error || !data) {
    return (
      <div className="app-shell">
        <div className="mx-auto max-w-5xl space-y-4">
          <Link href={backHref} className="text-sm text-cyan-300 hover:underline">
            {"<-"} Back
          </Link>
          <div className="banner banner-error text-sm">{error ?? "Shift detail not found."}</div>
        </div>
      </div>
    );
  }

  const shiftState = data.shift.endedAt ? "Closed" : "Open";
  const openOrCloseSchedule = data.scheduleShift
    ? `${data.scheduleShift.shiftDate} ${data.scheduleShift.scheduledStart} - ${data.scheduleShift.scheduledEnd}`
    : "--";

  return (
    <div className="app-shell p-3 sm:p-4 lg:p-6">
      <div className="mx-auto w-full max-w-6xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-1">
              <Link href={backHref} className="text-sm text-cyan-300 hover:underline">
                {"<-"} Back
              </Link>
            </div>
            <h1 className="text-2xl font-semibold text-slate-100">Shift Detail</h1>
            <p className="text-sm text-slate-400">
              Shift ID: <span className="font-mono">{data.shift.id}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={data.shift.endedAt ? "outline" : "destructive"}>{shiftState}</Badge>
            <Badge variant="outline">{data.shift.shiftType.toUpperCase()}</Badge>
            {data.shift.manualClosed ? <Badge variant="secondary">Manual Closed</Badge> : null}
            {data.shift.requiresOverride ? <Badge variant="destructive">Override Required</Badge> : null}
            {data.shift.scheduleShiftId ? <Badge variant="outline">Scheduled</Badge> : <Badge variant="secondary">Unscheduled</Badge>}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="space-y-4 xl:col-span-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle>Shift Summary</CardTitle>
                <CardDescription>Store, employee, timeline, and review flags.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>Store: <b>{data.store?.name ?? "--"}</b></div>
                  <div>Employee: <b>{data.profile?.name ?? "--"}</b></div>
                  <div>Shift Source: <b>{data.shift.shiftSource ?? "--"}</b></div>
                  <div>Duration: <b>{durationLabel(data.shift.startedAt, data.shift.endedAt)}</b></div>
                </div>
                <Separator />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>Planned Start: <b>{fmtDateTime(data.shift.plannedStartAt)}</b></div>
                  <div>Actual Start: <b>{fmtDateTime(data.shift.startedAt)}</b></div>
                  <div>End: <b>{fmtDateTime(data.shift.endedAt)}</b></div>
                  <div>Created: <b>{fmtDateTime(data.shift.createdAt)}</b></div>
                </div>
                <Separator />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>Override At: <b>{fmtDateTime(data.shift.overrideAt)}</b></div>
                  <div>Override Note: <b>{data.shift.overrideNote ?? "--"}</b></div>
                  <div>Manual Review: <b>{data.shift.manualClosedReviewStatus ?? "--"}</b></div>
                  <div>Unscheduled Review: <b>{fmtDateTime(data.shift.unscheduledReviewedAt)}</b></div>
                </div>
                {data.shift.shiftNote ? <div>Shift Note: <b>{data.shift.shiftNote}</b></div> : null}
                {data.shift.unscheduledReviewNote ? (
                  <div>Unscheduled Review Note: <b>{data.shift.unscheduledReviewNote}</b></div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle>Drawer Counts</CardTitle>
                <CardDescription>Start/changeover/end counts tied to this shift.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.drawerCounts.length === 0 ? (
                  <div className="text-sm text-slate-400">No drawer counts recorded.</div>
                ) : (
                  <div className="space-y-2">
                    {data.drawerCounts.map((row) => (
                      <div key={row.id} className="rounded border border-slate-800 bg-slate-900/70 p-2 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-medium text-slate-100">{row.countType.toUpperCase()} Count</div>
                          <div className="text-xs text-slate-400">{fmtDateTime(row.countedAt)}</div>
                        </div>
                        <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
                          <div>Drawer: <b>{fmtMoney(row.drawerCents)}</b></div>
                          <div>Change: <b>{fmtMoney(row.changeCount)}</b></div>
                          <div>Confirmed: <b>{row.confirmed ? "Yes" : "No"}</b></div>
                          <div>Out of Threshold: <b>{row.outOfThreshold ? "Yes" : "No"}</b></div>
                        </div>
                        {row.note ? <div className="mt-1 text-slate-300">Note: {row.note}</div> : null}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle>Sales / X-Report</CardTitle>
                <CardDescription>Daily sales linkage and shift-level sales entries.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>Schedule Window: <b>{openOrCloseSchedule}</b></div>
                <div>Business Date: <b>{fmtDate(data.dailySalesRecord?.businessDate)}</b></div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>Open X Report: <b>{fmtMoney(data.dailySalesRecord?.openXReportCents)}</b></div>
                  <div>Close Sales: <b>{fmtMoney(data.dailySalesRecord?.closeSalesCents)}</b></div>
                  <div>Z Report: <b>{fmtMoney(data.dailySalesRecord?.zReportCents)}</b></div>
                  <div>Balance Variance: <b>{fmtMoney(data.dailySalesRecord?.balanceVarianceCents)}</b></div>
                </div>
                <Separator />
                {data.shiftSalesEntries.length === 0 ? (
                  <div className="text-slate-400">No shift sales entries.</div>
                ) : (
                  <div className="space-y-1">
                    {data.shiftSalesEntries.map((entry) => (
                      <div key={entry.id} className="rounded border border-slate-800 bg-slate-900/70 p-2">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <b>{entry.entryType}</b> - {fmtMoney(entry.amountCents)}
                            {entry.priorXReportCents != null ? ` - prior X ${fmtMoney(entry.priorXReportCents)}` : ""}
                          </div>
                          <div className="text-xs text-slate-400">{fmtDateTime(entry.countedAt)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle>Safe Closeout</CardTitle>
                <CardDescription>Closeout payload tied directly to this shift.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {!data.safeCloseout ? (
                  <div className="text-slate-400">No safe closeout linked to this shift.</div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{data.safeCloseout.status.toUpperCase()}</Badge>
                      {data.safeCloseout.requiresManagerReview ? <Badge variant="destructive">Needs Review</Badge> : null}
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>Business Date: <b>{fmtDate(data.safeCloseout.businessDate)}</b></div>
                      <div>Variance: <b>{fmtMoney(data.safeCloseout.varianceCents)}</b></div>
                      <div>Cash Sales: <b>{fmtMoney(data.safeCloseout.cashSalesCents)}</b></div>
                      <div>Card Sales: <b>{fmtMoney(data.safeCloseout.cardSalesCents)}</b></div>
                      <div>Expected Deposit: <b>{fmtMoney(data.safeCloseout.expectedDepositCents)}</b></div>
                      <div>Actual Deposit: <b>{fmtMoney(data.safeCloseout.actualDepositCents)}</b></div>
                      <div>Denom Total: <b>{fmtMoney(data.safeCloseout.denomTotalCents)}</b></div>
                    </div>
                    <Separator />
                    <div>
                      <div className="font-medium text-slate-200">Expenses ({data.safeCloseout.expenses.length})</div>
                      {data.safeCloseout.expenses.length === 0 ? (
                        <div className="text-slate-400">None</div>
                      ) : (
                        <div className="mt-1 space-y-1">
                          {data.safeCloseout.expenses.map((row) => (
                            <div key={row.id} className="rounded border border-slate-800 bg-slate-900/70 p-2">
                              {row.category} - {fmtMoney(row.amountCents)}{row.note ? ` - ${row.note}` : ""}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle>Admin Actions</CardTitle>
                <CardDescription>Edit/Delete paths stay centralized until Phase 2 write UI lands.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Link href="/admin/shifts" className="block rounded border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800">
                  Open Shifts Admin (edit/remove)
                </Link>
                <Link
                  href={data.safeCloseout ? `/admin/safe-ledger?actionId=money-${data.safeCloseout.id}&source=dashboard` : "/admin/safe-ledger"}
                  className="block rounded border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800"
                >
                  Open Safe Ledger Review
                </Link>
                <Link href="/admin/open-shifts" className="block rounded border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800">
                  Open Open-Shifts Queue
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
