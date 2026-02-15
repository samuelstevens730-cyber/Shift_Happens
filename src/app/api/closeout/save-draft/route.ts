import { NextResponse } from "next/server";
import { authenticateShiftRequest, validateStoreAccess } from "@/lib/shiftAuth";
import { supabaseServer } from "@/lib/supabaseServer";
import type { SafeCloseoutDenoms, SafeCloseoutRow } from "@/types/safeLedger";

type DraftExpenseInput = {
  amount_cents: number;
  category: string;
  note?: string | null;
};

type Body = {
  storeId?: string;
  date?: string;
  shiftId?: string | null;
  cash_sales_cents?: number | null;
  card_sales_cents?: number | null;
  other_sales_cents?: number | null;
  drawer_count_cents?: number | null;
  denoms_jsonb?: SafeCloseoutDenoms | null;
  expenses?: DraftExpenseInput[] | null;
  sales_totals?: {
    cash_sales_cents?: number | null;
    card_sales_cents?: number | null;
    other_sales_cents?: number | null;
  } | null;
};

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toNonNegativeInt(value: unknown): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(Number(value));
  return rounded >= 0 ? rounded : null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(req: Request) {
  try {
    const authResult = await authenticateShiftRequest(req);
    if (!authResult.ok) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    const auth = authResult.auth;

    const body = await req.json().catch(() => null) as Body | null;
    if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

    const storeId = body.storeId ?? "";
    const businessDate = body.date ?? "";
    if (!storeId) return NextResponse.json({ error: "Missing storeId." }, { status: 400 });
    if (!isDateOnly(businessDate)) {
      return NextResponse.json({ error: "date must be YYYY-MM-DD." }, { status: 400 });
    }
    if (!validateStoreAccess(auth, storeId)) {
      return NextResponse.json({ error: "You do not have access to this store." }, { status: 403 });
    }

    const sales = body.sales_totals ?? null;
    const cashSales = toNonNegativeInt(sales?.cash_sales_cents ?? body.cash_sales_cents);
    const cardSales = toNonNegativeInt(sales?.card_sales_cents ?? body.card_sales_cents);
    const otherSales = toNonNegativeInt(sales?.other_sales_cents ?? body.other_sales_cents);
    const drawerCount = toNonNegativeInt(body.drawer_count_cents);
    const denoms = body.denoms_jsonb ?? null;
    const expenses = body.expenses ?? null;
    const shiftId = body.shiftId ?? null;

    if (shiftId && !isUuid(shiftId)) {
      return NextResponse.json({ error: "shiftId must be a valid UUID." }, { status: 400 });
    }
    if (denoms && typeof denoms !== "object") {
      return NextResponse.json({ error: "denoms_jsonb must be an object." }, { status: 400 });
    }
    if (expenses && !Array.isArray(expenses)) {
      return NextResponse.json({ error: "expenses must be an array." }, { status: 400 });
    }

    const { data: existing, error: existingErr } = await supabaseServer
      .from("safe_closeouts")
      .select("*")
      .eq("store_id", storeId)
      .eq("business_date", businessDate)
      .maybeSingle<SafeCloseoutRow>();
    if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 500 });

    const patch: Record<string, unknown> = {
      status: "draft",
      updated_at: new Date().toISOString(),
    };
    if (shiftId !== null) patch.shift_id = shiftId;
    if (cashSales !== null) patch.cash_sales_cents = cashSales;
    if (cardSales !== null) patch.card_sales_cents = cardSales;
    if (otherSales !== null) patch.other_sales_cents = otherSales;
    if (drawerCount !== null) patch.drawer_count_cents = drawerCount;
    if (denoms !== null) patch.denoms_jsonb = denoms;

    let closeoutId: string;

    if (existing) {
      const { error: updateErr } = await supabaseServer
        .from("safe_closeouts")
        .update(patch)
        .eq("id", existing.id);
      if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
      closeoutId = existing.id;
    } else {
      const insertPayload = {
        ...patch,
        store_id: storeId,
        business_date: businessDate,
        profile_id: auth.profileId,
      };
      const { data: inserted, error: insertErr } = await supabaseServer
        .from("safe_closeouts")
        .insert(insertPayload)
        .select("id")
        .single<{ id: string }>();
      if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
      closeoutId = inserted.id;
    }

    if (Array.isArray(expenses)) {
      const cleaned = expenses.map((e) => ({
        amount_cents: toNonNegativeInt(e.amount_cents),
        category: (e.category ?? "").trim(),
        note: e.note ? String(e.note).trim() : null,
      }));
      const invalid = cleaned.some((e) => e.amount_cents === null || !e.category);
      if (invalid) {
        return NextResponse.json(
          { error: "Each expense must include non-negative amount_cents and category." },
          { status: 400 }
        );
      }

      const { error: delErr } = await supabaseServer
        .from("safe_closeout_expenses")
        .delete()
        .eq("closeout_id", closeoutId);
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

      if (cleaned.length > 0) {
        const rows = cleaned.map((e) => ({
          closeout_id: closeoutId,
          amount_cents: e.amount_cents as number,
          category: e.category,
          note: e.note,
        }));
        const { error: insErr } = await supabaseServer
          .from("safe_closeout_expenses")
          .insert(rows);
        if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, closeoutId, status: "draft" });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to save closeout draft." },
      { status: 500 }
    );
  }
}
