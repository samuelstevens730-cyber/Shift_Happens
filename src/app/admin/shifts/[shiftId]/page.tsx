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

function toLocalInputValueFromISO(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [data, setData] = useState<ShiftDetailResponse | null>(null);
  const [shiftForm, setShiftForm] = useState({
    shiftType: "open" as ShiftDetailResponse["shift"]["shiftType"],
    plannedStartAt: "",
    startedAt: "",
    endedAt: "",
    shiftNote: "",
    manualCloseReviewStatus: "",
  });
  const [drawerForm, setDrawerForm] = useState<
    Record<
      string,
      {
        drawerCents: string;
        changeCount: string;
        note: string;
        confirmed: boolean;
        notifiedManager: boolean;
      }
    >
  >({});
  const [dailySalesForm, setDailySalesForm] = useState({
    openXReportCents: "",
    closeSalesCents: "",
    zReportCents: "",
    reviewNote: "",
  });
  const [editReason, setEditReason] = useState("");
  const [deleteReason, setDeleteReason] = useState("");
  const [hardDeleteReason, setHardDeleteReason] = useState("");

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
        setSuccess(null);
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
        const payload = json as ShiftDetailResponse;
        setData(payload);
        setShiftForm({
          shiftType: payload.shift.shiftType,
          plannedStartAt: toLocalInputValueFromISO(payload.shift.plannedStartAt),
          startedAt: toLocalInputValueFromISO(payload.shift.startedAt),
          endedAt: toLocalInputValueFromISO(payload.shift.endedAt),
          shiftNote: payload.shift.shiftNote ?? "",
          manualCloseReviewStatus: payload.shift.manualClosedReviewStatus ?? "",
        });
        setDrawerForm(
          Object.fromEntries(
            payload.drawerCounts.map((row) => [
              row.id,
              {
                drawerCents: String(row.drawerCents),
                changeCount: row.changeCount == null ? "" : String(row.changeCount),
                note: row.note ?? "",
                confirmed: row.confirmed,
                notifiedManager: row.notifiedManager,
              },
            ])
          )
        );
        setDailySalesForm({
          openXReportCents:
            payload.dailySalesRecord?.openXReportCents == null
              ? ""
              : String(payload.dailySalesRecord.openXReportCents),
          closeSalesCents:
            payload.dailySalesRecord?.closeSalesCents == null
              ? ""
              : String(payload.dailySalesRecord.closeSalesCents),
          zReportCents:
            payload.dailySalesRecord?.zReportCents == null
              ? ""
              : String(payload.dailySalesRecord.zReportCents),
          reviewNote: payload.dailySalesRecord?.reviewNote ?? "",
        });
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

  async function refreshDetail() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token ?? "";
    const res = await fetch(`/api/admin/shifts/${shiftId}/detail`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || "Failed to refresh shift detail.");
    const payload = json as ShiftDetailResponse;
    setData(payload);
    setShiftForm({
      shiftType: payload.shift.shiftType,
      plannedStartAt: toLocalInputValueFromISO(payload.shift.plannedStartAt),
      startedAt: toLocalInputValueFromISO(payload.shift.startedAt),
      endedAt: toLocalInputValueFromISO(payload.shift.endedAt),
      shiftNote: payload.shift.shiftNote ?? "",
      manualCloseReviewStatus: payload.shift.manualClosedReviewStatus ?? "",
    });
  }

  async function saveAllChanges() {
    if (!data || saving) return;
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      if (!token) {
        router.replace(`/login?next=/admin/shifts/${shiftId}`);
        return;
      }

      const drawerPayload = data.drawerCounts.map((row) => {
        const formRow = drawerForm[row.id];
        return {
          id: row.id,
          drawerCents: formRow ? Number(formRow.drawerCents || 0) : row.drawerCents,
          changeCount:
            formRow && formRow.changeCount !== "" ? Number(formRow.changeCount) : null,
          note: formRow?.note ?? null,
          confirmed: formRow?.confirmed ?? row.confirmed,
          notifiedManager: formRow?.notifiedManager ?? row.notifiedManager,
        };
      });

      const body = {
        reason: editReason.trim(),
        shift: {
          shiftType: shiftForm.shiftType,
          plannedStartAt: shiftForm.plannedStartAt
            ? new Date(shiftForm.plannedStartAt).toISOString()
            : undefined,
          startedAt: shiftForm.startedAt
            ? new Date(shiftForm.startedAt).toISOString()
            : undefined,
          endedAt: shiftForm.endedAt ? new Date(shiftForm.endedAt).toISOString() : null,
          shiftNote: shiftForm.shiftNote.trim() || null,
          manualCloseReviewStatus:
            shiftForm.manualCloseReviewStatus === ""
              ? null
              : shiftForm.manualCloseReviewStatus,
        },
        drawerCounts: drawerPayload,
        dailySalesRecord: {
          openXReportCents:
            dailySalesForm.openXReportCents === ""
              ? null
              : Number(dailySalesForm.openXReportCents),
          closeSalesCents:
            dailySalesForm.closeSalesCents === ""
              ? null
              : Number(dailySalesForm.closeSalesCents),
          zReportCents:
            dailySalesForm.zReportCents === ""
              ? null
              : Number(dailySalesForm.zReportCents),
          reviewNote: dailySalesForm.reviewNote.trim() || null,
        },
      };
      if (!body.reason) {
        throw new Error("Edit reason is required.");
      }

      const res = await fetch(`/api/admin/shifts/${shiftId}/detail`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to save shift detail.");

      await refreshDetail();
      setEditReason("");
      setSuccess("Shift detail updated.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save shift detail.");
    } finally {
      setSaving(false);
    }
  }

  async function softDeleteShift() {
    if (!data || saving) return;
    if (!window.confirm("Soft delete this shift? It will be removed from reporting views.")) {
      return;
    }
    const reason = deleteReason.trim();
    if (!reason) {
      setError("Soft delete reason is required.");
      return;
    }
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      if (!token) {
        router.replace(`/login?next=/admin/shifts/${shiftId}`);
        return;
      }

      const res = await fetch(`/api/admin/shifts/${shiftId}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to remove shift.");
      router.push(backHref);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to remove shift.");
    } finally {
      setSaving(false);
    }
  }

  async function hardDeleteShift() {
    if (!data || saving) return;
    if (
      !window.confirm(
        "Hard delete permanently removes this shift and related records. Continue?"
      )
    ) {
      return;
    }
    const reason = hardDeleteReason.trim();
    if (!reason) {
      setError("Hard delete reason is required.");
      return;
    }
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      if (!token) {
        router.replace(`/login?next=/admin/shifts/${shiftId}`);
        return;
      }
      const res = await fetch(`/api/admin/shifts/${shiftId}/hard`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to hard delete shift.");
      router.push(backHref);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to hard delete shift.");
    } finally {
      setSaving(false);
    }
  }

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
        {error ? <div className="banner banner-error text-sm">{error}</div> : null}
        {success ? <div className="banner text-sm">{success}</div> : null}

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
                  <div>
                    Shift Type:
                    <select
                      className="ml-2 rounded border border-slate-700 bg-slate-900 px-2 py-1"
                      value={shiftForm.shiftType}
                      onChange={(e) =>
                        setShiftForm((prev) => ({
                          ...prev,
                          shiftType: e.target.value as ShiftDetailResponse["shift"]["shiftType"],
                        }))
                      }
                    >
                      <option value="open">open</option>
                      <option value="close">close</option>
                      <option value="double">double</option>
                      <option value="other">other</option>
                    </select>
                  </div>
                  <div>Duration: <b>{durationLabel(data.shift.startedAt, data.shift.endedAt)}</b></div>
                </div>
                <Separator />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label>
                    Planned Start:
                    <input
                      type="datetime-local"
                      className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1"
                      value={shiftForm.plannedStartAt}
                      onChange={(e) =>
                        setShiftForm((prev) => ({ ...prev, plannedStartAt: e.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Actual Start:
                    <input
                      type="datetime-local"
                      className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1"
                      value={shiftForm.startedAt}
                      onChange={(e) =>
                        setShiftForm((prev) => ({ ...prev, startedAt: e.target.value }))
                      }
                    />
                  </label>
                  <label>
                    End:
                    <input
                      type="datetime-local"
                      className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1"
                      value={shiftForm.endedAt}
                      onChange={(e) =>
                        setShiftForm((prev) => ({ ...prev, endedAt: e.target.value }))
                      }
                    />
                  </label>
                  <div>Created: <b>{fmtDateTime(data.shift.createdAt)}</b></div>
                </div>
                <Separator />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>Override At: <b>{fmtDateTime(data.shift.overrideAt)}</b></div>
                  <div>Override Note: <b>{data.shift.overrideNote ?? "--"}</b></div>
                  <label>
                    Manual Review:
                    <select
                      className="ml-2 rounded border border-slate-700 bg-slate-900 px-2 py-1"
                      value={shiftForm.manualCloseReviewStatus}
                      onChange={(e) =>
                        setShiftForm((prev) => ({
                          ...prev,
                          manualCloseReviewStatus: e.target.value,
                        }))
                      }
                    >
                      <option value="">--</option>
                      <option value="approved">approved</option>
                      <option value="edited">edited</option>
                      <option value="removed">removed</option>
                    </select>
                  </label>
                  <div>Unscheduled Review: <b>{fmtDateTime(data.shift.unscheduledReviewedAt)}</b></div>
                </div>
                <label className="block">
                  Shift Note:
                  <textarea
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1"
                    rows={2}
                    value={shiftForm.shiftNote}
                    onChange={(e) =>
                      setShiftForm((prev) => ({ ...prev, shiftNote: e.target.value }))
                    }
                  />
                </label>
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
                          <label>
                            Drawer (cents)
                            <input
                              type="number"
                              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1"
                              value={drawerForm[row.id]?.drawerCents ?? ""}
                              onChange={(e) =>
                                setDrawerForm((prev) => ({
                                  ...prev,
                                  [row.id]: {
                                    ...(prev[row.id] ?? {
                                      drawerCents: String(row.drawerCents),
                                      changeCount: row.changeCount == null ? "" : String(row.changeCount),
                                      note: row.note ?? "",
                                      confirmed: row.confirmed,
                                      notifiedManager: row.notifiedManager,
                                    }),
                                    drawerCents: e.target.value,
                                  },
                                }))
                              }
                            />
                          </label>
                          <label>
                            Change Count (cents)
                            <input
                              type="number"
                              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1"
                              value={drawerForm[row.id]?.changeCount ?? ""}
                              onChange={(e) =>
                                setDrawerForm((prev) => ({
                                  ...prev,
                                  [row.id]: {
                                    ...(prev[row.id] ?? {
                                      drawerCents: String(row.drawerCents),
                                      changeCount: row.changeCount == null ? "" : String(row.changeCount),
                                      note: row.note ?? "",
                                      confirmed: row.confirmed,
                                      notifiedManager: row.notifiedManager,
                                    }),
                                    changeCount: e.target.value,
                                  },
                                }))
                              }
                            />
                          </label>
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={drawerForm[row.id]?.confirmed ?? row.confirmed}
                              onChange={(e) =>
                                setDrawerForm((prev) => ({
                                  ...prev,
                                  [row.id]: {
                                    ...(prev[row.id] ?? {
                                      drawerCents: String(row.drawerCents),
                                      changeCount: row.changeCount == null ? "" : String(row.changeCount),
                                      note: row.note ?? "",
                                      confirmed: row.confirmed,
                                      notifiedManager: row.notifiedManager,
                                    }),
                                    confirmed: e.target.checked,
                                  },
                                }))
                              }
                            />
                            Confirmed
                          </label>
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={drawerForm[row.id]?.notifiedManager ?? row.notifiedManager}
                              onChange={(e) =>
                                setDrawerForm((prev) => ({
                                  ...prev,
                                  [row.id]: {
                                    ...(prev[row.id] ?? {
                                      drawerCents: String(row.drawerCents),
                                      changeCount: row.changeCount == null ? "" : String(row.changeCount),
                                      note: row.note ?? "",
                                      confirmed: row.confirmed,
                                      notifiedManager: row.notifiedManager,
                                    }),
                                    notifiedManager: e.target.checked,
                                  },
                                }))
                              }
                            />
                            Notified Manager
                          </label>
                          <div>Out of Threshold: <b>{row.outOfThreshold ? "Yes" : "No"}</b></div>
                        </div>
                        <label className="block mt-1">
                          Note:
                          <input
                            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1"
                            value={drawerForm[row.id]?.note ?? ""}
                            onChange={(e) =>
                              setDrawerForm((prev) => ({
                                ...prev,
                                [row.id]: {
                                  ...(prev[row.id] ?? {
                                    drawerCents: String(row.drawerCents),
                                    changeCount: row.changeCount == null ? "" : String(row.changeCount),
                                    note: row.note ?? "",
                                    confirmed: row.confirmed,
                                    notifiedManager: row.notifiedManager,
                                  }),
                                  note: e.target.value,
                                },
                              }))
                            }
                          />
                        </label>
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
                  <label>
                    Open X Report (cents):
                    <input
                      type="number"
                      className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1"
                      value={dailySalesForm.openXReportCents}
                      onChange={(e) =>
                        setDailySalesForm((prev) => ({
                          ...prev,
                          openXReportCents: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Close Sales (cents):
                    <input
                      type="number"
                      className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1"
                      value={dailySalesForm.closeSalesCents}
                      onChange={(e) =>
                        setDailySalesForm((prev) => ({
                          ...prev,
                          closeSalesCents: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Z Report (cents):
                    <input
                      type="number"
                      className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1"
                      value={dailySalesForm.zReportCents}
                      onChange={(e) =>
                        setDailySalesForm((prev) => ({
                          ...prev,
                          zReportCents: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <div>Balance Variance: <b>{fmtMoney(data.dailySalesRecord?.balanceVarianceCents)}</b></div>
                </div>
                <label className="block">
                  Daily Sales Review Note:
                  <input
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1"
                    value={dailySalesForm.reviewNote}
                    onChange={(e) =>
                      setDailySalesForm((prev) => ({ ...prev, reviewNote: e.target.value }))
                    }
                  />
                </label>
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
                <label className="block text-sm">
                  Edit Reason (required to save):
                  <textarea
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1"
                    rows={2}
                    value={editReason}
                    onChange={(e) => setEditReason(e.target.value)}
                    placeholder="What changed and why?"
                  />
                </label>
                <button
                  className="w-full rounded bg-cyan-600 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-60"
                  onClick={() => void saveAllChanges()}
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Save All Changes"}
                </button>
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
                <button
                  className="w-full rounded border border-red-700/70 px-3 py-2 text-sm text-red-300 hover:bg-red-950/30 disabled:opacity-60"
                  onClick={() => void softDeleteShift()}
                  disabled={saving}
                >
                  Soft Delete Shift
                </button>
                <label className="block text-sm">
                  Soft Delete Reason:
                  <input
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1"
                    value={deleteReason}
                    onChange={(e) => setDeleteReason(e.target.value)}
                    placeholder="Reason for soft delete"
                  />
                </label>
                <label className="block text-sm">
                  Hard Delete Reason:
                  <input
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1"
                    value={hardDeleteReason}
                    onChange={(e) => setHardDeleteReason(e.target.value)}
                    placeholder="Required, minimum 8 chars"
                  />
                </label>
                <button
                  className="w-full rounded border border-red-500/70 px-3 py-2 text-sm text-red-200 hover:bg-red-900/30 disabled:opacity-60"
                  onClick={() => void hardDeleteShift()}
                  disabled={saving}
                >
                  Hard Delete Shift (Permanent)
                </button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
