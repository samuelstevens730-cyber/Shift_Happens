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
    <div className="border rounded p-3 space-y-2">
      <div className="text-sm font-semibold">Enter rollover sales from last night</div>
      <div className="text-xs text-slate-500">
        Enter the rollover amount using the printed report. This is a blind verification entry.
      </div>
      <label className="text-sm">Rollover amount ($)</label>
      <input
        className="w-full border rounded p-2"
        inputMode="decimal"
        value={amount}
        onChange={e => setAmount(e.target.value)}
        placeholder="0.00"
      />

      {err && <div className="text-sm text-amber-700 border border-amber-300 rounded p-2">{err}</div>}

      <div className="flex justify-end">
        <button
          className="px-3 py-1.5 rounded bg-black text-white disabled:opacity-50"
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

