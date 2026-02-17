import { NextResponse } from "next/server";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";
import { supabaseServer } from "@/lib/supabaseServer";
import type { ShiftDetailResponse } from "@/types/adminShiftDetail";

type ShiftRow = {
  id: string;
  store_id: string;
  profile_id: string;
  shift_type: "open" | "close" | "double" | "other";
  shift_source: string | null;
  shift_note: string | null;
  planned_start_at: string;
  started_at: string;
  ended_at: string | null;
  requires_override: boolean;
  override_at: string | null;
  override_by: string | null;
  override_note: string | null;
  manual_closed: boolean | null;
  manual_closed_at: string | null;
  manual_closed_by_profile: string | null;
  manual_closed_review_status: string | null;
  manual_closed_reviewed_at: string | null;
  manual_closed_reviewed_by: string | null;
  schedule_shift_id: string | null;
  unscheduled_reviewed_at: string | null;
  unscheduled_reviewed_by: string | null;
  unscheduled_review_note: string | null;
  last_action: string | null;
  last_action_by: string | null;
  created_at: string;
};

type StoreRow = { id: string; name: string; expected_drawer_cents: number };
type ProfileRow = { id: string; name: string | null; active: boolean | null };

type ScheduleShiftRow = {
  id: string;
  schedule_id: string;
  shift_date: string;
  shift_type: string;
  shift_mode: string | null;
  scheduled_start: string;
  scheduled_end: string;
};

type ScheduleRow = {
  id: string;
  status: string;
  period_start: string;
  period_end: string;
};

type DrawerCountRow = {
  id: string;
  count_type: "start" | "changeover" | "end";
  counted_at: string;
  drawer_cents: number;
  change_count: number | null;
  confirmed: boolean;
  notified_manager: boolean;
  note: string | null;
  out_of_threshold: boolean;
  reviewed_at: string | null;
  reviewed_by: string | null;
  count_missing: boolean;
};

type DailySalesRow = {
  id: string;
  business_date: string;
  open_shift_id: string | null;
  close_shift_id: string | null;
  open_x_report_cents: number | null;
  close_sales_cents: number | null;
  z_report_cents: number | null;
  closer_rollover_cents: number | null;
  opener_rollover_cents: number | null;
  rollover_cents: number | null;
  rollover_mismatch: boolean | null;
  out_of_balance: boolean | null;
  balance_variance_cents: number | null;
  reviewed_at: string | null;
  review_note: string | null;
};

type ShiftSalesRow = {
  id: string;
  entry_type: "x_report" | "z_report" | "rollover";
  amount_cents: number;
  prior_x_report_cents: number | null;
  confirmed: boolean | null;
  note: string | null;
  counted_at: string | null;
};

type SafeCloseoutRow = {
  id: string;
  business_date: string;
  status: string;
  cash_sales_cents: number;
  card_sales_cents: number;
  other_sales_cents: number;
  expected_deposit_cents: number;
  actual_deposit_cents: number;
  denom_total_cents: number;
  variance_cents: number;
  denoms_jsonb: Record<string, number>;
  requires_manager_review: boolean;
  reviewed_at: string | null;
  reviewed_by: string | null;
  deposit_override_reason: string | null;
};

type SafeExpenseRow = {
  id: string;
  amount_cents: number;
  category: string;
  note: string | null;
  created_at: string;
};

type SafePhotoRow = {
  id: string;
  photo_type: "deposit_required" | "pos_optional";
  storage_path: string | null;
  thumb_path: string | null;
  purge_after: string | null;
  created_at: string;
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ shiftId: string }> }
) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const {
      data: { user },
      error: authErr,
    } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { shiftId } = await params;
    if (!shiftId) return NextResponse.json({ error: "Missing shiftId." }, { status: 400 });

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (managerStoreIds.length === 0) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    const { data: shift, error: shiftErr } = await supabaseServer
      .from("shifts")
      .select(
        "id,store_id,profile_id,shift_type,shift_source,shift_note,planned_start_at,started_at,ended_at,requires_override,override_at,override_by,override_note,manual_closed,manual_closed_at,manual_closed_by_profile,manual_closed_review_status,manual_closed_reviewed_at,manual_closed_reviewed_by,schedule_shift_id,unscheduled_reviewed_at,unscheduled_reviewed_by,unscheduled_review_note,last_action,last_action_by,created_at"
      )
      .eq("id", shiftId)
      .maybeSingle()
      .returns<ShiftRow>();
    if (shiftErr) return NextResponse.json({ error: shiftErr.message }, { status: 500 });
    if (!shift) return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    if (!managerStoreIds.includes(shift.store_id)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const [
      storeRes,
      profileRes,
      scheduleShiftRes,
      drawerCountsRes,
      dailySalesRes,
      shiftSalesRes,
      safeCloseoutRes,
    ] = await Promise.all([
      supabaseServer
        .from("stores")
        .select("id,name,expected_drawer_cents")
        .eq("id", shift.store_id)
        .maybeSingle()
        .returns<StoreRow>(),
      supabaseServer
        .from("profiles")
        .select("id,name,active")
        .eq("id", shift.profile_id)
        .maybeSingle()
        .returns<ProfileRow>(),
      shift.schedule_shift_id
        ? supabaseServer
            .from("schedule_shifts")
            .select("id,schedule_id,shift_date,shift_type,shift_mode,scheduled_start,scheduled_end")
            .eq("id", shift.schedule_shift_id)
            .maybeSingle()
            .returns<ScheduleShiftRow>()
        : Promise.resolve({ data: null, error: null }),
      supabaseServer
        .from("shift_drawer_counts")
        .select(
          "id,count_type,counted_at,drawer_cents,change_count,confirmed,notified_manager,note,out_of_threshold,reviewed_at,reviewed_by,count_missing"
        )
        .eq("shift_id", shift.id)
        .order("counted_at", { ascending: true })
        .returns<DrawerCountRow[]>(),
      supabaseServer
        .from("daily_sales_records")
        .select(
          "id,business_date,open_shift_id,close_shift_id,open_x_report_cents,close_sales_cents,z_report_cents,closer_rollover_cents,opener_rollover_cents,rollover_cents,rollover_mismatch,out_of_balance,balance_variance_cents,reviewed_at,review_note"
        )
        .or(`open_shift_id.eq.${shift.id},close_shift_id.eq.${shift.id}`)
        .limit(1)
        .maybeSingle()
        .returns<DailySalesRow>(),
      supabaseServer
        .from("shift_sales_counts")
        .select("id,entry_type,amount_cents,prior_x_report_cents,confirmed,note,counted_at")
        .eq("shift_id", shift.id)
        .order("counted_at", { ascending: true })
        .returns<ShiftSalesRow[]>(),
      supabaseServer
        .from("safe_closeouts")
        .select(
          "id,business_date,status,cash_sales_cents,card_sales_cents,other_sales_cents,expected_deposit_cents,actual_deposit_cents,denom_total_cents,variance_cents,denoms_jsonb,requires_manager_review,reviewed_at,reviewed_by,deposit_override_reason"
        )
        .eq("shift_id", shift.id)
        .maybeSingle()
        .returns<SafeCloseoutRow>(),
    ]);

    for (const result of [
      storeRes,
      profileRes,
      scheduleShiftRes,
      drawerCountsRes,
      dailySalesRes,
      shiftSalesRes,
      safeCloseoutRes,
    ]) {
      if (result.error) {
        return NextResponse.json({ error: result.error.message }, { status: 500 });
      }
    }

    const scheduleShift = scheduleShiftRes.data;
    const scheduleRes = scheduleShift
      ? await supabaseServer
          .from("schedules")
          .select("id,status,period_start,period_end")
          .eq("id", scheduleShift.schedule_id)
          .maybeSingle()
          .returns<ScheduleRow>()
      : { data: null, error: null };
    if (scheduleRes.error) return NextResponse.json({ error: scheduleRes.error.message }, { status: 500 });

    const safeCloseout = safeCloseoutRes.data;
    const [safeExpensesRes, safePhotosRes] = safeCloseout
      ? await Promise.all([
          supabaseServer
            .from("safe_closeout_expenses")
            .select("id,amount_cents,category,note,created_at")
            .eq("closeout_id", safeCloseout.id)
            .order("created_at", { ascending: true })
            .returns<SafeExpenseRow[]>(),
          supabaseServer
            .from("safe_closeout_photos")
            .select("id,photo_type,storage_path,thumb_path,purge_after,created_at")
            .eq("closeout_id", safeCloseout.id)
            .order("created_at", { ascending: true })
            .returns<SafePhotoRow[]>(),
        ])
      : [{ data: [], error: null }, { data: [], error: null }];
    if (safeExpensesRes.error) return NextResponse.json({ error: safeExpensesRes.error.message }, { status: 500 });
    if (safePhotosRes.error) return NextResponse.json({ error: safePhotosRes.error.message }, { status: 500 });

    const response: ShiftDetailResponse = {
      shift: {
        id: shift.id,
        storeId: shift.store_id,
        profileId: shift.profile_id,
        shiftType: shift.shift_type,
        shiftSource: shift.shift_source,
        shiftNote: shift.shift_note,
        plannedStartAt: shift.planned_start_at,
        startedAt: shift.started_at,
        endedAt: shift.ended_at,
        requiresOverride: shift.requires_override,
        overrideAt: shift.override_at,
        overrideBy: shift.override_by,
        overrideNote: shift.override_note,
        manualClosed: Boolean(shift.manual_closed),
        manualClosedAt: shift.manual_closed_at,
        manualClosedByProfile: shift.manual_closed_by_profile,
        manualClosedReviewStatus: shift.manual_closed_review_status,
        manualClosedReviewedAt: shift.manual_closed_reviewed_at,
        manualClosedReviewedBy: shift.manual_closed_reviewed_by,
        scheduleShiftId: shift.schedule_shift_id,
        unscheduledReviewedAt: shift.unscheduled_reviewed_at,
        unscheduledReviewedBy: shift.unscheduled_reviewed_by,
        unscheduledReviewNote: shift.unscheduled_review_note,
        lastAction: shift.last_action,
        lastActionBy: shift.last_action_by,
        createdAt: shift.created_at,
      },
      store: storeRes.data
        ? {
            id: storeRes.data.id,
            name: storeRes.data.name,
            expectedDrawerCents: storeRes.data.expected_drawer_cents,
          }
        : null,
      profile: profileRes.data
        ? {
            id: profileRes.data.id,
            name: profileRes.data.name,
            active: profileRes.data.active,
          }
        : null,
      scheduleShift: scheduleShift
        ? {
            id: scheduleShift.id,
            scheduleId: scheduleShift.schedule_id,
            shiftDate: scheduleShift.shift_date,
            shiftType: scheduleShift.shift_type,
            shiftMode: scheduleShift.shift_mode,
            scheduledStart: scheduleShift.scheduled_start,
            scheduledEnd: scheduleShift.scheduled_end,
            scheduleStatus: scheduleRes.data?.status ?? null,
            periodStart: scheduleRes.data?.period_start ?? null,
            periodEnd: scheduleRes.data?.period_end ?? null,
          }
        : null,
      drawerCounts: (drawerCountsRes.data ?? []).map((row) => ({
        id: row.id,
        countType: row.count_type,
        countedAt: row.counted_at,
        drawerCents: row.drawer_cents,
        changeCount: row.change_count,
        confirmed: row.confirmed,
        notifiedManager: row.notified_manager,
        note: row.note,
        outOfThreshold: row.out_of_threshold,
        reviewedAt: row.reviewed_at,
        reviewedBy: row.reviewed_by,
        countMissing: row.count_missing,
      })),
      dailySalesRecord: dailySalesRes.data
        ? {
            id: dailySalesRes.data.id,
            businessDate: dailySalesRes.data.business_date,
            openShiftId: dailySalesRes.data.open_shift_id,
            closeShiftId: dailySalesRes.data.close_shift_id,
            openXReportCents: dailySalesRes.data.open_x_report_cents,
            closeSalesCents: dailySalesRes.data.close_sales_cents,
            zReportCents: dailySalesRes.data.z_report_cents,
            closerRolloverCents: dailySalesRes.data.closer_rollover_cents,
            openerRolloverCents: dailySalesRes.data.opener_rollover_cents,
            rolloverCents: dailySalesRes.data.rollover_cents,
            rolloverMismatch: dailySalesRes.data.rollover_mismatch,
            outOfBalance: dailySalesRes.data.out_of_balance,
            balanceVarianceCents: dailySalesRes.data.balance_variance_cents,
            reviewedAt: dailySalesRes.data.reviewed_at,
            reviewNote: dailySalesRes.data.review_note,
          }
        : null,
      shiftSalesEntries: (shiftSalesRes.data ?? []).map((row) => ({
        id: row.id,
        entryType: row.entry_type,
        amountCents: row.amount_cents,
        priorXReportCents: row.prior_x_report_cents,
        confirmed: row.confirmed,
        note: row.note,
        countedAt: row.counted_at,
      })),
      safeCloseout: safeCloseout
        ? {
            id: safeCloseout.id,
            businessDate: safeCloseout.business_date,
            status: safeCloseout.status,
            cashSalesCents: safeCloseout.cash_sales_cents,
            cardSalesCents: safeCloseout.card_sales_cents,
            otherSalesCents: safeCloseout.other_sales_cents,
            expectedDepositCents: safeCloseout.expected_deposit_cents,
            actualDepositCents: safeCloseout.actual_deposit_cents,
            denomTotalCents: safeCloseout.denom_total_cents,
            varianceCents: safeCloseout.variance_cents,
            denoms: safeCloseout.denoms_jsonb ?? {},
            requiresManagerReview: safeCloseout.requires_manager_review,
            reviewedAt: safeCloseout.reviewed_at,
            reviewedBy: safeCloseout.reviewed_by,
            depositOverrideReason: safeCloseout.deposit_override_reason,
            expenses: (safeExpensesRes.data ?? []).map((row) => ({
              id: row.id,
              amountCents: row.amount_cents,
              category: row.category,
              note: row.note,
              createdAt: row.created_at,
            })),
            photos: (safePhotosRes.data ?? []).map((row) => ({
              id: row.id,
              photoType: row.photo_type,
              storagePath: row.storage_path,
              thumbPath: row.thumb_path,
              purgeAfter: row.purge_after,
              createdAt: row.created_at,
            })),
          }
        : null,
    };

    return NextResponse.json(response);
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load shift detail." },
      { status: 500 }
    );
  }
}
