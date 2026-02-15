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
    first_name?: string | null;
    last_name?: string | null;
    name?: string | null;
  } | null;
  store: {
    name?: string | null;
  } | null;
};

function fullName(profile: CloseoutJoinRow["profile"]): string | null {
  if (!profile) return null;
  const first = (profile.first_name ?? "").trim();
  const last = (profile.last_name ?? "").trim();
  const combined = `${first} ${last}`.trim();
  if (combined) return combined;
  const fallback = (profile.name ?? "").trim();
  return fallback || null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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
        profile:profile_id(first_name,last_name,name),
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

    return NextResponse.json({
      closeout: {
        ...closeout,
        employee_name: fullName(closeout.profile),
        store_name: closeout.store?.name ?? null,
      },
      expenses: expensesRes.data ?? [],
      photos: photosRes.data ?? [],
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load safe closeout detail." },
      { status: 500 }
    );
  }
}
