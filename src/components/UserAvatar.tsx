"use client";
import { useEffect, useMemo, useState } from "react";

type AvatarMode = "full" | "head";

type AvatarOptions = {
  top?: string;
  accessories?: string;
  facialHair?: string;
  skinColor?: string;
};

const DEFAULT_STYLE = "adventurer";
const DEFAULT_SEED = "shift_happens";

const ALLOWED_AVATAAARS = {
  top: new Set(["longHair", "shortHair", "turban", "winterHat1", "winterHat2", "hat", "eyepatch"]),
  accessories: new Set(["kurt", "prescription01", "prescription02", "round", "sunglasses", "wayfarers", "none"]),
  facialHair: new Set(["beardMedium", "beardLight", "beardMajestic", "moustacheFancy", "moustacheMagnum", "none"]),
  skinColor: new Set(["f8d25c", "fd9841", "ffdbb4", "edb98a", "d08b5b", "ae5d29", "614335"]),
} as const;

const AVATAAARS_VALUE_MAP = {
  top: {
    longHair: "longHairBigHair",
    shortHair: "shortHairShortFlat",
    turban: "turban",
    winterHat1: "winterHat1",
    winterHat2: "winterHat2",
    hat: "hat",
    eyepatch: "eyepatch",
  },
  accessories: {
    none: "blank",
    kurt: "kurt",
    prescription01: "prescription01",
    prescription02: "prescription02",
    round: "round",
    sunglasses: "sunglasses",
    wayfarers: "wayfarers",
  },
  facialHair: {
    none: "blank",
    beardMedium: "beardMedium",
    beardLight: "beardLight",
    beardMajestic: "beardMajestic",
    moustacheFancy: "moustacheFancy",
    moustacheMagnum: "moustacheMagnum",
  },
  skinColor: {
    f8d25c: "yellow",
    fd9841: "tanned",
    ffdbb4: "light",
    edb98a: "pale",
    d08b5b: "brown",
    ae5d29: "darkBrown",
    "614335": "black",
  },
} as const;

function addDiceParam(params: URLSearchParams, key: string, value?: string) {
  if (!value) return;
  params.append(`${key}[]`, value);
}

export default function UserAvatar({
  seed,
  style,
  options,
  mode = "full",
  alt = "Avatar",
  className = "h-full w-full",
}: {
  seed?: string | null;
  style?: string | null;
  options?: AvatarOptions | null;
  mode?: AvatarMode;
  alt?: string;
  className?: string;
}) {
  const resolvedSeed = seed?.trim() || DEFAULT_SEED;
  const resolvedStyle = style?.trim() || DEFAULT_STYLE;

  const params = new URLSearchParams({ seed: resolvedSeed });

  if (resolvedStyle === "avataaars" && options) {
    const top = options.top;
    const accessories = options.accessories;
    const facialHair = options.facialHair;
    const skinColor = options.skinColor;
    if (top && ALLOWED_AVATAAARS.top.has(top)) {
      addDiceParam(params, "top", AVATAAARS_VALUE_MAP.top[top]);
    }
    if (accessories && ALLOWED_AVATAAARS.accessories.has(accessories)) {
      addDiceParam(params, "accessories", AVATAAARS_VALUE_MAP.accessories[accessories]);
    }
    if (facialHair && ALLOWED_AVATAAARS.facialHair.has(facialHair)) {
      addDiceParam(params, "facialHair", AVATAAARS_VALUE_MAP.facialHair[facialHair]);
    }
    if (skinColor && ALLOWED_AVATAAARS.skinColor.has(skinColor)) {
      addDiceParam(params, "skinColor", AVATAAARS_VALUE_MAP.skinColor[skinColor]);
    }
  }

  if (mode === "head") {
    params.set("scale", "150");
    params.set("translateY", "10");
  }

  const primarySrc = `https://api.dicebear.com/9.x/${resolvedStyle}/svg?${params.toString()}`;
  const simpleParams = new URLSearchParams({ seed: resolvedSeed });
  if (mode === "head") {
    simpleParams.set("scale", "150");
    simpleParams.set("translateY", "10");
  }
  const fallbackSimple = `https://api.dicebear.com/9.x/${resolvedStyle}/svg?${simpleParams.toString()}`;
  const fallbackAltStyle = `https://api.dicebear.com/9.x/adventurer/svg?${simpleParams.toString()}`;
  const fallbackAvataaarsNeutral = `https://api.dicebear.com/9.x/avataaars-neutral/svg?${simpleParams.toString()}`;

  const fallbackChain = useMemo(() => {
    const chain: string[] = [primarySrc, fallbackSimple];
    if (resolvedStyle === "avataaars") chain.push(fallbackAvataaarsNeutral);
    chain.push(fallbackAltStyle);
    return chain;
  }, [primarySrc, fallbackSimple, fallbackAvataaarsNeutral, fallbackAltStyle, resolvedStyle]);

  const [srcIndex, setSrcIndex] = useState(0);
  useEffect(() => {
    setSrcIndex(0);
  }, [primarySrc, resolvedStyle, resolvedSeed, mode, options?.top, options?.accessories, options?.facialHair, options?.skinColor]);
  const src = fallbackChain[Math.min(srcIndex, fallbackChain.length - 1)];

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setSrcIndex((prev) => (prev < fallbackChain.length - 1 ? prev + 1 : prev))}
    />
  );
}

export type { AvatarOptions };
