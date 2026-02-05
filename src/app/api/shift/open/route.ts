/**
 * GET /api/shift/open
 *
 * Returns the currently open shift for a profile (optionally scoped to a store or QR token).
 *
 * Query params:
 * - profileId: string (required)
 * - t?: string (QR token, optional)
 * - storeId?: string (optional)
 *
 * Response:
 * - { shiftId, startedAt, shiftType } when an open shift exists
 * - {} when no open shift found
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { authenticateShiftRequest } from "@/lib/shiftAuth";
import { getManagerStoreIds } from "@/lib/adminAuth";

type StoreRow = { id: string; name: string; expected_drawer_cents: number };
type ShiftRow = {
  id: string;
  started_at: string | null;
  shift_type: string | null;
  store: { id: string; name: string; expected_drawer_cents: number } | null;
};

export async function GET(req: Request) {
  try {
    // Authenticate request
    const authResult = await authenticateShiftRequest(req);
    if (!authResult.ok) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    const auth = authResult.auth;

    const { searchParams } = new URL(req.url);
    const qrToken = searchParams.get("t") || "";
    const storeIdParam = searchParams.get("storeId") || "";

    let targetStoreIds: string[];

    if (auth.authType === "employee") {
      // Employee: only access their own shifts in their authorized stores
      targetStoreIds = auth.storeIds;
    } else {
      // Manager: access shifts in stores they manage
      const managerUserId = auth.authUserId ?? auth.profileId;
      targetStoreIds = await getManagerStoreIds(managerUserId);
      if (targetStoreIds.length === 0) {
        return NextResponse.json({ error: "No managed stores." }, { status: 403 });
      }
    }

    // Apply store filter if provided via query param
    if (storeIdParam) {
      if (!targetStoreIds.includes(storeIdParam)) {
        return NextResponse.json({ error: "Forbidden." }, { status: 403 });
      }
      targetStoreIds = [storeIdParam];
    }

    // Build query - filter by authorized stores
    // Employee: only their own shifts, Manager: all shifts in managed stores
    let shiftQuery = supabaseServer
      .from("shifts")
      .select("id, started_at, shift_type, store:store_id(id, name, expected_drawer_cents), profile_id")
      .in("store_id", targetStoreIds)
      .is("ended_at", null)
      .neq("last_action", "removed")
      .order("started_at", { ascending: false })
      .limit(1);

    // For employees, restrict to their own profile
    if (auth.authType === "employee") {
      shiftQuery = shiftQuery.eq("profile_id", auth.profileId);
    }

    const { data: shift, error: shiftErr } = await shiftQuery.maybeSingle().returns<ShiftRow>();

    if (shiftErr) return NextResponse.json({ error: shiftErr.message }, { status: 500 });
    if (!shift?.id) return NextResponse.json({}, { status: 200 });

    return NextResponse.json({
      shiftId: shift.id,
      startedAt: shift.started_at,
      shiftType: shift.shift_type,
      storeId: shift.store?.id ?? null,
      storeName: shift.store?.name ?? null,
      expectedDrawerCents: shift.store?.expected_drawer_cents ?? null,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to check open shift." },
      { status: 500 }
    );
  }
}
