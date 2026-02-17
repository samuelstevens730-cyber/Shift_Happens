"use client";

type AvatarMode = "full" | "head";

type AvatarOptions = {
  top?: string;
  accessories?: string;
  facialHair?: string;
  skinColor?: string;
  clothing?: string;
};

const DEFAULT_STYLE = "adventurer";
const DEFAULT_SEED = "shift_happens";

const ALLOWED_AVATAAARS = {
  top: new Set([
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
  ]),
  accessories: new Set(["kurt", "prescription01", "prescription02", "round", "sunglasses", "wayfarers", "none"]),
  facialHair: new Set(["beardMedium", "beardLight", "beardMajestic", "moustacheFancy", "moustacheMagnum", "none"]),
  skinColor: new Set(["f8d25c", "fd9841", "ffdbb4", "edb98a", "d08b5b", "ae5d29", "614335"]),
  clothing: new Set([
    "blazerAndShirt",
    "blazerAndSweater",
    "collarAndSweater",
    "graphicShirt",
    "hoodie",
    "overall",
    "shirtCrewNeck",
    "shirtScoopNeck",
    "shirtVNeck",
    "none",
  ]),
} as const;

function addDiceParam(params: URLSearchParams, key: string, value?: string | null) {
  if (!value) return;
  const cleaned = value.trim();
  if (!cleaned || cleaned.toLowerCase() === "none") return;
  params.set(key, value);
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
  const baseUrl = "https://api.dicebear.com/9.x";
  const params = new URLSearchParams({ seed: resolvedSeed });

  if (resolvedStyle === "avataaars" && options) {
    const safeTop = options.top?.trim() ?? "";
    const safeAccessories = options.accessories?.trim() ?? "";
    const safeFacialHair = options.facialHair?.trim() ?? "";
    const safeSkinColor = options.skinColor?.trim().replace(/^#/, "") ?? "";
    const safeClothing = options.clothing?.trim() ?? "";

    if (safeTop && ALLOWED_AVATAAARS.top.has(safeTop)) addDiceParam(params, "top", safeTop);
    if (safeAccessories && ALLOWED_AVATAAARS.accessories.has(safeAccessories)) {
      addDiceParam(params, "accessories", safeAccessories);
    }
    if (safeFacialHair && ALLOWED_AVATAAARS.facialHair.has(safeFacialHair)) {
      addDiceParam(params, "facialHair", safeFacialHair);
    }
    if (safeSkinColor && ALLOWED_AVATAAARS.skinColor.has(safeSkinColor)) {
      addDiceParam(params, "skinColor", safeSkinColor);
    }
    if (safeClothing && ALLOWED_AVATAAARS.clothing.has(safeClothing)) {
      addDiceParam(params, "clothing", safeClothing);
    }
  }

  if (mode === "head") {
    params.set("scale", "150");
    params.set("translateY", "10");
  }
  const url = `${baseUrl}/${resolvedStyle}/svg?${params.toString()}`;
  // Debug helper requested for browser verification.
  console.log("Generated Avatar URL:", url);
  return <img src={url} alt={alt} className={className} />;
}

export type { AvatarOptions };
