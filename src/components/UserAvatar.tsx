"use client";

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
    if (top && ALLOWED_AVATAAARS.top.has(top)) addDiceParam(params, "top", top);
    if (accessories && ALLOWED_AVATAAARS.accessories.has(accessories)) {
      addDiceParam(params, "accessories", accessories);
    }
    if (facialHair && ALLOWED_AVATAAARS.facialHair.has(facialHair)) {
      addDiceParam(params, "facialHair", facialHair);
    }
    if (skinColor && ALLOWED_AVATAAARS.skinColor.has(skinColor)) {
      addDiceParam(params, "skinColor", skinColor);
    }
  }

  if (mode === "head") {
    params.set("scale", "150");
    params.set("translateY", "10");
  }

  const src = `https://api.dicebear.com/9.x/${resolvedStyle}/svg?${params.toString()}`;
  return <img src={src} alt={alt} className={className} />;
}

export type { AvatarOptions };
