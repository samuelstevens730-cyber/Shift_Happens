import { NextResponse } from "next/server";
import { getCstDowMinutes } from "@/lib/clockWindows";
import { roundTo30Minutes, ShiftType } from "@/lib/kioskRules";
import {
  authenticateShiftRequest,
  validateProfileAccess,
  validateStoreAccess,
} from "@/lib/shiftAuth";
import { supabaseServer } from "@/lib/supabaseServer";

const ALLOWED_SHIFT_TYPES: ShiftType[] = ["open", "close", "double", "other"];

function resolveScheduledShiftType(
  shiftType: ShiftType,
  shiftMode: string | null | undefined
): ShiftType {
  if (shiftMode === "double" || shiftType === "double") return "double";
  return shiftType;
}

export async function GET(req: Request) {
  try {
    const authResult = await authenticateShiftRequest(req);
    if (!authResult.ok) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    const auth = authResult.auth;

    const url = new URL(req.url);
    const storeId = (url.searchParams.get("storeId") ?? "").trim();
    const profileId = (url.searchParams.get("profileId") ?? "").trim();
    const plannedStartAt = (url.searchParams.get("plannedStartAt") ?? "").trim();

    if (!storeId || !profileId || !plannedStartAt) {
      return NextResponse.json(
        { error: "Missing storeId, profileId, or plannedStartAt." },
        { status: 400 }
      );
    }

    if (!validateStoreAccess(auth, storeId)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
    const profileCheck = validateProfileAccess(auth, profileId);
    if (!profileCheck.ok) {
      return NextResponse.json({ error: profileCheck.error }, { status: 403 });
    }

    const planned = new Date(plannedStartAt);
    if (Number.isNaN(planned.getTime())) {
      return NextResponse.json({ error: "Invalid plannedStartAt." }, { status: 400 });
    }
    const plannedRounded = roundTo30Minutes(planned);
    const plannedCst = getCstDowMinutes(plannedRounded);
    const plannedDateKey = plannedRounded.toLocaleDateString("en-CA", {
      timeZone: "America/Chicago",
    });
    const plannedMinutes = plannedCst?.minutes ?? null;

    const { data: scheduledRows, error: schedErr } = await supabaseServer
      .from("schedule_shifts")
      .select("id, shift_type, shift_mode, scheduled_start, shift_date, schedules!inner(status)")
      .eq("schedules.store_id", storeId)
      .eq("profile_id", profileId)
      .eq("shift_date", plannedDateKey)
      .eq("schedules.status", "published");

    if (schedErr) {
      return NextResponse.json({ error: schedErr.message }, { status: 500 });
    }

    let nearestType: ShiftType | null = null;
    let nearestScore = Number.POSITIVE_INFINITY;
    let hasOpen = false;
    let hasClose = false;
    let hasDouble = false;

    for (const row of scheduledRows ?? []) {
      const rowType = resolveScheduledShiftType(
        row.shift_type as ShiftType,
        row.shift_mode ?? null
      );
      if (rowType === "open") hasOpen = true;
      if (rowType === "close") hasClose = true;
      if (rowType === "double") hasDouble = true;

      if (plannedMinutes != null && row.scheduled_start) {
        const [h, m] = row.scheduled_start.split(":");
        const schedMinutes = Number(h) * 60 + Number(m);
        const score = Math.abs(plannedMinutes - schedMinutes);
        if (score < nearestScore) {
          nearestScore = score;
          nearestType = rowType;
        }
      } else if (!nearestType) {
        nearestType = rowType;
      }
    }

    if (hasDouble || (hasOpen && hasClose)) {
      return NextResponse.json({ shiftType: "double", source: "scheduled" });
    }
    if (nearestType && ALLOWED_SHIFT_TYPES.includes(nearestType)) {
      return NextResponse.json({ shiftType: nearestType, source: "scheduled" });
    }

    if (plannedCst != null && plannedMinutes != null) {
      const { data: templates, error: templateErr } = await supabaseServer
        .from("shift_templates")
        .select("shift_type, start_time")
        .eq("store_id", storeId)
        .eq("day_of_week", plannedCst.dow)
        .in("shift_type", ["open", "close"]);
      if (templateErr) return NextResponse.json({ error: templateErr.message }, { status: 500 });

      const toMinutes = (timeStr: string) => {
        const [hh, mm] = timeStr.split(":");
        return Number(hh) * 60 + Number(mm);
      };
      const openStart = templates?.find((t) => t.shift_type === "open")?.start_time;
      const closeStart = templates?.find((t) => t.shift_type === "close")?.start_time;

      if (openStart && Math.abs(plannedMinutes - toMinutes(openStart)) <= 120) {
        return NextResponse.json({ shiftType: "open", source: "template" });
      }
      if (closeStart && Math.abs(plannedMinutes - toMinutes(closeStart)) <= 120) {
        return NextResponse.json({ shiftType: "close", source: "template" });
      }
    }

    return NextResponse.json({ shiftType: "other", source: "fallback" });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to resolve shift type." },
      { status: 500 }
    );
  }
}

