/**
 * POST /api/end-shift - Clock Out
 *
 * Ends an active shift, records the ending drawer count, and validates all requirements are met.
 *
 * Authentication: Bearer token required (employee PIN JWT or manager Supabase session)
 * - Employee PIN JWT: issued by employee-auth edge function after PIN verification
 * - Manager Supabase: manager can clock out for themselves only (profile linked via auth_user_id)
 *
 * Request body:
 * - qrToken?: string - QR token to validate store ownership (optional)
 * - shiftId: string - Shift ID to end (required)
 * - endAt: string - ISO timestamp of end time (required)
 * - endDrawerCents?: number | null - Ending drawer count in cents (required for non-"other" shifts)
 * - changeDrawerCents?: number | null - Change drawer count in cents (required for non-"other" shifts)
 * - confirmed?: boolean - Whether the drawer count was confirmed
 * - notifiedManager?: boolean - Whether manager was notified of discrepancy
 * - note?: string | null - Optional note about the drawer count
 *
 * Returns:
 * - Success: { ok: true }
 * - Error: { error: string, requiresConfirm?: boolean, missingItemCount?: number, missing?: string[] }
 *
 * Business logic:
 * - Authenticates via employee PIN JWT or manager Supabase session
 * - Validates shift belongs to authenticated user (no impersonation)
 * - Validates shift exists and is not already ended
 * - Validates QR token matches shift's store if provided
 * - Blocks clock-out if there are pending messages (unacknowledged) or tasks (incomplete)
 * - For open/close/double shifts, validates all required checklist items are checked
 * - For non-"other" shifts, requires ending drawer count
 * - If drawer count is outside expected threshold, requires confirmation
 * - Rounds end time to nearest 30 minutes for payroll consistency
 * - Flags shifts over 13 hours as requiring manager override
 * - Uses upsert for drawer count to handle re-submissions gracefully
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { isOutOfThreshold, roundTo30Minutes, ShiftType } from "@/lib/kioskRules";
import { getCstDowMinutes, isTimeWithinWindow, toStoreKey } from "@/lib/clockWindows";
import { authenticateShiftRequest } from "@/lib/shiftAuth";

type Body = {
  qrToken?: string;
  shiftId: string;
  endAt: string; // ISO
  endDrawerCents?: number | null; // optional for "other" if you want
  changeDrawerCents?: number | null; // change drawer count in cents
  confirmed?: boolean;
  notifiedManager?: boolean;
  note?: string | null;
  manualClose?: boolean;
};

type TemplateRow = { id: string; store_id: string | null; shift_type: string };
type ScheduleShiftRow = {
  shift_date: string;
  scheduled_start: string;
  scheduled_end: string;
};

function parseClockWindowError(message: string) {
  const token = "CLOCK_WINDOW_VIOLATION:";
  if (!message.includes(token)) return null;
  const label = message.split(token)[1]?.trim() || "Outside allowed clock window";
  return { code: "CLOCK_WINDOW_VIOLATION", windowLabel: label };
}

function parseTimeToMinutes(timeValue: string): number | null {
  const parts = timeValue.split(":");
  if (parts.length < 2) return null;
  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return (hour * 60) + minute;
}

function templatesForShiftType(st: ShiftType) {
  if (st === "open") return ["open"];
  if (st === "close") return ["close"];
  if (st === "double") return ["open", "close"];
  return [];
}

async function fetchTemplatesForStore(storeId: string, shiftTypes: string[]) {
  const { data: storeTemplates, error: storeErr } = await supabaseServer
    .from("checklist_templates")
    .select("id, store_id, shift_type")
    .eq("store_id", storeId)
    .in("shift_type", shiftTypes)
    .returns<TemplateRow[]>();
  if (storeErr) throw new Error(storeErr.message);
  if (storeTemplates && storeTemplates.length > 0) return storeTemplates;

  const { data: legacyTemplates, error: legacyErr } = await supabaseServer
    .from("checklist_templates")
    .select("id, store_id, shift_type")
    .is("store_id", null)
    .in("shift_type", shiftTypes)
    .returns<TemplateRow[]>();
  if (legacyErr) throw new Error(legacyErr.message);
  return legacyTemplates ?? [];
}

export async function POST(req: Request) {
  try {
    // 0) Authenticate request (employee PIN JWT or manager Supabase session)
    const authResult = await authenticateShiftRequest(req);
    if (!authResult.ok) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    const auth = authResult.auth;

    const body = (await req.json()) as Body;

    if (!body.shiftId) return NextResponse.json({ error: "Missing shiftId." }, { status: 400 });
    if (!body.endAt) return NextResponse.json({ error: "Missing endAt." }, { status: 400 });

    const { data: shift, error: shiftErr } = await supabaseServer
      .from("shifts")
      .select("id, store_id, profile_id, shift_type, ended_at, started_at, schedule_shift_id, shift_source, requires_override")
      .eq("id", body.shiftId)
      .maybeSingle();

    if (shiftErr) return NextResponse.json({ error: shiftErr.message }, { status: 500 });
    if (!shift) return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    if (shift.ended_at) return NextResponse.json({ error: "Shift already ended." }, { status: 400 });

    // Validate shift belongs to authenticated user (no impersonation)
    if (shift.profile_id !== auth.profileId) {
      return NextResponse.json(
        { error: "You can only end your own shifts" },
        { status: 403 }
      );
    }

    let store: { id: string; name: string; expected_drawer_cents: number } | null = null;

    if (body.qrToken) {
      const { data: storeByToken } = await supabaseServer
        .from("stores")
        .select("id, name, expected_drawer_cents")
        .eq("qr_token", body.qrToken)
        .maybeSingle();
      if (!storeByToken) return NextResponse.json({ error: "Invalid QR token." }, { status: 401 });
      if (shift.store_id !== storeByToken.id) return NextResponse.json({ error: "Wrong store." }, { status: 403 });
      store = storeByToken;
    } else {
      const { data: storeById } = await supabaseServer
        .from("stores")
        .select("id, name, expected_drawer_cents")
        .eq("id", shift.store_id)
        .maybeSingle();
      if (!storeById) return NextResponse.json({ error: "Store not found." }, { status: 404 });
      store = storeById;
    }

    const { data: pendingAssignments, error: assignErr } = await supabaseServer
      .from("shift_assignments")
      .select("id,type,acknowledged_at,completed_at")
      .eq("delivered_shift_id", body.shiftId)
      .returns<{ id: string; type: "task" | "message"; acknowledged_at: string | null; completed_at: string | null }[]>();
    if (assignErr) return NextResponse.json({ error: assignErr.message }, { status: 500 });

    const hasPending = (pendingAssignments ?? []).some(a =>
      (a.type === "message" && !a.acknowledged_at) ||
      (a.type === "task" && !a.completed_at)
    );
    if (hasPending) {
      return NextResponse.json(
        { error: "Pending messages or tasks must be completed before clock out." },
        { status: 400 }
      );
    }

    const shiftType = shift.shift_type as ShiftType;

    // 1) Enforce checklist required items (per your v1 rule: cannot clock out until required items are checked)
    const neededTemplateTypes = templatesForShiftType(shiftType);

    if (neededTemplateTypes.length) {
      let templates: TemplateRow[] = [];
      try {
        templates = await fetchTemplatesForStore(shift.store_id, neededTemplateTypes);
      } catch (e: unknown) {
        return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to load templates." }, { status: 500 });
      }

      const templateIds = (templates ?? []).map(t => t.id);
      if (templateIds.length) {
        const { data: requiredItems, error: itemsErr } = await supabaseServer
          .from("checklist_items")
          .select("id")
          .in("template_id", templateIds)
          .eq("required", true);
        if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 });

        const requiredIds = new Set((requiredItems ?? []).map(i => i.id));

        const { data: doneRows, error: doneErr } = await supabaseServer
          .from("shift_checklist_checks")
          .select("item_id")
          .eq("shift_id", body.shiftId);
        if (doneErr) return NextResponse.json({ error: doneErr.message }, { status: 500 });

        const doneSet = new Set((doneRows ?? []).map(r => r.item_id));
        const missing = Array.from(requiredIds).filter(id => !doneSet.has(id));

        if (missing.length) {
          if (body.manualClose) {
            const nowIso = new Date().toISOString();
            const rows = missing.map(itemId => ({
              shift_id: body.shiftId,
              item_id: itemId,
              checked_at: nowIso,
            }));
            const { error: insertErr } = await supabaseServer
              .from("shift_checklist_checks")
              .upsert(rows, { onConflict: "shift_id,item_id" });
            if (insertErr) {
              return NextResponse.json({ error: insertErr.message }, { status: 500 });
            }
          } else {
            return NextResponse.json(
              { error: "Missing required checklist items.", missingItemCount: missing.length, missing },
              { status: 400 }
            );
          }
        }
      }
    }

    // 2) Insert END drawer count if required
    const endCents = body.endDrawerCents ?? null;
    const changeCents = body.changeDrawerCents ?? null;

    if (shiftType !== "other") {
      if (endCents === null || endCents === undefined) {
        return NextResponse.json({ error: "Missing end drawer count." }, { status: 400 });
      }
      if (changeCents === null || changeCents === undefined || !Number.isFinite(changeCents)) {
        return NextResponse.json({ error: "Missing change drawer count." }, { status: 400 });
      }
      const out = isOutOfThreshold(endCents, store.expected_drawer_cents);
      const changeNot200 = changeCents !== 20000;
      if (out && !body.confirmed) {
        return NextResponse.json({ error: "End drawer outside threshold. Must confirm.", requiresConfirm: true }, { status: 400 });
      }
      if (changeNot200 && !body.notifiedManager) {
        return NextResponse.json({ error: "Change drawer not $200. Must notify manager." }, { status: 400 });
      }

      const { error: endCountErr } = await supabaseServer
        .from("shift_drawer_counts")
        .upsert(
          {
            shift_id: body.shiftId,
            count_type: "end",
            drawer_cents: endCents,
            change_count: changeCents,
            confirmed: Boolean(body.confirmed),
            notified_manager: Boolean(body.notifiedManager),
            note: body.note ?? null,
          },
          { onConflict: "shift_id,count_type" }
        );

      if (endCountErr) return NextResponse.json({ error: endCountErr.message }, { status: 500 });
    } else if (endCents !== null && endCents !== undefined) {
      // optional for other
      const { error: endCountErr } = await supabaseServer
        .from("shift_drawer_counts")
        .upsert(
          {
            shift_id: body.shiftId,
            count_type: "end",
            drawer_cents: endCents,
            change_count: changeCents ?? null,
            confirmed: Boolean(body.confirmed),
            notified_manager: Boolean(body.notifiedManager),
            note: body.note ?? null,
          },
          { onConflict: "shift_id,count_type" }
        );
      if (endCountErr) return NextResponse.json({ error: endCountErr.message }, { status: 500 });
    }

    // 3) Round end time, set ended_at
    const endAt = new Date(body.endAt);
    if (Number.isNaN(endAt.getTime())) return NextResponse.json({ error: "Invalid endAt." }, { status: 400 });
    const endRounded = roundTo30Minutes(endAt);

    let hasScheduledShift = false;
    let scheduledDurationHours: number | null = null;
    if (shift.schedule_shift_id) {
      const { data: scheduleShift, error: scheduleShiftErr } = await supabaseServer
        .from("schedule_shifts")
        .select("shift_date, scheduled_start, scheduled_end")
        .eq("id", shift.schedule_shift_id)
        .maybeSingle<ScheduleShiftRow>();
      if (!scheduleShiftErr && scheduleShift) {
        hasScheduledShift = true;
        const scheduledStartMinutes = parseTimeToMinutes(scheduleShift.scheduled_start);
        const scheduledEndMinutes = parseTimeToMinutes(scheduleShift.scheduled_end);
        if (scheduledStartMinutes != null && scheduledEndMinutes != null) {
          const scheduledMinutes = scheduledEndMinutes >= scheduledStartMinutes
            ? (scheduledEndMinutes - scheduledStartMinutes)
            : ((24 * 60 - scheduledStartMinutes) + scheduledEndMinutes);
          scheduledDurationHours = scheduledMinutes / 60;
        }
      }
    }

    if (shiftType === "close" && !hasScheduledShift) {
      const storeKey = toStoreKey(store.name);
      const cst = getCstDowMinutes(endRounded);
      if (!storeKey || !cst) {
        return NextResponse.json(
          { error: "CLOCK_WINDOW_VIOLATION", code: "CLOCK_WINDOW_VIOLATION", windowLabel: "Outside allowed clock window" },
          { status: 400 }
        );
      }
      const windowCheck = isTimeWithinWindow({
        storeKey,
        shiftType: "close",
        localDow: cst.dow,
        minutes: cst.minutes,
      });
      if (!windowCheck.ok) {
        return NextResponse.json(
          { error: "CLOCK_WINDOW_VIOLATION", code: "CLOCK_WINDOW_VIOLATION", windowLabel: windowCheck.windowLabel },
          { status: 400 }
        );
      }
    }

    const startedAt = new Date(shift.started_at);
    const durationHours = Number.isNaN(startedAt.getTime())
      ? null
      : (endRounded.getTime() - startedAt.getTime()) / (1000 * 60 * 60);
    const overScheduledDuration = hasScheduledShift
      && durationHours != null
      && scheduledDurationHours != null
      && durationHours > scheduledDurationHours;
    const durationRequiresOverride = durationHours != null && durationHours > 13;
    const requiresOverride = Boolean(shift.requires_override) || durationRequiresOverride || overScheduledDuration;

    const updatePayload: Record<string, string | boolean | null> = {
      ended_at: endRounded.toISOString(),
      requires_override: requiresOverride,
    };

    if (overScheduledDuration) {
      updatePayload.override_note = "Clock-out exceeded scheduled hours";
    }

    if (body.manualClose) {
      updatePayload.manual_closed = true;
      updatePayload.manual_closed_at = endRounded.toISOString();
      updatePayload.manual_closed_by_profile = shift.profile_id;
      updatePayload.manual_closed_review_status = null;
      updatePayload.manual_closed_reviewed_at = null;
      updatePayload.manual_closed_reviewed_by = null;
    }

    const { error: endShiftErr } = await supabaseServer
      .from("shifts")
      .update(updatePayload)
      .eq("id", body.shiftId);

    // NOTE: DB trigger enforces drawer counts for open/close/double at this point.
    if (endShiftErr) {
      const parsed = parseClockWindowError(endShiftErr.message);
      if (parsed) {
        return NextResponse.json(
          { error: "CLOCK_WINDOW_VIOLATION", code: parsed.code, windowLabel: parsed.windowLabel },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: endShiftErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "End shift failed." }, { status: 500 });
  }
}
