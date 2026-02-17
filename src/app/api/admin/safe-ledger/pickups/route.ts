import { NextResponse } from "next/server";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";
import { supabaseServer } from "@/lib/supabaseServer";

type PickupCreateBody = {
  store_id?: string;
  pickup_date?: string;
  amount_cents?: number;
  note?: string | null;
};

function isDateOnly(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function isUuid(value: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

async function computeStoreCurrentBalance(storeId: string, throughDate: string): Promise<{ balanceCents: number; error?: string }> {
  const { data: closeouts, error: closeoutsErr } = await supabaseServer
    .from("safe_closeouts")
    .select("id,cash_sales_cents")
    .eq("store_id", storeId)
    .lte("business_date", throughDate)
    .returns<Array<{ id: string; cash_sales_cents: number }>>();
  if (closeoutsErr) return { balanceCents: 0, error: closeoutsErr.message };

  const closeoutIds = (closeouts ?? []).map((row) => row.id);
  let expenseTotal = 0;
  if (closeoutIds.length > 0) {
    const { data: expenses, error: expensesErr } = await supabaseServer
      .from("safe_closeout_expenses")
      .select("amount_cents,closeout_id")
      .in("closeout_id", closeoutIds)
      .returns<Array<{ closeout_id: string; amount_cents: number }>>();
    if (expensesErr) return { balanceCents: 0, error: expensesErr.message };
    expenseTotal = (expenses ?? []).reduce((sum, row) => sum + Number(row.amount_cents ?? 0), 0);
  }

  const closeoutTotal = (closeouts ?? []).reduce((sum, row) => sum + Number(row.cash_sales_cents ?? 0), 0);

  const { data: pickups, error: pickupsErr } = await supabaseServer
    .from("safe_pickups")
    .select("amount_cents")
    .eq("store_id", storeId)
    .lte("pickup_date", throughDate)
    .returns<Array<{ amount_cents: number }>>();
  if (pickupsErr) return { balanceCents: 0, error: pickupsErr.message };

  const pickupTotal = (pickups ?? []).reduce((sum, row) => sum + Number(row.amount_cents ?? 0), 0);
  return { balanceCents: closeoutTotal - expenseTotal - pickupTotal };
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const {
      data: { user },
      error: authErr,
    } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (managerStoreIds.length === 0) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    const body = (await req.json().catch(() => ({}))) as PickupCreateBody;
    const storeId = body.store_id ?? null;
    if (!isUuid(storeId) || !managerStoreIds.includes(storeId)) {
      return NextResponse.json({ error: "Invalid store_id." }, { status: 400 });
    }

    const pickupDate = isDateOnly(body.pickup_date ?? null) ? body.pickup_date! : new Date().toISOString().slice(0, 10);
    const balanceResult = await computeStoreCurrentBalance(storeId, pickupDate);
    if (balanceResult.error) return NextResponse.json({ error: balanceResult.error }, { status: 500 });

    const currentBalance = balanceResult.balanceCents;
    const amountCents =
      Number.isInteger(body.amount_cents) && (body.amount_cents ?? 0) >= 0
        ? (body.amount_cents as number)
        : Math.max(0, currentBalance);

    const { data: inserted, error: insertErr } = await supabaseServer
      .from("safe_pickups")
      .insert({
        store_id: storeId,
        pickup_date: pickupDate,
        amount_cents: amountCents,
        note: (body.note ?? "").trim() || null,
        recorded_by: user.id,
      })
      .select("id,store_id,pickup_date,pickup_at,amount_cents,note,recorded_by,created_at")
      .maybeSingle<{
        id: string;
        store_id: string;
        pickup_date: string;
        pickup_at: string;
        amount_cents: number;
        note: string | null;
        recorded_by: string;
        created_at: string;
      }>();
    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
    if (!inserted) return NextResponse.json({ error: "Failed to create safe pickup." }, { status: 500 });

    return NextResponse.json({
      pickup: inserted,
      current_balance_before_cents: currentBalance,
      current_balance_after_cents: currentBalance - amountCents,
      suggested_full_pickup_cents: Math.max(0, currentBalance),
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to record safe pickup." },
      { status: 500 }
    );
  }
}
