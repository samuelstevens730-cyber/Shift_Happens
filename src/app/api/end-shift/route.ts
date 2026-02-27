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
 * - Stores actual end submission time for payroll/reconciliation calculations
 * - Flags shifts over 13 hours as requiring manager override
 * - Uses upsert for drawer count to handle re-submissions gracefully
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { isOutOfThreshold, ShiftType } from "@/lib/kioskRules";
import { authenticateShiftRequest } from "@/lib/shiftAuth";

type Body = {
  qrToken?: string;
  shiftId: string;
  endAt: string; // ISO
  endDrawerCents?: number | null; // optional for "other" if you want
  changeDrawerCents?: number | null; // change drawer count in cents
  salesXReportCents?: number | null;
  salesZReportCents?: number | null;
  salesPriorXCents?: number | null;
  salesConfirmed?: boolean;
  confirmed?: boolean;
  notifiedManager?: boolean;
  note?: string | null;
  manualClose?: boolean;
  /** Transactions rung in the AM/open half (open shift). 0 = not captured. */
  openTransactionCount?: number | null;
  /** Transactions rung in the PM half (close/double). 0 = not captured. */
  closeTransactionCount?: number | null;
};

type TemplateRow = { id: string; store_id: string | null; shift_type: string };
type ScheduleShiftRow = {
  shift_date: string;
  scheduled_start: string;
  scheduled_end: string;
};

type SalesDailyRecordRow = {
  id: string;
  out_of_balance: boolean | null;
  balance_variance_cents: number | null;
  open_x_report_cents?: number | null;
};

const SCHEDULED_OVERRIDE_GRACE_MINUTES = 15;

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

function getCstDateKey(value: string): string | null {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(dt);
  const y = parts.find(p => p.type === "year")?.value;
  const m = parts.find(p => p.type === "month")?.value;
  const d = parts.find(p => p.type === "day")?.value;
  if (!y || !m || !d) return null;
  return `${y}-${m}-${d}`;
}

function dayOfWeekFromDateOnly(dateOnly: string): number {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  return dt.getUTCDay();
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
      .select("id, store_id, profile_id, shift_type, planned_start_at, ended_at, started_at, schedule_shift_id, shift_source, requires_override")
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

    // 2.5) Optional sales tracking (hours-safe, no behavior change when disabled)
    let salesWarning = false;
    let salesVarianceCents: number | null = null;
    const businessDate = getCstDateKey(shift.planned_start_at);
    if (!businessDate) {
      return NextResponse.json({ error: "Invalid shift planned_start_at for sales tracking." }, { status: 400 });
    }

    const [storeSettingsRes, rolloverConfigRes] = await Promise.all([
      supabaseServer
        .from("store_settings")
        .select("sales_tracking_enabled, sales_rollover_enabled, safe_ledger_enabled")
        .eq("store_id", shift.store_id)
        .maybeSingle<{
          sales_tracking_enabled: boolean | null;
          sales_rollover_enabled: boolean | null;
          safe_ledger_enabled: boolean | null;
        }>(),
      supabaseServer
        .from("store_rollover_config")
        .select("has_rollover")
        .eq("store_id", shift.store_id)
        .eq("day_of_week", dayOfWeekFromDateOnly(businessDate))
        .maybeSingle<{ has_rollover: boolean | null }>(),
    ]);
    if (storeSettingsRes.error) return NextResponse.json({ error: storeSettingsRes.error.message }, { status: 500 });
    if (rolloverConfigRes.error) return NextResponse.json({ error: rolloverConfigRes.error.message }, { status: 500 });
    const salesTrackingEnabled = Boolean(storeSettingsRes.data?.sales_tracking_enabled);
    const salesRolloverEnabled = storeSettingsRes.data?.sales_rollover_enabled ?? true;
    const safeLedgerEnabled = Boolean(storeSettingsRes.data?.safe_ledger_enabled);
    const isRolloverNight = Boolean(rolloverConfigRes.data?.has_rollover) && Boolean(salesRolloverEnabled);

    if (salesTrackingEnabled && shiftType !== "other") {
      const isOpenSales = shiftType === "open";
      const isCloseSales = shiftType === "close" || shiftType === "double";

      if (isOpenSales) {
        if (!Number.isFinite(body.salesXReportCents ?? null) || (body.salesXReportCents ?? 0) < 0) {
          return NextResponse.json({ error: "Missing or invalid X report total." }, { status: 400 });
        }

        const xReportCents = Math.round(body.salesXReportCents ?? 0);

        // Zero-contamination guard: treat 0 as "not captured" (same as null).
        const openTxnCount =
          typeof body.openTransactionCount === "number" &&
          Number.isInteger(body.openTransactionCount) &&
          body.openTransactionCount > 0
            ? body.openTransactionCount
            : null;

        const { data: dailyUpsert, error: dailyErr } = await supabaseServer
          .from("daily_sales_records")
          .upsert(
            {
              store_id: shift.store_id,
              business_date: businessDate,
              open_shift_id: shift.id,
              open_x_report_cents: xReportCents,
              ...(openTxnCount != null ? { open_transaction_count: openTxnCount } : {}),
            },
            { onConflict: "store_id,business_date" }
          )
          .select("id, out_of_balance, balance_variance_cents")
          .maybeSingle<SalesDailyRecordRow>();
        if (dailyErr) return NextResponse.json({ error: dailyErr.message }, { status: 500 });

        const dailyRecordId = dailyUpsert?.id ?? null;
        if (!dailyRecordId) {
          return NextResponse.json({ error: "Failed to upsert daily sales record." }, { status: 500 });
        }

        const { error: shiftSalesErr } = await supabaseServer
          .from("shift_sales_counts")
          .upsert(
            {
              shift_id: shift.id,
              daily_sales_record_id: dailyRecordId,
              entry_type: "x_report",
              amount_cents: xReportCents,
              confirmed: Boolean(body.salesConfirmed),
              note: body.note ?? null,
            },
            { onConflict: "shift_id,entry_type" }
          );
        if (shiftSalesErr) return NextResponse.json({ error: shiftSalesErr.message }, { status: 500 });

        salesWarning = Boolean(dailyUpsert?.out_of_balance);
        salesVarianceCents = dailyUpsert?.balance_variance_cents ?? null;
      }

      if (isCloseSales && !isRolloverNight) {
        let zReportCents: number | null =
          Number.isFinite(body.salesZReportCents ?? null) && (body.salesZReportCents ?? 0) >= 0
            ? Math.round(body.salesZReportCents ?? 0)
            : null;
        let priorXReportCents: number | null =
          Number.isFinite(body.salesPriorXCents ?? null) && (body.salesPriorXCents ?? 0) >= 0
            ? Math.round(body.salesPriorXCents ?? 0)
            : null;

        if ((zReportCents == null || priorXReportCents == null) && safeLedgerEnabled) {
          const [dailyRecordLookupRes, closeoutLookupRes] = await Promise.all([
            supabaseServer
              .from("daily_sales_records")
              .select("id,open_x_report_cents")
              .eq("store_id", shift.store_id)
              .eq("business_date", businessDate)
              .maybeSingle<{ id: string; open_x_report_cents: number | null }>(),
            supabaseServer
              .from("safe_closeouts")
              .select("id,status,cash_sales_cents,card_sales_cents")
              .eq("store_id", shift.store_id)
              .eq("business_date", businessDate)
              .maybeSingle<{
                id: string;
                status: string;
                cash_sales_cents: number;
                card_sales_cents: number;
              }>(),
          ]);
          if (dailyRecordLookupRes.error) {
            return NextResponse.json({ error: dailyRecordLookupRes.error.message }, { status: 500 });
          }
          if (closeoutLookupRes.error) {
            return NextResponse.json({ error: closeoutLookupRes.error.message }, { status: 500 });
          }

          const closeout = closeoutLookupRes.data;
          if (closeout && closeout.status !== "draft") {
            zReportCents = closeout.cash_sales_cents + closeout.card_sales_cents;
          }
          if (priorXReportCents == null) {
            priorXReportCents = dailyRecordLookupRes.data?.open_x_report_cents ?? null;
          }
        }

        if (zReportCents == null) {
          return NextResponse.json({ error: "Missing or invalid Z report total." }, { status: 400 });
        }
        if (priorXReportCents == null) {
          return NextResponse.json({ error: "Missing prior X report total. Ensure open shift sales are entered." }, { status: 400 });
        }

        const closeSalesCents = zReportCents - priorXReportCents;

        // Zero-contamination guard: treat 0 as "not captured" (same as null).
        const closeTxnCount =
          typeof body.closeTransactionCount === "number" &&
          Number.isInteger(body.closeTransactionCount) &&
          body.closeTransactionCount > 0
            ? body.closeTransactionCount
            : null;

        const { data: dailyUpsert, error: dailyErr } = await supabaseServer
          .from("daily_sales_records")
          .upsert(
            {
              store_id: shift.store_id,
              business_date: businessDate,
              close_shift_id: shift.id,
              close_sales_cents: closeSalesCents,
              z_report_cents: zReportCents,
              ...(closeTxnCount != null ? { close_transaction_count: closeTxnCount } : {}),
            },
            { onConflict: "store_id,business_date" }
          )
          .select("id, out_of_balance, balance_variance_cents")
          .maybeSingle<SalesDailyRecordRow>();
        if (dailyErr) return NextResponse.json({ error: dailyErr.message }, { status: 500 });

        const dailyRecordId = dailyUpsert?.id ?? null;
        if (!dailyRecordId) {
          return NextResponse.json({ error: "Failed to upsert daily sales record." }, { status: 500 });
        }

        const { error: shiftSalesErr } = await supabaseServer
          .from("shift_sales_counts")
          .upsert(
            {
              shift_id: shift.id,
              daily_sales_record_id: dailyRecordId,
              entry_type: "z_report",
              amount_cents: zReportCents,
              prior_x_report_cents: priorXReportCents,
              confirmed: Boolean(body.salesConfirmed),
              note: body.note ?? null,
            },
            { onConflict: "shift_id,entry_type" }
          );
        if (shiftSalesErr) return NextResponse.json({ error: shiftSalesErr.message }, { status: 500 });

        salesWarning = Boolean(dailyUpsert?.out_of_balance);
        salesVarianceCents = dailyUpsert?.balance_variance_cents ?? null;
      }

      if (isCloseSales && isRolloverNight) {
        const { error: markRolloverErr } = await supabaseServer
          .from("daily_sales_records")
          .upsert(
            {
              store_id: shift.store_id,
              business_date: businessDate,
              close_shift_id: shift.id,
              is_rollover_night: true,
            },
            { onConflict: "store_id,business_date" }
          );
        if (markRolloverErr) return NextResponse.json({ error: markRolloverErr.message }, { status: 500 });
      }

      if (salesWarning && !body.salesConfirmed) {
        return NextResponse.json(
          {
            error: "Sales mismatch detected. Please confirm to continue.",
            requiresSalesConfirm: true,
            salesVarianceCents,
          },
          { status: 400 }
        );
      }
    }

    // 3) Round end time, set ended_at
    const endAt = new Date(body.endAt);
    if (Number.isNaN(endAt.getTime())) return NextResponse.json({ error: "Invalid endAt." }, { status: 400 });

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

    // Clock-window enforcement is temporarily disabled.

    // Override review should be based on scheduled/planned start -> actual clock-out submission time.
    const plannedStartAt = new Date(shift.planned_start_at);
    const durationHours = Number.isNaN(plannedStartAt.getTime())
      ? null
      : (endAt.getTime() - plannedStartAt.getTime()) / (1000 * 60 * 60);
    const overScheduledDuration = hasScheduledShift
      && durationHours != null
      && scheduledDurationHours != null
      && durationHours > (scheduledDurationHours + (SCHEDULED_OVERRIDE_GRACE_MINUTES / 60));
    const durationRequiresOverride = durationHours != null && durationHours > 13;
    const requiresOverride = Boolean(shift.requires_override) || durationRequiresOverride || overScheduledDuration;

    const updatePayload: Record<string, string | boolean | null> = {
      ended_at: endAt.toISOString(),
      requires_override: requiresOverride,
    };

    // Keep legacy rows (schedule_shift_id present but shift_source null/manual)
    // from being treated as unscheduled by DB fallback clock-window trigger.
    if (shift.schedule_shift_id) {
      updatePayload.shift_source = "scheduled";
    }

    if (overScheduledDuration) {
      updatePayload.override_note = "Clock-out exceeded scheduled hours";
    }

    if (body.manualClose) {
      updatePayload.manual_closed = true;
      updatePayload.manual_closed_at = endAt.toISOString();
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

    return NextResponse.json({
      ok: true,
      salesWarning: salesWarning || undefined,
      salesVarianceCents: salesVarianceCents ?? undefined,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "End shift failed." }, { status: 500 });
  }
}
