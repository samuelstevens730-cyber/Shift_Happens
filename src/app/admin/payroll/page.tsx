"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type TotalsRow = {
  user_id: string;
  full_name: string | null;
  minutes_total: number;
  hours_rounded_total: number;
  shift_count: number;
};

function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23,59,59,999); return x; }

export default function PayrollPage() {
  // default to current week
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));

  const [from, setFrom] = useState(toISODate(monday));
  const [to, setTo] = useState(toISODate(today));
  const [rows, setRows] = useState<TotalsRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function runReport() {
    try {
      setErr(null);
      setLoading(true);

      const fromISO = startOfDay(new Date(from)).toISOString();
      const toISO = endOfDay(new Date(to)).toISOString();

      const { data, error } = await supabase.rpc("payroll_totals", {
        p_from: fromISO,
        p_to: toISO,
      });

      if (error) throw error;

      // sort by name for sanity
      const sorted = (data ?? []).sort((a: TotalsRow, b: TotalsRow) =>
        (a.full_name || "").localeCompare(b.full_name || "")
      );
      setRows(sorted);
    } catch (e: any) {
      setErr(e.message ?? "Failed to run report");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { runReport(); }, []); // run once on mount

  const grand = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.shifts += r.shift_count;
        acc.minutes += r.minutes_total;
        acc.hoursRounded += r.hours_rounded_total;
        return acc;
      },
      { shifts: 0, minutes: 0, hoursRounded: 0 }
    );
  }, [rows]);

  function exportCsv() {
    const header = ["user_id","full_name","shift_count","minutes_total","hours_rounded_total"];
    const lines = [header.join(",")].concat(
      rows.map(r => [
        r.user_id,
        `"${(r.full_name || "Unknown").replace(/"/g, '""')}"`,
        r.shift_count,
        r.minutes_total,
        r.hours_rounded_total,
      ].join(","))
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll_totals_${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-2xl font-semibold">Payroll Totals</h1>
        <p className="text-sm text-gray-600">
          Sums hours per employee across all stores for the selected period. Names from <code>profiles.full_name</code>.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div>
            <label className="text-sm">From</label>
            <input type="date" className="w-full border rounded p-2"
                   value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-sm">To</label>
            <input type="date" className="w-full border rounded p-2"
                   value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <button
            onClick={runReport}
            className="h-10 rounded bg-black text-white px-4 disabled:opacity-50"
            disabled={loading}
          >
            {loading ? "Running…" : "Run"}
          </button>
          <button
            onClick={exportCsv}
            className="h-10 rounded border px-4 disabled:opacity-50"
            disabled={!rows.length}
          >
            Export CSV
          </button>
        </div>

        {err && <div className="text-sm text-red-600 border border-red-300 rounded p-3">{err}</div>}

        <div className="border rounded">
          <div className="px-3 py-2 font-medium border-b">Totals by Employee</div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2">Employee</th>
                <th className="text-right px-3 py-2">Shifts</th>
                <th className="text-right px-3 py-2">Minutes</th>
                <th className="text-right px-3 py-2">Rounded Hours</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.user_id} className="border-t">
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.full_name || "Unknown"}</div>
                    <div className="text-xs text-gray-500 font-mono">{r.user_id.slice(0,8)}</div>
                  </td>
                  <td className="px-3 py-2 text-right">{r.shift_count}</td>
                  <td className="px-3 py-2 text-right">{r.minutes_total}</td>
                  <td className="px-3 py-2 text-right">{r.hours_rounded_total}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td className="px-3 py-6 text-center text-gray-500" colSpan={4}>
                    No shifts in range.
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="bg-gray-50">
                <tr className="font-medium">
                  <td className="px-3 py-2 text-right">Grand totals:</td>
                  <td className="px-3 py-2 text-right">{grand.shifts}</td>
                  <td className="px-3 py-2 text-right">{grand.minutes}</td>
                  <td className="px-3 py-2 text-right">{grand.hoursRounded}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
