import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const xSecret = req.headers.get("x-cron-secret");
  if (xSecret && xSecret === secret) return true;

  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return false;
  return auth.slice(7).trim() === secret;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: drafts, error: draftErr } = await supabaseServer
    .from("google_reviews")
    .select("id,screenshot_path")
    .eq("status", "draft")
    .lt("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .returns<Array<{ id: string; screenshot_path: string }>>();
  if (draftErr) {
    return NextResponse.json({ error: draftErr.message }, { status: 500 });
  }

  let purged = 0;
  for (const row of drafts ?? []) {
    await supabaseServer.storage.from("reviews").remove([row.screenshot_path]).catch(() => undefined);
    const { error: deleteErr } = await supabaseServer
      .from("google_reviews")
      .delete()
      .eq("id", row.id)
      .eq("status", "draft");
    if (!deleteErr) purged += 1;
  }

  return NextResponse.json({ purged });
}
