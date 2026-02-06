/**
 * Admin Requests - Approval Queue
 */
"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
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
  reason: string | null;
  status: string;
  created_at: string;
  expires_at: string;
};

type TimeOffRequest = {
  id: string;
  store_id: string;
  profile_id: string;
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
  requester_profile_id: string;
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
  const tabParam = (searchParams.get("tab") || "swaps") as TabId;
  const activeTab = TABS.some(t => t.id === tabParam) ? tabParam : "swaps";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [swapRequests, setSwapRequests] = useState<SwapRequest[]>([]);
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([]);
  const [timesheetRequests, setTimesheetRequests] = useState<TimesheetRequest[]>([]);

  const refreshAll = async (authToken: string) => {
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

    setSwapRequests(swapJson?.rows ?? []);
    setTimeOffRequests(timeJson?.rows ?? []);
    setTimesheetRequests(tsJson?.rows ?? []);
  };

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
  }, [router]);

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
        />
      );
    }
    if (activeTab === "timeoff") {
      return (
        <TimeOffApprovalCard
          requests={timeOffRequests}
          token={token}
          onRefresh={() => refreshAll(token)}
        />
      );
    }
    return (
      <TimesheetApprovalCard
        requests={timesheetRequests}
        token={token}
        onRefresh={() => refreshAll(token)}
      />
    );
  }, [activeTab, swapRequests, timeOffRequests, timesheetRequests, token]);

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
