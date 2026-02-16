import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";
import type { SafeCloseoutRow } from "@/types/safeLedger";

type SafeCloseoutStatusFilter = "pass" | "warn" | "fail";
type PhotoType = "deposit_required" | "pos_optional";

type ManualExpenseInput = {
  amount_cents: number;
  category: string;
  note?: string | null;
};

type ManualPhotoInput = {
  photo_type: PhotoType;
  storage_path: string;
  thumb_path?: string | null;
  purge_after?: string | null;
};

type ManualCreateBody = {
  store_id?: string;
  business_date?: string;
  profile_id?: string;
  cash_sales_cents?: number;
  card_sales_cents?: number;
  other_sales_cents?: number;
  actual_deposit_cents?: number;
  drawer_count_cents?: number | null;
  denoms_jsonb?: Record<string, unknown>;
  expenses?: ManualExpenseInput[];
  photos?: ManualPhotoInput[];
  deposit_override_reason?: string | null;
};

type CloseoutJoinRow = SafeCloseoutRow & {
  profile: {
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
  const fallback = (profile.name ?? "").trim();
  return fallback || null;
}

function intOrZero(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
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
        profile:profile_id(name),
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

    const editedByIds = Array.from(new Set((data ?? []).map((row) => row.edited_by).filter((id): id is string => Boolean(id))));
    let editorNameById = new Map<string, string>();
    if (editedByIds.length > 0) {
      const { data: editors, error: editorsErr } = await supabaseServer
        .from("app_users")
        .select("id, display_name")
        .in("id", editedByIds)
        .returns<Array<{ id: string; display_name: string | null }>>();
      if (editorsErr) return NextResponse.json({ error: editorsErr.message }, { status: 500 });
      editorNameById = new Map((editors ?? []).map((editor) => [editor.id, (editor.display_name ?? "").trim()]));
    }

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
      cash_sales_cents: row.cash_sales_cents,
      card_sales_cents: row.card_sales_cents,
      other_sales_cents: row.other_sales_cents,
      variance_cents: row.variance_cents,
      expected_deposit_cents: row.expected_deposit_cents,
      actual_deposit_cents: row.actual_deposit_cents,
      denom_total_cents: row.denom_total_cents,
      denoms_jsonb: row.denoms_jsonb,
      created_at: row.created_at,
      updated_at: row.updated_at,
      reviewed_at: row.reviewed_at,
      reviewed_by: row.reviewed_by,
      edited_at: row.edited_at,
      edited_by: row.edited_by,
      edited_by_name: row.edited_by ? editorNameById.get(row.edited_by) ?? null : null,
      is_historical_backfill: row.is_historical_backfill,
    }));

    return NextResponse.json({ rows });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load safe ledger." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
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

    const body = (await req.json().catch(() => ({}))) as ManualCreateBody;
    if (!isUuid(body.store_id ?? null) || !managerStoreIds.includes(body.store_id!)) {
      return NextResponse.json({ error: "Invalid store_id." }, { status: 400 });
    }
    if (!isUuid(body.profile_id ?? null)) {
      return NextResponse.json({ error: "Invalid profile_id." }, { status: 400 });
    }
    if (!isDateOnly(body.business_date ?? null)) {
      return NextResponse.json({ error: "business_date must be YYYY-MM-DD." }, { status: 400 });
    }

    const { data: membership, error: membershipErr } = await supabaseServer
      .from("store_memberships")
      .select("store_id")
      .eq("store_id", body.store_id!)
      .eq("profile_id", body.profile_id!)
      .maybeSingle<{ store_id: string }>();
    if (membershipErr) return NextResponse.json({ error: membershipErr.message }, { status: 500 });
    if (!membership) {
      return NextResponse.json({ error: "Selected employee is not assigned to this store." }, { status: 400 });
    }

    const cashSales = intOrZero(body.cash_sales_cents);
    const cardSales = intOrZero(body.card_sales_cents);
    const otherSales = intOrZero(body.other_sales_cents);
    const actualDeposit = intOrZero(body.actual_deposit_cents);
    const drawerCount =
      body.drawer_count_cents == null ? null : Math.max(0, Math.trunc(Number(body.drawer_count_cents)));

    if (body.drawer_count_cents != null && !Number.isFinite(Number(body.drawer_count_cents))) {
      return NextResponse.json({ error: "drawer_count_cents must be null or non-negative integer." }, { status: 400 });
    }

    const denoms = body.denoms_jsonb ?? {};
    const d100 = intOrZero(denoms["100"]);
    const d50 = intOrZero(denoms["50"]);
    const d20 = intOrZero(denoms["20"]);
    const d10 = intOrZero(denoms["10"]);
    const d5 = intOrZero(denoms["5"]);
    const d2 = intOrZero(denoms["2"]);
    const d1 = intOrZero(denoms["1"]);
    const denomTotal =
      (d100 * 10000) + (d50 * 5000) + (d20 * 2000) + (d10 * 1000) + (d5 * 500) + (d2 * 200) + (d1 * 100);

    const expenses = Array.isArray(body.expenses) ? body.expenses : [];
    let expenseTotal = 0;
    for (const e of expenses) {
      if (!Number.isInteger(e?.amount_cents) || (e?.amount_cents ?? -1) < 0) {
        return NextResponse.json({ error: "Each expense.amount_cents must be a non-negative integer." }, { status: 400 });
      }
      if (!e?.category || !String(e.category).trim()) {
        return NextResponse.json({ error: "Each expense.category is required." }, { status: 400 });
      }
      expenseTotal += e.amount_cents;
    }

    const rawExpected = cashSales - expenseTotal;
    const expectedDeposit = rawExpected < 0 ? 0 : ((rawExpected + 50) / 100 | 0) * 100;
    const variance = actualDeposit - expectedDeposit;
    const denomVariance = actualDeposit - denomTotal;

    const status: "pass" | "warn" = (variance === 0 && denomVariance === 0) ? "pass" : "warn";

    const { data: inserted, error: insertErr } = await supabaseServer
      .from("safe_closeouts")
      .insert({
        store_id: body.store_id,
        business_date: body.business_date,
        shift_id: null,
        profile_id: body.profile_id,
        status,
        cash_sales_cents: cashSales,
        card_sales_cents: cardSales,
        other_sales_cents: otherSales,
        expected_deposit_cents: expectedDeposit,
        actual_deposit_cents: actualDeposit,
        denom_total_cents: denomTotal,
        drawer_count_cents: drawerCount,
        variance_cents: variance,
        denoms_jsonb: {
          "100": d100,
          "50": d50,
          "20": d20,
          "10": d10,
          "5": d5,
          "2": d2,
          "1": d1,
        },
        deposit_override_reason: body.deposit_override_reason ?? null,
        requires_manager_review: false,
        is_historical_backfill: false,
        edited_at: new Date().toISOString(),
        edited_by: user.id,
      })
      .select("id")
      .maybeSingle<{ id: string }>();

    if (insertErr) {
      if (insertErr.code === "23505") {
        return NextResponse.json({ error: "A closeout already exists for this store/date." }, { status: 409 });
      }
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }
    if (!inserted?.id) return NextResponse.json({ error: "Failed to create closeout." }, { status: 500 });

    if (expenses.length > 0) {
      const rows = expenses.map((e) => ({
        closeout_id: inserted.id,
        amount_cents: e.amount_cents,
        category: String(e.category).trim(),
        note: (e.note ?? null) ? String(e.note).trim() : null,
      }));
      const { error: expenseErr } = await supabaseServer
        .from("safe_closeout_expenses")
        .insert(rows);
      if (expenseErr) return NextResponse.json({ error: expenseErr.message }, { status: 500 });
    }

    const photos = Array.isArray(body.photos) ? body.photos : [];
    if (photos.length > 0) {
      for (const photo of photos) {
        if (!photo?.storage_path || !String(photo.storage_path).trim()) {
          return NextResponse.json({ error: "Each photo.storage_path is required." }, { status: 400 });
        }
        if (photo.photo_type !== "deposit_required" && photo.photo_type !== "pos_optional") {
          return NextResponse.json({ error: "photo_type must be deposit_required or pos_optional." }, { status: 400 });
        }
      }
      const rows = photos.map((photo) => ({
        closeout_id: inserted.id,
        photo_type: photo.photo_type,
        storage_path: String(photo.storage_path).trim(),
        thumb_path: photo.thumb_path ? String(photo.thumb_path).trim() : null,
        purge_after: photo.purge_after ?? null,
      }));
      const { error: photoErr } = await supabaseServer
        .from("safe_closeout_photos")
        .insert(rows);
      if (photoErr) return NextResponse.json({ error: photoErr.message }, { status: 500 });
    }

    return NextResponse.json({ id: inserted.id, status, variance_cents: variance, denom_variance_cents: denomVariance });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create safe closeout." },
      { status: 500 }
    );
  }
}
