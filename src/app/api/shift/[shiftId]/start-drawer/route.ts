import { NextResponse } from "next/server";
import { isOutOfThreshold } from "@/lib/kioskRules";
import { authenticateShiftRequest } from "@/lib/shiftAuth";
import { getManagerStoreIds } from "@/lib/adminAuth";
import { supabaseServer } from "@/lib/supabaseServer";

type Body = {
  startDrawerCents?: number | null;
  changeDrawerCents?: number | null;
  confirmed?: boolean;
  notifiedManager?: boolean;
  note?: string | null;
};

export async function POST(
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
    const body = (await req.json()) as Body;

    const startCents = body.startDrawerCents;
    const changeCents = body.changeDrawerCents;

    if (startCents == null || !Number.isFinite(startCents) || startCents < 0) {
      return NextResponse.json({ error: "startDrawerCents is required and must be >= 0." }, { status: 400 });
    }
    if (changeCents == null || !Number.isFinite(changeCents) || changeCents < 0) {
      return NextResponse.json({ error: "changeDrawerCents is required and must be >= 0." }, { status: 400 });
    }

    const { data: shift, error: shiftErr } = await supabaseServer
      .from("shifts")
      .select("id,store_id,profile_id,shift_type,ended_at,last_action")
      .eq("id", shiftId)
      .maybeSingle();
    if (shiftErr) return NextResponse.json({ error: shiftErr.message }, { status: 500 });
    if (!shift || shift.last_action === "removed") {
      return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    }
    if (shift.ended_at) {
      return NextResponse.json({ error: "Shift already ended." }, { status: 400 });
    }

    if (auth.authType === "employee") {
      if (shift.profile_id !== auth.profileId) {
        return NextResponse.json({ error: "Forbidden." }, { status: 403 });
      }
    } else {
      const managerUserId = auth.authUserId ?? auth.profileId;
      const managerStoreIds = await getManagerStoreIds(managerUserId);
      if (!managerStoreIds.includes(shift.store_id)) {
        return NextResponse.json({ error: "Forbidden." }, { status: 403 });
      }
    }

    const { data: store, error: storeErr } = await supabaseServer
      .from("stores")
      .select("id,expected_drawer_cents")
      .eq("id", shift.store_id)
      .maybeSingle();
    if (storeErr) return NextResponse.json({ error: storeErr.message }, { status: 500 });
    if (!store) return NextResponse.json({ error: "Store not found." }, { status: 404 });

    const out = isOutOfThreshold(startCents, store.expected_drawer_cents);
    const changeNot200 = changeCents !== 20000;
    if (out && !body.confirmed) {
      return NextResponse.json(
        { error: "Start drawer outside threshold. Must confirm.", requiresConfirm: true },
        { status: 400 }
      );
    }
    if ((out || changeNot200) && !body.notifiedManager) {
      return NextResponse.json(
        { error: "Start drawer or change drawer requires manager notification.", requiresConfirm: true },
        { status: 400 }
      );
    }

    const { error: upsertErr } = await supabaseServer.from("shift_drawer_counts").upsert(
      {
        shift_id: shift.id,
        count_type: "start",
        drawer_cents: Math.round(startCents),
        change_count: Math.round(changeCents),
        confirmed: Boolean(body.confirmed),
        notified_manager: Boolean(body.notifiedManager),
        note: body.note?.trim() ? body.note.trim() : null,
        count_missing: false,
      },
      { onConflict: "shift_id,count_type" }
    );
    if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to save start drawer." },
      { status: 500 }
    );
  }
}
