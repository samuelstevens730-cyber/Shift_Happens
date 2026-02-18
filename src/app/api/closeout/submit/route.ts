import { NextResponse } from "next/server";
import { authenticateShiftRequest, validateStoreAccess } from "@/lib/shiftAuth";
import { supabaseServer } from "@/lib/supabaseServer";
import { checkSafeCloseoutWindow } from "@/lib/safeCloseoutWindow";
import type { SafeCloseoutDenoms, SafeCloseoutRow, SubmitSafeCloseoutResult } from "@/types/safeLedger";

type ExpenseInput = {
  amount_cents: number;
  category: string;
  note?: string | null;
};

type PhotoInput = {
  photo_type: "deposit_required" | "pos_optional";
  storage_path?: string | null;
  thumb_path?: string | null;
  purge_after?: string | null;
};

type Body = {
  closeoutId?: string;
  sales_totals?: {
    cash_sales_cents?: number;
    card_sales_cents?: number;
    other_sales_cents?: number;
  };
  expenses?: ExpenseInput[];
  denoms_json?: SafeCloseoutDenoms;
  drawer_count_cents?: number;
  photo_metadata?: PhotoInput[];
  actual_deposit_cents?: number;
  deposit_override_reason?: string | null;
};

type RpcResult = SubmitSafeCloseoutResult;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function toNonNegativeInt(value: unknown): number | null {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(Number(value));
  return rounded >= 0 ? rounded : null;
}

function buildMessage(result: RpcResult): string {
  if (result.status === "pass") return "Closeout submitted successfully.";
  if (result.status === "warn") return "Closeout submitted with warning variance.";
  if (result.status === "fail" && result.requires_manager_review) {
    return "Closeout submitted and flagged for manager review.";
  }
  return "Closeout failed validation. Please review and resubmit.";
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

    const closeoutId = body.closeoutId ?? "";
    if (!closeoutId || !isUuid(closeoutId)) {
      return NextResponse.json({ error: "closeoutId must be a valid UUID." }, { status: 400 });
    }

    const cashSales = toNonNegativeInt(body.sales_totals?.cash_sales_cents);
    const cardSales = toNonNegativeInt(body.sales_totals?.card_sales_cents);
    const otherSales = toNonNegativeInt(body.sales_totals?.other_sales_cents);
    const drawerCount = toNonNegativeInt(body.drawer_count_cents);
    const actualDeposit = toNonNegativeInt(body.actual_deposit_cents);

    if (cashSales === null || cardSales === null || otherSales === null) {
      return NextResponse.json({ error: "sales_totals values must be non-negative integers." }, { status: 400 });
    }
    if (drawerCount === null) {
      return NextResponse.json({ error: "drawer_count_cents is required for submit." }, { status: 400 });
    }
    if (actualDeposit === null) {
      return NextResponse.json({ error: "actual_deposit_cents is required and must be non-negative." }, { status: 400 });
    }
    if (!body.denoms_json || typeof body.denoms_json !== "object") {
      return NextResponse.json({ error: "denoms_json is required and must be an object." }, { status: 400 });
    }
    if (!Array.isArray(body.expenses)) {
      return NextResponse.json({ error: "expenses is required and must be an array." }, { status: 400 });
    }
    if (!Array.isArray(body.photo_metadata)) {
      return NextResponse.json({ error: "photo_metadata is required and must be an array." }, { status: 400 });
    }

    const { data: closeout, error: closeoutErr } = await supabaseServer
      .from("safe_closeouts")
      .select("*")
      .eq("id", closeoutId)
      .maybeSingle<SafeCloseoutRow>();
    if (closeoutErr) return NextResponse.json({ error: closeoutErr.message }, { status: 500 });
    if (!closeout) return NextResponse.json({ error: "Closeout not found." }, { status: 404 });
    if (!validateStoreAccess(auth, closeout.store_id)) {
      return NextResponse.json({ error: "You do not have access to this store." }, { status: 403 });
    }
    if (!closeout.shift_id) {
      return NextResponse.json({ error: "Safe closeout is not linked to a shift." }, { status: 400 });
    }
    const windowCheck = await checkSafeCloseoutWindow(closeout.shift_id);
    if (!windowCheck.allowed) {
      return NextResponse.json(
        { error: windowCheck.reason ?? "Safe closeout is not available yet for this shift." },
        { status: 400 }
      );
    }

    const { data: rpcData, error: rpcErr } = await supabaseServer.rpc("submit_safe_closeout", {
      p_closeout_id: closeoutId,
      p_cash_sales_cents: cashSales,
      p_card_sales_cents: cardSales,
      p_other_sales_cents: otherSales,
      p_actual_deposit_cents: actualDeposit,
      p_drawer_count_cents: drawerCount,
      p_expenses: body.expenses,
      p_denoms: body.denoms_json,
      p_photos: body.photo_metadata,
      p_deposit_override_reason: body.deposit_override_reason ?? null,
    });
    if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });

    const rpcRow = Array.isArray(rpcData) ? rpcData[0] as RpcResult | undefined : rpcData as RpcResult | null;
    if (!rpcRow) {
      return NextResponse.json({ error: "RPC returned no result." }, { status: 500 });
    }

    return NextResponse.json({
      status: rpcRow.status,
      variance: rpcRow.variance_cents,
      requires_manager_review: rpcRow.requires_manager_review,
      validation_attempts: rpcRow.validation_attempts,
      expected_deposit_cents: rpcRow.expected_deposit_cents,
      actual_deposit_cents: rpcRow.actual_deposit_cents,
      denom_total_cents: rpcRow.denom_total_cents,
      denom_variance_cents: rpcRow.denom_variance_cents,
      message: buildMessage(rpcRow),
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to submit closeout." },
      { status: 500 }
    );
  }
}
