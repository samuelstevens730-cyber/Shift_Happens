/**
 * POST /api/start-shift - Clock In
 *
 * Creates a new shift record and records the starting drawer count for an employee.
 *
 * Authentication: Bearer token required (employee PIN JWT or manager Supabase session)
 * - Employee PIN JWT: issued by employee-auth edge function after PIN verification
 * - Manager Supabase: manager can clock in for themselves only (profile linked via auth_user_id)
 *
 * Request body:
 * - qrToken?: string - QR token to identify the store (alternative to storeId)
 * - storeId?: string - Store ID (alternative to qrToken; one of qrToken or storeId required)
 * - profileId: string - Employee profile ID (must match authenticated user)
 * - shiftTypeHint?: "open" | "close" | "double" | "other" - Optional hint (server derives shift_type)
 * - plannedStartAt: string - ISO timestamp of planned start time (required)
 * - startDrawerCents?: number | null - Starting drawer count in cents (optional, can be submitted immediately after clock-in)
 * - changeDrawerCents?: number | null - Change drawer count in cents (optional, can be submitted immediately after clock-in)
 * - confirmed?: boolean - Whether the drawer count was confirmed (required if out of threshold)
 * - notifiedManager?: boolean - Whether manager was notified of discrepancy
 * - note?: string | null - Optional note about the drawer count
 *
 * Returns:
 * - Success: { shiftId: string, reused: boolean, startedAt?: string }
 * - Error: { error: string, requiresConfirm?: boolean, shiftId?: string }
 *
 * Business logic:
 * - Authenticates via employee PIN JWT or manager Supabase session
 * - Validates profileId matches authenticated user (no impersonation)
 * - Resolves store by QR token or store ID
 * - Validates employee exists, is active, and is assigned to the store
 * - Rounds planned start time to nearest 30 minutes for payroll consistency
 * - Start drawer can be captured after clock-in (separate flow)
 * - If drawer count is outside expected threshold, requires manager notification
 * - Prevents duplicate active shifts - returns existing shift if employee already clocked in at same store
 * - Blocks clock-in if employee has active shift at different store
 * - Matches planned start to published schedule (within -5/+15 min). If not scheduled, requires approval.
 * - Creates shift record and drawer count atomically (cleans up shift if drawer count fails)
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { isOutOfThreshold, roundTo30Minutes, ShiftType } from "@/lib/kioskRules";
import { getCstDowMinutes } from "@/lib/clockWindows";
import { authenticateShiftRequest, validateProfileAccess } from "@/lib/shiftAuth";
import { fetchCurrentWeather } from "@/lib/weatherClient";

type Body = {
  qrToken?: string;
  storeId?: string;
  profileId: string;
  shiftTypeHint?: ShiftType;
  plannedStartAt: string; // ISO string
  startDrawerCents?: number | null; // optional (captured pre- or post-clock-in)
  changeDrawerCents?: number | null; // change drawer count in cents
  confirmed?: boolean; // required if out of threshold
  notifiedManager?: boolean;
  note?: string | null;
  force?: boolean;
};

const ALLOWED_SHIFT_TYPES: ShiftType[] = ["open", "close", "double", "other"];

function resolveScheduledShiftType(
  shiftType: ShiftType,
  shiftMode: string | null | undefined
): ShiftType {
  // Scheduler stores double coverage as open/close rows with shift_mode = "double".
  if (shiftMode === "double" || shiftType === "double") return "double";
  return shiftType;
}

function parseClockWindowError(message: string) {
  const token = "CLOCK_WINDOW_VIOLATION:";
  if (!message.includes(token)) return null;
  const label = message.split(token)[1]?.trim() || "Outside allowed clock window";
  return { code: "CLOCK_WINDOW_VIOLATION", windowLabel: label };
}

async function resolveStoreIdFromQR(qrToken?: string): Promise<string | null> {
  if (!qrToken) return null;
  const { data } = await supabaseServer
    .from("stores")
    .select("id")
    .eq("qr_token", qrToken)
    .maybeSingle();
  return data?.id ?? null;
}

export async function POST(req: Request) {
  try {
    // 0) Authenticate request (employee PIN JWT or manager Supabase session)
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : null;

    if (!token) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const authResult = await authenticateShiftRequest(req);
    if (!authResult.ok) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const auth = authResult.auth;

    const body = (await req.json()) as Body;

    // Basic validation
    if (!body.qrToken && !body.storeId) {
      return NextResponse.json({ error: "Missing qrToken or storeId." }, { status: 400 });
    }
    if (!body.profileId) return NextResponse.json({ error: "Missing profileId." }, { status: 400 });

    // Validate profileId matches authenticated user (no impersonation)
    const profileCheck = validateProfileAccess(auth, body.profileId);
    if (!profileCheck.ok) {
      return NextResponse.json({ error: profileCheck.error }, { status: 403 });
    }
    if (body.shiftTypeHint && !ALLOWED_SHIFT_TYPES.includes(body.shiftTypeHint))
      return NextResponse.json({ error: "Invalid shiftTypeHint." }, { status: 400 });

    if (!body.plannedStartAt) return NextResponse.json({ error: "Missing plannedStartAt." }, { status: 400 });

    // 1) Resolve store by QR token or storeId
    const storeQuery = supabaseServer
      .from("stores")
      .select("id, name, expected_drawer_cents, latitude, longitude");

    const { data: store, error: storeErr } = body.qrToken
      ? await storeQuery.eq("qr_token", body.qrToken).maybeSingle()
      : await storeQuery.eq("id", body.storeId).maybeSingle();

    if (storeErr) return NextResponse.json({ error: storeErr.message }, { status: 500 });
    if (!store) return NextResponse.json({ error: "Invalid store." }, { status: 401 });

    // 2) Validate profile exists + active
    const { data: prof, error: profErr } = await supabaseServer
      .from("profiles")
      .select("id, active")
      .eq("id", body.profileId)
      .maybeSingle();

    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });
    if (!prof || prof.active === false)
      return NextResponse.json({ error: "Invalid or inactive employee." }, { status: 400 });

    // 3) Membership check (you made the table, so use it)
    const { data: mem, error: memErr } = await supabaseServer
      .from("store_memberships")
      .select("store_id")
      .eq("store_id", store.id)
      .eq("profile_id", body.profileId)
      .maybeSingle();

    if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });
    if (!mem) return NextResponse.json({ error: "Employee not assigned to this store." }, { status: 400 });

    // 4) Parse manual start time entered by employee.
    const planned = new Date(body.plannedStartAt);
    if (Number.isNaN(planned.getTime()))
      return NextResponse.json({ error: "Invalid plannedStartAt." }, { status: 400 });
    // Keep rounded helper values for schedule/window matching only.
    const plannedRounded = roundTo30Minutes(planned);

    // 4b) Determine schedule match + shift type from schedule if possible
    const plannedCst = getCstDowMinutes(plannedRounded);
    const plannedDateKey = plannedRounded.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const plannedMinutes = plannedCst?.minutes ?? null;

    const { data: scheduledRows, error: schedErr } = await supabaseServer
      .from("schedule_shifts")
      .select("id, shift_type, shift_mode, scheduled_start, scheduled_end, shift_date, schedules!inner(status)")
      // Source-of-truth store scope should come from parent schedule record.
      // schedule_shifts.store_id can be null/stale on legacy rows.
      .eq("schedules.store_id", store.id)
      .eq("profile_id", body.profileId)
      .eq("shift_date", plannedDateKey)
      .eq("schedules.status", "published");

    if (schedErr) return NextResponse.json({ error: schedErr.message }, { status: 500 });

    let matchedSchedule: { id: string; shift_type: ShiftType } | null = null;
    let bestWithinWindowScore: number | null = null;
    let nearestSchedule: { id: string; shift_type: ShiftType; score: number } | null = null;
    let doubleSchedule: { id: string; shift_type: ShiftType } | null = null;
    if (plannedMinutes != null && scheduledRows?.length) {
      for (const row of scheduledRows) {
        const scheduledType = resolveScheduledShiftType(
          row.shift_type as ShiftType,
          row.shift_mode ?? null
        );
        if (!doubleSchedule && scheduledType === "double") {
          doubleSchedule = { id: row.id, shift_type: "double" };
        }
        const [h, m] = row.scheduled_start.split(":");
        const schedMinutes = Number(h) * 60 + Number(m);
        const diff = plannedMinutes - schedMinutes;
        const score = Math.abs(diff);
        if (!nearestSchedule || score < nearestSchedule.score) {
          nearestSchedule = { id: row.id, shift_type: scheduledType, score };
        }
        if (diff >= -5 && diff <= 15) {
          if (bestWithinWindowScore == null || score < bestWithinWindowScore) {
            matchedSchedule = { id: row.id, shift_type: scheduledType };
            bestWithinWindowScore = score;
          }
        }
      }
    } else if (scheduledRows?.length) {
      const first = scheduledRows[0];
      nearestSchedule = {
        id: first.id,
        shift_type: resolveScheduledShiftType(first.shift_type as ShiftType, first.shift_mode ?? null),
        score: 0,
      };
      const foundDouble = scheduledRows.find(
        (row) => resolveScheduledShiftType(row.shift_type as ShiftType, row.shift_mode ?? null) === "double"
      );
      if (foundDouble) {
        doubleSchedule = { id: foundDouble.id, shift_type: "double" };
      }
    }

    const isWithinScheduledWindow = Boolean(matchedSchedule);
    const hasScheduledShift = Boolean(nearestSchedule);
    // Block unscheduled clock-ins unless explicitly forced (user confirmed the popup)
    if (!hasScheduledShift && !body.force) {
      return NextResponse.json(
        {
          error: "UNSCHEDULED",
          code: "UNSCHEDULED",
          requiresApproval: true,
          message: `You are clocking in for ${plannedRounded.toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "long", month: "short", day: "numeric" })} at ${plannedRounded.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" })}, but you are not on the schedule. This shift will require management approval.`,
        },
        { status: 409 }
      );
    }

    let resolvedShiftType: ShiftType =
      matchedSchedule?.shift_type ??
      doubleSchedule?.shift_type ??
      nearestSchedule?.shift_type ??
      "other";

    const resolvedScheduleId =
      matchedSchedule?.id ??
      doubleSchedule?.id ??
      nearestSchedule?.id ??
      null;

    if (!hasScheduledShift) {
      if (plannedCst) {
        const { data: templates } = await supabaseServer
          .from("shift_templates")
          .select("shift_type, start_time")
          .eq("store_id", store.id)
          .eq("day_of_week", plannedCst.dow)
          .in("shift_type", ["open", "close"]);

        const toMinutes = (timeStr: string) => {
          const [hh, mm] = timeStr.split(":");
          return Number(hh) * 60 + Number(mm);
        };

        if (templates && templates.length > 0 && plannedMinutes != null) {
          const openStart = templates.find(t => t.shift_type === "open")?.start_time;
          const closeStart = templates.find(t => t.shift_type === "close")?.start_time;
          if (openStart && Math.abs(plannedMinutes - toMinutes(openStart)) <= 120) {
            resolvedShiftType = "open";
          } else if (closeStart && Math.abs(plannedMinutes - toMinutes(closeStart)) <= 120) {
            resolvedShiftType = "close";
          } else {
            resolvedShiftType = "other";
          }
        } else if (body.shiftTypeHint && ALLOWED_SHIFT_TYPES.includes(body.shiftTypeHint)) {
          resolvedShiftType = body.shiftTypeHint;
        }
      } else if (body.shiftTypeHint && ALLOWED_SHIFT_TYPES.includes(body.shiftTypeHint)) {
        resolvedShiftType = body.shiftTypeHint;
      }
    }

    // Clock-window enforcement is temporarily disabled.

    // 5) Enforce start drawer rules BEFORE creating the shift
    const startCents = body.startDrawerCents ?? null;
    const changeCents = body.changeDrawerCents ?? null;

    // Start drawer capture is optional at clock-in and may be submitted immediately after clock-in.
    // If caller provides drawer values here, still enforce manager-notify rules.
    if (startCents !== null && startCents !== undefined) {
      if (!Number.isFinite(startCents)) {
        return NextResponse.json({ error: "Invalid startDrawerCents." }, { status: 400 });
      }
      const out = isOutOfThreshold(startCents, store.expected_drawer_cents);
      if (out && !body.notifiedManager) {
        return NextResponse.json(
          { error: "Start drawer outside threshold. Must notify manager.", requiresConfirm: true },
          { status: 400 }
        );
      }
    }
    if (changeCents !== null && changeCents !== undefined) {
      if (!Number.isFinite(changeCents)) {
        return NextResponse.json({ error: "Invalid changeDrawerCents." }, { status: 400 });
      }
      const changeNot200 = changeCents !== 20000;
      if (changeNot200 && !body.notifiedManager) {
        return NextResponse.json(
          { error: "Change drawer not $200. Must notify manager.", requiresConfirm: true },
          { status: 400 }
        );
      }
    }

    // 6) Create shift (database enforces one active shift per employee via unique index)
    let shift: { id: string } | null = null;
    try {
      const result = await supabaseServer
        .from("shifts")
        .insert({
          store_id: store.id,
          profile_id: body.profileId,
          shift_type: resolvedShiftType,
          schedule_shift_id: resolvedScheduleId,
          shift_source: hasScheduledShift ? "scheduled" : "manual",
          // Override is now reserved for over-scheduled or >13h at clock-out.
          requires_override: false,
          override_note: null,
          // Manual clock-in time for payroll/labor calculations.
          planned_start_at: planned.toISOString(),
          // Submission timestamp (audit/event trail).
          started_at: new Date().toISOString(),
        })
        .select("id")
        .maybeSingle();

      shift = result.data;
      const shiftErr = result.error;

      if (shiftErr) {
        const parsed = parseClockWindowError(shiftErr.message);
        if (parsed) {
          return NextResponse.json(
            { error: "CLOCK_WINDOW_VIOLATION", code: parsed.code, windowLabel: parsed.windowLabel },
            { status: 400 }
          );
        }
        return NextResponse.json({ error: shiftErr.message }, { status: 500 });
      }
    } catch (err: unknown) {
      // Check for unique violation (23505) - active shift already exists
      const errorCode = (err as { code?: string }).code;
      if (errorCode === "23505") {
        return NextResponse.json({ error: "Active shift already exists" }, { status: 409 });
      }
      // Re-throw other errors to be caught by outer catch
      throw err;
    }

    if (!shift) return NextResponse.json({ error: "Failed to create shift." }, { status: 500 });

    // 8) Insert start drawer count for non-other; optional for other if provided
    if (startCents !== null && startCents !== undefined) {
      const { error: sdcErr } = await supabaseServer.from("shift_drawer_counts").insert({
        shift_id: shift.id,
        count_type: "start",
        drawer_cents: startCents,
        change_count: changeCents,
        confirmed: Boolean(body.confirmed),
        notified_manager: Boolean(body.notifiedManager),
        note: body.note ?? null,
      });

      if (sdcErr) {
        // Clean up the created shift so you don’t accumulate ghosts
        await supabaseServer.from("shifts").delete().eq("id", shift.id);
        return NextResponse.json({ error: sdcErr.message }, { status: 500 });
      }
    }

    // 9) Capture start weather — non-fatal; never delays or blocks clock-in response.
    if (store.latitude != null && store.longitude != null) {
      fetchCurrentWeather(store.latitude, store.longitude)
        .then(async (snap) => {
          if (!snap) return;
          await supabaseServer
            .from("shifts")
            .update({
              start_weather_condition: snap.condition,
              start_weather_desc:      snap.description,
              start_temp_f:            snap.tempF,
            })
            .eq("id", shift!.id);
        })
        .catch((err) => {
          console.warn("[start-shift] Weather capture failed (non-fatal):", err);
        });
    }

    return NextResponse.json({ shiftId: shift.id, reused: false, shiftType: resolvedShiftType });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Start shift failed." },
      { status: 500 }
    );
  }
}
