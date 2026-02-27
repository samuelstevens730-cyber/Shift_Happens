"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import UserAvatar from "@/components/UserAvatar";
import type { EmployeePublicScoreboardResponse } from "@/types/employeePublicScoreboard";

const PIN_TOKEN_KEY = "sh_pin_token";

function cstDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function gradeTone(grade: "A" | "B" | "C" | "D") {
  if (grade === "A") return "text-emerald-300";
  if (grade === "B") return "text-sky-300";
  if (grade === "C") return "text-amber-300";
  return "text-red-300";
}

export default function EmployeeScoreboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<EmployeePublicScoreboardResponse | null>(null);
  const [from, setFrom] = useState(() => cstDateKey(addDays(new Date(), -29)));
  const [to, setTo] = useState(() => cstDateKey(new Date()));
  const [storeId, setStoreId] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [showWinnerOverlay, setShowWinnerOverlay] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const pinToken = typeof window !== "undefined" ? sessionStorage.getItem(PIN_TOKEN_KEY) : null;
        let token = pinToken ?? "";
        if (!token) {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          token = session?.access_token ?? "";
        }
        if (!token) {
          router.replace("/login?next=/scoreboard");
          return;
        }
        const qs = new URLSearchParams({ from, to, storeId });
        const res = await fetch(`/api/employee/scoreboard?${qs.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Failed to load rankings.");
        if (!alive) return;
        setData(json as EmployeePublicScoreboardResponse);
      } catch (e: unknown) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load rankings.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [from, to, storeId, router]);

  const myPublicRow = useMemo(() => {
    if (!data?.myRow) return null;
    return data.publicRows.find((row) => row.profileId === data.myRow?.profileId) ?? null;
  }, [data]);

  const winner = data?.winner ?? null;

  useEffect(() => {
    setShowWinnerOverlay(false);
    const raf = window.requestAnimationFrame(() => setShowWinnerOverlay(true));
    return () => window.cancelAnimationFrame(raf);
  }, [winner?.profileId, winner?.score]);

  return (
    <div className="app-shell">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold">Employee Rankings (Beta)</h1>
          <Link href="/" className="btn-secondary px-3 py-1.5">
            Back Home
          </Link>
        </div>

        <div className="card card-pad">
          <div className="flex items-center justify-between gap-2">
            <button
              className="flex-1 text-left text-sm"
              onClick={() => setShowFilters((v) => !v)}
              aria-expanded={showFilters}
            >
              <span className="font-semibold">Filters:</span> {from} to {to} ·{" "}
              {storeId === "all"
                ? "All Stores"
                : data?.stores.find((s) => s.id === storeId)?.name ?? "Selected Store"}
            </button>
            <button className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setShowFilters((v) => !v)}>
              {showFilters ? "Collapse" : "Expand"}
            </button>
            <Link href="/avatar" className="btn-primary px-3 py-1.5 text-sm">
              Customize Look
            </Link>
          </div>
          {showFilters && (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="text-sm">
                From
                <input className="input mt-1" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="text-sm">
                To
                <input className="input mt-1" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
              <label className="text-sm">
                Store
                <select className="select mt-1" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                  <option value="all">All Stores</option>
                  {(data?.stores ?? []).map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>

        {loading && <div className="card card-pad">Loading rankings...</div>}
        {error && <div className="banner banner-error">{error}</div>}

        {!loading && !error && data && (
          <>
            <div className="card card-pad">
              <div className="mb-2 text-sm font-semibold">Crown Seat</div>
              <div className="relative rounded-xl border border-dashed border-white/20 bg-white/5 p-2">
                <div className="relative w-full overflow-hidden rounded-xl aspect-[14/9] sm:aspect-[18/9] lg:aspect-[22/9]">
                  <Image
                    src="/KING_IMG_2.png"
                    alt="King throne"
                    fill
                    className="object-cover object-top"
                    sizes="(max-width: 768px) 100vw, 720px"
                    priority
                  />
                  <div className="absolute left-1/2 top-[29%] h-[23%] w-[17.5%] -translate-x-1/2 -translate-y-1/2 sm:top-[22%] sm:h-[18%] sm:w-[13%] lg:top-[22.5%] lg:h-[17.5%] lg:w-[12%]">
                    <UserAvatar
                      mode="head"
                      seed={winner?.avatarSeed ?? winner?.profileId}
                      style={winner?.avatarStyle ?? "avataaars"}
                      options={winner?.avatarOptions}
                      uploadUrl={winner?.avatarUploadUrl}
                      alt={winner?.employeeName ?? "Winner avatar"}
                      className="h-full w-full"
                    />
                    <Image
                      src="/crown.png"
                      alt=""
                      width={120}
                      height={72}
                      className="pointer-events-none absolute left-[44%] top-[-59%] w-[117%] -translate-x-1/2 drop-shadow-[0_0_14px_rgba(251,191,36,0.65)] sm:top-[-61%] sm:w-[102%] lg:top-[-57%] lg:w-[108%]"
                    />
                  </div>
                  <div
                    className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/35 to-transparent px-4 pb-4 pt-10 text-center transition-all duration-700 ${
                      showWinnerOverlay ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
                    }`}
                    style={{
                      animation: showWinnerOverlay ? "winnerOverlayIn 700ms cubic-bezier(0.16,1,0.3,1)" : "none",
                    }}
                  >
                    <div
                      className="text-xl font-black tracking-wide text-white sm:text-3xl"
                      style={{ textShadow: "0 0 10px rgba(255,255,255,0.45), 0 0 24px rgba(56,189,248,0.45)" }}
                    >
                      {winner?.employeeName ?? "NO WINNER YET"}
                    </div>
                    <div
                      className={`text-lg font-extrabold sm:text-2xl ${winner ? gradeTone(winner.grade) : "text-slate-300"}`}
                      style={{ textShadow: "0 0 8px rgba(56,189,248,0.45), 0 0 18px rgba(56,189,248,0.35)" }}
                    >
                      {winner ? `${winner.grade} • ${winner.score.toFixed(1)}` : "WAITING ON DATA"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <style jsx>{`
              @keyframes winnerOverlayIn {
                0% {
                  opacity: 0;
                  transform: translateY(16px) scale(0.98);
                  filter: blur(3px);
                }
                100% {
                  opacity: 1;
                  transform: translateY(0) scale(1);
                  filter: blur(0);
                }
              }
            `}</style>

            <div className="card card-pad">
              <div className="mb-3 text-sm font-semibold">Team Score Cards</div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.publicRows.map((row) => (
                  <div key={row.profileId} className="rounded-xl border border-white/15 bg-white/5 p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <div className="h-10 w-10 overflow-hidden rounded-full border border-white/20 bg-black">
                        <UserAvatar
                          seed={row.avatarSeed ?? row.profileId}
                          style={row.avatarStyle ?? "avataaars"}
                          options={row.avatarOptions}
                          uploadUrl={row.avatarUploadUrl}
                          alt={`${row.employeeName ?? "Employee"} avatar`}
                        />
                      </div>
                      <div className="font-semibold">{row.employeeName ?? "Unknown"}</div>
                    </div>
                    <div className="text-sm">
                      Score: <b>{row.score.toFixed(1)}</b>
                    </div>
                    <div className={`text-sm font-semibold ${gradeTone(row.grade)}`}>Grade: {row.grade}</div>
                    <Link
                      href={`/dashboard/scoreboard/shifts?profileId=${row.profileId}&from=${from}&to=${to}&storeId=${storeId}`}
                      className="mt-2 text-xs text-sky-400 hover:text-sky-300 block"
                    >
                      Shifts ↗
                    </Link>
                  </div>
                ))}
              </div>
            </div>

            <div className="card card-pad">
              <div className="mb-2 text-sm font-semibold">My Stats (Full Detail)</div>
              {!data.myRow ? (
                <div className="text-sm muted">No personal score data for this range.</div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-4 text-sm">
                    <div>
                      Name: <b>{data.myRow.employeeName ?? "Unknown"}</b>
                    </div>
                    <div>
                      Score: <b>{data.myRow.score.toFixed(1)}</b>
                    </div>
                    <div>
                      Grade: <b>{data.myRow.grade}</b>
                    </div>
                    <div>
                      Shifts: <b>{data.myRow.shiftsWorked}</b>
                    </div>
                    {myPublicRow && (
                      <div className="flex items-center gap-2">
                        <span>Avatar:</span>
                        <div className="h-8 w-8 overflow-hidden rounded-full border border-white/20 bg-black">
                          <UserAvatar
                            seed={myPublicRow.avatarSeed ?? myPublicRow.profileId}
                            style={myPublicRow.avatarStyle ?? "avataaars"}
                            options={myPublicRow.avatarOptions}
                            uploadUrl={myPublicRow.avatarUploadUrl}
                            alt="My avatar"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="overflow-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/10 text-left">
                          <th className="py-2 pr-3">Category</th>
                          <th className="py-2 pr-3">Points</th>
                          <th className="py-2 pr-3">Max</th>
                          <th className="py-2 pr-3">Detail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.myRow.categories.map((cat) => (
                          <tr key={cat.key} className="border-b border-white/5">
                            <td className="py-2 pr-3">{cat.label}</td>
                            <td className="py-2 pr-3">{cat.points == null ? "N/A" : cat.points.toFixed(1)}</td>
                            <td className="py-2 pr-3">{cat.maxPoints}</td>
                            <td className="py-2 pr-3 muted">{cat.detail}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <Link
                      href={`/scoreboard/shifts?from=${from}&to=${to}&storeId=${storeId}`}
                      className="btn-secondary px-3 py-1.5 text-sm"
                    >
                      View Shift Breakdown →
                    </Link>
                  </div>
                </div>
              )}
            </div>

            {data.managerRows.length > 0 && (
              <div className="card card-pad">
                <div className="mb-2 text-sm font-semibold">Manager Scores (Not Eligible to Win)</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {data.managerRows.map((row) => (
                    <div key={row.profileId} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 overflow-hidden rounded-full border border-white/20 bg-black">
                          <UserAvatar
                            seed={row.avatarSeed ?? row.profileId}
                            style={row.avatarStyle ?? "avataaars"}
                            options={row.avatarOptions}
                            uploadUrl={row.avatarUploadUrl}
                            alt={`${row.employeeName ?? "Manager"} avatar`}
                          />
                        </div>
                        <div>
                          {row.employeeName ?? "Manager"}: <b>{row.score.toFixed(1)}</b> ({row.grade})
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}


