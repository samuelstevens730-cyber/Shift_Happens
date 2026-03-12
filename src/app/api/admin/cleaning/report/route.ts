import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";

type StoreRow = { id: string; name: string };
type CompletionRow = {
  id: string;
  shift_id: string;
  status: "completed" | "skipped";
  completed_at: string;
  skipped_reason: string | null;
  completed_by_profile: { name: string | null } | null;
  schedule: {
    shift_type: "am" | "pm";
    cleaning_task: { name: string; category: string | null } | null;
  } | null;
  shifts: {
    id: string;
    store_id: string;
    profile: { name: string | null } | null;
  } | null;
};

function cstDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : "";
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
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
  const tz = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  const match = tz.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/i);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2] || "0");
  return hours * 60 + (hours < 0 ? -minutes : minutes);
}

function cstDateStartToUtcIso(dateOnly: string) {
  const match = dateOnly.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const utcMidnight = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 0, 0, 0));
  const offset = getCstOffsetMinutes(utcMidnight);
  if (offset == null) return null;
  const utcMillis = Date.UTC(Number(year), Number(month) - 1, Number(day), 0, 0, 0) - (offset * 60000);
  return new Date(utcMillis).toISOString();
}

function nextDateOnly(dateOnly: string) {
  const match = dateOnly.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const next = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + 1, 0, 0, 0));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

export async function GET(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const {
      data: { user },
      error: authErr,
    } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (!managerStoreIds.length) {
      return NextResponse.json({ date: null, stores: [] });
    }

    const url = new URL(req.url);
    const requestedDate = url.searchParams.get("date");
    const reportDate = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
      ? requestedDate
      : cstDateKey(addDays(new Date(), -1));

    const fromUtcIso = cstDateStartToUtcIso(reportDate);
    const toUtcIso = nextDateOnly(reportDate) ? cstDateStartToUtcIso(nextDateOnly(reportDate) as string) : null;
    if (!fromUtcIso || !toUtcIso) {
      return NextResponse.json({ error: "Invalid date." }, { status: 400 });
    }

    const { data: stores, error: storesErr } = await supabaseServer
      .from("stores")
      .select("id, name")
      .in("id", managerStoreIds)
      .order("name", { ascending: true })
      .returns<StoreRow[]>();
    if (storesErr) return NextResponse.json({ error: storesErr.message }, { status: 500 });

    const { data: completions, error: completionsErr } = await supabaseServer
      .from("cleaning_task_completions")
      .select(
        "id, shift_id, status, completed_at, skipped_reason, completed_by_profile:completed_by(name), schedule:store_cleaning_schedule_id(shift_type, cleaning_task:cleaning_task_id(name, category)), shifts:shift_id!inner(id, store_id, profile:profile_id(name))"
      )
      .in("shifts.store_id", managerStoreIds)
      .gte("completed_at", fromUtcIso)
      .lt("completed_at", toUtcIso)
      .returns<CompletionRow[]>();
    if (completionsErr) return NextResponse.json({ error: completionsErr.message }, { status: 500 });

    const rowsByStore = new Map<string, Array<{
      id: string;
      shiftId: string;
      status: "completed" | "skipped";
      shiftType: "am" | "pm" | null;
      taskName: string | null;
      taskCategory: string | null;
      employeeName: string | null;
      completedByName: string | null;
      completedAt: string;
      skippedReason: string | null;
    }>>();

    for (const row of completions ?? []) {
      const shift = row.shifts;
      if (!shift) continue;
      const list = rowsByStore.get(shift.store_id) ?? [];
      list.push({
        id: row.id,
        shiftId: row.shift_id,
        status: row.status,
        shiftType: row.schedule?.shift_type ?? null,
        taskName: row.schedule?.cleaning_task?.name ?? null,
        taskCategory: row.schedule?.cleaning_task?.category ?? null,
        employeeName: shift.profile?.name ?? null,
        completedByName: row.completed_by_profile?.name ?? null,
        completedAt: row.completed_at,
        skippedReason: row.skipped_reason ?? null,
      });
      rowsByStore.set(shift.store_id, list);
    }

    const storePayload = (stores ?? []).map((store) => ({
      id: store.id,
      name: store.name,
      rows: (rowsByStore.get(store.id) ?? []).sort((a, b) => a.completedAt.localeCompare(b.completedAt)),
    }));

    return NextResponse.json({ date: reportDate, stores: storePayload });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load cleaning report." },
      { status: 500 }
    );
  }
}
