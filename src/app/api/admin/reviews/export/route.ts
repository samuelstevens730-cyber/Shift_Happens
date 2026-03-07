import { NextResponse } from "next/server";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";
import { supabaseServer } from "@/lib/supabaseServer";

type ReviewStatus = "draft" | "pending" | "approved" | "rejected";

type ReviewRow = {
  id: string;
  store_id: string;
  profile_id: string;
  submitted_by_type: "employee" | "manager";
  review_date: string;
  status: ReviewStatus;
  reviewed_at: string | null;
  rejection_reason: string | null;
  notes: string | null;
  created_at: string;
};

function isMonth(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}$/.test(value));
}

function csvField(value: string | null | undefined): string {
  if (value == null || value === "") return "\"\"";
  const cleaned = value.replace(/[\r\n]+/g, " ");
  const escaped = cleaned.replace(/"/g, "\"\"");
  return `"${escaped}"`;
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
    if (!managerStoreIds.length) {
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
      .select("id,store_id,profile_id,submitted_by_type,review_date,status,reviewed_at,rejection_reason,notes,created_at")
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

    const [profilesRes, storesRes] = await Promise.all([
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
    ]);
    if (profilesRes.error) return NextResponse.json({ error: profilesRes.error.message }, { status: 500 });
    if (storesRes.error) return NextResponse.json({ error: storesRes.error.message }, { status: 500 });

    const nameByProfile = new Map<string, string>(
      (profilesRes.data ?? []).map((row): [string, string] => [row.id, row.name?.trim() || "Unknown"])
    );
    const nameByStore = new Map<string, string>(
      (storesRes.data ?? []).map((row): [string, string] => [row.id, row.name])
    );

    const lines: string[] = [];
    lines.push(
      "ID,Store,Employee Name,Review Date,Submitted By Type,Status,Submitted At,Reviewed At,Notes,Rejection Reason"
    );

    for (const row of reviews ?? []) {
      lines.push(
        [
          row.id,
          csvField(nameByStore.get(row.store_id) ?? "Unknown"),
          csvField(nameByProfile.get(row.profile_id) ?? "Unknown"),
          row.review_date,
          row.submitted_by_type,
          row.status,
          row.created_at,
          row.reviewed_at ?? "",
          csvField(row.notes),
          csvField(row.rejection_reason),
        ].join(",")
      );
    }

    return new NextResponse(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=\"reviews-${month}.csv\"`,
      },
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to export reviews." },
      { status: 500 }
    );
  }
}
