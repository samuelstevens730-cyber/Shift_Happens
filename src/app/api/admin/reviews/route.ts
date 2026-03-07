import { NextResponse } from "next/server";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";
import { supabaseServer } from "@/lib/supabaseServer";

type ReviewStatus = "draft" | "pending" | "approved" | "rejected";

type ReviewRow = {
  id: string;
  store_id: string;
  profile_id: string;
  submitted_by_type: "employee" | "manager";
  submitted_by_profile_id: string | null;
  submitted_by_auth_id: string | null;
  review_date: string;
  screenshot_path: string;
  status: ReviewStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  notes: string | null;
  created_at: string;
};

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
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const {
      data: { user },
      error: authErr,
    } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (managerStoreIds.length === 0) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const url = new URL(req.url);
    const month = isMonth(url.searchParams.get("month"))
      ? (url.searchParams.get("month") as string)
      : getCstCurrentMonth();
    const statusParam = (url.searchParams.get("status") ?? "all").trim();
    const storeParam = (url.searchParams.get("storeId") ?? "all").trim();
    const { from, to } = getMonthBounds(month);

    const activeStoreIds =
      storeParam === "all"
        ? managerStoreIds
        : managerStoreIds.includes(storeParam)
          ? [storeParam]
          : null;
    if (!activeStoreIds) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const reviewQuery = supabaseServer
      .from("google_reviews")
      .select(
        "id,store_id,profile_id,submitted_by_type,submitted_by_profile_id,submitted_by_auth_id,review_date,screenshot_path,status,reviewed_by,reviewed_at,rejection_reason,notes,created_at"
      )
      .in("store_id", activeStoreIds)
      .gte("review_date", from)
      .lte("review_date", to)
      .order("created_at", { ascending: false });

    if (statusParam !== "all") {
      if (!["draft", "pending", "approved", "rejected"].includes(statusParam)) {
        return NextResponse.json({ error: "Invalid status filter." }, { status: 400 });
      }
      reviewQuery.eq("status", statusParam as ReviewStatus);
    }

    const { data: reviews, error: reviewErr } = await reviewQuery.returns<ReviewRow[]>();
    if (reviewErr) return NextResponse.json({ error: reviewErr.message }, { status: 500 });

    const profileIds = Array.from(new Set((reviews ?? []).map((row) => row.profile_id)));
    const storeIds = Array.from(new Set((reviews ?? []).map((row) => row.store_id)));
    const reviewerIds = Array.from(
      new Set((reviews ?? []).map((row) => row.reviewed_by).filter((value): value is string => Boolean(value)))
    );

    const [profilesRes, storesRes, reviewersRes, scopedStoresRes, employeesRes] = await Promise.all([
      profileIds.length
        ? supabaseServer
            .from("profiles")
            .select("id,name")
            .in("id", profileIds)
            .returns<Array<{ id: string; name: string | null }>>()
        : Promise.resolve({ data: [], error: null }),
      storeIds.length
        ? supabaseServer
            .from("stores")
            .select("id,name")
            .in("id", storeIds)
            .returns<Array<{ id: string; name: string }>>()
        : Promise.resolve({ data: [], error: null }),
      reviewerIds.length
        ? supabaseServer
            .from("app_users")
            .select("id,display_name")
            .in("id", reviewerIds)
            .returns<Array<{ id: string; display_name: string | null }>>()
        : Promise.resolve({ data: [], error: null }),
      supabaseServer
        .from("stores")
        .select("id,name")
        .in("id", managerStoreIds)
        .order("name", { ascending: true })
        .returns<Array<{ id: string; name: string }>>(),
      supabaseServer
        .from("store_memberships")
        .select("profile_id,profiles:profile_id(id,name)")
        .in("store_id", activeStoreIds)
        .returns<Array<{ profile_id: string; profiles: { id: string; name: string | null } | null }>>(),
    ]);

    if (profilesRes.error) return NextResponse.json({ error: profilesRes.error.message }, { status: 500 });
    if (storesRes.error) return NextResponse.json({ error: storesRes.error.message }, { status: 500 });
    if (reviewersRes.error) return NextResponse.json({ error: reviewersRes.error.message }, { status: 500 });
    if (scopedStoresRes.error) return NextResponse.json({ error: scopedStoresRes.error.message }, { status: 500 });
    if (employeesRes.error) return NextResponse.json({ error: employeesRes.error.message }, { status: 500 });

    const nameByProfile = new Map<string, string>(
      (profilesRes.data ?? []).map((row): [string, string] => [row.id, row.name?.trim() || "Unknown"])
    );
    const nameByStore = new Map<string, string>(
      (storesRes.data ?? []).map((row): [string, string] => [row.id, row.name])
    );
    const nameByReviewer = new Map<string, string>(
      (reviewersRes.data ?? []).map((row): [string, string] => [row.id, row.display_name?.trim() || "Unknown"])
    );

    const hydrated = await Promise.all(
      (reviews ?? []).map(async (row) => {
        const { data: signed, error: signErr } = await supabaseServer.storage
          .from("reviews")
          .createSignedUrl(row.screenshot_path, 60 * 60);
        return {
          ...row,
          employee_name: nameByProfile.get(row.profile_id) ?? "Unknown",
          store_name: nameByStore.get(row.store_id) ?? "Unknown",
          reviewed_by_name: row.reviewed_by ? nameByReviewer.get(row.reviewed_by) ?? null : null,
          screenshot_url: signErr ? null : signed.signedUrl,
        };
      })
    );

    return NextResponse.json({
      month,
      from,
      to,
      storeId: storeParam,
      stores: scopedStoresRes.data ?? [],
      employees:
        (employeesRes.data ?? [])
          .map((row) => ({
            profileId: row.profile_id,
            name: row.profiles?.name?.trim() || "Unknown",
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      reviews: hydrated,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load reviews." },
      { status: 500 }
    );
  }
}
