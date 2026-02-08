import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";

type StoreRow = { id: string; name: string };
type TaskRow = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  sort_order: number;
  is_active: boolean;
};
type ScheduleRow = {
  id: string;
  store_id: string;
  cleaning_task_id: string;
  day_of_week: number;
  shift_type: "am" | "pm";
  is_required: boolean;
};

type SaveEntry = {
  cleaningTaskId: string;
  dayOfWeek: number;
  shiftType: "am" | "pm";
  isRequired: boolean;
};

type SaveBody = {
  storeId?: string;
  entries?: SaveEntry[];
};

export async function GET(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (managerStoreIds.length === 0) {
      return NextResponse.json({ stores: [], storeId: null, tasks: [], schedules: [] });
    }

    const { data: stores, error: storesErr } = await supabaseServer
      .from("stores")
      .select("id, name")
      .in("id", managerStoreIds)
      .order("name", { ascending: true })
      .returns<StoreRow[]>();
    if (storesErr) return NextResponse.json({ error: storesErr.message }, { status: 500 });

    const url = new URL(req.url);
    const requestedStoreId = url.searchParams.get("storeId");
    const validStoreId = requestedStoreId && managerStoreIds.includes(requestedStoreId)
      ? requestedStoreId
      : (stores ?? [])[0]?.id ?? null;

    if (!validStoreId) {
      return NextResponse.json({ stores: stores ?? [], storeId: null, tasks: [], schedules: [] });
    }

    const { data: tasks, error: tasksErr } = await supabaseServer
      .from("cleaning_tasks")
      .select("id, name, description, category, sort_order, is_active")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .returns<TaskRow[]>();
    if (tasksErr) return NextResponse.json({ error: tasksErr.message }, { status: 500 });

    const { data: schedules, error: schedulesErr } = await supabaseServer
      .from("store_cleaning_schedules")
      .select("id, store_id, cleaning_task_id, day_of_week, shift_type, is_required")
      .eq("store_id", validStoreId)
      .returns<ScheduleRow[]>();
    if (schedulesErr) return NextResponse.json({ error: schedulesErr.message }, { status: 500 });

    return NextResponse.json({
      stores: stores ?? [],
      storeId: validStoreId,
      tasks: tasks ?? [],
      schedules: schedules ?? [],
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to load cleaning config." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (managerStoreIds.length === 0) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const body = (await req.json()) as SaveBody;
    const storeId = body.storeId ?? "";
    if (!storeId) return NextResponse.json({ error: "Missing storeId." }, { status: 400 });
    if (!managerStoreIds.includes(storeId)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    const entries = (body.entries ?? []).filter(entry =>
      entry &&
      typeof entry.cleaningTaskId === "string" &&
      Number.isInteger(entry.dayOfWeek) &&
      entry.dayOfWeek >= 0 &&
      entry.dayOfWeek <= 6 &&
      (entry.shiftType === "am" || entry.shiftType === "pm") &&
      Boolean(entry.isRequired)
    );

    const { error: deleteErr } = await supabaseServer
      .from("store_cleaning_schedules")
      .delete()
      .eq("store_id", storeId);
    if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 });

    if (entries.length) {
      const rows = entries.map(entry => ({
        store_id: storeId,
        cleaning_task_id: entry.cleaningTaskId,
        day_of_week: entry.dayOfWeek,
        shift_type: entry.shiftType,
        is_required: true,
      }));
      const { error: insertErr } = await supabaseServer
        .from("store_cleaning_schedules")
        .insert(rows);
      if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to save cleaning config." }, { status: 500 });
  }
}
