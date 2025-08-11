// src/app/run/[shiftId]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Item = {
  id: string;
  text: string;
  required: boolean;
  required_for: "clock_in" | "clock_out" | "none";
  manager_only: boolean;
};

export default function ShiftRunPage() {
  const { shiftId } = useParams() as { shiftId: string };
  const router = useRouter();

  const [runId, setRunId] = useState<string | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Load run + items
  useEffect(() => {
    (async () => {
      setErr(null);
      setLoading(true);
      try {
        // 1) Grab the run tied to this shift
        const { data: run, error: runErr } = await supabase
          .from("checklist_runs")
          .select("id, store_id, checklist_id")
          .eq("shift_id", shiftId)
          .limit(1)
          .single();
        if (runErr) throw runErr;
        setRunId(run.id);
        setStoreId(run.store_id);

        // 2) Load checklist items
        const { data: its, error: itemsErr } = await supabase
          .from("checklist_items")
          .select("id, text, required, required_for, manager_only")
          .eq("checklist_id", run.checklist_id)
          .order("order_num");
        if (itemsErr) throw itemsErr;

        setItems(its ?? []);

        // 3) Load any checks already done
        const { data: checks, error: checksErr } = await supabase
          .from("checklist_item_checks")
          .select("item_id")
          .eq("run_id", run.id);
        if (checksErr) throw checksErr;

        setDone(new Set((checks ?? []).map(c => c.item_id)));
      } catch (e: any) {
        setErr(e.message ?? "Failed to load run");
      } finally {
        setLoading(false);
      }
    })();
  }, [shiftId]);

  const requiredIds = useMemo(
    () => items.filter(i => i.required && i.required_for === "clock_out").map(i => i.id),
    [items]
  );
  const remainingRequired = useMemo(
    () => requiredIds.filter(id => !done.has(id)).length,
    [requiredIds, done]
  );
  const canClockOut = remainingRequired === 0 && !!runId;

  async function checkItem(itemId: string) {
    if (!runId) return;
    if (done.has(itemId)) return; // keep v1 simple: no uncheck
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");

      const { error } = await supabase
        .from("checklist_item_checks")
        .insert({ run_id: runId, item_id: itemId, checked_by: user.id });
      if (error) throw error;

      setDone(prev => new Set(prev).add(itemId));
    } catch (e: any) {
      setErr(e.message ?? "Failed to check item");
    }
  }

  async function clockOut() {
    try {
      const { error } = await supabase
        .from("shifts")
        .update({ end_at: new Date().toISOString(), status: "closed" })
        .eq("id", shiftId);
      if (error) throw error;
      router.replace("/clock");
    } catch (e: any) {
      setErr(e.message ?? "Failed to clock out");
    }
  }

  if (loading) return <div className="p-6">Loading…</div>;

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-md mx-auto space-y-4">
        <h1 className="text-2xl font-semibold">Opening Checklist</h1>
        {storeId && <p className="text-sm text-gray-600">Store: <b>{storeId}</b></p>}
        {err && <div className="text-sm text-red-600 border border-red-300 rounded p-3">{err}</div>}

        {items.length === 0 ? (
          <div className="text-sm border rounded p-3">
            No items for this checklist. If the user is a manager and you only seeded clerk tasks, either
            seed a manager opening list or test as a clerk.
          </div>
        ) : (
          <ul className="border rounded divide-y">
            {items.map(it => {
              const isDone = done.has(it.id);
              return (
                <li key={it.id} className="flex items-center justify-between p-3">
                  <div>
                    <div>{it.text}</div>
                    <div className="text-xs text-gray-500">
                      {it.required && it.required_for === "clock_out" ? "Required for clock out" : "Optional"}
                      {it.manager_only ? " • Manager only" : ""}
                    </div>
                  </div>
                  <button
                    onClick={() => checkItem(it.id)}
                    disabled={isDone}
                    className={`px-3 py-1 rounded ${isDone ? "bg-green-500 text-white" : "bg-gray-200"}`}
                  >
                    {isDone ? "Done" : "Check"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="space-y-2">
          <p className="text-sm">
            {remainingRequired > 0
              ? `Finish ${remainingRequired} required item${remainingRequired === 1 ? "" : "s"} to enable Clock Out.`
              : "All required items done."}
          </p>
          <button
            onClick={clockOut}
            disabled={!canClockOut}
            className="w-full rounded py-2 bg-black text-white disabled:opacity-50"
          >
            Clock Out
          </button>
        </div>
      </div>
    </div>
  );
}
