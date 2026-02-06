import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("x-cron-secret");
  return header === secret;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseServer.rpc("send_selection_nudges");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ nudged: data ?? 0 });
}
