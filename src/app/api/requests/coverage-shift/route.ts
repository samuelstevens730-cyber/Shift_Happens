// src/app/api/requests/coverage-shift/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { authenticateShiftRequest, validateStoreAccess } from "@/lib/shiftAuth";
import { createStoreNotification } from "@/lib/notifications";
import { submitCoverageShiftSchema } from "@/schemas/requests";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";

const CHICAGO = "America/Chicago";

/**
 * Convert a Chicago wall-clock date+time to a UTC ISO string.
 * Uses Intl to determine the actual UTC offset for the given local time,
 * so DST is handled automatically (CST = -06:00, CDT = -05:00).
 */
function chicagoToUtcIso(date: string, time: string): string {
  // Parse the Chicago wall-clock instant as if it were UTC, then correct for offset.
  // Strategy: treat the string as UTC to get a candidate timestamp, then use
  // Intl to find what Chicago time that UTC maps to, compute the delta, and adjust.
  const candidate = new Date(`${date}T${time}:00Z`);

  // Find the Chicago wall-clock time that candidate maps to
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHICAGO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(candidate);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);

  // Chicago wall-clock for the candidate UTC instant
  const chicagoYear   = get("year");
  const chicagoMonth  = get("month") - 1;
  const chicagoDay    = get("day");
  const chicagoHour   = get("hour") % 24; // "24" can appear with hour12:false at midnight
  const chicagoMinute = get("minute");
  const chicagoSecond = get("second");

  // Reconstruct the Chicago wall-clock as a UTC timestamp (purely numeric comparison)
  const chicagoAsUtc = Date.UTC(
    chicagoYear, chicagoMonth, chicagoDay,
    chicagoHour, chicagoMinute, chicagoSecond
  );

  // The offset (ms) between Chicago local and UTC for this instant
  const offsetMs = candidate.getTime() - chicagoAsUtc;

  // Desired Chicago wall-clock time as a UTC-naive timestamp
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi]    = time.split(":").map(Number);
  const wallMs = Date.UTC(y, mo - 1, d, h, mi, 0);

  // Apply offset to get the actual UTC instant
  return new Date(wallMs + offsetMs).toISOString();
}

export async function POST(req: Request) {
  const authResult = await authenticateShiftRequest(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }
  const { profileId } = authResult.auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = submitCoverageShiftSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  }

  const { coverageStoreId, shiftDate, timeIn, timeOut, notes } = parsed.data;
  if (!validateStoreAccess(authResult.auth, coverageStoreId)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  // Convert Chicago wall-clock times to UTC instants
  const timeInUtc  = chicagoToUtcIso(shiftDate, timeIn);
  const timeOutUtc = chicagoToUtcIso(shiftDate, timeOut);

  if (new Date(timeOutUtc) <= new Date(timeInUtc)) {
    return NextResponse.json({ error: "Time out must be after time in" }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from("coverage_shift_requests")
    .insert({
      profile_id:        profileId,
      coverage_store_id: coverageStoreId,
      shift_date:        shiftDate,
      time_in:           timeInUtc,
      time_out:          timeOutUtc,
      notes:             notes ?? null,
      status:            "pending",
    })
    .select("id")
    .single();

  if (error) {
    console.error("Coverage shift insert error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const created = await createStoreNotification({
    storeId: coverageStoreId,
    notificationType: "coverage_pending_approval",
    priority: "high",
    title: "Coverage request needs approval",
    body: "An employee has requested coverage for a shift.",
    entityType: "coverage_shift_request",
    entityId: data.id,
    createdBy: authResult.auth.authType === "manager" ? authResult.auth.authUserId : undefined,
  });

  if (!created) {
    console.error("Failed to create coverage pending approval notification.", { requestId: data.id });
  }

  return NextResponse.json({ requestId: data.id }, { status: 201 });
}

export async function GET(req: Request) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const managerStoreIds = await getManagerStoreIds(user.id);
  if (managerStoreIds.length === 0) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabaseServer
    .from("coverage_shift_requests")
    .select(`
      id, shift_date, time_in, time_out, notes, status, denial_reason, created_at,
      profiles ( name ),
      coverage_store:stores ( name )
    `)
    .in("coverage_store_id", managerStoreIds)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("Coverage shift list error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ requests: data ?? [] });
}
