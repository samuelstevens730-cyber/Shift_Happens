import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type EndBody = { endAt?: string };

type ShiftRow = {
  id: string;
  shift_type: string | null;
  ended_at: string | null;
  started_at: string | null;
  store: { id: string; expected_drawer_cents: number } | null;
};

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  return auth.slice(7);
}

function parseBody(value: unknown): EndBody {
  if (!value || typeof value !== "object") return {};
  const record = value as { endAt?: unknown };
  return { endAt: typeof record.endAt === "string" ? record.endAt : undefined };
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ shiftId: string }> }
) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { shiftId } = await params;
  if (!shiftId) return NextResponse.json({ error: "Missing shiftId." }, { status: 400 });

  const body = parseBody(await req.json());
  if (!body.endAt) return NextResponse.json({ error: "Missing endAt." }, { status: 400 });

  const endAt = new Date(body.endAt);
  if (Number.isNaN(endAt.getTime())) {
    return NextResponse.json({ error: "Invalid endAt." }, { status: 400 });
  }

  const { data: shift, error: shiftErr } = await supabaseServer
    .from("shifts")
    .select("id, shift_type, ended_at, started_at, store:store_id(id, expected_drawer_cents)")
    .eq("id", shiftId)
    .maybeSingle()
    .returns<ShiftRow>();

  if (shiftErr) return NextResponse.json({ error: shiftErr.message }, { status: 500 });
  if (!shift) return NextResponse.json({ error: "Shift not found." }, { status: 404 });
  if (shift.ended_at) return NextResponse.json({ error: "Shift already ended." }, { status: 400 });

  if (shift.shift_type !== "other") {
    const expected = shift.store?.expected_drawer_cents ?? 20000;
    const { error: countErr } = await supabaseServer
      .from("shift_drawer_counts")
      .upsert(
        {
          shift_id: shiftId,
          count_type: "end",
          drawer_cents: expected,
          confirmed: false,
          notified_manager: false,
          note: "Admin ended shift (no drawer count).",
          counted_at: endAt.toISOString(),
          out_of_threshold: false,
          count_missing: true,
        },
        { onConflict: "shift_id,count_type" }
      );
    if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });
  }

  const startedAt = shift.started_at ? new Date(shift.started_at) : null;
  const durationHours = startedAt && !Number.isNaN(startedAt.getTime())
    ? (endAt.getTime() - startedAt.getTime()) / (1000 * 60 * 60)
    : null;
  const requiresOverride = durationHours != null && durationHours > 13;

  const { data, error } = await supabaseServer
    .from("shifts")
    .update({
      ended_at: endAt.toISOString(),
      requires_override: requiresOverride,
    })
    .eq("id", shiftId)
    .select("id")
    .maybeSingle()
    .returns<ShiftRow>();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Shift not found." }, { status: 404 });

  return NextResponse.json({ ok: true });
}
