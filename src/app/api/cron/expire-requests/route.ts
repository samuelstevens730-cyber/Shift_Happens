import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("x-cron-secret");
  const url = new URL(req.url);
  const query = url.searchParams.get("secret");
  const vercelCron = req.headers.get("x-vercel-cron");
  if (secret && (header === secret || query === secret)) return true;
  // Fallback for Vercel Cron (no custom headers supported)
  if (!secret && vercelCron === "1") return true;
  return false;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseServer.rpc("process_expired_requests");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ processed: data ?? 0 });
}
