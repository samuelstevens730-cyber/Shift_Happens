import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type EndBody = { endAt?: string };

type ShiftRow = { id: string };

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

  const { data, error } = await supabaseServer
    .from("shifts")
    .update({ ended_at: endAt.toISOString() })
    .eq("id", shiftId)
    .select("id")
    .maybeSingle()
    .returns<ShiftRow>();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Shift not found." }, { status: 404 });

  return NextResponse.json({ ok: true });
}
