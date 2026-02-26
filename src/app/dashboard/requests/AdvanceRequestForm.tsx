"use client";

import { useMemo, useState } from "react";

type AdvanceRow = {
  id: string;
  store_id: string | null;
  advance_date: string;
  advance_hours: string;
  cash_amount_cents: number | null;
  note: string | null;
  status: "pending_verification" | "verified" | "voided";
  store: { id: string; name: string } | null;
};

type StoreRow = { id: string; name: string };

function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function AdvanceRequestForm({
  rows,
  stores,
  loading,
  onSubmit,
}: {
  rows: AdvanceRow[];
  stores: StoreRow[];
  loading: boolean;
  onSubmit: (payload: {
    storeId?: string | null;
    advanceDate?: string | null;
    advanceHours: number;
    cashAmountDollars?: number | null;
    note?: string | null;
  }) => Promise<{ ok: true } | { ok: false; error: unknown }>;
}) {
  const today = useMemo(() => toISODate(new Date()), []);
  const [storeId, setStoreId] = useState<string>("");
  const [advanceDate, setAdvanceDate] = useState(today);
  const [advanceHours, setAdvanceHours] = useState("");
  const [cashAmountDollars, setCashAmountDollars] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  return (
    <div className="card card-pad space-y-4">
      <div>
        <div className="text-sm font-semibold">Advance Log</div>
        <p className="text-xs muted">Log any advance you received so management can verify before payroll.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs muted">Store</label>
          <select className="select" value={storeId} onChange={e => setStoreId(e.target.value)}>
            <option value="" disabled>Select a store</option>
            {stores.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs muted">Date</label>
          <input type="date" className="input" value={advanceDate} onChange={e => setAdvanceDate(e.target.value)} />
        </div>
        <div>
          <label className="text-xs muted">Advance Hours (required)</label>
          <input
            className="input"
            placeholder="e.g. 5"
            value={advanceHours}
            onChange={e => setAdvanceHours(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs muted">Cash Amount $ (optional)</label>
          <input
            className="input"
            placeholder="e.g. 50"
            value={cashAmountDollars}
            onChange={e => setCashAmountDollars(e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="text-xs muted">Note (optional)</label>
        <input
          className="input"
          placeholder="Anything management should know?"
          value={note}
          onChange={e => setNote(e.target.value)}
        />
      </div>

      {error && <div className="banner banner-error text-sm">{error}</div>}
      {ok && <div className="banner text-sm">{ok}</div>}

      <button
        className="btn-primary px-4 py-2 disabled:opacity-50"
        disabled={saving || loading}
        onClick={async () => {
          setError(null);
          setOk(null);
          if (!storeId) {
            setError("Please select a store.");
            return;
          }
          const hours = Number(advanceHours);
          if (!Number.isFinite(hours) || hours <= 0) {
            setError("Please enter a valid advance hour value.");
            return;
          }

          setSaving(true);
          const result = await onSubmit({
            storeId,
            advanceDate: `${advanceDate}T12:00:00-06:00`,
            advanceHours: hours,
            cashAmountDollars: cashAmountDollars.trim() === "" ? null : Number(cashAmountDollars),
            note: note.trim() === "" ? null : note.trim(),
          });
          setSaving(false);
          if (!result.ok) {
            setError(typeof result.error === "string" ? result.error : "Failed to submit advance.");
            return;
          }
          setAdvanceHours("");
          setCashAmountDollars("");
          setNote("");
          setOk("Advance submitted. Management will verify it before payroll.");
        }}
      >
        {saving ? "Saving..." : "Submit Advance"}
      </button>

      <div className="space-y-2">
        <div className="text-sm font-semibold">My Advance Entries</div>
        {rows.length === 0 && <div className="text-sm muted">No advance entries yet.</div>}
        {rows.map(row => (
          <div key={row.id} className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm space-y-1">
            <div className="flex items-center justify-between">
              <div className="font-semibold">{row.store?.name ?? "Store"}</div>
              <span className={`text-xs ${
                row.status === "verified" ? "text-green-400" : row.status === "voided" ? "text-red-400" : "text-amber-300"
              }`}>
                {row.status.replace("_", " ").toUpperCase()}
              </span>
            </div>
            <div className="text-xs muted">
              {new Date(row.advance_date).toLocaleString("en-US", {
                timeZone: "America/Chicago",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </div>
            <div>Hours: {row.advance_hours}</div>
            {row.cash_amount_cents != null && <div>Cash: ${(row.cash_amount_cents / 100).toFixed(2)}</div>}
            {row.note && <div className="text-xs muted">Note: {row.note}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
