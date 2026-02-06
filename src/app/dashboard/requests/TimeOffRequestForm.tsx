"use client";

import { useEffect, useMemo, useState } from "react";
import { useRequestMutations } from "@/hooks/useRequestMutations";

type TimeOffBlock = {
  id: string;
  start_date: string;
  end_date: string;
  created_at: string;
};

type Props = {
  blocks: TimeOffBlock[];
  onRefresh: () => void;
};

function formatDate(value: string) {
  const dt = new Date(`${value}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function TimeOffRequestForm({ blocks, onRefresh }: Props) {
  const { loading, submitTimeOffRequest } = useRequestMutations();
  const [storeId, setStoreId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [conflictError, setConflictError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedStoreId = sessionStorage.getItem("sh_pin_store_id") || "";
    if (storedStoreId) setStoreId(storedStoreId);
  }, []);

  const upcomingBlocks = useMemo(() => {
    const today = new Date();
    const todayKey = today.toISOString().slice(0, 10);
    return blocks.filter(b => b.end_date >= todayKey);
  }, [blocks]);

  const handleSubmit = async () => {
    setError(null);
    setConflictError(null);
    const res = await submitTimeOffRequest({
      storeId,
      startDate,
      endDate,
      reason: reason || null,
    });
    if (!res.ok) {
      if (res.status === 409) {
        setConflictError(res.error ?? "Time off request conflicts with a published shift.");
      } else {
        setError(res.error ?? "Failed to submit time off request.");
      }
      return;
    }
    setStartDate("");
    setEndDate("");
    setReason("");
    onRefresh();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
      <div className="card card-pad space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Request Time Off</h2>
          <p className="text-sm muted">Requests are checked against published schedules.</p>
        </div>

        {conflictError && <div className="banner banner-error text-sm">{conflictError}</div>}
        {error && <div className="banner banner-error text-sm">{error}</div>}

        <div className="space-y-1">
          <label className="text-sm muted">Store ID</label>
          <input
            className="input"
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            placeholder="Store UUID"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm muted">Start Date</label>
            <input
              className="input"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm muted">End Date</label>
            <input
              className="input"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-sm muted">Reason (optional)</label>
          <textarea
            className="textarea"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Optional details"
          />
        </div>
        <button
          className="btn-primary w-full"
          onClick={handleSubmit}
          disabled={loading || !storeId || !startDate || !endDate}
        >
          {loading ? "Submitting..." : "Submit Time Off Request"}
        </button>
      </div>

      <div className="card card-pad space-y-3">
        <div>
          <h3 className="text-base font-semibold">Upcoming Blocks</h3>
          <p className="text-xs muted">Approved or manager-added blocks.</p>
        </div>
        {upcomingBlocks.length === 0 && (
          <div className="text-sm muted">No upcoming time off blocks.</div>
        )}
        {upcomingBlocks.map(block => (
          <div key={block.id} className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
            <div className="font-semibold">
              {formatDate(block.start_date)} - {formatDate(block.end_date)}
            </div>
            <div className="text-xs muted">Created {formatDate(block.created_at)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
