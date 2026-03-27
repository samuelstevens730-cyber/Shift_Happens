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
import { collapseScheduledCoverage } from "@/lib/shiftOverride";

type StoreRow = { id: string; name: string; expected_drawer_cents: number };
type ShiftRow = {
  id: string;
  started_at: string | null;
  shift_type: string | null;
  planned_start_at: string;
  schedule_shift_id: string | null;
  profile_id: string;
  store_id: string;
  store: { id: string; name: string; expected_drawer_cents: number } | null;
};

type ScheduleShiftRow = {
  id: string;
  shift_date: string;
  scheduled_start: string;
  scheduled_end: string;
  shift_type: string | null;
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
    const profileIdParam = searchParams.get("profileId") || "";

    if (!profileIdParam) {
      return NextResponse.json({ error: "Missing profileId." }, { status: 400 });
    }

    let targetStoreIds: string[];

    if (auth.authType === "employee") {
      if (profileIdParam !== auth.profileId) {
        return NextResponse.json({ error: "Forbidden." }, { status: 403 });
      }
      // Employee: only access their own shifts in their authorized stores
      targetStoreIds = auth.storeIds;
    } else {
      if (auth.profileId && profileIdParam !== auth.profileId) {
        return NextResponse.json({ error: "Forbidden." }, { status: 403 });
      }
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
      .select("id, started_at, shift_type, planned_start_at, schedule_shift_id, profile_id, store_id, store:store_id(id, name, expected_drawer_cents)")
      .in("store_id", targetStoreIds)
      .is("ended_at", null)
      .neq("last_action", "removed")
      .eq("profile_id", profileIdParam)
      .order("started_at", { ascending: false })
      .limit(1);

    const { data: shift, error: shiftErr } = await shiftQuery.maybeSingle().returns<ShiftRow>();

    if (shiftErr) return NextResponse.json({ error: shiftErr.message }, { status: 500 });
    if (!shift?.id) return NextResponse.json({}, { status: 200 });

    let scheduledWindow: {
      shift_date: string;
      scheduled_start: string;
      scheduled_end: string;
    } | null = null;
    const shiftDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(shift.planned_start_at));
    const { data: scheduleRows, error: scheduleErr } = await supabaseServer
      .from("schedule_shifts")
      .select("id, shift_date, scheduled_start, scheduled_end, shift_type")
      .eq("store_id", shift.store_id)
      .eq("profile_id", shift.profile_id)
      .eq("shift_date", shiftDate)
      .returns<ScheduleShiftRow[]>();
    if (scheduleErr) return NextResponse.json({ error: scheduleErr.message }, { status: 500 });
    const sameDayRows = scheduleRows ?? [];
    if (sameDayRows.length > 0) {
      const sortedRows = sameDayRows
        .slice()
        .sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));
      const coverage = collapseScheduledCoverage(sortedRows);
      if (coverage) {
        scheduledWindow = {
          shift_date: coverage.shiftDate,
          scheduled_start: sortedRows[0]!.scheduled_start,
          scheduled_end: sortedRows[sortedRows.length - 1]!.scheduled_end,
        };
      }
    }

    return NextResponse.json({
      shiftId: shift.id,
      startedAt: shift.started_at,
      shiftType: shift.shift_type,
      storeId: shift.store?.id ?? null,
      storeName: shift.store?.name ?? null,
      expectedDrawerCents: shift.store?.expected_drawer_cents ?? null,
      scheduledWindow,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to check open shift." },
      { status: 500 }
    );
  }
}
