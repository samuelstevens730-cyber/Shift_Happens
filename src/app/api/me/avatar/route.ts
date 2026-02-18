import { NextResponse } from "next/server";
import { authenticateShiftRequest } from "@/lib/shiftAuth";
import { supabaseServer } from "@/lib/supabaseServer";
import type { AvatarOptions } from "@/components/UserAvatar";

type PatchBody = {
  avatar_style?: string | null;
  avatar_seed?: string | null;
  avatar_options?: AvatarOptions | null;
  avatar_upload_path?: string | null;
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
  if (typeof raw.clothing === "string") next.clothing = raw.clothing;
  return next;
}

function toAvatarPublicUrl(path: string | null | undefined): string | null {
  const safePath = path?.trim();
  if (!safePath) return null;
  const { data } = supabaseServer.storage.from("avatars").getPublicUrl(safePath);
  return data.publicUrl ?? null;
}

export async function GET(req: Request) {
  const authResult = await authenticateShiftRequest(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }
  const profileId = authResult.auth.profileId;
  const { data, error } = await supabaseServer
    .from("profiles")
    .select("id,name,avatar_style,avatar_seed,avatar_options,avatar_upload_path")
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
    avatar_upload_path: data.avatar_upload_path ?? null,
    avatar_upload_url: toAvatarPublicUrl(data.avatar_upload_path),
  });
}

export async function PATCH(req: Request) {
  const authResult = await authenticateShiftRequest(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }
  const profileId = authResult.auth.profileId;
  const body = (await req.json()) as PatchBody;

  const updates: Record<string, unknown> = {};

  if ("avatar_style" in body) {
    const style = body.avatar_style?.trim() || "avataaars";
    if (!ALLOWED_STYLES.has(style)) {
      return NextResponse.json({ error: "Invalid avatar style." }, { status: 400 });
    }
    updates.avatar_style = style;
  }
  if ("avatar_seed" in body) {
    updates.avatar_seed = body.avatar_seed?.trim() || profileId;
  }
  if ("avatar_options" in body) {
    updates.avatar_options = sanitizeOptions(body.avatar_options);
  }
  if ("avatar_upload_path" in body) {
    const path = body.avatar_upload_path?.trim() || null;
    if (path && !path.startsWith(`${profileId}/`)) {
      return NextResponse.json({ error: "Invalid avatar upload path." }, { status: 400 });
    }
    updates.avatar_upload_path = path;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No avatar fields provided." }, { status: 400 });
  }

  const { error } = await supabaseServer
    .from("profiles")
    .update(updates)
    .eq("id", profileId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
