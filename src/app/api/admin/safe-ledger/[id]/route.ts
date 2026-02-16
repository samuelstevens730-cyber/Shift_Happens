import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";
import type {
  SafeCloseoutExpenseRow,
  SafeCloseoutPhotoRow,
  SafeCloseoutRow,
} from "@/types/safeLedger";

type CloseoutJoinRow = SafeCloseoutRow & {
  profile: {
    name?: string | null;
  } | null;
  store: {
    name?: string | null;
  } | null;
};

type PatchBody = {
  status?: "draft" | "pass" | "warn" | "fail";
  cash_sales_cents?: number;
  card_sales_cents?: number;
  other_sales_cents?: number;
  expected_deposit_cents?: number;
  actual_deposit_cents?: number;
  drawer_count_cents?: number | null;
  deposit_override_reason?: string | null;
  denoms_jsonb?: Record<string, unknown>;
  expenses?: Array<{
    amount_cents: number;
    category: string;
    note?: string | null;
  }>;
  expenses_replace?: boolean;
  photos_replace?: boolean;
  photos?: Array<{
    photo_type: "deposit_required" | "pos_optional";
    storage_path: string;
    thumb_path?: string | null;
    purge_after?: string | null;
  }>;
};

function fullName(profile: CloseoutJoinRow["profile"]): string | null {
  if (!profile) return null;
  const fallback = (profile.name ?? "").trim();
  return fallback || null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function intOrZero(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid closeout id." }, { status: 400 });
    }

    const { data: closeout, error: closeoutErr } = await supabaseServer
      .from("safe_closeouts")
      .select(`
        *,
        profile:profile_id(name),
        store:store_id(name)
      `)
      .eq("id", id)
      .maybeSingle<CloseoutJoinRow>();

    if (closeoutErr) return NextResponse.json({ error: closeoutErr.message }, { status: 500 });
    if (!closeout) return NextResponse.json({ error: "Closeout not found." }, { status: 404 });
    if (!managerStoreIds.includes(closeout.store_id)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const [expensesRes, photosRes] = await Promise.all([
      supabaseServer
        .from("safe_closeout_expenses")
        .select("*")
        .eq("closeout_id", id)
        .order("created_at", { ascending: true })
        .returns<SafeCloseoutExpenseRow[]>(),
      supabaseServer
        .from("safe_closeout_photos")
        .select("*")
        .eq("closeout_id", id)
        .order("created_at", { ascending: true })
        .returns<SafeCloseoutPhotoRow[]>(),
    ]);

    if (expensesRes.error) return NextResponse.json({ error: expensesRes.error.message }, { status: 500 });
    if (photosRes.error) return NextResponse.json({ error: photosRes.error.message }, { status: 500 });

    const photosWithUrls = await Promise.all(
      (photosRes.data ?? []).map(async (photo) => {
        if (!photo.storage_path) return { ...photo, signed_url: null };
        const { data: signed, error: signErr } = await supabaseServer.storage
          .from("safe-photos")
          .createSignedUrl(photo.storage_path, 60 * 30);
        if (signErr) return { ...photo, signed_url: null };
        return { ...photo, signed_url: signed.signedUrl };
      })
    );

    let editedByName: string | null = null;
    if (closeout.edited_by) {
      const { data: editor, error: editorErr } = await supabaseServer
        .from("app_users")
        .select("display_name")
        .eq("id", closeout.edited_by)
        .maybeSingle<{ display_name: string | null }>();
      if (editorErr) return NextResponse.json({ error: editorErr.message }, { status: 500 });
      editedByName = (editor?.display_name ?? "").trim() || null;
    }

    return NextResponse.json({
      closeout: {
        ...closeout,
        employee_name: fullName(closeout.profile),
        store_name: closeout.store?.name ?? null,
        edited_by_name: editedByName,
      },
      expenses: expensesRes.data ?? [],
      photos: photosWithUrls,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load safe closeout detail." },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid closeout id." }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as PatchBody;

    const { data: existing, error: existingErr } = await supabaseServer
      .from("safe_closeouts")
      .select("*")
      .eq("id", id)
      .maybeSingle<SafeCloseoutRow>();

    if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 500 });
    if (!existing) return NextResponse.json({ error: "Closeout not found." }, { status: 404 });
    if (!managerStoreIds.includes(existing.store_id)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    if (
      (body.cash_sales_cents !== undefined && !isNonNegativeInt(body.cash_sales_cents)) ||
      (body.card_sales_cents !== undefined && !isNonNegativeInt(body.card_sales_cents)) ||
      (body.other_sales_cents !== undefined && !isNonNegativeInt(body.other_sales_cents)) ||
      (body.expected_deposit_cents !== undefined && !isNonNegativeInt(body.expected_deposit_cents)) ||
      (body.actual_deposit_cents !== undefined && !isNonNegativeInt(body.actual_deposit_cents))
    ) {
      return NextResponse.json({ error: "Money fields must be non-negative integer cents." }, { status: 400 });
    }

    if (
      body.drawer_count_cents !== undefined &&
      body.drawer_count_cents !== null &&
      !isNonNegativeInt(body.drawer_count_cents)
    ) {
      return NextResponse.json({ error: "drawer_count_cents must be null or non-negative integer cents." }, { status: 400 });
    }

    if (
      body.status !== undefined &&
      !["draft", "pass", "warn", "fail"].includes(body.status)
    ) {
      return NextResponse.json({ error: "status must be one of draft, pass, warn, fail." }, { status: 400 });
    }

    const patch: Partial<SafeCloseoutRow> = {
      cash_sales_cents: body.cash_sales_cents ?? existing.cash_sales_cents,
      card_sales_cents: body.card_sales_cents ?? existing.card_sales_cents,
      other_sales_cents: body.other_sales_cents ?? existing.other_sales_cents,
      expected_deposit_cents: body.expected_deposit_cents ?? existing.expected_deposit_cents,
      actual_deposit_cents: body.actual_deposit_cents ?? existing.actual_deposit_cents,
      drawer_count_cents: body.drawer_count_cents ?? existing.drawer_count_cents,
      deposit_override_reason: body.deposit_override_reason ?? existing.deposit_override_reason,
      status: body.status ?? existing.status,
      edited_at: new Date().toISOString(),
      edited_by: user.id,
      updated_at: new Date().toISOString(),
    };

    if (body.denoms_jsonb) {
      const d100 = intOrZero(body.denoms_jsonb["100"]);
      const d50 = intOrZero(body.denoms_jsonb["50"]);
      const d20 = intOrZero(body.denoms_jsonb["20"]);
      const d10 = intOrZero(body.denoms_jsonb["10"]);
      const d5 = intOrZero(body.denoms_jsonb["5"]);
      const d2 = intOrZero(body.denoms_jsonb["2"]);
      const d1 = intOrZero(body.denoms_jsonb["1"]);
      patch.denoms_jsonb = { "100": d100, "50": d50, "20": d20, "10": d10, "5": d5, "2": d2, "1": d1 };
      patch.denom_total_cents = (d100 * 10000) + (d50 * 5000) + (d20 * 2000) + (d10 * 1000) + (d5 * 500) + (d2 * 200) + (d1 * 100);
    }

    let nextExpenseTotal: number | null = null;
    if (body.expenses !== undefined) {
      for (const expense of body.expenses) {
        if (!isNonNegativeInt(expense?.amount_cents)) {
          return NextResponse.json({ error: "Each expense.amount_cents must be a non-negative integer." }, { status: 400 });
        }
        if (!expense?.category || !String(expense.category).trim()) {
          return NextResponse.json({ error: "Each expense.category is required." }, { status: 400 });
        }
      }
      nextExpenseTotal = body.expenses.reduce((sum, e) => sum + e.amount_cents, 0);
      if (body.expected_deposit_cents === undefined) {
        const rawExpected = patch.cash_sales_cents! - nextExpenseTotal;
        patch.expected_deposit_cents = rawExpected < 0 ? 0 : Math.trunc((rawExpected + 50) / 100) * 100;
      }
    }

    patch.variance_cents = patch.actual_deposit_cents! - patch.expected_deposit_cents!;

    const { data: updated, error: updateErr } = await supabaseServer
      .from("safe_closeouts")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single<SafeCloseoutRow>();

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    if (body.expenses !== undefined) {
      const shouldReplace = body.expenses_replace ?? true;
      if (shouldReplace) {
        const { error: deleteExpenseErr } = await supabaseServer
          .from("safe_closeout_expenses")
          .delete()
          .eq("closeout_id", id);
        if (deleteExpenseErr) return NextResponse.json({ error: deleteExpenseErr.message }, { status: 500 });
      }
      if (body.expenses.length > 0) {
        const rows = body.expenses.map((expense) => ({
          closeout_id: id,
          amount_cents: expense.amount_cents,
          category: String(expense.category).trim(),
          note: expense.note ? String(expense.note).trim() : null,
        }));
        const { error: insertExpenseErr } = await supabaseServer
          .from("safe_closeout_expenses")
          .insert(rows);
        if (insertExpenseErr) return NextResponse.json({ error: insertExpenseErr.message }, { status: 500 });
      }
    }

    if (body.photos_replace && body.photos?.length) {
      const invalidPhoto = body.photos.find((photo) => {
        const typeOk = photo.photo_type === "deposit_required" || photo.photo_type === "pos_optional";
        const pathOk = Boolean(photo.storage_path && String(photo.storage_path).trim());
        return !typeOk || !pathOk;
      });
      if (invalidPhoto) {
        return NextResponse.json({ error: "Each photo needs valid photo_type and storage_path." }, { status: 400 });
      }

      const { error: deleteErr } = await supabaseServer
        .from("safe_closeout_photos")
        .delete()
        .eq("closeout_id", id);
      if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 });
    }

    if (body.photos?.length) {
      const invalidPhoto = body.photos.find((photo) => {
        const typeOk = photo.photo_type === "deposit_required" || photo.photo_type === "pos_optional";
        const pathOk = Boolean(photo.storage_path && String(photo.storage_path).trim());
        return !typeOk || !pathOk;
      });
      if (invalidPhoto) {
        return NextResponse.json({ error: "Each photo needs valid photo_type and storage_path." }, { status: 400 });
      }

      const photoRows = body.photos.map((photo) => ({
        closeout_id: id,
        photo_type: photo.photo_type,
        storage_path: String(photo.storage_path).trim(),
        thumb_path: photo.thumb_path ? String(photo.thumb_path).trim() : null,
        purge_after: photo.purge_after ?? null,
      }));

      const { error: photoErr } = await supabaseServer
        .from("safe_closeout_photos")
        .insert(photoRows);
      if (photoErr) return NextResponse.json({ error: photoErr.message }, { status: 500 });
    }

    return NextResponse.json({ row: updated });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update safe closeout." },
      { status: 500 }
    );
  }
}
