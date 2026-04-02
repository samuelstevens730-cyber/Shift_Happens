import { NextResponse } from "next/server";
import { authenticateShiftRequest, validateProfileAccess, validateStoreAccess } from "@/lib/shiftAuth";
import { supabaseServer } from "@/lib/supabaseServer";
import { fetchForecast3Hour } from "@/lib/weatherClient";

type ShiftType = "open" | "close" | "double" | "other";

type ThermostatMode = "heat" | "cool";

function isShiftType(value: string | null): value is ShiftType {
  return value === "open" || value === "close" || value === "double" || value === "other";
}

function parseIso(value: string | null): Date | null {
  if (!value) return null;
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function addDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function cstDow(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
  }).formatToParts(date);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[weekday ?? "Sun"] ?? 0;
}

function cstDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function buildCstDateTime(dateKey: string, timeValue: string): Date | null {
  const match = timeValue.match(/^(\d{2}):(\d{2})/);
  if (!match) return null;
  const [year, month, day] = dateKey.split("-").map(Number);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;

  const provisionalUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  const offsetParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    timeZoneName: "shortOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(provisionalUtc);
  const tz = offsetParts.find((p) => p.type === "timeZoneName")?.value ?? "";
  const offsetMatch = tz.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/i);
  if (!offsetMatch) return null;
  const offsetHours = Number(offsetMatch[1]);
  const offsetMinutes = Number(offsetMatch[2] || "0");
  const totalOffsetMinutes = offsetHours * 60 + (offsetHours < 0 ? -offsetMinutes : offsetMinutes);
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0) - totalOffsetMinutes * 60_000);
}

async function resolveNextOpenAt(storeId: string, after: Date): Promise<Date | null> {
  const afterTime = after.getTime();
  for (let dayOffset = 0; dayOffset <= 2; dayOffset += 1) {
    const candidateDay = addDays(after, dayOffset);
    const dayOfWeek = cstDow(candidateDay);
    const dateKey = cstDateKey(candidateDay);

    const { data, error } = await supabaseServer
      .from("shift_templates")
      .select("start_time")
      .eq("store_id", storeId)
      .eq("day_of_week", dayOfWeek)
      .eq("shift_type", "open")
      .order("start_time", { ascending: true })
      .limit(1)
      .maybeSingle<{ start_time: string }>();

    if (error) throw new Error(error.message);
    if (!data?.start_time) continue;

    const openAt = buildCstDateTime(dateKey, data.start_time);
    if (openAt && openAt.getTime() > afterTime) {
      return openAt;
    }
  }
  return null;
}

export async function GET(req: Request) {
  try {
    const authResult = await authenticateShiftRequest(req);
    if (!authResult.ok) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    const auth = authResult.auth;

    const url = new URL(req.url);
    const shiftId = (url.searchParams.get("shiftId") ?? "").trim();
    const endAtInput = (url.searchParams.get("endAt") ?? "").trim();

    if (!shiftId) {
      return NextResponse.json({ error: "Missing shiftId." }, { status: 400 });
    }

    const { data: shift, error: shiftErr } = await supabaseServer
      .from("shifts")
      .select("id, store_id, profile_id, shift_type")
      .eq("id", shiftId)
      .maybeSingle<{ id: string; store_id: string; profile_id: string; shift_type: string | null }>();

    if (shiftErr) return NextResponse.json({ error: shiftErr.message }, { status: 500 });
    if (!shift) return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    if (!isShiftType(shift.shift_type)) {
      return NextResponse.json({ error: "Invalid shift type." }, { status: 400 });
    }

    if (!validateStoreAccess(auth, shift.store_id)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
    const profileCheck = validateProfileAccess(auth, shift.profile_id);
    if (!profileCheck.ok) {
      return NextResponse.json({ error: profileCheck.error }, { status: 403 });
    }

    if (shift.shift_type !== "close" && shift.shift_type !== "double") {
      return NextResponse.json({ applicable: false });
    }

    const { data: store, error: storeErr } = await supabaseServer
      .from("stores")
      .select("id, latitude, longitude")
      .eq("id", shift.store_id)
      .maybeSingle<{ id: string; latitude: number | null; longitude: number | null }>();

    if (storeErr) return NextResponse.json({ error: storeErr.message }, { status: 500 });
    if (!store) return NextResponse.json({ error: "Store not found." }, { status: 404 });
    if (store.latitude == null || store.longitude == null) {
      return NextResponse.json({
        applicable: true,
        available: false,
        message: "Before leaving, set the thermostat to 70F on cool if tomorrow will be warm, or 70F on heat if tomorrow will be cool.",
      });
    }

    const endAt = parseIso(endAtInput) ?? new Date();
    const nextOpenAt = await resolveNextOpenAt(shift.store_id, endAt);
    if (!nextOpenAt) {
      return NextResponse.json({
        applicable: true,
        available: false,
        message: "Before leaving, set the thermostat to 70F on cool if tomorrow will be warm, or 70F on heat if tomorrow will be cool.",
      });
    }

    const forecast = await fetchForecast3Hour(store.latitude, store.longitude);
    if (!forecast || forecast.length === 0) {
      return NextResponse.json({
        applicable: true,
        available: false,
        message: "Before leaving, check tomorrow's conditions and set the thermostat to 70F on cool if the day will be warm, or 70F on heat if it will be cool.",
      });
    }

    const startUnix = Math.floor(endAt.getTime() / 1000);
    const endUnix = Math.floor(nextOpenAt.getTime() / 1000);
    const windowPoints = forecast.filter((point) => point.unixTime >= startUnix && point.unixTime <= endUnix);
    const relevantPoints = windowPoints.length > 0
      ? windowPoints
      : forecast.filter((point) => point.unixTime >= startUnix).slice(0, 4);

    if (relevantPoints.length === 0) {
      return NextResponse.json({
        applicable: true,
        available: false,
        message: "Before leaving, check tomorrow's conditions and set the thermostat to 70F on cool if the day will be warm, or 70F on heat if it will be cool.",
      });
    }

    const overnightLow = relevantPoints.reduce((min, point) => Math.min(min, point.tempF), relevantPoints[0]!.tempF);
    const recommendedMode: ThermostatMode = overnightLow > 70 ? "cool" : "heat";

    return NextResponse.json({
      applicable: true,
      available: true,
      overnightLowF: overnightLow,
      nextOpenAt: nextOpenAt.toISOString(),
      recommendedMode,
      setPointF: 70,
      message:
        recommendedMode === "cool"
          ? `Overnight forecast stays warm (low ${overnightLow}F). Before leaving, set the thermostat to 70F on cool.`
          : `Overnight forecast gets cool (low ${overnightLow}F). Before leaving, set the thermostat to 70F on heat.`,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load thermostat guidance." },
      { status: 500 }
    );
  }
}
