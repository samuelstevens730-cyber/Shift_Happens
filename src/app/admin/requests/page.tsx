/**
 * Admin Requests - Approval Queue
 */
"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import SwapApprovalCard from "./SwapApprovalCard";
import TimeOffApprovalCard from "./TimeOffApprovalCard";
import TimesheetApprovalCard from "./TimesheetApprovalCard";

type SwapRequest = {
  id: string;
  schedule_shift_id: string;
  store_id: string;
  requester_profile_id: string;
  requester?: { id: string; name: string | null } | null;
  schedule_shift?: {
    id: string;
    shift_date: string;
    scheduled_start: string;
    scheduled_end: string;
    shift_type: string;
    store_id: string;
    stores?: { name: string } | null;
  } | null;
  reason: string | null;
  status: string;
  created_at: string;
  expires_at: string;
};

type TimeOffRequest = {
  id: string;
  store_id: string;
  store?: { id: string; name: string | null } | null;
  profile_id: string;
  profile?: { id: string; name: string | null } | null;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: string;
  created_at: string;
};

type TimesheetRequest = {
  id: string;
  shift_id: string;
  store_id: string;
  store?: { id: string; name: string | null } | null;
  requester_profile_id: string;
  requester?: { id: string; name: string | null } | null;
  requested_started_at: string | null;
  requested_ended_at: string | null;
  original_started_at: string;
  original_ended_at: string | null;
  reason: string;
  status: string;
  created_at: string;
};

const TABS = [
  { id: "swaps", label: "Swaps" },
  { id: "timeoff", label: "Time Off" },
  { id: "timesheets", label: "Timesheets" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function AdminRequestsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const source = searchParams.get("source");
  const actionId = searchParams.get("actionId");
  const storeIdFilter = searchParams.get("storeId");
  const dashboardTab: TabId | null =
    actionId?.startsWith("approval-swap-")
      ? "swaps"
      : actionId?.startsWith("approval-timeoff-")
        ? "timeoff"
        : actionId?.startsWith("approval-timesheet-")
          ? "timesheets"
          : null;
  const activeTab = TABS.some(t => t.id === tabParam) ? (tabParam as TabId) : dashboardTab ?? "swaps";
  const highlightRequestId =
    actionId?.startsWith("approval-swap-")
      ? actionId.replace("approval-swap-", "")
      : actionId?.startsWith("approval-timeoff-")
        ? actionId.replace("approval-timeoff-", "")
        : actionId?.startsWith("approval-timesheet-")
          ? actionId.replace("approval-timesheet-", "")
          : null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [swapRequests, setSwapRequests] = useState<SwapRequest[]>([]);
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([]);
  const [timesheetRequests, setTimesheetRequests] = useState<TimesheetRequest[]>([]);

  const refreshAll = useCallback(async (authToken: string) => {
    const [swapRes, timeRes, tsRes] = await Promise.all([
      fetch("/api/requests/shift-swap", { headers: { Authorization: `Bearer ${authToken}` } }),
      fetch("/api/requests/time-off", { headers: { Authorization: `Bearer ${authToken}` } }),
      fetch("/api/requests/timesheet", { headers: { Authorization: `Bearer ${authToken}` } }),
    ]);

    const swapJson = await swapRes.json();
    const timeJson = await timeRes.json();
    const tsJson = await tsRes.json();

    if (!swapRes.ok) throw new Error(swapJson?.error ?? "Failed to load swap requests.");
    if (!timeRes.ok) throw new Error(timeJson?.error ?? "Failed to load time off requests.");
    if (!tsRes.ok) throw new Error(tsJson?.error ?? "Failed to load timesheet requests.");

    const nextSwaps: SwapRequest[] = swapJson?.rows ?? [];
    const nextTimeOff: TimeOffRequest[] = timeJson?.rows ?? [];
    const nextTimesheets: TimesheetRequest[] = tsJson?.rows ?? [];
    if (source === "dashboard" && storeIdFilter) {
      setSwapRequests(nextSwaps.filter((row) => row.store_id === storeIdFilter));
      setTimeOffRequests(nextTimeOff.filter((row) => row.store_id === storeIdFilter));
      setTimesheetRequests(nextTimesheets.filter((row) => row.store_id === storeIdFilter));
      return;
    }
    setSwapRequests(nextSwaps);
    setTimeOffRequests(nextTimeOff);
    setTimesheetRequests(nextTimesheets);
  }, [source, storeIdFilter]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          router.replace("/login?next=/admin/requests");
          return;
        }
        const { data: { session } } = await supabase.auth.getSession();
        const accessToken = session?.access_token ?? null;
        if (!accessToken) {
          router.replace("/login?next=/admin/requests");
          return;
        }
        if (!alive) return;
        setToken(accessToken);
        await refreshAll(accessToken);
      } catch (e: unknown) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load requests.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [router, refreshAll]);

  const handleTabChange = (next: TabId) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    router.replace(`/admin/requests?${params.toString()}`);
  };

  const content = useMemo(() => {
    if (!token) return null;
    if (activeTab === "swaps") {
      return (
        <SwapApprovalCard
          requests={swapRequests}
          token={token}
          onRefresh={() => refreshAll(token)}
          highlightRequestId={highlightRequestId}
        />
      );
    }
    if (activeTab === "timeoff") {
      return (
        <TimeOffApprovalCard
          requests={timeOffRequests}
          token={token}
          onRefresh={() => refreshAll(token)}
          highlightRequestId={highlightRequestId}
        />
      );
    }
    return (
      <TimesheetApprovalCard
        requests={timesheetRequests}
        token={token}
        onRefresh={() => refreshAll(token)}
        highlightRequestId={highlightRequestId}
      />
    );
  }, [activeTab, swapRequests, timeOffRequests, timesheetRequests, token, refreshAll, highlightRequestId]);

  if (loading) return <div className="app-shell">Loading...</div>;
  if (error) return <div className="app-shell"><div className="banner banner-error">{error}</div></div>;

  return (
    <div className="app-shell">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Requests</h1>
            <p className="text-sm muted">Review and approve employee requests.</p>
          </div>
          <div className="inline-flex rounded-full border border-white/10 bg-white/5 p-1">
            {TABS.map(tab => (
              <button
                key={tab.id}
                className={`px-4 py-2 text-sm font-semibold rounded-full transition ${
                  activeTab === tab.id
                    ? "bg-white text-black"
                    : "text-white/70 hover:text-white"
                }`}
                onClick={() => handleTabChange(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </header>

        {source === "dashboard" && (
          <div className="rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
            Opened from Dashboard Action Items{storeIdFilter ? ` · Store filter applied` : ""}{highlightRequestId ? ` · Highlight target loaded` : ""}.
          </div>
        )}

        {content}
      </div>
    </div>
  );
}

export default function AdminRequestsPage() {
  return (
    <Suspense fallback={<div className="app-shell">Loading...</div>}>
      <AdminRequestsContent />
    </Suspense>
  );
}
