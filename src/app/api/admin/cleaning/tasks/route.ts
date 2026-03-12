import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";

type TaskBody = {
  taskId?: string;
  name?: string;
  description?: string | null;
  category?: string | null;
  sortOrder?: number;
  isActive?: boolean;
};

async function requireManager(req: Request) {
  const token = getBearerToken(req);
  if (!token) return { error: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) };

  const {
    data: { user },
    error: authErr,
  } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) {
    return { error: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) };
  }

  const managerStoreIds = await getManagerStoreIds(user.id);
  if (!managerStoreIds.length) {
    return { error: NextResponse.json({ error: "Forbidden." }, { status: 403 }) };
  }

  return { managerStoreIds };
}

async function parseTaskBody(req: Request): Promise<TaskBody | NextResponse> {
  try {
    return (await req.json()) as TaskBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
}

function normalizeTaskPayload(body: TaskBody) {
  const name = (body.name ?? "").trim();
  if (!name) {
    return { error: NextResponse.json({ error: "Task name is required." }, { status: 400 }) };
  }

  const sortOrder = Number.isInteger(body.sortOrder) ? Number(body.sortOrder) : 0;
  const description = typeof body.description === "string" ? body.description.trim() || null : null;
  const category = typeof body.category === "string" ? body.category.trim() || null : null;

  return {
    payload: {
      name,
      description,
      category,
      sort_order: sortOrder,
      is_active: body.isActive !== false,
    },
  };
}

export async function POST(req: Request) {
  try {
    const auth = await requireManager(req);
    if ("error" in auth) return auth.error;

    const body = await parseTaskBody(req);
    if (body instanceof NextResponse) return body;

    const normalized = normalizeTaskPayload(body);
    if ("error" in normalized) return normalized.error;

    const { data, error } = await supabaseServer
      .from("cleaning_tasks")
      .insert(normalized.payload)
      .select("id")
      .maybeSingle<{ id: string }>();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, id: data?.id ?? null });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create cleaning task." },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await requireManager(req);
    if ("error" in auth) return auth.error;

    const body = await parseTaskBody(req);
    if (body instanceof NextResponse) return body;

    const taskId = (body.taskId ?? "").trim();
    if (!taskId) return NextResponse.json({ error: "Missing taskId." }, { status: 400 });

    const { data: existing, error: existingErr } = await supabaseServer
      .from("cleaning_tasks")
      .select("id")
      .eq("id", taskId)
      .maybeSingle<{ id: string }>();
    if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 500 });
    if (!existing) return NextResponse.json({ error: "Cleaning task not found." }, { status: 404 });

    const normalized = normalizeTaskPayload(body);
    if ("error" in normalized) return normalized.error;

    const { error } = await supabaseServer
      .from("cleaning_tasks")
      .update(normalized.payload)
      .eq("id", taskId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update cleaning task." },
      { status: 500 }
    );
  }
}

