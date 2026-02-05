import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";

type Body = {
  storeId?: string;
  expectedDrawerCents?: number;
};

export async function PATCH(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const body = (await req.json()) as Body;
    const storeId = body.storeId || "";
    if (!storeId) return NextResponse.json({ error: "Missing storeId." }, { status: 400 });

    const expected = body.expectedDrawerCents;
    if (!Number.isFinite(expected)) {
      return NextResponse.json({ error: "Invalid expected drawer amount." }, { status: 400 });
    }

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (!managerStoreIds.includes(storeId)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const { error: updateErr } = await supabaseServer
      .from("stores")
      .update({ expected_drawer_cents: Math.max(0, Math.round(expected ?? 0)) })
      .eq("id", storeId);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to update store." }, { status: 500 });
  }
}
