/**
 * POST /api/admin/backfill-weather
 *
 * One-time historical weather backfill for shifts that have no weather data.
 * Uses OWM One Call API 3.0 timemachine endpoint — requires OWM One Call 3.0
 * subscription (free tier: 1,000 calls/day).
 *
 * ── Strategy ─────────────────────────────────────────────────────────────────
 * Rather than calling OWM once per shift (expensive), we call once per
 * (store, day) pair at noon UTC on that day, then stamp ALL shifts for that
 * store/day with the same condition and temperature. This means an AM shift,
 * a PM shift, and a double all get the same daily reading — the right tradeoff
 * for a historical backfill where we just need "what was the general weather
 * on this day" rather than exact per-shift accuracy.
 *
 * For 30 days × 2 stores: max 60 OWM calls total — well within the 800-call
 * daily safety cap.
 *
 * ── Rate-limiting ─────────────────────────────────────────────────────────────
 * The client drives pagination, sending one HTTP request per BATCH of
 * (store, day) groups. Each batch fires OWM calls concurrently then returns.
 * This keeps every individual Vercel function invocation well under 10 seconds.
 * callsUsedSoFar is accumulated by the client across batches and passed in
 * so this route can self-stop before hitting MAX_DAILY_CALLS.
 *
 * Auth:   Bearer token, manager-scoped.
 * Body:   { daysBack: number, offset: number, callsUsedSoFar: number }
 * Returns { processed, updated, failed, callsUsed, total, done, nextOffset, capped }
 */

import { NextResponse } from "next/server";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";
import { supabaseServer } from "@/lib/supabaseServer";
import { fetchHistoricalWeather } from "@/lib/weatherClient";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * (Store, day) groups processed per route invocation.
 * Each group = 1 OWM call fired concurrently.
 * At 4 s timeout each: worst-case ~4 s per batch — safe within 10 s Vercel limit.
 */
const BATCH_SIZE = 8;

/**
 * Hard ceiling on total OWM calls across the entire backfill run.
 * Free tier = 1,000/day; we cap at 800 to leave 200 for regular clock-in/out.
 */
const MAX_DAILY_CALLS = 800;

// ─── Types ────────────────────────────────────────────────────────────────────

interface BackfillBody {
  /** Calendar days back to scan (1–90) */
  daysBack: number;
  /** Pagination offset over (store, day) groups (0 on first call) */
  offset: number;
  /** OWM calls already used this run (from previous batches) */
  callsUsedSoFar: number;
}

interface BackfillShiftRow {
  id: string;
  store_id: string;
  started_at: string;
  ended_at: string | null;
  start_weather_condition: string | null;
  start_weather_desc:      string | null;
  end_weather_condition: string | null;
  end_weather_desc:      string | null;
}

interface BackfillStoreRow {
  id: string;
  latitude: number | null;
  longitude: number | null;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    // ── Auth ─────────────────────────────────────────────────────────────────
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const {
      data: { user },
      error: authErr,
    } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (managerStoreIds.length === 0) {
      return NextResponse.json({ error: "No stores in scope." }, { status: 403 });
    }

    // ── Body ─────────────────────────────────────────────────────────────────
    let body: BackfillBody;
    try {
      body = (await req.json()) as BackfillBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const daysBack        = Math.min(90, Math.max(1, Math.round(body.daysBack ?? 30)));
    const offset          = Math.max(0, Math.round(body.offset ?? 0));
    const callsUsedSoFar  = Math.max(0, Math.round(body.callsUsedSoFar ?? 0));

    // ── Guard: already at cap ─────────────────────────────────────────────────
    if (callsUsedSoFar >= MAX_DAILY_CALLS) {
      return NextResponse.json({
        processed: 0, updated: 0, failed: 0, callsUsed: 0,
        total: 0, done: false, nextOffset: offset, capped: true,
      });
    }

    // ── Date window ───────────────────────────────────────────────────────────
    const since = new Date();
    since.setDate(since.getDate() - daysBack);
    const sinceISO = since.toISOString();

    // ── Fetch all shifts in window ────────────────────────────────────────────
    const { data: allShifts, error: shiftsErr } = await supabaseServer
      .from("shifts")
      .select(
        "id,store_id,started_at,ended_at,start_weather_condition,start_weather_desc,end_weather_condition,end_weather_desc"
      )
      .in("store_id", managerStoreIds)
      .gte("started_at", sinceISO)
      .neq("last_action", "removed")
      .not("started_at", "is", null)
      .order("started_at", { ascending: true })
      .returns<BackfillShiftRow[]>();

    if (shiftsErr) {
      return NextResponse.json({ error: shiftsErr.message }, { status: 500 });
    }

    // ── Group shifts by (store_id, date) ─────────────────────────────────────
    // A shift "needs fill" if any weather field is missing.
    // We use the UTC date of started_at as the day key.
    // A shift needs fill if any weather field (condition OR desc) is missing.
    const needsFill = (s: BackfillShiftRow) =>
      s.start_weather_condition == null || s.start_weather_desc == null ||
      (s.ended_at != null && (s.end_weather_condition == null || s.end_weather_desc == null));

    // Build ordered list of unique (store, date) groups that contain at least
    // one shift needing fill.
    type GroupKey = string; // "storeId::YYYY-MM-DD"
    const groupMap = new Map<GroupKey, BackfillShiftRow[]>();

    for (const shift of allShifts ?? []) {
      if (!needsFill(shift)) continue;
      const dateStr = shift.started_at.slice(0, 10); // YYYY-MM-DD UTC
      const key: GroupKey = `${shift.store_id}::${dateStr}`;
      const arr = groupMap.get(key) ?? [];
      arr.push(shift);
      groupMap.set(key, arr);
    }

    const allGroups = Array.from(groupMap.entries()); // [key, shifts[]]
    const total = allGroups.length;

    // Apply pagination.
    const batch = allGroups.slice(offset, offset + BATCH_SIZE);

    if (batch.length === 0) {
      return NextResponse.json({
        processed: 0, updated: 0, failed: 0, callsUsed: 0,
        total, done: true, nextOffset: offset, capped: false,
      });
    }

    // ── Fetch store coordinates ───────────────────────────────────────────────
    const { data: storeRows, error: storeErr } = await supabaseServer
      .from("stores")
      .select("id,latitude,longitude")
      .in("id", managerStoreIds)
      .returns<BackfillStoreRow[]>();

    if (storeErr) {
      return NextResponse.json({ error: storeErr.message }, { status: 500 });
    }

    const coordsMap = new Map(
      (storeRows ?? [])
        .filter(s => s.latitude != null && s.longitude != null)
        .map(s => [s.id, { lat: s.latitude as number, lon: s.longitude as number }])
    );

    // ── Process batch concurrently ────────────────────────────────────────────
    let batchCallsUsed = 0;
    let updated = 0;
    let failed = 0;

    const budgetRemaining = MAX_DAILY_CALLS - callsUsedSoFar;

    await Promise.all(
      batch.map(async ([key, shifts]) => {
        const [storeId, dateStr] = key.split("::");
        const coords = coordsMap.get(storeId);

        if (!coords) {
          // No coordinates configured for this store.
          failed += shifts.length;
          return;
        }

        if (batchCallsUsed >= budgetRemaining) {
          // Hit the call budget inside this batch — skip.
          failed += shifts.length;
          return;
        }

        // One OWM call at noon UTC on this day.
        batchCallsUsed++;
        const noonUnix = Math.floor(new Date(`${dateStr}T12:00:00.000Z`).getTime() / 1000);
        const snap = await fetchHistoricalWeather(coords.lat, coords.lon, noonUnix);

        if (!snap) {
          // OWM returned null (API error, key lacks 3.0 access, date out of range, etc.)
          failed += shifts.length;
          return;
        }

        // Stamp ALL shifts for this store/day with the daily condition.
        // Each shift gets: start condition + desc + temp, end condition + desc + temp (same reading).
        for (const shift of shifts) {
          const updates: Record<string, string | number | null> = {};

          if (shift.start_weather_condition == null || shift.start_weather_desc == null) {
            updates.start_weather_condition = snap.condition;
            updates.start_weather_desc      = snap.description;
            updates.start_temp_f            = snap.tempF;
          }
          if (shift.ended_at != null && (shift.end_weather_condition == null || shift.end_weather_desc == null)) {
            updates.end_weather_condition = snap.condition;
            updates.end_weather_desc      = snap.description;
            updates.end_temp_f            = snap.tempF;
          }

          if (Object.keys(updates).length > 0) {
            const { error: updateErr } = await supabaseServer
              .from("shifts")
              .update(updates)
              .eq("id", shift.id);

            if (updateErr) {
              console.warn(`[backfill-weather] Failed to update shift ${shift.id}:`, updateErr.message);
              failed++;
            } else {
              updated++;
            }
          }
        }
      })
    );

    const nextOffset = offset + batch.length;
    const doneAfterBatch = nextOffset >= total;
    const capped = (callsUsedSoFar + batchCallsUsed) >= MAX_DAILY_CALLS && !doneAfterBatch;

    return NextResponse.json({
      processed: batch.length,   // (store, day) groups processed
      updated,                    // individual shift rows updated
      failed,                     // shifts skipped (no coords, OWM failure, or budget)
      callsUsed: batchCallsUsed,  // OWM calls made in this batch
      total,                      // total (store, day) groups needing fill
      done: doneAfterBatch,
      nextOffset,
      capped,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Backfill failed." },
      { status: 500 }
    );
  }
}
