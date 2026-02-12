import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";

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
  profile: { id: string; name: string | null } | null;
  store: { id: string; name: string } | null;
};

function isDateOnly(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function getCstOffsetMinutes(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    timeZoneName: "shortOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const tz = parts.find(p => p.type === "timeZoneName")?.value ?? "";
  const match = tz.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/i);
  if (!match) return null;
  const hours = Number(match[1]);
  const mins = Number(match[2] || "0");
  return hours * 60 + (hours < 0 ? -mins : mins);
}

function cstDateStartToUtcIso(dateOnly: string) {
  const match = dateOnly.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  const utcMidnight = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0));
  const offset = getCstOffsetMinutes(utcMidnight);
  if (offset == null) return null;
  const utcMillis = Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0) - offset * 60000;
  return new Date(utcMillis).toISOString();
}

function nextDateOnly(dateOnly: string) {
  const dt = new Date(`${dateOnly}T00:00:00.000Z`);
  dt.setUTCDate(dt.getUTCDate() + 1);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function requireManager(req: Request) {
  const token = getBearerToken(req);
  if (!token) return { ok: false as const, response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) };
  const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) return { ok: false as const, response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) };
  const storeIds = await getManagerStoreIds(user.id);
  if (!storeIds.length) {
    return { ok: false as const, response: NextResponse.json({ error: "No managed stores." }, { status: 403 }) };
  }
  return { ok: true as const, user, storeIds };
}

export async function GET(req: Request) {
  try {
    const manager = await requireManager(req);
    if (!manager.ok) return manager.response;

    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const profileId = url.searchParams.get("profileId") || "";
    const status = url.searchParams.get("status") || "";

    let query = supabaseServer
      .from("payroll_advances")
      .select("id, profile_id, store_id, advance_date, advance_hours, cash_amount_cents, note, status, created_at, profile:profile_id(id,name), store:store_id(id,name)")
      .in("store_id", manager.storeIds)
      .order("advance_date", { ascending: false });

    if (from && isDateOnly(from)) {
      const iso = cstDateStartToUtcIso(from);
      if (iso) query = query.gte("advance_date", iso);
    }
    if (to && isDateOnly(to)) {
      const iso = cstDateStartToUtcIso(nextDateOnly(to));
      if (iso) query = query.lt("advance_date", iso);
    }
    if (profileId) query = query.eq("profile_id", profileId);
    if (status) query = query.eq("status", status);

    const { data, error } = await query.returns<AdvanceRow[]>();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ rows: data ?? [] });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to load advances." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const manager = await requireManager(req);
    if (!manager.ok) return manager.response;

    const body = await req.json();
    const profileId = String(body.profileId || "");
    const storeIdRaw = body.storeId ? String(body.storeId) : null;
    const advanceDate = String(body.advanceDate || new Date().toISOString());
    const advanceHours = Number(body.advanceHours);
    const cashAmountDollars = body.cashAmountDollars == null || body.cashAmountDollars === ""
      ? null
      : Number(body.cashAmountDollars);
    const note = body.note ? String(body.note) : null;
    const status = body.status ? String(body.status) : "verified";

    if (!profileId) return NextResponse.json({ error: "profileId is required." }, { status: 400 });
    if (!Number.isFinite(advanceHours) || advanceHours <= 0) {
      return NextResponse.json({ error: "advanceHours must be > 0." }, { status: 400 });
    }
    if (storeIdRaw && !manager.storeIds.includes(storeIdRaw)) {
      return NextResponse.json({ error: "Invalid store selection." }, { status: 403 });
    }

    const { data: profileStore, error: membershipErr } = await supabaseServer
      .from("store_memberships")
      .select("store_id")
      .eq("profile_id", profileId)
      .in("store_id", manager.storeIds)
      .limit(1)
      .maybeSingle();
    if (membershipErr) return NextResponse.json({ error: membershipErr.message }, { status: 500 });
    const fallbackStoreId = profileStore?.store_id ?? manager.storeIds[0];

    const { data, error } = await supabaseServer
      .from("payroll_advances")
      .insert({
        profile_id: profileId,
        store_id: storeIdRaw ?? fallbackStoreId,
        advance_date: advanceDate,
        advance_hours: advanceHours,
        cash_amount_cents: cashAmountDollars == null ? null : Math.round(cashAmountDollars * 100),
        note,
        status: status === "pending_verification" || status === "voided" ? status : "verified",
        verified_by_auth_user_id: status === "verified" ? manager.user.id : null,
      })
      .select("id")
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ id: data?.id ?? null }, { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to create advance." }, { status: 500 });
  }
}
