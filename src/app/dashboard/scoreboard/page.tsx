"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Dice6, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import type { EmployeePublicScoreboardResponse } from "@/types/employeePublicScoreboard";

const PIN_TOKEN_KEY = "sh_pin_token";
const AVATAR_SEED_KEY = "sh_avatar_seed";
const AVATAR_STYLE_KEY = "sh_avatar_style";

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

function avatarUrl(seed: string, style: string) {
  return `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seed)}`;
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
  const [avatarSeed, setAvatarSeed] = useState("shift_happens");
  const [avatarStyle, setAvatarStyle] = useState("adventurer");
  const [avatarDraft, setAvatarDraft] = useState("shift_happens");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedSeed = localStorage.getItem(AVATAR_SEED_KEY);
    const savedStyle = localStorage.getItem(AVATAR_STYLE_KEY);
    if (savedSeed) {
      setAvatarSeed(savedSeed);
      setAvatarDraft(savedSeed);
    }
    if (savedStyle) setAvatarStyle(savedStyle);
  }, []);

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
          router.replace("/login?next=/dashboard/scoreboard");
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

  const winnerAvatarSeed = useMemo(() => {
    if (!data?.winner) return avatarSeed;
    if (data.myRow && data.winner.profileId === data.myRow.profileId) return avatarSeed;
    return data.winner.profileId;
  }, [data, avatarSeed]);

  return (
    <div className="app-shell">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold">Employee Rankings (Beta)</h1>
          <Link href="/" className="btn-secondary px-3 py-1.5">
            Back Home
          </Link>
        </div>

        <div className="card card-pad grid gap-3 sm:grid-cols-4">
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
          <div className="self-end text-xs muted">
            Public ranking is beta and still being tuned.
          </div>
        </div>

        {loading && <div className="card card-pad">Loading rankings...</div>}
        {error && <div className="banner banner-error">{error}</div>}

        {!loading && !error && data && (
          <>
            <div className="card card-pad">
              <div className="mb-2 text-sm font-semibold">Current Crown Holder</div>
              <div className="relative min-h-[180px] rounded-xl border border-dashed border-white/20 bg-white/5">
                <div className="absolute left-1/2 top-6 h-16 w-16 -translate-x-1/2 overflow-hidden rounded-full border-2 border-amber-300 bg-black">
                  <img src={avatarUrl(winnerAvatarSeed, avatarStyle)} alt="Winner avatar" className="h-full w-full" />
                </div>
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-center text-xs">
                  <div className="font-semibold">{data.winner?.employeeName ?? "No winner yet"}</div>
                  <div className="muted">Drop king image into this container when ready.</div>
                </div>
              </div>
            </div>

            <div className="card card-pad">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold">My Avatar</div>
                <button
                  className="btn-secondary px-2 py-1 text-xs"
                  onClick={() => {
                    const next = `${data.myRow?.profileId ?? "employee"}_${Math.random().toString(36).slice(2, 8)}`;
                    setAvatarDraft(next);
                    setAvatarSeed(next);
                    localStorage.setItem(AVATAR_SEED_KEY, next);
                  }}
                >
                  <RefreshCw className="mr-1 inline h-3 w-3" />
                  Randomize
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-[90px_1fr_auto] sm:items-center">
                <div className="h-20 w-20 overflow-hidden rounded-full border border-white/20">
                  <img src={avatarUrl(avatarSeed, avatarStyle)} alt="My avatar" className="h-full w-full" />
                </div>
                <input
                  className="input"
                  value={avatarDraft}
                  onChange={(e) => setAvatarDraft(e.target.value)}
                  placeholder="Avatar seed"
                />
                <div className="flex gap-2">
                  <select
                    className="select"
                    value={avatarStyle}
                    onChange={(e) => {
                      setAvatarStyle(e.target.value);
                      localStorage.setItem(AVATAR_STYLE_KEY, e.target.value);
                    }}
                  >
                    <option value="adventurer">Adventurer</option>
                    <option value="bottts">Bottts</option>
                    <option value="fun-emoji">Fun Emoji</option>
                    <option value="lorelei">Lorelei</option>
                  </select>
                  <button
                    className="btn-primary px-3 py-1.5 text-xs"
                    onClick={() => {
                      const next = avatarDraft.trim() || `${data.myRow?.profileId ?? "employee"}_avatar`;
                      setAvatarSeed(next);
                      localStorage.setItem(AVATAR_SEED_KEY, next);
                    }}
                  >
                    <Dice6 className="mr-1 inline h-3 w-3" />
                    Save
                  </button>
                </div>
              </div>
            </div>

            <div className="card card-pad">
              <div className="mb-3 text-sm font-semibold">Team Score Cards</div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.publicRows.map((row) => (
                  <div key={row.profileId} className="rounded-xl border border-white/15 bg-white/5 p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <div className="h-10 w-10 overflow-hidden rounded-full border border-white/20">
                        <img
                          src={avatarUrl(
                            data.myRow?.profileId === row.profileId ? avatarSeed : row.profileId,
                            avatarStyle
                          )}
                          alt={`${row.employeeName ?? "Employee"} avatar`}
                          className="h-full w-full"
                        />
                      </div>
                      <div className="font-semibold">{row.employeeName ?? "Unknown"}</div>
                    </div>
                    <div className="text-sm">
                      Score: <b>{row.score.toFixed(1)}</b>
                    </div>
                    <div className={`text-sm font-semibold ${gradeTone(row.grade)}`}>Grade: {row.grade}</div>
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
                </div>
              )}
            </div>

            {data.managerRows.length > 0 && (
              <div className="card card-pad">
                <div className="mb-2 text-sm font-semibold">Manager Scores (Not Eligible to Win)</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {data.managerRows.map((row) => (
                    <div key={row.profileId} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm">
                      {row.employeeName ?? "Manager"}: <b>{row.score.toFixed(1)}</b> ({row.grade})
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
