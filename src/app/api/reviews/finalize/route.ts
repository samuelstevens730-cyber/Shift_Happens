import { NextResponse } from "next/server";
import {
  authenticateShiftRequest,
  validateStoreAccess,
  validateProfileAccess,
} from "@/lib/shiftAuth";
import { supabaseServer } from "@/lib/supabaseServer";

type FinalizeBody = {
  reviewId?: string;
  profileId?: string;
  storeId?: string;
  reviewDate?: string;
};

type DraftReviewRow = {
  id: string;
  store_id: string;
  submitted_by_profile_id: string | null;
  screenshot_path: string;
  status: "draft" | "pending" | "approved" | "rejected";
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getCstMonthBounds(): { from: string; to: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const todayCst = fmt.format(new Date());
  const [year, month] = todayCst.split("-").map(Number);
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

export async function POST(req: Request) {
  try {
    const authResult = await authenticateShiftRequest(req);
    if (!authResult.ok) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    const auth = authResult.auth;

    let body: FinalizeBody;
    try {
      body = (await req.json()) as FinalizeBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const reviewId = (body.reviewId ?? "").trim();
    const profileId = (body.profileId ?? "").trim();
    const storeId = (body.storeId ?? "").trim();
    const reviewDate = (body.reviewDate ?? "").trim();

    if (!isUuid(reviewId)) {
      return NextResponse.json({ error: "Valid reviewId is required." }, { status: 400 });
    }
    if (!isUuid(profileId)) {
      return NextResponse.json({ error: "Valid profileId is required." }, { status: 400 });
    }
    if (!isUuid(storeId)) {
      return NextResponse.json({ error: "Valid storeId is required." }, { status: 400 });
    }
    if (!isDateOnly(reviewDate)) {
      return NextResponse.json({ error: "reviewDate must be YYYY-MM-DD." }, { status: 400 });
    }

    const { from, to } = getCstMonthBounds();
    if (reviewDate < from || reviewDate > to) {
      return NextResponse.json(
        { error: "Review date must be within the current month." },
        { status: 400 }
      );
    }

    const { data: draft, error: draftErr } = await supabaseServer
      .from("google_reviews")
      .select("id,store_id,submitted_by_profile_id,screenshot_path,status")
      .eq("id", reviewId)
      .eq("status", "draft")
      .maybeSingle<DraftReviewRow>();
    if (draftErr) return NextResponse.json({ error: draftErr.message }, { status: 500 });
    if (!draft) {
      return NextResponse.json({ error: "Draft review not found." }, { status: 404 });
    }

    if (auth.authType === "employee") {
      if (draft.submitted_by_profile_id !== auth.profileId) {
        return NextResponse.json({ error: "Forbidden." }, { status: 403 });
      }
      if (!validateStoreAccess(auth, draft.store_id)) {
        return NextResponse.json({ error: "Forbidden." }, { status: 403 });
      }
      const profileCheck = validateProfileAccess(auth, profileId);
      if (!profileCheck.ok) {
        return NextResponse.json({ error: profileCheck.error }, { status: 403 });
      }
    } else {
      if (!validateStoreAccess(auth, draft.store_id)) {
        return NextResponse.json({ error: "Forbidden." }, { status: 403 });
      }
    }

    const { data: profileMembership, error: membershipErr } = await supabaseServer
      .from("store_memberships")
      .select("profile_id")
      .eq("store_id", draft.store_id)
      .eq("profile_id", profileId)
      .maybeSingle<{ profile_id: string }>();
    if (membershipErr) return NextResponse.json({ error: membershipErr.message }, { status: 500 });
    if (!profileMembership) {
      return NextResponse.json({ error: "Profile is not assigned to this store." }, { status: 403 });
    }

    const { data: updated, error: updateErr } = await supabaseServer
      .from("google_reviews")
      .update({
        profile_id: profileId,
        review_date: reviewDate,
        status: "pending",
        submitted_by_type: auth.authType === "manager" ? "manager" : "employee",
        submitted_by_profile_id: auth.authType === "employee" ? auth.profileId : null,
        submitted_by_auth_id: auth.authType === "manager" ? auth.authUserId ?? null : null,
      })
      .eq("id", reviewId)
      .eq("status", "draft")
      .select("*")
      .single();
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json({ review: updated });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to finalize review." },
      { status: 500 }
    );
  }
}
