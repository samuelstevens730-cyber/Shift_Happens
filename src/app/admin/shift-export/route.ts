// src/app/api/admin/shift-export/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || "";
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";

  const adminKey = process.env.ADMIN_DASH_KEY || "";
  if (!adminKey || key !== adminKey) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!from || !to) return NextResponse.json({ error: "Missing from/to." }, { status: 400 });

  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return NextResponse.json({ error: "Invalid from/to date." }, { status: 400 });
  }

  // inclusive range on ended_at/started_at depends on how you want payroll.
  // v1: include shifts whose started_at is within range.
  const { data, error } = await supabaseServer
    .from("shift_export")
    .select("*")
    .gte("started_at", fromDate.toISOString())
    .lte("started_at", toDate.toISOString())
    .order("started_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ rows: data ?? [] });
}
