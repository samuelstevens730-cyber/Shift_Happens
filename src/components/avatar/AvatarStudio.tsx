"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import UserAvatar, { type AvatarOptions } from "@/components/UserAvatar";

const PIN_TOKEN_KEY = "sh_pin_token";

const TOP_OPTIONS = [
  "longHair",
  "shortHair",
  "eyepatch",
  "hat",
  "hijab",
  "turban",
  "winterHat1",
  "winterHat2",
  "winterHat3",
  "frida",
  "shavedSides",
] as const;
const ACCESSORY_OPTIONS = ["none", "kurt", "prescription01", "prescription02", "round", "sunglasses", "wayfarers"] as const;
const FACIAL_HAIR_OPTIONS = ["none", "beardMedium", "beardLight", "beardMajestic", "moustacheFancy", "moustacheMagnum"] as const;
const SKIN_OPTIONS = ["f8d25c", "fd9841", "ffdbb4", "edb98a", "d08b5b", "ae5d29", "614335"] as const;
const CLOTHING_OPTIONS = [
  "none",
  "blazerAndShirt",
  "blazerAndSweater",
  "collarAndSweater",
  "graphicShirt",
  "hoodie",
  "overall",
  "shirtCrewNeck",
  "shirtScoopNeck",
  "shirtVNeck",
] as const;
const STYLE_OPTIONS = ["avataaars", "adventurer", "bottts", "fun-emoji", "lorelei"] as const;

function randomSeed() {
  return `avatar_${Math.random().toString(36).slice(2, 10)}`;
}

export default function AvatarStudio() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [style, setStyle] = useState<(typeof STYLE_OPTIONS)[number]>("avataaars");
  const [seed, setSeed] = useState("shift_happens");
  const [top, setTop] = useState<(typeof TOP_OPTIONS)[number]>("shortHair");
  const [accessories, setAccessories] = useState<(typeof ACCESSORY_OPTIONS)[number]>("none");
  const [facialHair, setFacialHair] = useState<(typeof FACIAL_HAIR_OPTIONS)[number]>("none");
  const [skinColor, setSkinColor] = useState<(typeof SKIN_OPTIONS)[number]>("ffdbb4");
  const [clothing, setClothing] = useState<(typeof CLOTHING_OPTIONS)[number]>("none");

  const options = useMemo<AvatarOptions>(
    () => ({
      top,
      accessories,
      facialHair,
      skinColor,
      clothing,
    }),
    [top, accessories, facialHair, skinColor, clothing]
  );

  async function getAuthToken() {
    const pinToken = typeof window !== "undefined" ? sessionStorage.getItem(PIN_TOKEN_KEY) : null;
    if (pinToken) return pinToken;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const token = await getAuthToken();
        if (!token) {
          router.replace("/login?next=/avatar");
          return;
        }
        const res = await fetch("/api/me/avatar", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Failed to load avatar.");
        if (!alive) return;
        setStyle((json.avatar_style ?? "avataaars") as (typeof STYLE_OPTIONS)[number]);
        setSeed(json.avatar_seed ?? "shift_happens");
        const opts = (json.avatar_options ?? {}) as AvatarOptions;
        if (opts.top && TOP_OPTIONS.includes(opts.top as (typeof TOP_OPTIONS)[number])) {
          setTop(opts.top as (typeof TOP_OPTIONS)[number]);
        }
        if (
          opts.accessories &&
          ACCESSORY_OPTIONS.includes(opts.accessories as (typeof ACCESSORY_OPTIONS)[number])
        ) {
          setAccessories(opts.accessories as (typeof ACCESSORY_OPTIONS)[number]);
        }
        if (
          opts.facialHair &&
          FACIAL_HAIR_OPTIONS.includes(opts.facialHair as (typeof FACIAL_HAIR_OPTIONS)[number])
        ) {
          setFacialHair(opts.facialHair as (typeof FACIAL_HAIR_OPTIONS)[number]);
        }
        if (opts.skinColor && SKIN_OPTIONS.includes(opts.skinColor as (typeof SKIN_OPTIONS)[number])) {
          setSkinColor(opts.skinColor as (typeof SKIN_OPTIONS)[number]);
        }
        if (opts.clothing && CLOTHING_OPTIONS.includes(opts.clothing as (typeof CLOTHING_OPTIONS)[number])) {
          setClothing(opts.clothing as (typeof CLOTHING_OPTIONS)[number]);
        }
      } catch (e: unknown) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load avatar.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  return (
    <div className="card card-pad space-y-4">
      {loading ? (
        <div className="text-sm muted">Loading avatar studio...</div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
            <div className="space-y-3">
              <div className="rounded-xl border border-white/15 bg-white/5 p-4">
                <div className="mb-2 text-sm font-semibold">Live Preview</div>
                <div className="mx-auto h-48 w-48 overflow-hidden rounded-full border border-white/20 bg-black">
                  <UserAvatar
                    seed={seed}
                    style={style}
                    options={style === "avataaars" ? options : undefined}
                    className="h-full w-full"
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                Style
                <select
                  className="select mt-1"
                  value={style}
                  onChange={(e) => setStyle(e.target.value as (typeof STYLE_OPTIONS)[number])}
                >
                  {STYLE_OPTIONS.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm">
                Seed
                <input className="input mt-1" value={seed} onChange={(e) => setSeed(e.target.value)} />
              </label>

              <div className="sm:col-span-2">
                <button
                  className="btn-secondary px-3 py-1.5 text-sm"
                  onClick={() => setSeed(randomSeed())}
                >
                  <RefreshCw className="mr-1 inline h-3 w-3" />
                  Randomize Face
                </button>
              </div>

              {style === "avataaars" && (
                <>
                  <label className="text-sm">
                    Top (Hair / Hat)
                    <select
                      className="select mt-1"
                      value={top}
                      onChange={(e) => setTop(e.target.value as (typeof TOP_OPTIONS)[number])}
                    >
                      {TOP_OPTIONS.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-sm">
                    Accessories
                    <select
                      className="select mt-1"
                      value={accessories}
                      onChange={(e) => setAccessories(e.target.value as (typeof ACCESSORY_OPTIONS)[number])}
                    >
                      {ACCESSORY_OPTIONS.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-sm">
                    Facial Hair
                    <select
                      className="select mt-1"
                      value={facialHair}
                      onChange={(e) => setFacialHair(e.target.value as (typeof FACIAL_HAIR_OPTIONS)[number])}
                    >
                      {FACIAL_HAIR_OPTIONS.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-sm">
                    Skin Color
                    <select
                      className="select mt-1"
                      value={skinColor}
                      onChange={(e) => setSkinColor(e.target.value as (typeof SKIN_OPTIONS)[number])}
                    >
                      {SKIN_OPTIONS.map((item) => (
                        <option key={item} value={item}>
                          #{item}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-sm">
                    Clothing
                    <select
                      className="select mt-1"
                      value={clothing}
                      onChange={(e) => setClothing(e.target.value as (typeof CLOTHING_OPTIONS)[number])}
                    >
                      {CLOTHING_OPTIONS.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </div>
          </div>

          {error && <div className="banner banner-error">{error}</div>}
          {saved && <div className="banner">{saved}</div>}

          <div className="flex justify-end">
            <button
              className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
              disabled={saving}
              onClick={async () => {
                setError(null);
                setSaved(null);
                const token = await getAuthToken();
                if (!token) {
                  setError("Session expired. Please log in again.");
                  return;
                }
                setSaving(true);
                try {
                  const res = await fetch("/api/me/avatar", {
                    method: "PATCH",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                      avatar_style: style,
                      avatar_seed: seed.trim() || "shift_happens",
                      avatar_options: style === "avataaars" ? options : {},
                    }),
                  });
                  const json = await res.json();
                  if (!res.ok) throw new Error(json?.error || "Failed to save avatar.");
                  setSaved("Avatar saved.");
                } catch (e: unknown) {
                  setError(e instanceof Error ? e.message : "Failed to save avatar.");
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? "Saving..." : "Save Avatar"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
