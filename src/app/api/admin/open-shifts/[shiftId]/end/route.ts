/**
 * POST /api/admin/open-shifts/[shiftId]/end - Force Close an Open Shift
 *
 * Administratively ends an open shift, creating a placeholder drawer count
 * if needed. Used when an employee fails to properly close their shift.
 *
 * Auth: Bearer token required (admin access)
 *
 * URL params:
 *   - shiftId: UUID of the shift to end
 *
 * Request body:
 *   - endAt: ISO timestamp for when the shift should be marked as ended (required)
 *
 * Returns: { ok: true } on success
 *
 * Error responses:
 *   - 400: Missing/invalid endAt, shift already ended
 *   - 401: Unauthorized (invalid/missing token)
 *   - 404: Shift not found
 *   - 500: Database error
 *
 * Business logic:
 *   - For non-"other" shift types, creates a placeholder end drawer count:
 *     - Uses store's expected_drawer_cents as the count value
 *     - Sets count_missing = true to flag it needs review
 *     - Adds note "Admin ended shift (no drawer count)."
 *   - Calculates shift duration and sets requires_override = true if > 13 hours
 *   - Updates shift with ended_at and marks last_action = "edited"
 *   - Upserts drawer count using shift_id + count_type as conflict key
 */
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
      last_action: "edited",
      last_action_by: user.id,
    })
    .eq("id", shiftId)
    .select("id")
    .maybeSingle()
    .returns<ShiftRow>();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Shift not found." }, { status: 404 });

  return NextResponse.json({ ok: true });
}
