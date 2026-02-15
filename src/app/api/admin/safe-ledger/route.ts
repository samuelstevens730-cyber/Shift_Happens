import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";
import type { SafeCloseoutRow } from "@/types/safeLedger";

type SafeCloseoutStatusFilter = "pass" | "warn" | "fail";

type CloseoutJoinRow = SafeCloseoutRow & {
  profile: {
    first_name?: string | null;
    last_name?: string | null;
    name?: string | null;
  } | null;
  store: {
    name?: string | null;
  } | null;
};

function isDateOnly(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function isUuid(value: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function normalizeStatus(value: string | null): SafeCloseoutStatusFilter | null {
  if (value === "pass" || value === "warn" || value === "fail") return value;
  return null;
}

function fullName(profile: CloseoutJoinRow["profile"]): string | null {
  if (!profile) return null;
  const first = (profile.first_name ?? "").trim();
  const last = (profile.last_name ?? "").trim();
  const combined = `${first} ${last}`.trim();
  if (combined) return combined;
  const fallback = (profile.name ?? "").trim();
  return fallback || null;
}

export async function GET(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (managerStoreIds.length === 0) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const url = new URL(req.url);
    const storeId = url.searchParams.get("storeId");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const status = normalizeStatus(url.searchParams.get("status"));
    const reviewNeeded = url.searchParams.get("review_needed");

    if (storeId && !isUuid(storeId)) {
      return NextResponse.json({ error: "storeId must be a valid UUID." }, { status: 400 });
    }
    if (storeId && !managerStoreIds.includes(storeId)) {
      return NextResponse.json({ error: "Invalid store selection." }, { status: 403 });
    }
    if (!isDateOnly(from) || !isDateOnly(to)) {
      return NextResponse.json({ error: "from and to must be YYYY-MM-DD." }, { status: 400 });
    }
    if (url.searchParams.has("status") && !status) {
      return NextResponse.json({ error: "status must be pass, warn, or fail." }, { status: 400 });
    }
    if (reviewNeeded != null && reviewNeeded !== "true" && reviewNeeded !== "false") {
      return NextResponse.json({ error: "review_needed must be true or false." }, { status: 400 });
    }

    let query = supabaseServer
      .from("safe_closeouts")
      .select(`
        *,
        profile:profile_id(first_name,last_name,name),
        store:store_id(name)
      `)
      .in("store_id", managerStoreIds)
      .gte("business_date", from)
      .lte("business_date", to);

    if (storeId) query = query.eq("store_id", storeId);
    if (status) query = query.eq("status", status);
    if (reviewNeeded === "true") query = query.eq("requires_manager_review", true);

    const { data, error } = await query
      .order("business_date", { ascending: false })
      .returns<CloseoutJoinRow[]>();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = (data ?? []).map((row) => ({
      id: row.id,
      store_id: row.store_id,
      store_name: row.store?.name ?? null,
      business_date: row.business_date,
      shift_id: row.shift_id,
      profile_id: row.profile_id,
      employee_name: fullName(row.profile),
      status: row.status,
      requires_manager_review: row.requires_manager_review,
      validation_attempts: row.validation_attempts,
      variance_cents: row.variance_cents,
      expected_deposit_cents: row.expected_deposit_cents,
      actual_deposit_cents: row.actual_deposit_cents,
      denom_total_cents: row.denom_total_cents,
      created_at: row.created_at,
      updated_at: row.updated_at,
      reviewed_at: row.reviewed_at,
      reviewed_by: row.reviewed_by,
    }));

    return NextResponse.json({ rows });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load safe ledger." },
      { status: 500 }
    );
  }
}
