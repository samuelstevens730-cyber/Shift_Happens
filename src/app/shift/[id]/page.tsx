"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { toLocalInputValue } from "@/lib/date";

function ChangeoverPanel({
  shiftId,
  confirmed,
  onConfirmed,
}: {
  shiftId: string;
  confirmed: boolean;
  onConfirmed: (v: boolean) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  if (confirmed) {
    return (
      <div className="border rounded p-3 text-sm text-green-700">
        Changeover confirmed for this shift.
      </div>
    );
  }
  return (
    <div className="border rounded p-3 space-y-2">
      <p className="text-sm">Mid‑shift handoff requires drawer count and changeover.</p>
      {error && (
        <div className="text-sm text-red-600 border border-red-300 rounded p-2">
          {error}
        </div>
      )}
      <button
        className="rounded bg-black text-white px-3 py-2"
        onClick={async () => {
          const { error } = await supabase.rpc("confirm_changeover", { p_shift_id: shiftId });
          if (error) { setError(error.message); return; }
          setError(null);
          onConfirmed(true);
        }}
      >
        I did changeover
      </button>
    </div>
  );
}

function ClockOutModal({
  shiftId,
  onClose,
  onSuccess,
}: {
  shiftId: string;
  onClose: () => void;
  onSuccess: () => void; // navigate to receipt page
}) {
  const [endLocal, setEndLocal] = useState(toLocalInputValue());
  const [error, setError] = useState<string | null>(null);
  const closingItems = [
    "Close Credit Card Batch",
    "Print Z-Report",
    "Match Credit Card Summary Total and Z-Report Charge total",
    "Count till and change drawer",
    "Fill out Sales Worksheet using numbers from both Reports",
    "Take report picture and post to sales group.",
  ];
  const [closingChecks, setClosingChecks] = useState<boolean[]>(
    closingItems.map(() => false)
  );
  const [doubleCheck, setDoubleCheck] = useState(false);

  const endDate = new Date(endLocal);
  const endHour = endDate.getHours();
  const isClosingShift = !Number.isNaN(endHour) && (endHour >= 20 || endHour === 0);
  const allClosingDone = closingChecks.every(Boolean);

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl p-4 space-y-3">
        <h2 className="text-lg font-semibold">End Shift</h2>

        <label className="text-sm">End time</label>
        <input
          type="datetime-local"
          className="w-full border rounded p-2"
          value={endLocal}
          onChange={e => setEndLocal(e.target.value)}
        />
        {error && (
          <div className="text-sm text-red-600 border border-red-300 rounded p-2">
            {error}
          </div>
        )}
        {isClosingShift && (
          <div className="space-y-2">
            <div className="text-sm font-medium">Closing Checklist</div>
            <ul className="border rounded divide-y">
              {closingItems.map((text, idx) => (
                <li key={idx} className="flex items-center gap-2 p-2 text-sm">
                  <input
                    type="checkbox"
                    checked={closingChecks[idx]}
                    onChange={e => {
                      setClosingChecks(prev => {
                        const copy = [...prev];
                        copy[idx] = e.target.checked;
                        return copy;
                      });
                    }}
                  />
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={doubleCheck}
            onChange={e => setDoubleCheck(e.target.checked)}
          />
          I understand I’m ending my shift.
        </label>

        <div className="flex gap-2 justify-end">
          <button className="px-3 py-1.5 rounded border" onClick={onClose}>Cancel</button>
          <button
            disabled={!doubleCheck || (isClosingShift && !allClosingDone)}
            className="px-3 py-1.5 rounded bg-black text-white disabled:opacity-50"
            onClick={async () => {
              setError(null);
              const d = new Date(endLocal);
              if (Number.isNaN(d.getTime())) {
                setError("Invalid date/time.");
                return;
              }
              const { error: rpcError } = await supabase.rpc("end_shift", {
                p_shift_id: shiftId,
                p_end_at: d.toISOString(),
                p_closing_confirm: isClosingShift && allClosingDone,
                p_manager_override: false,
              });
              if (rpcError) { setError(rpcError.message); return; }
              // close modal, then navigate to the receipt page
              onClose();
              onSuccess();
            }}
          >
            Confirm End Shift
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ShiftPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const shiftId = id;

  const [loading, setLoading] = useState(true);
  const [storeId, setStoreId] = useState<string>("");
  const [startAt, setStartAt] = useState<string>("");
  const [changeoverConfirmed, setChangeoverConfirmed] = useState(false);
  const [showClockOut, setShowClockOut] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    (async () => {
      setErr(null);
      setLoading(true);
      const { data, error } = await supabase
        .from("shifts")
        .select("store_id, start_at, changeover_confirmed, end_at")
        .eq("id", shiftId)
        .maybeSingle();

      if (error) { setErr(error.message); setLoading(false); return; }
      if (!data) { setErr("Shift not found."); setLoading(false); return; }
      if (ignore) return;

      setStoreId(data.store_id);
      setStartAt(data.start_at);
      setChangeoverConfirmed(Boolean(data.changeover_confirmed));

      if (data.end_at) {
        router.replace(`/shift/${shiftId}/done`);
        return;
      }
      setLoading(false);
    })();
    return () => { ignore = true; };
  }, [shiftId, router]);

  const minutesSoFar = useMemo(() => {
    if (!startAt) return 0;
    return Math.floor((Date.now() - new Date(startAt).getTime()) / 60000);
  }, [startAt]);

  if (loading) return <div className="p-6">Loading…</div>;
  if (err) return <div className="p-6 text-red-600">{err}</div>;

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-md mx-auto space-y-4">
        <h1 className="text-2xl font-semibold">Shift</h1>
        <div className="text-sm text-gray-600">
          Store: <b>{storeId}</b> · Started: {new Date(startAt).toLocaleString()} · {minutesSoFar} min elapsed
        </div>

        <ChangeoverPanel
          shiftId={shiftId}
          confirmed={changeoverConfirmed}
          onConfirmed={setChangeoverConfirmed}
        />

        <button
          className="w-full rounded bg-black text-white py-2 disabled:opacity-50"
          disabled={!changeoverConfirmed}
          onClick={() => setShowClockOut(true)}
        >
          Clock Out
        </button>

        {showClockOut && (
          <ClockOutModal
            shiftId={shiftId}
            onClose={() => setShowClockOut(false)}
            onSuccess={() => router.replace(`/shift/${shiftId}/done`)}
          />
        )}
      </div>
    </div>
  );
}
