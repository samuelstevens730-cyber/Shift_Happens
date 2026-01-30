/**
 * POST /api/admin/variances/[countId]/review - Mark a Variance as Reviewed
 *
 * Marks a drawer count variance as reviewed by the manager, removing it from
 * the unreviewed variances list. Optionally accepts a review note.
 *
 * Auth: Bearer token required (admin access)
 *
 * URL params:
 *   - countId: UUID of the drawer count record to mark as reviewed
 *
 * Request body:
 *   - reviewNote: Optional note explaining the review/resolution (string)
 *
 * Returns: { ok: true } on success
 *
 * Error responses:
 *   - 400: Missing countId
 *   - 401: Unauthorized (invalid/missing token)
 *   - 404: Drawer count record not found
 *   - 500: Database error
 *
 * Business logic:
 *   - Sets reviewed_at to current timestamp
 *   - Sets reviewed_by to the authenticated user's ID
 *   - If reviewNote provided and review_note column exists, stores the note
 *   - Dynamically checks for review_note column existence for backward compatibility
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type ReviewBody = {
  reviewNote?: string;
};

type ColumnRow = { column_name: string };

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  return auth.slice(7);
}

function parseBody(value: unknown): ReviewBody {
  if (!value || typeof value !== "object") return {};
  const record = value as { reviewNote?: unknown };
  return { reviewNote: typeof record.reviewNote === "string" ? record.reviewNote : undefined };
}

async function hasReviewNoteColumn() {
  const { data, error } = await supabaseServer
    .from("information_schema.columns")
    .select("column_name")
    .eq("table_schema", "public")
    .eq("table_name", "shift_drawer_counts")
    .eq("column_name", "review_note")
    .returns<ColumnRow[]>();
  if (error) return false;
  return (data ?? []).length > 0;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ countId: string }> }
) {
  const token = getBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { countId } = await params;
  if (!countId) {
    return NextResponse.json({ error: "Missing countId." }, { status: 400 });
  }

  const body = parseBody(await req.json());
  const nowIso = new Date().toISOString();

  const updateData: {
    reviewed_at: string;
    reviewed_by: string;
    review_note?: string | null;
  } = {
    reviewed_at: nowIso,
    reviewed_by: user.id,
  };

  const reviewNote = body.reviewNote?.trim();
  if (reviewNote) {
    const hasColumn = await hasReviewNoteColumn();
    if (hasColumn) updateData.review_note = reviewNote;
  }

  const { data, error } = await supabaseServer
    .from("shift_drawer_counts")
    .update(updateData)
    .eq("id", countId)
    .select("id")
    .maybeSingle()
    .returns<{ id: string }>();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });

  return NextResponse.json({ ok: true });
}
