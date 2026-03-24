"use client";

import { useState } from "react";

type Props = {
  storeId: string;
  previousBusinessDate: string;
  resolveAuthToken: () => Promise<string | null>;
  onSubmitted: () => void;
};

function parseMoneyInputToCents(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export default function RolloverEntryCard({
  storeId,
  previousBusinessDate,
  resolveAuthToken,
  onSubmitted,
}: Props) {
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [mismatchDetected, setMismatchDetected] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="shift-status-panel shift-status-panel-amber space-y-3">
      <div className="shift-status-title">Enter rollover sales from last night</div>
      <div className="shift-status-copy">
        Enter the rollover amount using the printed report. This is a blind verification entry.
      </div>
      <label className="shift-field-label">Rollover amount ($)</label>
      <input
        className="shift-field-input"
        inputMode="decimal"
        value={amount}
        onChange={e => setAmount(e.target.value)}
        placeholder="0.00"
      />

      {err && <div className="shift-flash shift-flash-warn text-sm">{err}</div>}

      <div className="flex justify-end">
        <button
          className="shift-button disabled:opacity-50"
          disabled={saving}
          onClick={async () => {
            setErr(null);
            const cents = parseMoneyInputToCents(amount);
            if (cents == null) {
              setErr("Please enter a valid non-negative amount.");
              return;
            }

            const token = await resolveAuthToken();
            if (!token) {
              setErr("Session expired. Please refresh.");
              return;
            }

            setSaving(true);
            try {
              const res = await fetch("/api/sales/rollover", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                  storeId,
                  date: previousBusinessDate,
                  amount: cents,
                  source: "opener",
                  forceMismatch: mismatchDetected,
                }),
              });
              const json = await res.json();

              if (res.status === 409 && json?.requiresConfirmation) {
                setMismatchDetected(true);
                setErr("Mismatch detected. Submit again to save mismatch for manager review.");
                return;
              }
              if (!res.ok) {
                throw new Error(json?.error || "Failed to submit rollover.");
              }

              onSubmitted();
            } catch (e: unknown) {
              setErr(e instanceof Error ? e.message : "Failed to submit rollover.");
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Submitting..." : mismatchDetected ? "Save Mismatch" : "Submit Rollover"}
        </button>
      </div>
    </div>
  );
}
