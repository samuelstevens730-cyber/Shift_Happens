/**
 * Employee Requests Dashboard
 */
"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import HomeHeader from "@/components/HomeHeader";
import SwapRequestCard from "./SwapRequestCard";
import OpenRequestsPanel from "./OpenRequestsPanel";
import TimeOffRequestForm from "./TimeOffRequestForm";
import TimesheetCorrectionForm from "./TimesheetCorrectionForm";
import { useShiftSwapRequests } from "@/hooks/useShiftSwapRequests";
import { useTimeOffRequests } from "@/hooks/useTimeOffRequests";
import { useTimesheetRequests } from "@/hooks/useTimesheetRequests";

const TABS = [
  { id: "swaps", label: "Swaps" },
  { id: "open", label: "Open Requests" },
  { id: "timeoff", label: "Time Off" },
  { id: "timesheets", label: "Timesheets" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function RequestsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = (searchParams.get("tab") || "swaps") as TabId;
  const activeTab = TABS.some(t => t.id === tabParam) ? tabParam : "swaps";

  const [isManager, setIsManager] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);

  const swaps = useShiftSwapRequests();
  const timeOff = useTimeOffRequests();
  const timesheets = useTimesheetRequests();

  useEffect(() => {
    let alive = true;
    async function checkAuth() {
      const pinToken = typeof window !== "undefined" ? sessionStorage.getItem("sh_pin_token") : null;
      const pinProfile = typeof window !== "undefined" ? sessionStorage.getItem("sh_pin_profile_id") : null;
      const { data: { user } } = await supabase.auth.getUser();

      if (!alive) return;
      setIsManager(Boolean(user));
      setIsAuthenticated(Boolean(pinToken || user));

      if (pinProfile) {
        setProfileId(pinProfile);
        return;
      }
      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("id")
          .eq("auth_user_id", user.id)
          .maybeSingle();
        if (!alive) return;
        setProfileId(profile?.id ?? null);
      }
    }
    checkAuth();
    return () => { alive = false; };
  }, []);

  const handleTabChange = (next: TabId) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    router.replace(`/dashboard/requests?${params.toString()}`);
  };

  const tabContent = useMemo(() => {
    if (activeTab === "swaps") {
      return (
        <div className="space-y-4">
          {swaps.error && <div className="banner banner-error text-sm">{swaps.error}</div>}
          <SwapRequestCard requests={swaps.rows} onRefresh={swaps.refresh} />
        </div>
      );
    }
    if (activeTab === "open") {
      return (
        <div className="space-y-4">
          {swaps.error && <div className="banner banner-error text-sm">{swaps.error}</div>}
          <OpenRequestsPanel requests={swaps.rows} onRefresh={swaps.refresh} />
        </div>
      );
    }
    if (activeTab === "timeoff") {
      return (
        <div className="space-y-4">
          {timeOff.error && <div className="banner banner-error text-sm">{timeOff.error}</div>}
          <TimeOffRequestForm blocks={timeOff.blocks} onRefresh={timeOff.refresh} />
        </div>
      );
    }
    return (
      <div className="space-y-4">
        {timesheets.error && <div className="banner banner-error text-sm">{timesheets.error}</div>}
        <TimesheetCorrectionForm onRefresh={timesheets.refresh} />
        <div className="card card-pad space-y-2">
          <div className="text-sm font-semibold">Recent Timesheet Requests</div>
          {timesheets.rows.length === 0 && <div className="text-sm muted">No requests yet.</div>}
          {timesheets.rows.map(req => (
            <div key={req.id} className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{req.status.toUpperCase()}</span>
                <span className="text-xs muted">
                  {new Date(req.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              </div>
              <div className="text-xs muted">Shift: {req.shift_id}</div>
              <div className="text-xs muted">
                Original: {req.original_started_at} {"->"} {req.original_ended_at ?? "--"}
              </div>
              <div className="text-xs muted">
                Requested: {req.requested_started_at ?? "--"} {"->"} {req.requested_ended_at ?? "--"}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }, [activeTab, swaps, timeOff, timesheets]);

  return (
    <div className="bento-shell">
      <HomeHeader
        isManager={isManager}
        isAuthenticated={isAuthenticated}
        profileId={profileId}
      />
      <div className="max-w-5xl mx-auto space-y-4 px-4 py-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Requests</h1>
            <p className="text-sm muted">Submit and track shift swaps, time off, and timesheet corrections.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
        </div>

        {tabContent}
      </div>
    </div>
  );
}

export default function RequestsPage() {
  return (
    <Suspense fallback={<div className="bento-shell flex items-center justify-center"><div className="text-muted">Loading...</div></div>}>
      <RequestsContent />
    </Suspense>
  );
}

