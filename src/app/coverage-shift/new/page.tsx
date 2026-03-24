"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import HomeHeader from "@/components/HomeHeader";

const PIN_TOKEN_KEY    = "sh_pin_token";
const PIN_PROFILE_KEY  = "sh_pin_profile_id";

type Store = { id: string; name: string };

function todayCst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

export default function CoverageShiftNewPage() {
  const router = useRouter();

  const [authToken, setAuthToken]             = useState<string | null>(null);
  const [isManager, setIsManager]             = useState(false);
  const [navProfileId, setNavProfileId]       = useState<string | null>(null);
  const [stores, setStores]                   = useState<Store[]>([]);

  const [shiftDate, setShiftDate]             = useState(() => todayCst());
  const [coverageStoreId, setCoverageStoreId] = useState("");
  const [timeIn, setTimeIn]                   = useState("09:00");
  const [timeOut, setTimeOut]                 = useState("17:00");
  const [notes, setNotes]                     = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess]       = useState(false);
  const [formError, setFormError]   = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      const pinToken = sessionStorage.getItem(PIN_TOKEN_KEY);
      const { data: { session } } = await supabase.auth.getSession();

      if (pinToken) {
        setAuthToken(pinToken);
        setNavProfileId(sessionStorage.getItem(PIN_PROFILE_KEY));
      } else if (session) {
        setAuthToken(session.access_token);
        setIsManager(true);
        const res = await fetch("/api/me/profile", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const d = await res.json();
          if (d?.profileId) setNavProfileId(d.profileId);
        }
      } else {
        router.replace("/clock");
        return;
      }

      const { data: storeData } = await supabase
        .from("stores")
        .select("id, name")
        .order("name", { ascending: true });
      setStores(storeData ?? []);
      if (storeData?.[0]) setCoverageStoreId(storeData[0].id);
    }
    init();
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!coverageStoreId) {
      setFormError("Please select a store.");
      return;
    }

    // Simple client-side guard — server enforces the real check after timezone conversion
    if (timeOut <= timeIn) {
      setFormError("Time out must be after time in.");
      return;
    }

    setSubmitting(true);
    // Send plain strings — server converts to UTC using America/Chicago timezone
    const res = await fetch("/api/requests/coverage-shift", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        coverageStoreId,
        shiftDate,
        timeIn,
        timeOut,
        notes: notes.trim() || null,
      }),
    });

    const json = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setFormError(json.error ?? "Submission failed. Please try again.");
      return;
    }

    setSuccess(true);
  }

  if (success) {
    return (
      <div className="bento-shell">
        <HomeHeader isManager={isManager} isAuthenticated profileId={navProfileId} />
        <main className="mx-auto max-w-lg px-4 pt-6 space-y-4">
          <div className="clock-page-intro-card">
            <h2 className="clock-page-intro-title">Submitted</h2>
            <p className="clock-page-intro-desc">
              Your coverage shift has been submitted and is pending manager approval.
              It will appear on your timecard once approved.
            </p>
          </div>
          <button className="btn-primary px-4 py-2" onClick={() => router.push("/")}>
            Back Home
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="bento-shell">
      <HomeHeader isManager={isManager} isAuthenticated profileId={navProfileId} />
      <main className="mx-auto max-w-lg px-4 pt-6 space-y-4">
        <div className="clock-page-intro-card">
          <h2 className="clock-page-intro-title">Coverage Shift</h2>
          <p className="clock-page-intro-desc">
            Log hours worked at another store. A manager will review and approve.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card card-pad space-y-4">
          <label className="block text-sm">
            Date
            <input
              type="date"
              className="input mt-1"
              value={shiftDate}
              max={todayCst()}
              onChange={e => setShiftDate(e.target.value)}
              required
            />
          </label>

          <label className="block text-sm">
            Store
            <select
              className="select mt-1"
              value={coverageStoreId}
              onChange={e => setCoverageStoreId(e.target.value)}
              required
            >
              {stores.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              Time In
              <input
                type="time"
                className="input mt-1"
                value={timeIn}
                onChange={e => setTimeIn(e.target.value)}
                required
              />
            </label>
            <label className="block text-sm">
              Time Out
              <input
                type="time"
                className="input mt-1"
                value={timeOut}
                onChange={e => setTimeOut(e.target.value)}
                required
              />
            </label>
          </div>

          <label className="block text-sm">
            Notes <span className="muted">(optional)</span>
            <textarea
              className="input mt-1 h-20 resize-none"
              maxLength={500}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. covered for sick call"
            />
          </label>

          {formError && <div className="banner banner-error text-sm">{formError}</div>}

          <button
            type="submit"
            className="btn-primary px-4 py-2 w-full"
            disabled={submitting}
          >
            {submitting ? "Submitting…" : "Submit Coverage Shift"}
          </button>
        </form>
      </main>
    </div>
  );
}
