"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

interface Profile { id: string; full_name: string | null; }
interface Store   { id: string; name: string; }

interface ShiftRow {
  id: string;
  user_id: string;
  full_name: string | null;
  store_id: string;
  start_at: string;
  end_at: string;
  minutes: number;
  rounded_hours: number;
}

function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function endOfDay(d: Date)   { const x = new Date(d); x.setHours(23,59,59,999); return x; }

function roundMinutes(mins: number) {
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (rem < 20) return hours;
  if (rem > 40) return hours + 1;
  return hours + 0.5;
}

export default function PayrollAdminPage() {
  // default range = this week
  const today  = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));

  const [from, setFrom]               = useState(toISODate(monday));
  const [to, setTo]                   = useState(toISODate(today));
  const [profiles, setProfiles]       = useState<Profile[]>([]);
  const [stores, setStores]           = useState<Store[]>([]);
  const [selectedUser, setSelectedUser]   = useState<string>("all");
  const [selectedStore, setSelectedStore] = useState<string>("all");
  const [rows, setRows]               = useState<ShiftRow[]>([]);
  const [loading, setLoading]         = useState(false);
  const [err, setErr]                 = useState<string | null>(null);

  // dropdowns
  useEffect(() => {
    (async () => {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name")
        .order("full_name", { ascending: true });
      setProfiles(profs ?? []);

      const { data: sts } = await supabase
        .from("stores")
        .select("id, name")
        .order("name", { ascending: true });
      setStores(sts ?? []);
    })();
  }, []);

  const runReport = useCallback(async () => {
    try {
      setErr(null);
      setLoading(true);

      const fromISO = startOfDay(new Date(from)).toISOString();
      const toISO   = endOfDay(new Date(to)).toISOString();

      // 1) fetch per-shift rows via RPC (RLS-safe)
      const { data: rpcRows, error: rpcErr } = await supabase.rpc("payroll_shifts_range", {
        p_from: fromISO,
        p_to:   toISO,
      });
      if (rpcErr) throw rpcErr;

      type RpcRow = { id: string; user_id: string; store_id: string; start_at: string; end_at: string };

      // optional client-side filtering for user/store dropdowns
      let raw: RpcRow[] = (rpcRows ?? []) as RpcRow[];
      if (selectedUser !== "all")  raw = raw.filter(r => r.user_id === selectedUser);
      if (selectedStore !== "all") raw = raw.filter(r => r.store_id === selectedStore);

      // 2) fetch names for those user_ids
      const userIds = Array.from(new Set(raw.map(r => r.user_id)));
      const nameMap = new Map<string, string | null>();
      if (userIds.length) {
        const { data: profs, error: profErr } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);
        if (profErr) throw profErr;
        (profs ?? []).forEach(p => nameMap.set(p.id, p.full_name));
      }

      // 3) compute durations
      const processed: ShiftRow[] = raw.map(r => {
        const start = new Date(r.start_at);
        const end   = new Date(r.end_at);
        const mins  = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
        return {
          id: r.id,
          user_id: r.user_id,
          full_name: nameMap.get(r.user_id) ?? null,
          store_id: r.store_id,
          start_at: r.start_at,
          end_at: r.end_at,
          minutes: mins,
          rounded_hours: roundMinutes(mins),
        };
      });

      setRows(processed);
    } catch (e: unknown) {
      console.error("Payroll run error:", e);
      setErr(e instanceof Error ? e.message : "Failed to run report");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [from, to, selectedUser, selectedStore]);

  useEffect(() => { void runReport(); }, [runReport]);

  const totalMinutes = useMemo(() => rows.reduce((a, r) => a + r.minutes, 0), [rows]);
  const totalRounded = useMemo(() => rows.reduce((a, r) => a + r.rounded_hours, 0), [rows]);

  function exportCsv() {
    const header = ["shift_id","user_id","full_name","store_id","start_at","end_at","minutes","rounded_hours"];
    const lines = [header.join(",")].concat(
      rows.map(r => [
        r.id,
        r.user_id,
        `"${(r.full_name || "Unknown").replace(/"/g,'""')}"`,
        r.store_id,
        r.start_at,
        r.end_at,
        r.minutes,
        r.rounded_hours,
      ].join(","))
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `payroll_${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
  return (
    <div className="app-shell">
      <div className="max-w-5xl mx-auto space-y-6">
        <h1 className="text-2xl font-semibold">Payroll Admin</h1>

        <div className="card card-pad grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
          <div>
            <label className="text-sm muted">From</label>
            <input type="date" className="input" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-sm muted">To</label>
            <input type="date" className="input" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div>
            <label className="text-sm muted">User</label>
            <select className="select" value={selectedUser} onChange={e => setSelectedUser(e.target.value)}>
              <option value="all">All</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.full_name || p.id.slice(0,8)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm muted">Store</label>
            <select className="select" value={selectedStore} onChange={e => setSelectedStore(e.target.value)}>
              <option value="all">All</option>
              {stores.map(s => (
                <option key={s.id} value={s.id}>{s.name || s.id}</option>
              ))}
            </select>
          </div>
          <button onClick={runReport} className="h-12 btn-primary px-4 disabled:opacity-50" disabled={loading}>
            {loading ? "Running..." : "Run"}
          </button>
          <button onClick={exportCsv} className="h-12 btn-secondary px-4 disabled:opacity-50" disabled={!rows.length}>
            Export CSV
          </button>
        </div>

        {err && <div className="banner banner-error text-sm">{err}</div>}

        <div className="card">
          <div className="px-3 py-2 font-medium border-b border-white/10">Shifts</div>
          <table className="w-full text-sm">
            <thead className="bg-black/40">
              <tr>
                <th className="text-left px-3 py-2">Employee</th>
                <th className="text-left px-3 py-2">Store</th>
                <th className="text-left px-3 py-2">Start</th>
                <th className="text-left px-3 py-2">End</th>
                <th className="text-right px-3 py-2">Minutes</th>
                <th className="text-right px-3 py-2">Rounded Hours</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t border-white/10">
                  <td className="px-3 py-2">{r.full_name || "Unknown"}</td>
                  <td className="px-3 py-2">{r.store_id}</td>
                  <td className="px-3 py-2">{new Date(r.start_at).toLocaleString()}</td>
                  <td className="px-3 py-2">{new Date(r.end_at).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{r.minutes}</td>
                  <td className="px-3 py-2 text-right">{r.rounded_hours}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td className="px-3 py-6 text-center muted" colSpan={6}>No shifts in range.</td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="bg-black/40">
                <tr className="font-medium">
                  <td className="px-3 py-2 text-right" colSpan={4}>Totals:</td>
                  <td className="px-3 py-2 text-right">{totalMinutes}</td>
                  <td className="px-3 py-2 text-right">{totalRounded}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
