// src/app/api/confirm-changeover/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { isOutOfThreshold } from "@/lib/kioskRules";

type Body = {
  qrToken: string;
  shiftId: string;
  drawerCents: number;
  confirmed?: boolean;
  notifiedManager?: boolean;
  note?: string | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body.qrToken) return NextResponse.json({ error: "Missing qrToken." }, { status: 401 });
    if (!body.shiftId) return NextResponse.json({ error: "Missing shiftId." }, { status: 400 });
    if (typeof body.drawerCents !== "number") return NextResponse.json({ error: "Missing drawerCents." }, { status: 400 });

    const { data: store } = await supabaseServer
      .from("stores")
      .select("id, expected_drawer_cents")
      .eq("qr_token", body.qrToken)
      .maybeSingle();

    if (!store) return NextResponse.json({ error: "Invalid QR token." }, { status: 401 });

    const { data: shift } = await supabaseServer
      .from("shifts")
      .select("id, store_id, shift_type, ended_at")
      .eq("id", body.shiftId)
      .maybeSingle();

    if (!shift) return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    if (shift.store_id !== store.id) return NextResponse.json({ error: "Wrong store." }, { status: 403 });
    if (shift.ended_at) return NextResponse.json({ error: "Shift already ended." }, { status: 400 });

    const out = isOutOfThreshold(body.drawerCents, store.expected_drawer_cents);
    if (out && !body.confirmed) {
      return NextResponse.json({ error: "Drawer outside threshold. Must confirm.", requiresConfirm: true }, { status: 400 });
    }

    // insert or replace changeover
    const { error } = await supabaseServer
      .from("shift_drawer_counts")
      .upsert(
        {
          shift_id: body.shiftId,
          count_type: "changeover",
          drawer_cents: body.drawerCents,
          confirmed: Boolean(body.confirmed),
          notified_manager: Boolean(body.notifiedManager),
          note: body.note ?? null,
        },
        { onConflict: "shift_id,count_type" }
      );

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Changeover failed." }, { status: 500 });
  }
}
