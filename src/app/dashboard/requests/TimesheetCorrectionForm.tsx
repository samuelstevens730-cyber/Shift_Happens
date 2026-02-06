"use client";

import { useEffect, useMemo, useState } from "react";
import { useRequestMutations } from "@/hooks/useRequestMutations";
import { supabase } from "@/lib/supabaseClient";
import { createEmployeeSupabase } from "@/lib/employeeSupabase";

type Props = {
  onRefresh: () => void;
};

type ShiftOption = {
  id: string;
  store_id: string | null;
  stores?: { name: string }[] | null;
  started_at: string;
  ended_at: string | null;
};

function formatDateTime(value?: string | null) {
  if (!value) return "--";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function TimesheetCorrectionForm({ onRefresh }: Props) {
  const { loading, submitTimesheetChange } = useRequestMutations();
  const [shiftId, setShiftId] = useState("");
  const [requestedStartedAt, setRequestedStartedAt] = useState("");
  const [requestedEndedAt, setRequestedEndedAt] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lockedError, setLockedError] = useState<string | null>(null);
  const [shiftOptions, setShiftOptions] = useState<ShiftOption[]>([]);
  const [shiftError, setShiftError] = useState<string | null>(null);

  const shiftLabelById = useMemo(() => {
    const map = new Map<string, string>();
    shiftOptions.forEach(s => {
      const store = s.stores?.[0]?.name ?? s.store_id ?? "Store";
      map.set(
        s.id,
        `${formatDateTime(s.started_at)} → ${formatDateTime(s.ended_at)} · ${store}`
      );
    });
    return map;
  }, [shiftOptions]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setShiftError(null);
      const pinToken = typeof window !== "undefined" ? sessionStorage.getItem("sh_pin_token") : null;
      const profileId = typeof window !== "undefined" ? sessionStorage.getItem("sh_pin_profile_id") : null;
      const client = pinToken ? createEmployeeSupabase(pinToken) : supabase;

      if (!profileId) return;

      const { data, error: shiftErr } = await client
        .from("shifts")
        .select("id, store_id, stores(name), started_at, ended_at")
        .eq("profile_id", profileId)
        .order("started_at", { ascending: false })
        .limit(20);

      if (!alive) return;
      if (shiftErr) {
        setShiftError(shiftErr.message);
        return;
      }
      setShiftOptions((data ?? []) as ShiftOption[]);
      if (data && data.length > 0) {
        setShiftId((prev) => prev || data[0].id);
      }
    })();
    return () => { alive = false; };
  }, []);

  const handleSubmit = async () => {
    setError(null);
    setLockedError(null);

    const res = await submitTimesheetChange({
      shiftId,
      requestedStartedAt: requestedStartedAt || null,
      requestedEndedAt: requestedEndedAt || null,
      reason,
    });
    if (!res.ok) {
      if (res.status === 409) {
        setLockedError(res.error ?? "Payroll period is locked.");
      } else {
        setError(res.error ?? "Failed to submit timesheet request.");
      }
      return;
    }
    setShiftId("");
    setRequestedStartedAt("");
    setRequestedEndedAt("");
    setReason("");
    onRefresh();
  };

  return (
    <div className="card card-pad space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Timesheet Correction</h2>
        <p className="text-sm muted">Request a correction for a specific shift.</p>
      </div>

      {lockedError && <div className="banner banner-error text-sm">{lockedError}</div>}
      {error && <div className="banner banner-error text-sm">{error}</div>}

      <div className="space-y-1">
        <label className="text-sm muted">Shift</label>
        <select
          className="select"
          value={shiftId}
          onChange={(e) => setShiftId(e.target.value)}
        >
          {shiftOptions.map(shift => (
            <option key={shift.id} value={shift.id}>
              {shiftLabelById.get(shift.id)}
            </option>
          ))}
        </select>
        {shiftError && <div className="text-xs text-red-300">{shiftError}</div>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-sm muted">Requested Start (optional)</label>
          <input
            className="input"
            type="datetime-local"
            value={requestedStartedAt}
            onChange={(e) => setRequestedStartedAt(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm muted">Requested End (optional)</label>
          <input
            className="input"
            type="datetime-local"
            value={requestedEndedAt}
            onChange={(e) => setRequestedEndedAt(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm muted">Reason</label>
        <textarea
          className="textarea"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why this correction is needed"
        />
      </div>

      <button
        className="btn-primary w-full"
        onClick={handleSubmit}
        disabled={loading || !shiftId || !reason}
      >
        {loading ? "Submitting..." : "Submit Timesheet Request"}
      </button>
    </div>
  );
}
