"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import HomeHeader from "@/components/HomeHeader";

const PIN_TOKEN_KEY = "sh_pin_token";
const PIN_STORE_KEY = "sh_pin_store_id";
const PIN_PROFILE_KEY = "sh_pin_profile_id";

type ReviewScoreRow = {
  profileId: string;
  name: string;
  count: number;
};

type ReviewSubmission = {
  id: string;
  store_id: string;
  profile_id: string;
  review_date: string;
  status: "pending" | "rejected";
  rejection_reason: string | null;
  created_at: string;
};

type StoreOption = { id: string; name: string };
type EmployeeOption = { profileId: string; name: string };

type ReviewsResponse = {
  month: string;
  scoreboard: ReviewScoreRow[];
  mySubmissions: ReviewSubmission[];
  employees: EmployeeOption[];
  stores: StoreOption[];
  profileId: string;
};

type UploadResponse = {
  uploadUrl: string;
  reviewId: string;
};

function cstMonthKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
}

function cstDateKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function monthLabel(month: string): string {
  const [year, monthNum] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNum - 1, 1));
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function fileExtension(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return ext === "jpeg" ? "jpg" : ext;
}

export default function ReviewsPage() {
  const router = useRouter();

  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isManager, setIsManager] = useState(false);
  const [navProfileId, setNavProfileId] = useState<string | null>(null);
  const [month] = useState(() => cstMonthKey());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [stores, setStores] = useState<StoreOption[]>([]);
  const [storeId, setStoreId] = useState<string>("all");
  const [scoreboard, setScoreboard] = useState<ReviewScoreRow[]>([]);
  const [mySubmissions, setMySubmissions] = useState<ReviewSubmission[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [myProfileId, setMyProfileId] = useState<string>("");

  const [reviewDate, setReviewDate] = useState(() => cstDateKey());
  const [earningProfileId, setEarningProfileId] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadedReviewId, setUploadedReviewId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const resolveToken = useCallback(async (): Promise<string | null> => {
    const pinToken = sessionStorage.getItem(PIN_TOKEN_KEY);
    if (pinToken) return pinToken;
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? null;
  }, []);

  const loadReviews = useCallback(
    async (nextStoreId: string, token: string) => {
      const query = new URLSearchParams({ storeId: nextStoreId, month });
      const res = await fetch(`/api/reviews?${query.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json()) as ReviewsResponse | { error?: string };
      if (!res.ok) {
        throw new Error(("error" in json && json.error) || "Failed to load reviews.");
      }
      const payload = json as ReviewsResponse;
      setScoreboard(payload.scoreboard ?? []);
      setMySubmissions(payload.mySubmissions ?? []);
      setEmployees(payload.employees ?? []);
      setStores(payload.stores ?? []);
      setMyProfileId(payload.profileId);
      setEarningProfileId((prev) => prev || payload.profileId);
    },
    [month]
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const token = await resolveToken();
        if (!token) {
          router.replace("/clock");
          return;
        }
        if (!alive) return;
        setAuthToken(token);

        // Check manager status (supabase session = manager)
        const { data: { session } } = await supabase.auth.getSession();
        const adminAuthed = !!session?.user;
        setIsManager(adminAuthed);

        const pinProfileId = typeof window !== "undefined" ? sessionStorage.getItem(PIN_PROFILE_KEY) : null;
        if (pinProfileId) {
          setNavProfileId(pinProfileId);
        } else if (adminAuthed && session?.access_token) {
          const res = await fetch("/api/me/profile", { headers: { Authorization: `Bearer ${session.access_token}` } });
          if (res.ok) {
            const data = await res.json();
            if (data?.profileId) setNavProfileId(data.profileId);
          }
        }

        const storedStoreId = sessionStorage.getItem(PIN_STORE_KEY);
        const initialStoreId = storedStoreId && storedStoreId !== "null" ? storedStoreId : "all";
        setStoreId(initialStoreId);
        await loadReviews(initialStoreId, token);
      } catch (e: unknown) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load review tracker.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadReviews, resolveToken, router]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const storeName = useMemo(() => {
    if (storeId === "all") return "All Stores";
    return stores.find((store) => store.id === storeId)?.name ?? "Store";
  }, [storeId, stores]);

  const firstOfMonth = `${month}-01`;
  const todayCst = cstDateKey();

  async function refreshCurrentStore() {
    if (!authToken) return;
    await loadReviews(storeId, authToken);
  }

  async function handleStoreChange(nextStoreId: string) {
    if (!authToken) return;
    setStoreId(nextStoreId);
    setLoading(true);
    setError(null);
    try {
      await loadReviews(nextStoreId, authToken);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load reviews.");
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload() {
    if (!authToken) return;
    if (!selectedFile) {
      setFormError("Select a screenshot first.");
      return;
    }
    if (storeId === "all") {
      setFormError("Choose a specific store tab before uploading.");
      return;
    }
    if (!earningProfileId) {
      setFormError("Select the earning employee.");
      return;
    }

    setFormError(null);
    setFormMessage(null);
    setUploading(true);
    try {
      const ext = fileExtension(selectedFile.name);
      const uploadRes = await fetch("/api/reviews/upload-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          fileExtension: ext,
          storeId,
          profileId: earningProfileId,
        }),
      });
      const uploadJson = (await uploadRes.json()) as UploadResponse | { error?: string };
      if (!uploadRes.ok) {
        throw new Error(("error" in uploadJson && uploadJson.error) || "Failed to create upload URL.");
      }
      const { uploadUrl, reviewId } = uploadJson as UploadResponse;
      const putRes = await fetch(uploadUrl, { method: "PUT", body: selectedFile });
      if (!putRes.ok) {
        throw new Error("Failed to upload screenshot.");
      }
      setUploadedReviewId(reviewId);
      setFormMessage("Screenshot uploaded. Submit to log review.");
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : "Upload failed.");
      setUploadedReviewId(null);
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmitReview() {
    if (!authToken) return;
    if (!uploadedReviewId) {
      setFormError("Upload a screenshot before submitting.");
      return;
    }
    if (storeId === "all") {
      setFormError("Choose a specific store tab before submitting.");
      return;
    }
    if (!earningProfileId) {
      setFormError("Select the earning employee.");
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setFormMessage(null);
    try {
      const res = await fetch("/api/reviews/finalize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          reviewId: uploadedReviewId,
          profileId: earningProfileId,
          storeId,
          reviewDate,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Failed to submit review.");

      setFormMessage("Submitted! Pending manager approval.");
      setSelectedFile(null);
      setUploadedReviewId(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      await refreshCurrentStore();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : "Failed to submit review.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bento-shell">
      <HomeHeader
        isManager={isManager}
        isAuthenticated={true}
        profileId={navProfileId}
      />
      <main className="mx-auto max-w-2xl px-4 pt-4 space-y-4">
        <div className="clock-page-intro-card">
          <h2 className="clock-page-intro-title">Reviews</h2>
          <p className="clock-page-intro-desc">{monthLabel(month)}</p>
        </div>

        <div className="card card-pad">
          <div className="mb-3 flex flex-wrap gap-2">
            {stores[0] && (
              <button
                className={`px-3 py-1.5 rounded border text-sm ${
                  storeId !== "all" ? "bg-white/10 border-white/30" : "border-white/15"
                }`}
                onClick={() => handleStoreChange(stores[0].id)}
              >
                {stores[0].name}
              </button>
            )}
            <button
              className={`px-3 py-1.5 rounded border text-sm ${
                storeId === "all" ? "bg-white/10 border-white/30" : "border-white/15"
              }`}
              onClick={() => handleStoreChange("all")}
            >
              All Stores
            </button>
          </div>

          {loading ? (
            <div className="text-sm muted">Loading...</div>
          ) : error ? (
            <div className="banner banner-error">{error}</div>
          ) : scoreboard.length === 0 ? (
            <div className="text-sm muted">No reviews logged yet this month.</div>
          ) : (
            <div className="space-y-2">
              {scoreboard.map((row, index) => (
                <div
                  key={row.profileId}
                  className={`rounded-lg border px-3 py-2 flex items-center justify-between ${
                    row.profileId === myProfileId ? "border-emerald-400/60 bg-emerald-500/10" : "border-white/10"
                  }`}
                >
                  <div className="text-sm">
                    <span className="mr-2 muted">#{index + 1}</span>
                    <span>{row.name}</span>
                  </div>
                  <span className="text-sm font-semibold rounded-full px-2 py-0.5 bg-white/10">
                    {row.count}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 text-xs muted">Viewing: {storeName}</div>
        </div>

        {mySubmissions.length > 0 && (
          <div className="card card-pad">
            <div className="mb-2 text-sm font-semibold">My Submissions</div>
            <div className="space-y-2">
              {mySubmissions.map((submission) => (
                <div key={submission.id} className="rounded-lg border border-white/10 p-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span>{submission.review_date}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        submission.status === "pending"
                          ? "bg-amber-500/20 text-amber-200"
                          : "bg-red-500/20 text-red-200"
                      }`}
                    >
                      {submission.status === "pending" ? "Pending" : "Rejected"}
                    </span>
                  </div>
                  {submission.status === "rejected" && submission.rejection_reason && (
                    <div className="mt-1 text-xs muted">{submission.rejection_reason}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="card card-pad space-y-3">
          <div className="text-sm font-semibold">Log a Review</div>

          <label className="block text-sm">
            Review Date
            <input
              type="date"
              className="input mt-1"
              min={firstOfMonth}
              max={todayCst}
              value={reviewDate}
              onChange={(event) => setReviewDate(event.target.value)}
            />
          </label>

          <label className="block text-sm">
            Earning Employee
            <select
              className="select mt-1"
              value={earningProfileId}
              onChange={(event) => setEarningProfileId(event.target.value)}
            >
              {employees.map((employee) => (
                <option key={employee.profileId} value={employee.profileId}>
                  {employee.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            Screenshot
            <input
              type="file"
              accept="image/*"
              className="mt-1 block w-full text-sm"
              onChange={(event) => {
                const nextFile = event.target.files?.[0] ?? null;
                setSelectedFile(nextFile);
                setUploadedReviewId(null);
                setFormMessage(null);
                setFormError(null);
                if (previewUrl) URL.revokeObjectURL(previewUrl);
                setPreviewUrl(nextFile ? URL.createObjectURL(nextFile) : null);
              }}
            />
          </label>

          {previewUrl && (
            <img src={previewUrl} alt="Screenshot preview" className="max-h-48 rounded border border-white/15" />
          )}

          <div className="flex flex-wrap gap-2">
            <button
              className="btn-secondary px-3 py-1.5"
              onClick={handleUpload}
              disabled={uploading || !selectedFile || storeId === "all"}
            >
              {uploading ? "Uploading..." : uploadedReviewId ? "Re-upload" : "Upload Screenshot"}
            </button>
            <button
              className="btn-primary px-3 py-1.5 disabled:opacity-50"
              onClick={handleSubmitReview}
              disabled={submitting || !uploadedReviewId}
            >
              {submitting ? "Submitting..." : "Log Review"}
            </button>
          </div>

          {formMessage && <div className="text-sm text-emerald-300">{formMessage}</div>}
          {formError && <div className="text-sm text-red-300">{formError}</div>}
        </div>
      </main>
    </div>
  );
}
