import { NextResponse } from "next/server";
import { authenticateShiftRequest, validateStoreAccess } from "@/lib/shiftAuth";
import { supabaseServer } from "@/lib/supabaseServer";
import type { SafeCloseoutRow } from "@/types/safeLedger";

type StoreSettings = {
  store_id: string;
  safe_ledger_enabled: boolean;
  safe_deposit_tolerance_cents: number;
  safe_denom_tolerance_cents: number;
  safe_photo_retention_days: number;
  safe_photo_purge_day_of_month: number;
};

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function GET(req: Request) {
  try {
    const authResult = await authenticateShiftRequest(req);
    if (!authResult.ok) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    const auth = authResult.auth;

    const url = new URL(req.url);
    const storeId = url.searchParams.get("storeId") ?? "";
    const date = url.searchParams.get("date") ?? "";

    if (!storeId) {
      return NextResponse.json({ error: "Missing storeId." }, { status: 400 });
    }
    if (!isDateOnly(date)) {
      return NextResponse.json({ error: "date must be YYYY-MM-DD." }, { status: 400 });
    }
    if (!validateStoreAccess(auth, storeId)) {
      return NextResponse.json({ error: "You do not have access to this store." }, { status: 403 });
    }

    const [settingsRes, closeoutRes] = await Promise.all([
      supabaseServer
        .from("store_settings")
        .select("store_id, safe_ledger_enabled, safe_deposit_tolerance_cents, safe_denom_tolerance_cents, safe_photo_retention_days, safe_photo_purge_day_of_month")
        .eq("store_id", storeId)
        .maybeSingle<StoreSettings>(),
      supabaseServer
        .from("safe_closeouts")
        .select("*")
        .eq("store_id", storeId)
        .eq("business_date", date)
        .maybeSingle<SafeCloseoutRow>(),
    ]);

    if (settingsRes.error) {
      return NextResponse.json({ error: settingsRes.error.message }, { status: 500 });
    }
    if (closeoutRes.error) {
      return NextResponse.json({ error: closeoutRes.error.message }, { status: 500 });
    }

    const settings: StoreSettings = settingsRes.data ?? {
      store_id: storeId,
      safe_ledger_enabled: false,
      safe_deposit_tolerance_cents: 100,
      safe_denom_tolerance_cents: 0,
      safe_photo_retention_days: 38,
      safe_photo_purge_day_of_month: 8,
    };

    return NextResponse.json({
      settings,
      closeout: closeoutRes.data ?? null,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load closeout context." },
      { status: 500 }
    );
  }
}
