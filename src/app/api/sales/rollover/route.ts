import { NextResponse } from "next/server";
import { authenticateShiftRequest, validateStoreAccess } from "@/lib/shiftAuth";
import { supabaseServer } from "@/lib/supabaseServer";

type RolloverSource = "closer" | "opener";

type Body = {
  storeId?: string;
  date?: string;
  amount?: number;
  source?: RolloverSource;
  forceMismatch?: boolean;
};

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isRolloverSource(value: unknown): value is RolloverSource {
  return value === "closer" || value === "opener";
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
    const amount = body.amount;
    const source = body.source;
    const forceMismatch = Boolean(body.forceMismatch);

    if (!storeId) return NextResponse.json({ error: "Missing storeId." }, { status: 400 });
    if (!isDateOnly(businessDate)) {
      return NextResponse.json({ error: "date must be YYYY-MM-DD." }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount == null || amount < 0) {
      return NextResponse.json({ error: "amount must be a non-negative number." }, { status: 400 });
    }
    if (!isRolloverSource(source)) {
      return NextResponse.json({ error: "source must be 'closer' or 'opener'." }, { status: 400 });
    }
    if (!validateStoreAccess(auth, storeId)) {
      return NextResponse.json({ error: "You do not have access to this store." }, { status: 403 });
    }

    const { data, error } = await supabaseServer.rpc("submit_rollover_entry", {
      p_store_id: storeId,
      p_business_date: businessDate,
      p_amount_cents: Math.round(amount),
      p_source: source,
      p_force_mismatch: forceMismatch,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (data === "MATCHED") {
      return NextResponse.json({ ok: true, status: "matched" });
    }
    if (data === "PENDING_SECOND_ENTRY") {
      return NextResponse.json({ ok: true, status: "pending" });
    }
    if (data === "MISMATCH_SAVED") {
      return NextResponse.json({ ok: true, status: "saved_with_flag" });
    }
    if (data === "MISMATCH_DETECTED") {
      return NextResponse.json(
        { ok: false, error: "mismatch", requiresConfirmation: true },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: `Unexpected rollover status: ${String(data)}` },
      { status: 500 }
    );
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to submit rollover entry." },
      { status: 500 }
    );
  }
}

