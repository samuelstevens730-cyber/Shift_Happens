import { NextResponse } from "next/server";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";
import { supabaseServer } from "@/lib/supabaseServer";

type ScheduledRow = {
  id: string;
  profile_id: string | null;
  store_id: string;
  shift_date: string;
  shift_type: "open" | "close" | "double" | "other";
  scheduled_start: string;
  scheduled_end: string;
  store: { name: string } | null;
  profile: { name: string | null } | null;
};

type ShiftRow = {
  id: string;
  profile_id: string;
  store_id: string;
  shift_type: "open" | "close" | "double" | "other";
  planned_start_at: string;
  started_at: string | null;
  ended_at: string | null;
  requires_override: boolean | null;
  override_at: string | null;
  override_note: string | null;
  manual_closed: boolean | null;
  manual_closed_reviewed_at: string | null;
  schedule_shift_id: string | null;
  store: { name: string } | null;
  profile: { name: string | null } | null;
};

type AdvanceRow = {
  profile_id: string;
  advance_hours: string | number;
};

type StoreSettingsRow = {
  store_id: string;
  payroll_variance_warn_hours: number | null;
  payroll_shift_drift_warn_hours: number | null;
};

function calcScheduledMinutes(start: string, end: string) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  return endMin >= startMin ? endMin - startMin : (24 * 60 - startMin) + endMin;
}

function calcActualMinutes(startAt: string, endAt: string) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

function roundMinutes(mins: number) {
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (rem < 20) return hours;
  if (rem > 40) return hours + 1;
  return hours + 0.5;
}

function getCstOffsetMinutes(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    timeZoneName: "shortOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const tz = parts.find(p => p.type === "timeZoneName")?.value ?? "";
  const match = tz.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/i);
  if (!match) return null;
  const hours = Number(match[1]);
  const mins = Number(match[2] || "0");
  return hours * 60 + (hours < 0 ? -mins : mins);
}

function cstDateStartToUtcIso(dateOnly: string) {
  const match = dateOnly.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  const utcMidnight = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0));
  const offset = getCstOffsetMinutes(utcMidnight);
  if (offset == null) return null;
  const utcMillis = Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0) - offset * 60000;
  return new Date(utcMillis).toISOString();
}

function nextDateOnly(dateOnly: string) {
  const match = dateOnly.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function detectStoreBucket(storeName: string | null) {
  const name = (storeName || "").toLowerCase();
  if (/\blv\s*1\b/.test(name)) return "lv1";
  if (/\blv\s*2\b/.test(name)) return "lv2";
  return "other";
}

function inWorkedThrough(shiftDate: string, asOf: string) {
  return shiftDate <= asOf;
}

function getCstDateKey(value: string) {
  const dt = new Date(value);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(dt);
  const y = parts.find(p => p.type === "year")?.value ?? "";
  const m = parts.find(p => p.type === "month")?.value ?? "";
  const d = parts.find(p => p.type === "day")?.value ?? "";
  return `${y}-${m}-${d}`;
}

export async function GET(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { data: auth, error: authErr } = await supabaseServer.auth.getUser(token);
    if (authErr || !auth.user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const asOf = url.searchParams.get("asOf");
    const storeId = url.searchParams.get("storeId") || "";
    if (!from || !to) return NextResponse.json({ error: "from and to are required (YYYY-MM-DD)." }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json({ error: "from/to must be YYYY-MM-DD." }, { status: 400 });
    }

    const safeAsOf = asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : to;
    if (safeAsOf < from || safeAsOf > to) {
      return NextResponse.json({ error: "asOf must be within the selected date range." }, { status: 400 });
    }

    const managerStoreIds = await getManagerStoreIds(auth.user.id);
    if (managerStoreIds.length === 0) {
      return NextResponse.json({ error: "No managed stores." }, { status: 403 });
    }
    if (storeId && !managerStoreIds.includes(storeId)) {
      return NextResponse.json({ error: "Invalid store selection." }, { status: 403 });
    }
    const scopeStoreIds = storeId ? [storeId] : managerStoreIds;

    const fromUtcIso = cstDateStartToUtcIso(from);
    const toExclusive = nextDateOnly(to);
    const toUtcExclusiveIso = toExclusive ? cstDateStartToUtcIso(toExclusive) : null;
    const asOfExclusive = nextDateOnly(safeAsOf);
    const asOfUtcExclusiveIso = asOfExclusive ? cstDateStartToUtcIso(asOfExclusive) : null;
    if (!fromUtcIso || !toUtcExclusiveIso || !asOfUtcExclusiveIso) {
      return NextResponse.json({ error: "Invalid date bounds." }, { status: 400 });
    }

    const { data: settingsRows, error: settingsErr } = await supabaseServer
      .from("store_settings")
      .select("store_id, payroll_variance_warn_hours, payroll_shift_drift_warn_hours")
      .in("store_id", scopeStoreIds)
      .returns<StoreSettingsRow[]>();
    if (settingsErr) return NextResponse.json({ error: settingsErr.message }, { status: 500 });

    const varianceThresholdHours = Math.min(
      ...((settingsRows ?? [])
        .map(r => Number(r.payroll_variance_warn_hours ?? 2))
        .filter(n => Number.isFinite(n) && n >= 0)),
      2
    );
    const shiftDriftThresholdHours = Math.min(
      ...((settingsRows ?? [])
        .map(r => Number(r.payroll_shift_drift_warn_hours ?? 2))
        .filter(n => Number.isFinite(n) && n >= 0)),
      2
    );

    const { data: scheduledRowsRaw, error: scheduledErr } = await supabaseServer
      .from("schedule_shifts")
      .select("id, profile_id, store_id, shift_date, shift_type, scheduled_start, scheduled_end, store:store_id(name), profile:profile_id(name), schedules!inner(status)")
      .in("store_id", scopeStoreIds)
      .eq("schedules.status", "published")
      .gte("shift_date", from)
      .lte("shift_date", to)
      .returns<ScheduledRow[]>();
    if (scheduledErr) return NextResponse.json({ error: scheduledErr.message }, { status: 500 });
    const scheduledRows = scheduledRowsRaw ?? [];

    const { data: shiftRowsRaw, error: shiftErr } = await supabaseServer
      .from("shifts")
      .select("id, profile_id, store_id, shift_type, planned_start_at, started_at, ended_at, requires_override, override_at, override_note, manual_closed, manual_closed_reviewed_at, schedule_shift_id, store:store_id(name), profile:profile_id(name)")
      .in("store_id", scopeStoreIds)
      .neq("last_action", "removed")
      .gte("planned_start_at", fromUtcIso)
      .lt("planned_start_at", toUtcExclusiveIso)
      .returns<ShiftRow[]>();
    if (shiftErr) return NextResponse.json({ error: shiftErr.message }, { status: 500 });
    const shiftRows = shiftRowsRaw ?? [];

    const eligibleProfileIds = Array.from(new Set(
      scheduledRows.map(r => r.profile_id).concat(shiftRows.map(r => r.profile_id)).filter(Boolean)
    )) as string[];
    let advanceRows: AdvanceRow[] = [];
    if (eligibleProfileIds.length > 0) {
      const { data: advRows, error: advErr } = await supabaseServer
        .from("payroll_advances")
        .select("profile_id, advance_hours")
        .in("profile_id", eligibleProfileIds)
        .eq("status", "verified")
        .gte("advance_date", fromUtcIso)
        .lt("advance_date", toUtcExclusiveIso)
        .returns<AdvanceRow[]>();
      if (advErr) return NextResponse.json({ error: advErr.message }, { status: 500 });
      advanceRows = advRows ?? [];
    }

    const scheduledById = new Map(scheduledRows.map(r => [r.id, r]));
    const shiftsWorkedThrough = shiftRows.filter(r => {
      const shiftDate = getCstDateKey(r.planned_start_at);
      return shiftDate <= safeAsOf;
    });

    const scheduledWorkedThrough = scheduledRows.filter(r => inWorkedThrough(r.shift_date, safeAsOf));
    const matchedScheduleIds = new Set(
      shiftsWorkedThrough.map(r => r.schedule_shift_id).filter((v): v is string => Boolean(v))
    );
    const shiftsByCoverageKey = new Map<string, ShiftRow[]>();
    for (const shift of shiftsWorkedThrough) {
      const key = `${shift.profile_id}|${shift.store_id}|${getCstDateKey(shift.planned_start_at)}`;
      const list = shiftsByCoverageKey.get(key) ?? [];
      list.push(shift);
      shiftsByCoverageKey.set(key, list);
    }
    const missingCoverageRows = scheduledWorkedThrough.filter(r => {
      if (matchedScheduleIds.has(r.id)) return false;
      if (!r.profile_id) return false;
      const key = `${r.profile_id}|${r.store_id}|${r.shift_date}`;
      const sameDayShifts = shiftsByCoverageKey.get(key) ?? [];
      if (!sameDayShifts.length) return true;

      const hasCompatibleShift = sameDayShifts.some(shift => {
        if (shift.shift_type === r.shift_type) return true;
        if (shift.shift_type === "double" && (r.shift_type === "open" || r.shift_type === "close" || r.shift_type === "double")) return true;
        if (r.shift_type === "double" && (shift.shift_type === "open" || shift.shift_type === "close")) return true;
        return false;
      });
      return !hasCompatibleShift;
    });

    const unapprovedShifts = shiftsWorkedThrough.filter(r =>
      (Boolean(r.manual_closed) && !r.manual_closed_reviewed_at) ||
      (Boolean(r.requires_override) && Boolean(r.ended_at) && !r.override_at)
    );
    const openShifts = shiftsWorkedThrough.filter(r => !r.ended_at);

    const unexplainedVariances = shiftsWorkedThrough
      .filter(r => Boolean(r.schedule_shift_id) && Boolean(r.ended_at))
      .map(r => {
        const scheduled = r.schedule_shift_id ? scheduledById.get(r.schedule_shift_id) : null;
        if (!scheduled || !r.ended_at) return null;
        const actualMinutes = calcActualMinutes(r.planned_start_at, r.ended_at);
        const scheduledMinutes = calcScheduledMinutes(scheduled.scheduled_start, scheduled.scheduled_end);
        const diffHours = Math.abs(actualMinutes - scheduledMinutes) / 60;
        return { shift: r, scheduled, diffHours };
      })
      .filter((x): x is { shift: ShiftRow; scheduled: ScheduledRow; diffHours: number } => Boolean(x))
      .filter(x => x.diffHours >= shiftDriftThresholdHours && !(x.shift.override_note || "").trim().length);

    type EmployeeCalc = {
      user_id: string;
      full_name: string | null;
      worked_hours: number;
      projected_hours: number;
      scheduled_hours: number;
      advance_hours: number;
      submit_hours: number;
    };
    const employees = new Map<string, EmployeeCalc>();
    const upsert = (profileId: string, name: string | null) => {
      const existing = employees.get(profileId);
      if (existing) return existing;
      const created: EmployeeCalc = {
        user_id: profileId,
        full_name: name,
        worked_hours: 0,
        projected_hours: 0,
        scheduled_hours: 0,
        advance_hours: 0,
        submit_hours: 0,
      };
      employees.set(profileId, created);
      return created;
    };

    for (const row of scheduledRows) {
      if (!row.profile_id) continue;
      const entry = upsert(row.profile_id, row.profile?.name ?? null);
      const hours = roundMinutes(calcScheduledMinutes(row.scheduled_start, row.scheduled_end));
      entry.scheduled_hours += hours;
      if (row.shift_date > safeAsOf) entry.projected_hours += hours;
    }

    for (const row of shiftsWorkedThrough) {
      if (!row.ended_at) continue;
      const entry = upsert(row.profile_id, row.profile?.name ?? null);
      const hours = roundMinutes(calcActualMinutes(row.started_at || row.planned_start_at, row.ended_at));
      entry.worked_hours += hours;
    }

    for (const row of advanceRows) {
      const entry = upsert(row.profile_id, null);
      entry.advance_hours += Number(row.advance_hours ?? 0);
    }

    const employeeRows = Array.from(employees.values())
      .map(row => ({
        ...row,
        submit_hours: row.worked_hours + row.projected_hours - row.advance_hours,
      }))
      .sort((a, b) => (a.full_name || "Unknown").localeCompare(b.full_name || "Unknown"));

    const totals = employeeRows.reduce(
      (acc, row) => {
        acc.worked_hours += row.worked_hours;
        acc.projected_hours += row.projected_hours;
        acc.scheduled_hours += row.scheduled_hours;
        acc.advances_hours += row.advance_hours;
        acc.submitted_hours += row.submit_hours;
        return acc;
      },
      { worked_hours: 0, projected_hours: 0, scheduled_hours: 0, advances_hours: 0, submitted_hours: 0 }
    );

    const openTotals = { lv1_hours: 0, lv2_hours: 0, total_hours: 0 };
    const scheduledTotalsByStore = { lv1_hours: 0, lv2_hours: 0, total_hours: 0 };
    for (const row of scheduledRows) {
      const hours = roundMinutes(calcScheduledMinutes(row.scheduled_start, row.scheduled_end));
      const bucket = detectStoreBucket(row.store?.name ?? null);
      if (bucket === "lv1") openTotals.lv1_hours += hours;
      if (bucket === "lv2") openTotals.lv2_hours += hours;
      openTotals.total_hours += hours;
      if (row.profile_id) {
        if (bucket === "lv1") scheduledTotalsByStore.lv1_hours += hours;
        if (bucket === "lv2") scheduledTotalsByStore.lv2_hours += hours;
        scheduledTotalsByStore.total_hours += hours;
      }
    }

    const scheduledMinusSubmitted = totals.scheduled_hours - totals.submitted_hours;
    const submittedMinusScheduled = totals.submitted_hours - totals.scheduled_hours;
    const scheduledVarianceWarning = Math.abs(scheduledMinusSubmitted) > varianceThresholdHours;
    const openMinusSubmitted = openTotals.total_hours - totals.submitted_hours;
    const coveragePercent = openTotals.total_hours > 0
      ? (scheduledTotalsByStore.total_hours / openTotals.total_hours) * 100
      : 100;

    const operationalChecks = [
      {
        key: "unapproved_shifts",
        label: "Unapproved shifts",
        ok: unapprovedShifts.length === 0,
        count: unapprovedShifts.length,
        details: unapprovedShifts.slice(0, 10).map(r => ({
          shift_id: r.id,
          employee: r.profile?.name ?? "Unknown",
          store: r.store?.name ?? "Unknown",
          planned_start_at: r.planned_start_at,
          reason: r.manual_closed && !r.manual_closed_reviewed_at ? "manual_close_pending_review" : "override_pending",
        })),
      },
      {
        key: "missing_coverage",
        label: "Missing coverage (scheduled but no logged shift)",
        ok: missingCoverageRows.length === 0,
        count: missingCoverageRows.length,
        details: missingCoverageRows.slice(0, 10).map(r => ({
          schedule_shift_id: r.id,
          employee: r.profile?.name ?? "Unknown",
          store: r.store?.name ?? "Unknown",
          shift_date: r.shift_date,
          shift_type: r.shift_type,
        })),
      },
      {
        key: "open_shifts",
        label: "Clock out violations (open shifts)",
        ok: openShifts.length === 0,
        count: openShifts.length,
        details: openShifts.slice(0, 10).map(r => ({
          shift_id: r.id,
          employee: r.profile?.name ?? "Unknown",
          store: r.store?.name ?? "Unknown",
          planned_start_at: r.planned_start_at,
        })),
      },
      {
        key: "unexplained_variance",
        label: `Unexplained variances (>= ${shiftDriftThresholdHours}h drift without override note)`,
        ok: unexplainedVariances.length === 0,
        count: unexplainedVariances.length,
        details: unexplainedVariances.slice(0, 10).map(v => ({
          shift_id: v.shift.id,
          employee: v.shift.profile?.name ?? "Unknown",
          store: v.shift.store?.name ?? "Unknown",
          shift_date: getCstDateKey(v.shift.planned_start_at),
          planned_start_at: v.shift.planned_start_at,
          planned_end_at: v.shift.ended_at,
          scheduled_start: v.scheduled.scheduled_start,
          scheduled_end: v.scheduled.scheduled_end,
          drift_hours: Number(v.diffHours.toFixed(2)),
        })),
      },
    ];

    const warnings: string[] = [];
    if (scheduledVarianceWarning) {
      warnings.push(
        `Scheduled vs submitted differs by ${scheduledMinusSubmitted.toFixed(1)} hours (threshold ${varianceThresholdHours}).`
      );
    }
    if (missingCoverageRows.length > 0) {
      warnings.push(`Missing coverage detected on ${missingCoverageRows.length} scheduled shift(s).`);
    }
    if (unapprovedShifts.length > 0) {
      warnings.push(`${unapprovedShifts.length} shift(s) still need manager approval.`);
    }
    if (openShifts.length > 0) {
      warnings.push(`${openShifts.length} shift(s) are still open.`);
    }
    if (unexplainedVariances.length > 0) {
      warnings.push(`${unexplainedVariances.length} shift(s) have drift above threshold without override note.`);
    }

    const whatsappLines = [
      "LV1&2 Hours:",
      "",
      ...employeeRows.map(row => {
        if (row.advance_hours > 0) {
          const gross = row.worked_hours + row.projected_hours;
          return `${row.full_name || "Unknown"}: ${gross} - ${row.advance_hours} (advance) = ${row.submit_hours}`;
        }
        return `${row.full_name || "Unknown"}: ${row.submit_hours}`;
      }),
      "",
      `Total hours: ${totals.submitted_hours}`,
      "",
      "Total hours open:",
      `LV1: ${openTotals.lv1_hours}`,
      `LV2: ${openTotals.lv2_hours}`,
      `Total: ${openTotals.total_hours}`,
    ];

    return NextResponse.json({
      status: warnings.length ? "needs_attention" : "ok",
      period: { from, to, asOf: safeAsOf },
      thresholds: {
        payroll_variance_warn_hours: varianceThresholdHours,
        payroll_shift_drift_warn_hours: shiftDriftThresholdHours,
      },
      operationalChecks,
      staffingReconciliation: {
        openTotals,
        scheduledTotals: {
          lv1_hours: Number(scheduledTotalsByStore.lv1_hours.toFixed(2)),
          lv2_hours: Number(scheduledTotalsByStore.lv2_hours.toFixed(2)),
          total_hours: Number(scheduledTotalsByStore.total_hours.toFixed(2)),
        },
        open_minus_scheduled: Number((openTotals.total_hours - scheduledTotalsByStore.total_hours).toFixed(2)),
        coverage_percent: Number(coveragePercent.toFixed(1)),
      },
      employeeSummary: employeeRows,
      financialReconciliation: {
        scheduled_hours: totals.scheduled_hours,
        worked_hours: totals.worked_hours,
        projected_hours: totals.projected_hours,
        advances_hours: totals.advances_hours,
        submitted_hours: totals.submitted_hours,
        scheduled_minus_submitted: Number(scheduledMinusSubmitted.toFixed(2)),
        submitted_minus_scheduled: Number(submittedMinusScheduled.toFixed(2)),
        open_minus_submitted: Number(openMinusSubmitted.toFixed(2)),
      },
      warnings,
      whatsappText: whatsappLines.join("\n"),
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to build reconciliation report." },
      { status: 500 }
    );
  }
}
