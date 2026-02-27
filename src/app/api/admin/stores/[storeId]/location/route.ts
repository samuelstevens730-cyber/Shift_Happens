/**
 * PATCH /api/admin/stores/[storeId]/location
 *
 * Updates the GPS coordinates for a store. Coordinates are used by the
 * weather integration to capture ambient conditions at clock-in and clock-out.
 *
 * Auth:   Bearer token; manager must have access to the target store.
 * Body:   { latitude: number, longitude: number }
 * Validation:
 *   - latitude  ∈ [-90, 90]
 *   - longitude ∈ [-180, 180]
 */

import { NextResponse } from "next/server";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";
import { supabaseServer } from "@/lib/supabaseServer";

interface Body {
  latitude: number;
  longitude: number;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    // ── Auth ───────────────────────────────────────────────────────────────────
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const {
      data: { user },
      error: authErr,
    } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    // ── Params & scope ────────────────────────────────────────────────────────
    const { storeId } = await params;
    if (!storeId) {
      return NextResponse.json({ error: "Missing storeId." }, { status: 400 });
    }

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (!managerStoreIds.includes(storeId)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    // ── Body ──────────────────────────────────────────────────────────────────
    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const { latitude, longitude } = body;

    if (
      typeof latitude !== "number" ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90
    ) {
      return NextResponse.json(
        { error: "latitude must be a finite number between -90 and 90." },
        { status: 400 }
      );
    }

    if (
      typeof longitude !== "number" ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      return NextResponse.json(
        { error: "longitude must be a finite number between -180 and 180." },
        { status: 400 }
      );
    }

    // ── Update ────────────────────────────────────────────────────────────────
    const { error: updateErr } = await supabaseServer
      .from("stores")
      .update({ latitude, longitude })
      .eq("id", storeId);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update store location." },
      { status: 500 }
    );
  }
}
