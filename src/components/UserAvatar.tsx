"use client";

import { useMemo } from "react";
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

export default function UserAvatar({
  seed,
  style = "avataaars",
  options = {},
  className,
  mode = "full",
  alt = "User Avatar",
}: UserAvatarProps) {
  const avatarUrl = useMemo(() => {
    // 1. Use v9.x (Standard)
    const baseUrl = `https://api.dicebear.com/9.x/${style}/svg`;
    const params = new URLSearchParams();

    // 2. Always set the seed
    params.append("seed", seed || "shift_happens");

    // 3. Append options (ONLY if valid)
    if (style === "avataaars") {
      const normalized = { ...options };
      // eyepatch is an accessory in avataaars; studio currently offers it in top.
      if (normalized.top === "eyepatch") {
        normalized.top = undefined;
        normalized.accessories = "eyepatch";
      }

      Object.entries(normalized).forEach(([key, value]) => {
        if (!ALLOWED_AVATAAARS_KEYS.has(key)) return;
        const safeValue = value?.trim();
        // FILTER: do not send "none", empty strings, or nulls.
        if (!safeValue || safeValue.toLowerCase() === "none") return;
        const finalValue = key === "skinColor" ? safeValue.replace(/^#/, "") : safeValue;
        params.append(key, finalValue);
      });
    }

    // 4. Throne mode logic
    if (mode === "head") {
      params.append("scale", "150");
      params.append("translateY", "10");
    }

    const url = `${baseUrl}?${params.toString()}`;
    console.log("Generated Avatar URL:", url);
    return url;
  }, [seed, style, options, mode]);

  return (
    <div className="flex flex-col items-center">
      <img
        src={avatarUrl}
        alt={alt}
        className={cn("h-full w-full object-cover", className)}
        onError={(e) => {
          console.error("Avatar Failed:", avatarUrl);
          e.currentTarget.src = `https://ui-avatars.com/api/?name=${seed || "User"}&background=random`;
        }}
      />
    </div>
  );
}
