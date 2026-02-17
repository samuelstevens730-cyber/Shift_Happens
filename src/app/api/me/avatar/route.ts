import { NextResponse } from "next/server";
import { authenticateShiftRequest } from "@/lib/shiftAuth";
import { supabaseServer } from "@/lib/supabaseServer";
import type { AvatarOptions } from "@/components/UserAvatar";

type PatchBody = {
  avatar_style?: string | null;
  avatar_seed?: string | null;
  avatar_options?: AvatarOptions | null;
};

const ALLOWED_STYLES = new Set(["avataaars", "adventurer", "bottts", "fun-emoji", "lorelei"]);

function sanitizeOptions(value: unknown): AvatarOptions {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const next: AvatarOptions = {};
  if (typeof raw.top === "string") next.top = raw.top;
  if (typeof raw.accessories === "string") next.accessories = raw.accessories;
  if (typeof raw.facialHair === "string") next.facialHair = raw.facialHair;
  if (typeof raw.skinColor === "string") next.skinColor = raw.skinColor;
  return next;
}

export async function GET(req: Request) {
  const authResult = await authenticateShiftRequest(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }
  const profileId = authResult.auth.profileId;
  const { data, error } = await supabaseServer
    .from("profiles")
    .select("id,name,avatar_style,avatar_seed,avatar_options")
    .eq("id", profileId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  return NextResponse.json({
    id: data.id,
    name: data.name,
    avatar_style: data.avatar_style ?? "avataaars",
    avatar_seed: data.avatar_seed ?? profileId,
    avatar_options: sanitizeOptions(data.avatar_options),
  });
}

export async function PATCH(req: Request) {
  const authResult = await authenticateShiftRequest(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }
  const profileId = authResult.auth.profileId;
  const body = (await req.json()) as PatchBody;

  const style = body.avatar_style?.trim() || "avataaars";
  const seed = body.avatar_seed?.trim() || profileId;
  if (!ALLOWED_STYLES.has(style)) {
    return NextResponse.json({ error: "Invalid avatar style." }, { status: 400 });
  }
  const options = sanitizeOptions(body.avatar_options);

  const { error } = await supabaseServer
    .from("profiles")
    .update({
      avatar_style: style,
      avatar_seed: seed,
      avatar_options: options,
    })
    .eq("id", profileId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
