import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { authenticateShiftRequest, validateStoreAccess } from "@/lib/shiftAuth";
import { supabaseServer } from "@/lib/supabaseServer";

type UploadUrlBody = {
  fileExtension?: string;
  storeId?: string;
  profileId?: string;
};

const ALLOWED_EXTENSIONS = new Set(["jpg", "png", "webp", "heic", "jpeg"]);

function normalizeExtension(value: string): string {
  return value.trim().toLowerCase().replace(/^\./, "");
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(req: Request) {
  try {
    const authResult = await authenticateShiftRequest(req);
    if (!authResult.ok) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    const auth = authResult.auth;

    let body: UploadUrlBody;
    try {
      body = (await req.json()) as UploadUrlBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const fileExtension = normalizeExtension(body.fileExtension ?? "");
    const storeId = (body.storeId ?? "").trim();
    const profileId = (body.profileId ?? "").trim();

    if (!storeId || !isUuid(storeId)) {
      return NextResponse.json({ error: "Valid storeId is required." }, { status: 400 });
    }
    if (!profileId || !isUuid(profileId)) {
      return NextResponse.json({ error: "Valid profileId is required." }, { status: 400 });
    }
    if (!ALLOWED_EXTENSIONS.has(fileExtension)) {
      return NextResponse.json({ error: "Unsupported file extension." }, { status: 400 });
    }

    const { data: storeExists, error: storeErr } = await supabaseServer
      .from("stores")
      .select("id")
      .eq("id", storeId)
      .maybeSingle<{ id: string }>();
    if (storeErr) return NextResponse.json({ error: storeErr.message }, { status: 500 });
    if (!storeExists) {
      return NextResponse.json({ error: "Store not found." }, { status: 400 });
    }

    if (!validateStoreAccess(auth, storeId)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const { data: membership, error: membershipErr } = await supabaseServer
      .from("store_memberships")
      .select("profile_id")
      .eq("store_id", storeId)
      .eq("profile_id", profileId)
      .maybeSingle<{ profile_id: string }>();
    if (membershipErr) return NextResponse.json({ error: membershipErr.message }, { status: 500 });
    if (!membership) {
      return NextResponse.json({ error: "Profile is not assigned to this store." }, { status: 403 });
    }

    const reviewId = crypto.randomUUID();
    const path = `${storeId}/${reviewId}.${fileExtension}`;

    const { data: signedData, error: signedErr } = await supabaseServer.storage
      .from("reviews")
      .createSignedUploadUrl(path, {
        upsert: false,
      });
    if (signedErr) {
      return NextResponse.json({ error: signedErr.message }, { status: 500 });
    }

    const { error: insertErr } = await supabaseServer
      .from("google_reviews")
      .insert({
        id: reviewId,
        store_id: storeId,
        profile_id: profileId,
        submitted_by_type: auth.authType === "manager" ? "manager" : "employee",
        submitted_by_profile_id: auth.authType === "employee" ? auth.profileId : null,
        submitted_by_auth_id: auth.authType === "manager" ? auth.authUserId ?? null : null,
        review_date: "1970-01-01",
        screenshot_path: path,
        status: "draft",
      });

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({
      uploadUrl: signedData.signedUrl,
      reviewId,
      path,
      token: signedData.token,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create upload URL." },
      { status: 500 }
    );
  }
}
