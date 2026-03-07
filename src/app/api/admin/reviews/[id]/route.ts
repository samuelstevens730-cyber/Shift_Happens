import { NextResponse } from "next/server";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";
import { supabaseServer } from "@/lib/supabaseServer";

type PatchBody = {
  action?: "approve" | "reject";
  rejectionReason?: string | null;
  notes?: string | null;
};

type ReviewRow = {
  id: string;
  store_id: string;
  screenshot_path: string;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function authenticateManager(req: Request): Promise<
  | { ok: true; userId: string; managerStoreIds: string[] }
  | { ok: false; response: NextResponse }
> {
  const token = getBearerToken(req);
  if (!token) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) };
  }
  const {
    data: { user },
    error: authErr,
  } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) };
  }
  const managerStoreIds = await getManagerStoreIds(user.id);
  if (!managerStoreIds.length) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden." }, { status: 403 }) };
  }
  return { ok: true, userId: user.id, managerStoreIds };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateManager(req);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid review id." }, { status: 400 });
    }

    let body: PatchBody;
    try {
      body = (await req.json()) as PatchBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!body.action || !["approve", "reject"].includes(body.action)) {
      return NextResponse.json({ error: "Invalid action." }, { status: 400 });
    }

    const { data: review, error: reviewErr } = await supabaseServer
      .from("google_reviews")
      .select("id,store_id")
      .eq("id", id)
      .maybeSingle<Pick<ReviewRow, "id" | "store_id">>();
    if (reviewErr) return NextResponse.json({ error: reviewErr.message }, { status: 500 });
    if (!review) return NextResponse.json({ error: "Review not found." }, { status: 404 });
    if (!auth.managerStoreIds.includes(review.store_id)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const { data: appUser, error: appUserErr } = await supabaseServer
      .from("app_users")
      .select("id")
      .eq("auth_user_id", auth.userId)
      .maybeSingle<{ id: string }>();
    if (appUserErr) return NextResponse.json({ error: appUserErr.message }, { status: 500 });
    if (!appUser) {
      return NextResponse.json({ error: "Manager app user record not found." }, { status: 400 });
    }

    const patch: {
      status: "approved" | "rejected";
      reviewed_by: string;
      reviewed_at: string;
      rejection_reason?: string | null;
      notes?: string | null;
    } = {
      status: body.action === "approve" ? "approved" : "rejected",
      reviewed_by: appUser.id,
      reviewed_at: new Date().toISOString(),
    };
    if (body.action === "reject") {
      patch.rejection_reason = body.rejectionReason?.trim() || null;
    } else {
      patch.rejection_reason = null;
    }
    if (body.notes !== undefined) {
      patch.notes = body.notes?.trim() || null;
    }

    const { data: updated, error: updateErr } = await supabaseServer
      .from("google_reviews")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json({ review: updated });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update review." },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateManager(req);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid review id." }, { status: 400 });
    }

    const { data: review, error: reviewErr } = await supabaseServer
      .from("google_reviews")
      .select("id,store_id,screenshot_path")
      .eq("id", id)
      .maybeSingle<ReviewRow>();
    if (reviewErr) return NextResponse.json({ error: reviewErr.message }, { status: 500 });
    if (!review) return NextResponse.json({ error: "Review not found." }, { status: 404 });
    if (!auth.managerStoreIds.includes(review.store_id)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    await supabaseServer.storage.from("reviews").remove([review.screenshot_path]).catch((e) => {
      console.error("Failed to delete review screenshot:", e);
    });

    const { error: deleteErr } = await supabaseServer
      .from("google_reviews")
      .delete()
      .eq("id", id);
    if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to delete review." },
      { status: 500 }
    );
  }
}
