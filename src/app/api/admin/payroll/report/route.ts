import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";

type WorkedShiftRow = {
  profile_id: string;
  planned_start_at: string;
  ended_at: string;
  store: { name: string } | null;
  profile: { name: string | null } | null;
};

type ProjectedShiftRow = {
  profile_id: string | null;
  shift_date: string;
  scheduled_start: string;
  scheduled_end: string;
  store_id: string;
};

type AdvanceRow = {
  profile_id: string;
  advance_hours: string | number;
};

type EmployeeCalc = {
  user_id: string;
  full_name: string | null;
  worked_hours: number;
  projected_hours: number;
  advance_hours: number;
  submit_hours: number;
};

function calcMinutes(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0;
  return Math.max(0, Math.round((e.getTime() - s.getTime()) / 60000));
}

function calcScheduledMinutes(start: string, end: string) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  return endMin >= startMin ? endMin - startMin : (24 * 60 - startMin) + endMin;
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
  return null;
}

export async function GET(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const asOf = url.searchParams.get("asOf");
    const storeId = url.searchParams.get("storeId") || "";

    if (!from || !to) {
      return NextResponse.json({ error: "from and to are required (YYYY-MM-DD)." }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json({ error: "from/to must be YYYY-MM-DD." }, { status: 400 });
    }

    const safeAsOf = asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : to;

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (managerStoreIds.length === 0) {
      return NextResponse.json({
        employees: [],
        totals: { worked_hours: 0, projected_hours: 0, advances_hours: 0, submitted_hours: 0 },
        openTotals: { lv1_hours: 0, lv2_hours: 0, total_hours: 0 },
      });
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
    const projectedStartDate = nextDateOnly(safeAsOf);
    if (!fromUtcIso || !toUtcExclusiveIso || !asOfUtcExclusiveIso) {
      return NextResponse.json({ error: "Invalid date bounds." }, { status: 400 });
    }

    const { data: stores, error: storesErr } = await supabaseServer
      .from("stores")
      .select("id, name")
      .in("id", scopeStoreIds);
    if (storesErr) return NextResponse.json({ error: storesErr.message }, { status: 500 });
    const storeNameById = new Map((stores ?? []).map(s => [s.id, s.name]));

    const { data: workedRows, error: workedErr } = await supabaseServer
      .from("shifts")
      .select("profile_id, planned_start_at, ended_at, store:store_id(name), profile:profile_id(name)")
      .in("store_id", scopeStoreIds)
      .not("ended_at", "is", null)
      .neq("last_action", "removed")
      .gte("planned_start_at", fromUtcIso)
      .lt("planned_start_at", toUtcExclusiveIso)
      .lt("ended_at", asOfUtcExclusiveIso)
      .returns<WorkedShiftRow[]>();
    if (workedErr) return NextResponse.json({ error: workedErr.message }, { status: 500 });

    let projectedRows: ProjectedShiftRow[] = [];
    if (projectedStartDate && projectedStartDate <= to) {
      const { data, error } = await supabaseServer
        .from("schedule_shifts")
        .select("profile_id, shift_date, scheduled_start, scheduled_end, store_id, schedules!inner(status)")
        .in("store_id", scopeStoreIds)
        .eq("schedules.status", "published")
        .gte("shift_date", projectedStartDate)
        .lte("shift_date", to)
        .not("profile_id", "is", null)
        .returns<ProjectedShiftRow[]>();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      projectedRows = data ?? [];
    }

    const { data: openRows, error: openErr } = await supabaseServer
      .from("schedule_shifts")
      .select("scheduled_start, scheduled_end, store_id, schedules!inner(status)")
      .in("store_id", scopeStoreIds)
      .eq("schedules.status", "published")
      .gte("shift_date", from)
      .lte("shift_date", to);
    if (openErr) return NextResponse.json({ error: openErr.message }, { status: 500 });

    const { data: advanceRows, error: advanceErr } = await supabaseServer
      .from("payroll_advances")
      .select("profile_id, advance_hours")
      .in("store_id", scopeStoreIds)
      .eq("status", "verified")
      .gte("advance_date", fromUtcIso)
      .lt("advance_date", toUtcExclusiveIso)
      .returns<AdvanceRow[]>();
    if (advanceErr) return NextResponse.json({ error: advanceErr.message }, { status: 500 });

    const employees = new Map<string, EmployeeCalc>();
    const upsert = (profileId: string, name: string | null) => {
      const existing = employees.get(profileId);
      if (existing) return existing;
      const created: EmployeeCalc = {
        user_id: profileId,
        full_name: name,
        worked_hours: 0,
        projected_hours: 0,
        advance_hours: 0,
        submit_hours: 0,
      };
      employees.set(profileId, created);
      return created;
    };

    for (const row of workedRows ?? []) {
      const entry = upsert(row.profile_id, row.profile?.name ?? null);
      entry.worked_hours += roundMinutes(calcMinutes(row.planned_start_at, row.ended_at));
    }

    for (const row of projectedRows ?? []) {
      if (!row.profile_id) continue;
      const entry = upsert(row.profile_id, null);
      entry.projected_hours += roundMinutes(calcScheduledMinutes(row.scheduled_start, row.scheduled_end));
    }

    for (const row of advanceRows ?? []) {
      const entry = upsert(row.profile_id, null);
      entry.advance_hours += Number(row.advance_hours ?? 0);
    }

    const openTotals = { lv1_hours: 0, lv2_hours: 0, total_hours: 0 };
    for (const row of openRows ?? []) {
      const minutes = calcScheduledMinutes(row.scheduled_start, row.scheduled_end);
      const hours = roundMinutes(minutes);
      const bucket = detectStoreBucket(storeNameById.get(row.store_id) ?? null);
      if (bucket === "lv1") openTotals.lv1_hours += hours;
      if (bucket === "lv2") openTotals.lv2_hours += hours;
      openTotals.total_hours += hours;
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
        acc.advances_hours += row.advance_hours;
        acc.submitted_hours += row.submit_hours;
        return acc;
      },
      { worked_hours: 0, projected_hours: 0, advances_hours: 0, submitted_hours: 0 }
    );

    const whatsappLines = [
      "LV1&2 Hours:",
      "",
      ...employeeRows.map(row => {
        const gross = row.worked_hours + row.projected_hours;
        if (row.advance_hours > 0) {
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
      employees: employeeRows,
      totals,
      openTotals,
      reconciliationDiff: totals.submitted_hours - openTotals.total_hours,
      whatsappText: whatsappLines.join("\n"),
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to build payroll report." }, { status: 500 });
  }
}
