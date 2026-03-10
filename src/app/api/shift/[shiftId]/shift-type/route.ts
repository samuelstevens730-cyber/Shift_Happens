import { NextResponse } from "next/server";
import {
  authenticateShiftRequest,
  validateStoreAccess,
} from "@/lib/shiftAuth";
import { supabaseServer } from "@/lib/supabaseServer";

type Body = {
  shiftType?: "open" | "close" | "double" | "other";
};

const ALLOWED_SHIFT_TYPES = new Set(["open", "close", "double", "other"]);

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ shiftId: string }> }
) {
  try {
    const authResult = await authenticateShiftRequest(req);
    if (!authResult.ok) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    const auth = authResult.auth;
    const { shiftId } = await params;

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const nextShiftType = body.shiftType;
    if (!nextShiftType || !ALLOWED_SHIFT_TYPES.has(nextShiftType)) {
      return NextResponse.json({ error: "Invalid shiftType." }, { status: 400 });
    }

    const { data: shift, error: shiftErr } = await supabaseServer
      .from("shifts")
      .select("id, store_id, profile_id, shift_type, ended_at, last_action")
      .eq("id", shiftId)
      .maybeSingle<{
        id: string;
        store_id: string;
        profile_id: string;
        shift_type: "open" | "close" | "double" | "other";
        ended_at: string | null;
        last_action: string | null;
      }>();

    if (shiftErr) return NextResponse.json({ error: shiftErr.message }, { status: 500 });
    if (!shift || shift.last_action === "removed") {
      return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    }

    if (auth.authType === "employee") {
      if (shift.profile_id !== auth.profileId) {
        return NextResponse.json({ error: "Forbidden." }, { status: 403 });
      }
    } else if (!validateStoreAccess(auth, shift.store_id)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    if (shift.ended_at) {
      return NextResponse.json({ error: "Cannot edit shift type after clock-out." }, { status: 400 });
    }

    if (shift.shift_type === nextShiftType) {
      return NextResponse.json({ shiftType: shift.shift_type });
    }

    const { data: updated, error: updateErr } = await supabaseServer
      .from("shifts")
      .update({
        shift_type: nextShiftType,
        last_action: "updated",
      })
      .eq("id", shift.id)
      .select("shift_type")
      .maybeSingle<{ shift_type: "open" | "close" | "double" | "other" }>();

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
    if (!updated) return NextResponse.json({ error: "Shift not found." }, { status: 404 });

    return NextResponse.json({ shiftType: updated.shift_type });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update shift type." },
      { status: 500 }
    );
  }
}

