"use client";

import { useState } from "react";
import { useRequestMutations } from "@/hooks/useRequestMutations";

type Props = {
  onRefresh: () => void;
};

export default function TimesheetCorrectionForm({ onRefresh }: Props) {
  const { loading, submitTimesheetChange } = useRequestMutations();
  const [shiftId, setShiftId] = useState("");
  const [requestedStartedAt, setRequestedStartedAt] = useState("");
  const [requestedEndedAt, setRequestedEndedAt] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lockedError, setLockedError] = useState<string | null>(null);

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
        <label className="text-sm muted">Shift ID</label>
        <input
          className="input"
          value={shiftId}
          onChange={(e) => setShiftId(e.target.value)}
          placeholder="Shift UUID"
        />
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
