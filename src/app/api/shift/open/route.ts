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

type StoreRow = { id: string };
type ShiftRow = { id: string; started_at: string | null; shift_type: string | null };

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const profileId = searchParams.get("profileId") || "";
    const qrToken = searchParams.get("t") || "";
    const storeIdParam = searchParams.get("storeId") || "";

    if (!profileId) {
      return NextResponse.json({ error: "Missing profileId." }, { status: 400 });
    }

    let storeId: string | null = storeIdParam || null;
    if (!storeId && qrToken) {
      const { data: storeRow, error: storeErr } = await supabaseServer
        .from("stores")
        .select("id")
        .eq("qr_token", qrToken)
        .maybeSingle()
        .returns<StoreRow>();

      if (storeErr) return NextResponse.json({ error: storeErr.message }, { status: 500 });
      if (!storeRow) return NextResponse.json({}, { status: 200 });
      storeId = storeRow.id;
    }

    let shiftQuery = supabaseServer
      .from("shifts")
      .select("id, started_at, shift_type")
      .eq("profile_id", profileId)
      .is("ended_at", null)
      .neq("last_action", "removed")
      .order("started_at", { ascending: false })
      .limit(1);

    if (storeId) shiftQuery = shiftQuery.eq("store_id", storeId);

    const { data: shift, error: shiftErr } = await shiftQuery.maybeSingle().returns<ShiftRow>();

    if (shiftErr) return NextResponse.json({ error: shiftErr.message }, { status: 500 });
    if (!shift?.id) return NextResponse.json({}, { status: 200 });

    return NextResponse.json({
      shiftId: shift.id,
      startedAt: shift.started_at,
      shiftType: shift.shift_type,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to check open shift." },
      { status: 500 }
    );
  }
}
