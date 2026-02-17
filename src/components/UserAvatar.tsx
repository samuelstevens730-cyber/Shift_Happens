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

export default function UserAvatar({
  seed,
  style = "avataaars",
  options = {},
  className,
  mode = "full",
  alt = "User Avatar",
}: UserAvatarProps) {
  const avatarUrl = useMemo(() => {
    const baseUrl = `https://api.dicebear.com/9.x/${style}/svg`;
    const params = new URLSearchParams();
    params.append("seed", seed || "shift_happens");

    if (style === "avataaars") {
      Object.entries(options).forEach(([key, value]) => {
        const safeValue = value?.trim();
        if (!safeValue || safeValue.toLowerCase() === "none") return;
        params.append(key, key === "skinColor" ? safeValue.replace(/^#/, "") : safeValue);
      });
    }

    if (mode === "head") {
      params.append("scale", "150");
      params.append("translateY", "10");
    }

    const url = `${baseUrl}?${params.toString()}`;
    console.log("Generated Avatar URL:", url);
    return url;
  }, [seed, style, options, mode]);

  return (
    <img
      src={avatarUrl}
      alt={alt}
      className={cn("h-10 w-10 rounded-full bg-white/10 object-cover", className)}
      onError={(e) => {
        e.currentTarget.src = `https://ui-avatars.com/api/?name=${seed || "User"}&background=random`;
      }}
    />
  );
}
