import { NextResponse } from "next/server";
import { authenticateShiftRequest } from "@/lib/shiftAuth";
import { supabaseServer } from "@/lib/supabaseServer";

type ScoreboardRow = {
  profileId: string;
  name: string;
  count: number;
};

type SubmissionRow = {
  id: string;
  store_id: string;
  profile_id: string;
  review_date: string;
  status: "pending" | "rejected";
  rejection_reason: string | null;
  created_at: string;
};

type StoreMemberRow = { profile_id: string; profiles: { id: string; name: string | null } | null };

function isMonth(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}$/.test(value));
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getCstCurrentMonth(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
}

function getMonthBounds(month: string): { from: string; to: string } {
  const [year, monthNumber] = month.split("-").map(Number);
  const from = `${year}-${String(monthNumber).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const to = `${year}-${String(monthNumber).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

export async function GET(req: Request) {
  try {
    const authResult = await authenticateShiftRequest(req);
    if (!authResult.ok) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    const auth = authResult.auth;

    const url = new URL(req.url);
    const storeIdParam = (url.searchParams.get("storeId") ?? "all").trim();
    const month = isMonth(url.searchParams.get("month"))
      ? (url.searchParams.get("month") as string)
      : getCstCurrentMonth();
    const { from, to } = getMonthBounds(month);

    if (storeIdParam !== "all") {
      if (!isUuid(storeIdParam)) {
        return NextResponse.json({ error: "Invalid storeId." }, { status: 400 });
      }
      const { data: storeExists, error: storeErr } = await supabaseServer
        .from("stores")
        .select("id")
        .eq("id", storeIdParam)
        .maybeSingle<{ id: string }>();
      if (storeErr) return NextResponse.json({ error: storeErr.message }, { status: 500 });
      if (!storeExists) {
        return NextResponse.json({ error: "Store not found." }, { status: 400 });
      }
    }

    const { data: scopedStores, error: scopedStoresErr } = await supabaseServer
      .from("stores")
      .select("id,name")
      .in("id", auth.storeIds)
      .returns<Array<{ id: string; name: string }>>();
    if (scopedStoresErr) {
      return NextResponse.json({ error: scopedStoresErr.message }, { status: 500 });
    }

    const scoreboardPromise =
      storeIdParam === "all"
        ? supabaseServer
            .from("google_reviews")
            .select("profile_id")
            .eq("status", "approved")
            .gte("review_date", from)
            .lte("review_date", to)
            .returns<Array<{ profile_id: string }>>()
        : supabaseServer
            .from("google_reviews")
            .select("profile_id")
            .eq("status", "approved")
            .eq("store_id", storeIdParam)
            .gte("review_date", from)
            .lte("review_date", to)
            .returns<Array<{ profile_id: string }>>();

    const mySubmissionsPromise = supabaseServer
      .from("google_reviews")
      .select("id,store_id,profile_id,review_date,status,rejection_reason,created_at")
      .eq("profile_id", auth.profileId)
      .in("status", ["pending", "rejected"])
      .gte("review_date", from)
      .lte("review_date", to)
      .order("created_at", { ascending: false })
      .returns<SubmissionRow[]>();

    const employeesPromise =
      storeIdParam === "all"
        ? Promise.resolve({ data: [] as StoreMemberRow[], error: null })
        : supabaseServer
            .from("store_memberships")
            .select("profile_id,profiles:profile_id(id,name)")
            .eq("store_id", storeIdParam)
            .returns<StoreMemberRow[]>();

    const [scoreboardRes, submissionsRes, employeesRes] = await Promise.all([
      scoreboardPromise,
      mySubmissionsPromise,
      employeesPromise,
    ]);

    if (scoreboardRes.error) {
      return NextResponse.json({ error: scoreboardRes.error.message }, { status: 500 });
    }
    if (submissionsRes.error) {
      return NextResponse.json({ error: submissionsRes.error.message }, { status: 500 });
    }
    if (employeesRes.error) {
      return NextResponse.json({ error: employeesRes.error.message }, { status: 500 });
    }

    const countsByProfile = new Map<string, number>();
    for (const row of scoreboardRes.data ?? []) {
      countsByProfile.set(row.profile_id, (countsByProfile.get(row.profile_id) ?? 0) + 1);
    }

    const profileIds = [...countsByProfile.keys()];
    const { data: profiles, error: profileErr } = profileIds.length
      ? await supabaseServer
          .from("profiles")
          .select("id,name")
          .in("id", profileIds)
          .returns<Array<{ id: string; name: string | null }>>()
      : { data: [] as Array<{ id: string; name: string | null }>, error: null };

    if (profileErr) {
      return NextResponse.json({ error: profileErr.message }, { status: 500 });
    }

    const nameByProfile = new Map((profiles ?? []).map((profile) => [profile.id, profile.name?.trim() || "Unknown"]));
    const scoreboard: ScoreboardRow[] = profileIds
      .map((profileId) => ({
        profileId,
        name: nameByProfile.get(profileId) ?? "Unknown",
        count: countsByProfile.get(profileId) ?? 0,
      }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.name.localeCompare(b.name);
      });

    const employees = (employeesRes.data ?? [])
      .map((row) => ({
        profileId: row.profile_id,
        name: row.profiles?.name?.trim() || "Unknown",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      month,
      scoreboard,
      mySubmissions: submissionsRes.data ?? [],
      employees,
      stores: scopedStores ?? [],
      profileId: auth.profileId,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load review data." },
      { status: 500 }
    );
  }
}
