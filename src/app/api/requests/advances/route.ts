import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { authenticateShiftRequest } from "@/lib/shiftAuth";
import { submitAdvanceSchema } from "@/schemas/requests";

type AdvanceRow = {
  id: string;
  profile_id: string;
  store_id: string | null;
  advance_date: string;
  advance_hours: string;
  cash_amount_cents: number | null;
  note: string | null;
  status: "pending_verification" | "verified" | "voided";
  created_at: string;
  store: { id: string; name: string } | null;
};

type StoreMembershipRow = {
  store_id: string;
  store: { id: string; name: string } | null;
};

export async function GET(req: Request) {
  const authResult = await authenticateShiftRequest(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }
  const auth = authResult.auth;

  const [advancesRes, storesRes] = await Promise.all([
    supabaseServer
      .from("payroll_advances")
      .select("id, profile_id, store_id, advance_date, advance_hours, cash_amount_cents, note, status, created_at, store:store_id(id,name)")
      .eq("profile_id", auth.profileId)
      .order("advance_date", { ascending: false })
      .returns<AdvanceRow[]>(),
    supabaseServer
      .from("store_memberships")
      .select("store_id, store:store_id(id,name)")
      .eq("profile_id", auth.profileId)
      .returns<StoreMembershipRow[]>(),
  ]);

  if (advancesRes.error) return NextResponse.json({ error: advancesRes.error.message }, { status: 500 });
  if (storesRes.error) return NextResponse.json({ error: storesRes.error.message }, { status: 500 });

  return NextResponse.json({
    rows: advancesRes.data ?? [],
    stores: (storesRes.data ?? [])
      .map(row => row.store)
      .filter((s): s is { id: string; name: string } => Boolean(s)),
  });
}

export async function POST(req: Request) {
  const authResult = await authenticateShiftRequest(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }
  const auth = authResult.auth;

  const body = await req.json().catch(() => null);
  const parsed = submitAdvanceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const payload = parsed.data;

  const { data: memberships, error: membershipErr } = await supabaseServer
    .from("store_memberships")
    .select("store_id")
    .eq("profile_id", auth.profileId)
    .returns<{ store_id: string }[]>();
  if (membershipErr) return NextResponse.json({ error: membershipErr.message }, { status: 500 });

  const storeIds = (memberships ?? []).map(m => m.store_id);
  if (storeIds.length === 0) {
    return NextResponse.json({ error: "No store membership found for your profile." }, { status: 403 });
  }

  const selectedStoreId = payload.storeId ?? storeIds[0];
  if (!storeIds.includes(selectedStoreId)) {
    return NextResponse.json({ error: "Invalid store selection." }, { status: 403 });
  }

  const { data, error } = await supabaseServer
    .from("payroll_advances")
    .insert({
      profile_id: auth.profileId,
      store_id: selectedStoreId,
      advance_date: payload.advanceDate ?? new Date().toISOString(),
      advance_hours: payload.advanceHours,
      cash_amount_cents:
        payload.cashAmountDollars == null ? null : Math.round(payload.cashAmountDollars * 100),
      note: payload.note ?? null,
      status: "pending_verification",
      entered_by_profile_id: auth.profileId,
    })
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ id: data?.id ?? null }, { status: 201 });
}
