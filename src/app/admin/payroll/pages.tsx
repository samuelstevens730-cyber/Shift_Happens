"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// types for dropdown options and rows
interface Profile { id: string; full_name: string | null; }
interface Store { id: string; name: string; }
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
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23,59,59,999); return x; }

function roundMinutes(mins: number) {
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  let add = 0;
  if (rem < 20) add = 0;
  else if (rem > 40) add = 1;
  else add = 0.5;
  return hours + add;
}

export default function PayrollAdminPage() {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));

  const [from, setFrom] = useState(toISODate(monday));
  const [to, setTo] = useState(toISODate(today));
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedUser, setSelectedUser] = useState<string>("all");
  const [selectedStore, setSelectedStore] = useState<string>("all");
  const [rows, setRows] = useState<ShiftRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);

  const hasAccess = role === "manager" || role === "owner";

  useEffect(() => {
    // check current user's role
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setErr("Not signed in."); return; }
      const { data, error } = await supabase
        .from("profiles")
        .select("global_role")
        .eq("id", user.id)
        .single();
      if (error) { setErr(error.message); return; }
      setRole(data?.global_role ?? null);
    })();
  }, []);

  useEffect(() => {
    if (!hasAccess) return;
    // load dropdown data
    (async () => {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id,full_name")
        .order("full_name");
      setProfiles(profs ?? []);
      const { data: sts } = await supabase
        .from("stores")
        .select("id,name")
        .order("name");
      setStores(sts ?? []);
    })();
  }, [hasAccess]);

  async function runReport() {
    try {
      setErr(null);
      setLoading(true);

      const fromISO = startOfDay(new Date(from)).toISOString();
      const toISO = endOfDay(new Date(to)).toISOString();

      let query = supabase
        .from("shifts")
        .select("id,user_id,start_at,end_at,store_id,profiles(full_name)")
        .gte("start_at", fromISO)
        .lte("start_at", toISO)
        .not("end_at", "is", null);

      if (selectedUser !== "all") query = query.eq("user_id", selectedUser);
      if (selectedStore !== "all") query = query.eq("store_id", selectedStore);

      const { data, error } = await query.order("start_at");
      if (error) throw error;

      type ShiftQueryResult = {
        id: string;
        user_id: string;
        start_at: string;
        end_at: string;
        store_id: string;
        profiles: { full_name: string | null } | null;
      };

      const processed = ((data as ShiftQueryResult[]) || []).map((r) => {
        const start = new Date(r.start_at);
        const end = new Date(r.end_at);
        const mins = Math.round((end.getTime() - start.getTime()) / 60000);
        return {
          id: r.id,
          user_id: r.user_id,
          full_name: r.profiles?.full_name ?? null,
          store_id: r.store_id,
          start_at: r.start_at,
          end_at: r.end_at,
          minutes: mins,
          rounded_hours: roundMinutes(mins),
        } as ShiftRow;
      });
      setRows(processed);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to run report");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  // intentionally only re-run when access level changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (hasAccess) runReport(); }, [hasAccess]);

  const totalMinutes = useMemo(() => rows.reduce((a,r) => a + r.minutes, 0), [rows]);
  const totalRounded = useMemo(() => rows.reduce((a,r) => a + r.rounded_hours, 0), [rows]);

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
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll_${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (role && !hasAccess) {
    return <div className="p-6">Access denied.</div>;
  }

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <h1 className="text-2xl font-semibold">Payroll Admin</h1>

        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
          <div>
            <label className="text-sm">From</label>
            <input type="date" className="w-full border rounded p-2" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-sm">To</label>
            <input type="date" className="w-full border rounded p-2" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div>
            <label className="text-sm">User</label>
            <select className="w-full border rounded p-2" value={selectedUser} onChange={e => setSelectedUser(e.target.value)}>
              <option value="all">All</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.full_name || p.id.slice(0,8)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm">Store</label>
            <select className="w-full border rounded p-2" value={selectedStore} onChange={e => setSelectedStore(e.target.value)}>
              <option value="all">All</option>
              {stores.map(s => (
                <option key={s.id} value={s.id}>{s.name || s.id}</option>
              ))}
            </select>
          </div>
          <button onClick={runReport} className="h-10 rounded bg-black text-white px-4 disabled:opacity-50" disabled={loading}>
            {loading ? "Running…" : "Run"}
          </button>
          <button onClick={exportCsv} className="h-10 rounded border px-4 disabled:opacity-50" disabled={!rows.length}>
            Export CSV
          </button>
        </div>

        {err && <div className="text-sm text-red-600 border border-red-300 rounded p-3">{err}</div>}

        <div className="border rounded">
          <div className="px-3 py-2 font-medium border-b">Shifts</div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
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
                <tr key={r.id} className="border-t">
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
                  <td className="px-3 py-6 text-center text-gray-500" colSpan={6}>No shifts in range.</td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="bg-gray-50">
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
