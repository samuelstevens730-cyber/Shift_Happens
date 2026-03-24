"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ReportRow = {
  id: string;
  shiftId: string;
  status: "completed" | "skipped";
  shiftType: "am" | "pm" | null;
  taskName: string | null;
  taskCategory: string | null;
  employeeName: string | null;
  completedByName: string | null;
  completedAt: string;
  skippedReason: string | null;
};

type ReportStore = {
  id: string;
  name: string;
  rows: ReportRow[];
};

type CleaningReportResponse =
  | {
      date: string | null;
      stores: ReportStore[];
    }
  | { error: string };

function formatWhen(value: string) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function CleaningAuditPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isAuthed, setIsAuthed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportDate, setReportDate] = useState("");
  const [stores, setStores] = useState<ReportStore[]>([]);

  const loadReport = async (date?: string) => {
    setError(null);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token || "";
    if (!token) {
      router.replace("/login?next=/admin/cleaning/report");
      return;
    }

    const qs = date ? `?date=${encodeURIComponent(date)}` : "";
    const res = await fetch(`/api/admin/cleaning/report${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json()) as CleaningReportResponse;
    if (!res.ok || "error" in json) {
      setError("error" in json ? json.error : "Failed to load cleaning audit.");
      return;
    }

    setReportDate(json.date ?? "");
    setStores(json.stores ?? []);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!alive) return;
        if (!user) {
          router.replace("/login?next=/admin/cleaning/report");
          return;
        }
        setIsAuthed(true);
      } catch (e: unknown) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to check auth.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  useEffect(() => {
    if (!isAuthed) return;
    void loadReport();
  }, [isAuthed]);

  if (loading) return <div className="app-shell">Loading...</div>;
  if (!isAuthed) return null;

  return (
    <div className="app-shell">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold uppercase tracking-tight text-[var(--text)]">Cleaning Audit</h1>
            <div className="text-sm muted">Completed and skipped cleaning tasks by store</div>
          </div>
          <Link href="/admin/cleaning" className="btn-secondary px-4 py-2 text-sm">
            Back to Cleaning Setup
          </Link>
        </div>

        {error && <div className="banner banner-error text-sm">{error}</div>}

        <div className="card card-pad flex flex-wrap items-end gap-3">
          <label className="space-y-1">
            <div className="text-sm muted">Business Date</div>
            <input
              className="input"
              type="date"
              value={reportDate}
              onChange={(e) => setReportDate(e.target.value)}
            />
          </label>
          <button className="btn-primary px-4 py-2" onClick={() => void loadReport(reportDate)}>
            Load Report
          </button>
        </div>

        <div className="space-y-4">
          {stores.map((store) => (
            <div key={store.id} className="card card-pad space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-lg font-medium">{store.name}</div>
                <div className="text-sm muted">{store.rows.length} marked task(s)</div>
              </div>

              {store.rows.length ? (
                <div className="overflow-x-auto">
                  <table className="min-w-[900px] w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-400">
                        <th className="px-2 py-2">Status</th>
                        <th className="px-2 py-2">Shift</th>
                        <th className="px-2 py-2">Task</th>
                        <th className="px-2 py-2">Employee</th>
                        <th className="px-2 py-2">Marked By</th>
                        <th className="px-2 py-2">Marked At</th>
                        <th className="px-2 py-2">Skip Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {store.rows.map((row) => (
                        <tr key={row.id} className="border-t border-[var(--cardBorder)]">
                          <td className="px-2 py-2">
                            <span className={row.status === "completed" ? "text-emerald-400" : "text-amber-300"}>
                              {row.status}
                            </span>
                          </td>
                          <td className="px-2 py-2 uppercase">{row.shiftType ?? "--"}</td>
                          <td className="px-2 py-2">
                            <div>{row.taskName ?? "--"}</div>
                            {row.taskCategory ? <div className="text-xs muted">{row.taskCategory}</div> : null}
                          </td>
                          <td className="px-2 py-2">{row.employeeName ?? "--"}</td>
                          <td className="px-2 py-2">{row.completedByName ?? "--"}</td>
                          <td className="px-2 py-2">{formatWhen(row.completedAt)}</td>
                          <td className="px-2 py-2">{row.skippedReason ?? "--"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-sm muted">No cleaning tasks were marked for this store on that date.</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

