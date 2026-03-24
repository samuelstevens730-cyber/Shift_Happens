"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ReviewStatus = "draft" | "pending" | "approved" | "rejected";

type AdminReviewRow = {
  id: string;
  store_id: string;
  store_name: string;
  profile_id: string;
  employee_name: string;
  submitted_by_type: "employee" | "manager";
  review_date: string;
  status: ReviewStatus;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
  rejection_reason: string | null;
  notes: string | null;
  created_at: string;
  screenshot_url: string | null;
};

type AdminReviewsResponse = {
  month: string;
  storeId: string;
  stores: Array<{ id: string; name: string }>;
  employees: Array<{ profileId: string; name: string }>;
  reviews: AdminReviewRow[];
};

type UploadResponse = { uploadUrl: string; reviewId: string };

function cstMonthKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
}

function monthLabel(month: string): string {
  const [year, monthNum] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNum - 1, 1));
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function cstDateKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function fileExtension(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return ext === "jpeg" ? "jpg" : ext;
}

function relativeTime(iso: string): string {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return iso;
  const diffMin = Math.round((Date.now() - time) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.round(diffHour / 24);
  return `${diffDay}d ago`;
}

export default function AdminReviewsPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [month, setMonth] = useState(() => cstMonthKey());
  const [storeId, setStoreId] = useState("all");
  const [status, setStatus] = useState("all");
  const [stores, setStores] = useState<Array<{ id: string; name: string }>>([]);
  const [employees, setEmployees] = useState<Array<{ profileId: string; name: string }>>([]);
  const [reviews, setReviews] = useState<AdminReviewRow[]>([]);

  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowNotes, setRowNotes] = useState<Record<string, string>>({});
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});
  const [rejectOpen, setRejectOpen] = useState<Record<string, boolean>>({});
  const [deleteOpen, setDeleteOpen] = useState<Record<string, boolean>>({});

  const [submitEmployeeId, setSubmitEmployeeId] = useState("");
  const [submitDate, setSubmitDate] = useState(() => cstDateKey());
  const [submitFile, setSubmitFile] = useState<File | null>(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  async function fetchReviews(nextStoreId = storeId, nextStatus = status, nextMonth = month) {
    if (!token) return;
    const query = new URLSearchParams({
      storeId: nextStoreId,
      status: nextStatus,
      month: nextMonth,
    });
    const res = await fetch(`/api/admin/reviews?${query.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json()) as AdminReviewsResponse | { error?: string };
    if (!res.ok) throw new Error(("error" in json && json.error) || "Failed to load reviews.");
    const payload = json as AdminReviewsResponse;
    setStores(payload.stores ?? []);
    setEmployees(payload.employees ?? []);
    setReviews(payload.reviews ?? []);
    if (nextStoreId !== "all" && !(payload.stores ?? []).some((s) => s.id === nextStoreId)) {
      setStoreId("all");
    }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) {
          router.replace("/login?next=/admin/reviews");
          return;
        }
        if (!alive) return;
        setToken(session.access_token);
      } catch (e: unknown) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to authenticate.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        await fetchReviews();
      } catch (e: unknown) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load reviews.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, storeId, status, month]);

  const approvedSummary = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const row of reviews) {
      if (row.status !== "approved") continue;
      const current = counts.get(row.profile_id) ?? { name: row.employee_name, count: 0 };
      current.count += 1;
      counts.set(row.profile_id, current);
    }
    return [...counts.entries()]
      .map(([profileId, value]) => ({ profileId, ...value }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [reviews]);

  const queue = useMemo(
    () =>
      reviews
        .filter((row) => row.status === "pending")
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [reviews]
  );

  async function patchReview(id: string, action: "approve" | "reject") {
    if (!token) return;
    setSavingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reviews/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action,
          notes: rowNotes[id] ?? "",
          rejectionReason: action === "reject" ? rejectReason[id] ?? "" : null,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Failed to update review.");
      await fetchReviews();
      setRejectOpen((prev) => ({ ...prev, [id]: false }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update review.");
    } finally {
      setSavingId(null);
    }
  }

  async function deleteReview(id: string) {
    if (!token) return;
    setSavingId(id);
    try {
      const res = await fetch(`/api/admin/reviews/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Failed to delete review.");
      await fetchReviews();
      setDeleteOpen((prev) => ({ ...prev, [id]: false }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete review.");
    } finally {
      setSavingId(null);
    }
  }

  async function exportCsv() {
    if (!token) return;
    const query = new URLSearchParams({ storeId, status, month });
    const res = await fetch(`/api/admin/reviews/export?${query.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(json?.error || "Failed to export CSV.");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `reviews-${month}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function submitManagerReview() {
    if (!token) return;
    if (!submitEmployeeId || !submitFile) {
      setSubmitErr("Employee and screenshot are required.");
      return;
    }
    if (storeId === "all") {
      setSubmitErr("Pick a specific store first.");
      return;
    }
    setSubmitBusy(true);
    setSubmitErr(null);
    setSubmitMsg(null);
    try {
      const ext = fileExtension(submitFile.name);
      const uploadRes = await fetch("/api/reviews/upload-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          fileExtension: ext,
          storeId,
          profileId: submitEmployeeId,
        }),
      });
      const uploadJson = (await uploadRes.json()) as UploadResponse | { error?: string };
      if (!uploadRes.ok) {
        throw new Error(("error" in uploadJson && uploadJson.error) || "Failed to prepare upload.");
      }
      const { uploadUrl, reviewId } = uploadJson as UploadResponse;
      const putRes = await fetch(uploadUrl, { method: "PUT", body: submitFile });
      if (!putRes.ok) throw new Error("Failed to upload screenshot.");

      const finalizeRes = await fetch("/api/reviews/finalize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          reviewId,
          profileId: submitEmployeeId,
          storeId,
          reviewDate: submitDate,
        }),
      });
      const finalizeJson = (await finalizeRes.json()) as { error?: string };
      if (!finalizeRes.ok) {
        throw new Error(finalizeJson.error || "Failed to finalize review.");
      }

      const approveRes = await fetch(`/api/admin/reviews/${reviewId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: "approve" }),
      });
      const approveJson = (await approveRes.json()) as { error?: string };
      if (!approveRes.ok) {
        throw new Error(approveJson.error || "Failed to auto-approve review.");
      }

      setSubmitMsg("Review approved.");
      setSubmitFile(null);
      await fetchReviews();
    } catch (e: unknown) {
      setSubmitErr(e instanceof Error ? e.message : "Failed to submit review.");
    } finally {
      setSubmitBusy(false);
    }
  }

  if (loading) {
    return <div className="app-shell">Loading...</div>;
  }

  return (
    <div className="app-shell">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold uppercase tracking-tight text-[var(--text)]">Reviews Admin — {monthLabel(month)}</h1>
        </div>

        {error && <div className="banner banner-error">{error}</div>}

        <div className="card card-pad grid gap-3 sm:grid-cols-4">
          <label className="text-sm">
            Month
            <input type="month" className="input mt-1" value={month} onChange={(e) => setMonth(e.target.value)} />
          </label>
          <label className="text-sm">
            Store
            <select className="select mt-1" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              <option value="all">All Stores</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Status
            <select className="select mt-1" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="draft">Draft</option>
            </select>
          </label>
          <div className="self-end">
            <button className="btn-primary px-3 py-1.5 w-full" onClick={exportCsv}>
              Export CSV
            </button>
          </div>
        </div>

        <div className="card card-pad">
          <div className="mb-2 text-sm font-semibold">Scoreboard Summary (Approved)</div>
          {approvedSummary.length === 0 ? (
            <div className="text-sm muted">No approved reviews in this view.</div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {approvedSummary.map((row, index) => (
                <div key={row.profileId} className="rounded border border-white/10 px-3 py-2 text-sm">
                  <span className="muted mr-2">#{index + 1}</span>
                  <span>{row.name}</span>
                  <span className="float-right font-semibold">{row.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {queue.length > 0 && (
          <div className="card card-pad space-y-3">
            <div className="text-sm font-semibold">Approval Queue</div>
            {queue.map((row) => (
              <div key={row.id} className="rounded-lg border border-white/10 p-3 space-y-2">
                <div className="flex flex-wrap justify-between gap-2 text-sm">
                  <div>
                    <b>{row.employee_name}</b> · {row.store_name} · {row.review_date}
                  </div>
                  <div className="muted">
                    {row.submitted_by_type} · {relativeTime(row.created_at)}
                  </div>
                </div>
                {row.screenshot_url && (
                  <a href={row.screenshot_url} target="_blank" rel="noreferrer">
                    <img src={row.screenshot_url} alt="Review screenshot" className="rounded max-h-48 border border-white/15" />
                  </a>
                )}
                <textarea
                  className="input min-h-[72px]"
                  placeholder="Notes (optional)"
                  value={rowNotes[row.id] ?? ""}
                  onChange={(event) => setRowNotes((prev) => ({ ...prev, [row.id]: event.target.value }))}
                />
                {rejectOpen[row.id] && (
                  <input
                    className="input"
                    placeholder="Rejection reason"
                    value={rejectReason[row.id] ?? ""}
                    onChange={(event) => setRejectReason((prev) => ({ ...prev, [row.id]: event.target.value }))}
                  />
                )}
                <div className="flex gap-2">
                  <button
                    className="btn-primary px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500"
                    disabled={savingId === row.id}
                    onClick={() => patchReview(row.id, "approve")}
                  >
                    Approve
                  </button>
                  {!rejectOpen[row.id] ? (
                    <button
                      className="btn-secondary px-3 py-1.5"
                      onClick={() => setRejectOpen((prev) => ({ ...prev, [row.id]: true }))}
                    >
                      Reject
                    </button>
                  ) : (
                    <button
                      className="btn-secondary px-3 py-1.5"
                      disabled={savingId === row.id}
                      onClick={() => patchReview(row.id, "reject")}
                    >
                      Confirm Reject
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="card card-pad space-y-3">
          <div className="text-sm font-semibold">All Reviews</div>
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left border-b border-white/10">
                  <th className="py-2 pr-3">Employee</th>
                  <th className="py-2 pr-3">Store</th>
                  <th className="py-2 pr-3">Review Date</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Submitted</th>
                  <th className="py-2 pr-3">Reviewed By</th>
                  <th className="py-2 pr-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((row) => (
                  <tr key={row.id} className="border-b border-white/5 align-top">
                    <td className="py-2 pr-3">{row.employee_name}</td>
                    <td className="py-2 pr-3">{row.store_name}</td>
                    <td className="py-2 pr-3">{row.review_date}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          row.status === "approved"
                            ? "bg-emerald-500/20 text-emerald-200"
                            : row.status === "pending"
                              ? "bg-amber-500/20 text-amber-200"
                              : row.status === "rejected"
                                ? "bg-red-500/20 text-red-200"
                                : "bg-zinc-500/20 text-zinc-200"
                        }`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="py-2 pr-3">{relativeTime(row.created_at)}</td>
                    <td className="py-2 pr-3">{row.reviewed_by_name ?? "--"}</td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-2">
                        {row.screenshot_url && (
                          <a href={row.screenshot_url} target="_blank" rel="noreferrer" className="btn-secondary px-2 py-1 text-xs">
                            View
                          </a>
                        )}
                        {!deleteOpen[row.id] ? (
                          <button
                            className="btn-secondary px-2 py-1 text-xs"
                            onClick={() => setDeleteOpen((prev) => ({ ...prev, [row.id]: true }))}
                          >
                            Delete
                          </button>
                        ) : (
                          <>
                            <button
                              className="btn-secondary px-2 py-1 text-xs"
                              disabled={savingId === row.id}
                              onClick={() => deleteReview(row.id)}
                            >
                              Confirm
                            </button>
                            <button
                              className="btn-secondary px-2 py-1 text-xs"
                              onClick={() => setDeleteOpen((prev) => ({ ...prev, [row.id]: false }))}
                            >
                              Cancel
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {reviews.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-4 text-center muted">
                      No reviews found for these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card card-pad space-y-3">
          <div className="text-sm font-semibold">Manager Direct Submit</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              Employee
              <select
                className="select mt-1"
                value={submitEmployeeId}
                onChange={(event) => setSubmitEmployeeId(event.target.value)}
              >
                <option value="">Select</option>
                {employees.map((row) => (
                  <option key={row.profileId} value={row.profileId}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Review Date
              <input
                type="date"
                className="input mt-1"
                value={submitDate}
                onChange={(event) => setSubmitDate(event.target.value)}
              />
            </label>
            <label className="text-sm">
              Screenshot
              <input
                type="file"
                className="mt-1 block w-full text-sm"
                accept="image/*"
                onChange={(event) => setSubmitFile(event.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary px-3 py-1.5" disabled={submitBusy} onClick={submitManagerReview}>
              {submitBusy ? "Submitting..." : "Submit & Auto-Approve"}
            </button>
          </div>
          {submitMsg && <div className="text-sm text-emerald-300">{submitMsg}</div>}
          {submitErr && <div className="text-sm text-red-300">{submitErr}</div>}
        </div>
      </div>
    </div>
  );
}
