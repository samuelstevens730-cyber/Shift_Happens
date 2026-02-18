"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export interface AvatarOptions {
  top?: string;
  accessories?: string;
  facialHair?: string;
  skinColor?: string;
  clothing?: string;
  [key: string]: string | undefined;
}

interface UserAvatarProps {
  seed?: string | null;
  style?: string;
  options?: AvatarOptions;
  uploadUrl?: string | null;
  className?: string;
  mode?: "full" | "head";
  alt?: string;
}

const ALLOWED_AVATAAARS_KEYS = new Set([
  "top",
  "accessories",
  "facialHair",
  "skinColor",
  "clothing",
]);

const VALID_TOPS = new Set([
  "bigHair",
  "bob",
  "bun",
  "curly",
  "curvy",
  "dreads",
  "dreads01",
  "dreads02",
  "frida",
  "frizzle",
  "fro",
  "froBand",
  "hat",
  "hijab",
  "longButNotTooLong",
  "miaWallace",
  "shaggy",
  "shaggyMullet",
  "shavedSides",
  "shortCurly",
  "shortFlat",
  "shortRound",
  "shortWaved",
  "sides",
  "straight01",
  "straight02",
  "straightAndStrand",
  "theCaesar",
  "theCaesarAndSidePart",
  "turban",
  "winterHat1",
  "winterHat02",
  "winterHat03",
  "winterHat04",
]);

const VALID_ACCESSORIES = new Set([
  "eyepatch",
  "kurt",
  "prescription01",
  "prescription02",
  "round",
  "sunglasses",
  "wayfarers",
]);

const VALID_FACIAL_HAIR = new Set([
  "beardLight",
  "beardMajestic",
  "beardMedium",
  "moustacheFancy",
  "moustacheMagnum",
]);

export default function UserAvatar({
  seed,
  style = "avataaars",
  options = {},
  uploadUrl,
  className,
  mode = "full",
  alt = "User Avatar",
}: UserAvatarProps) {
  const avatarUrls = useMemo(() => {
    // 1. Use v9.x (Standard)
    const baseUrl = `https://api.dicebear.com/9.x/${style}/svg`;

    const addCommon = (params: URLSearchParams) => {
      params.append("seed", seed || "shift_happens");
      if (mode === "head") {
        params.append("scale", "150");
        params.append("translateY", "10");
      }
    };

    const topAlias: Record<string, string> = {
      longHair: "longButNotTooLong",
      shortHair: "shortFlat",
      winterHat2: "winterHat02",
      winterHat3: "winterHat03",
      winterHat4: "winterHat04",
    };

    const buildParams = (variant: "raw" | "mapped" | "minimal") => {
      const params = new URLSearchParams();
      addCommon(params);

      if (style === "avataaars" && variant !== "minimal") {
        const normalized = { ...options };
        if (normalized.top === "eyepatch") {
          normalized.top = undefined;
          if (!normalized.accessories || normalized.accessories === "none") {
            normalized.accessories = "eyepatch";
          }
        }

        Object.entries(normalized).forEach(([key, value]) => {
          if (!ALLOWED_AVATAAARS_KEYS.has(key)) return;
          const safeValue = value?.trim();
          if (!safeValue || safeValue.toLowerCase() === "none") return;

          if (key === "top") {
            const top = (variant === "mapped" ? (topAlias[safeValue] ?? safeValue) : safeValue) as string;
            if (!VALID_TOPS.has(top)) return;
            params.append("top", top);
            return;
          }

          if (key === "accessories") {
            if (!VALID_ACCESSORIES.has(safeValue)) return;
            params.append("accessories", safeValue);
            params.set("accessoriesProbability", "100");
            return;
          }

          if (key === "facialHair") {
            if (!VALID_FACIAL_HAIR.has(safeValue)) return;
            params.append("facialHair", safeValue);
            params.set("facialHairProbability", "100");
            return;
          }

          if (key === "skinColor") {
            const hex = safeValue.replace(/^#/, "").toLowerCase();
            params.append("skinColor", hex);
            return;
          }

          params.append(key, safeValue);
        });

        const accessoriesSelected = normalized.accessories?.trim();
        if (!accessoriesSelected || accessoriesSelected.toLowerCase() === "none") {
          params.set("accessoriesProbability", "0");
        }

        const facialHairSelected = normalized.facialHair?.trim();
        if (!facialHairSelected || facialHairSelected.toLowerCase() === "none") {
          params.set("facialHairProbability", "0");
        }
      }

      return params;
    };

    const primary = `${baseUrl}?${buildParams("raw").toString()}`;
    const mapped = `${baseUrl}?${buildParams("mapped").toString()}`;
    const minimal = `${baseUrl}?${buildParams("minimal").toString()}`;
    const neutral = `https://api.dicebear.com/9.x/avataaars-neutral/svg?${buildParams("minimal").toString()}`;
    const adventurer = `https://api.dicebear.com/9.x/adventurer/svg?${buildParams("minimal").toString()}`;
    const uploaded = uploadUrl?.trim();

    console.log("Generated Avatar URL:", primary);
    return uploaded ? [uploaded, primary, mapped, minimal, neutral, adventurer] : [primary, mapped, minimal, neutral, adventurer];
  }, [seed, style, options, mode, uploadUrl]);

  const [urlIndex, setUrlIndex] = useState(0);
  useEffect(() => {
    setUrlIndex(0);
  }, [avatarUrls]);
  const avatarUrl = avatarUrls[Math.min(urlIndex, avatarUrls.length - 1)];

  return (
    <div className="flex flex-col items-center">
      <img
        src={avatarUrl}
        alt={alt}
        className={cn("h-full w-full object-cover", className)}
        onError={(e) => {
          console.error("Avatar Failed:", avatarUrl);
          if (urlIndex < avatarUrls.length - 1) {
            setUrlIndex((prev) => prev + 1);
            return;
          }
          e.currentTarget.src = `https://ui-avatars.com/api/?name=${seed || "User"}&background=random`;
        }}
      />
    </div>
  );
}
