/**
 * weatherClient.ts
 *
 * Server-side OpenWeatherMap API wrapper.
 *
 * Usage:
 *   import { fetchCurrentWeather } from "@/lib/weatherClient";
 *   const snap = await fetchCurrentWeather(32.529184, -94.787952);
 *   // snap = { condition: "Clear", tempF: 72 } | null
 *
 * Design constraints:
 *   - NEVER throws — always returns null on any error.
 *   - Never blocks clock-in/out on failure. Callers should fire-and-forget or
 *     wrap with their own try/catch.
 *   - Server-side only. Uses OPENWEATHERMAP_API_KEY (no NEXT_PUBLIC_ prefix).
 */

export interface WeatherSnapshot {
  /** Human-readable condition string, e.g. "Clear", "Rain", "Thunderstorm" */
  condition: string;
  /**
   * Detailed description, e.g. "clear sky", "heavy intensity rain", "overcast clouds".
   * Source: OWM weather[0].description (title-cased for display consistency).
   */
  description: string;
  /** Temperature in °F, rounded to nearest integer */
  tempF: number;
}

/** OWM /data/2.5/weather response shape (partial — only fields we use) */
interface OWMCurrentResponse {
  weather: Array<{ main: string; description: string }>;
  main: { temp: number };
}

/**
 * OWM One Call API 3.0 /timemachine response shape (partial).
 * Requires OWM One Call API 3.0 subscription (free tier: 1,000 calls/day).
 */
interface OWMTimemachineResponse {
  data: Array<{
    dt: number;
    temp: number;
    weather: Array<{ main: string; description: string }>;
  }>;
}

/**
 * Fetches current weather conditions for the given coordinates.
 *
 * @param lat - Latitude (WGS-84)
 * @param lon - Longitude (WGS-84)
 * @returns WeatherSnapshot or null if the call fails for any reason
 */
export async function fetchCurrentWeather(
  lat: number,
  lon: number
): Promise<WeatherSnapshot | null> {
  const apiKey = process.env.OPENWEATHERMAP_API_KEY;
  if (!apiKey) {
    console.error("[weatherClient] OPENWEATHERMAP_API_KEY is not set. Weather capture disabled.");
    return null;
  }

  const url =
    `https://api.openweathermap.org/data/2.5/weather` +
    `?lat=${lat}&lon=${lon}&units=imperial&appid=${apiKey}`;

  try {
    const res = await fetch(url, {
      // 5-second hard timeout — never block clock-in/out for more than this
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });

    if (!res.ok) {
      console.warn(
        `[weatherClient] OWM responded ${res.status} for (${lat}, ${lon}). Weather not captured.`
      );
      return null;
    }

    const data: OWMCurrentResponse = await res.json();

    const condition    = data.weather?.[0]?.main ?? null;
    const description  = data.weather?.[0]?.description ?? null;
    const tempRaw      = data.main?.temp ?? null;

    if (condition == null || tempRaw == null) {
      console.warn("[weatherClient] OWM response missing expected fields.", data);
      return null;
    }

    return {
      condition:   toTitleCase(condition),
      description: toTitleCase(description ?? condition),
      tempF:       Math.round(tempRaw),
    };
  } catch (err) {
    // AbortError (timeout) or network failure — log and return null
    console.warn("[weatherClient] Weather fetch failed (non-fatal):", err);
    return null;
  }
}

/**
 * Fetches historical weather conditions using OWM One Call API 3.0 (timemachine).
 *
 * IMPORTANT: Requires OWM One Call API 3.0 subscription. The free tier includes
 * 1,000 calls/day. This function uses the same OPENWEATHERMAP_API_KEY as
 * fetchCurrentWeather — verify your key has One Call 3.0 access.
 *
 * @param lat           - Latitude (WGS-84)
 * @param lon           - Longitude (WGS-84)
 * @param unixTimestamp - Unix epoch seconds for the target historical moment
 * @returns WeatherSnapshot or null if the call fails for any reason
 */
export async function fetchHistoricalWeather(
  lat: number,
  lon: number,
  unixTimestamp: number
): Promise<WeatherSnapshot | null> {
  const apiKey = process.env.OPENWEATHERMAP_API_KEY;
  if (!apiKey) {
    console.error("[weatherClient] OPENWEATHERMAP_API_KEY is not set. Historical fetch skipped.");
    return null;
  }

  const url =
    `https://api.openweathermap.org/data/3.0/onecall/timemachine` +
    `?lat=${lat}&lon=${lon}&dt=${unixTimestamp}&units=imperial&appid=${apiKey}`;

  try {
    const res = await fetch(url, {
      // 4-second timeout — backfill must not stall Vercel's function window
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });

    if (!res.ok) {
      console.warn(
        `[weatherClient] OWM timemachine responded ${res.status} for ts=${unixTimestamp}. ` +
        `(401 = key lacks One Call 3.0 access; 400 = timestamp out of plan range)`
      );
      return null;
    }

    const data: OWMTimemachineResponse = await res.json();
    const entry = data.data?.[0];
    if (!entry) return null;

    const condition   = entry.weather?.[0]?.main ?? null;
    const description = entry.weather?.[0]?.description ?? null;
    const tempRaw     = entry.temp ?? null;

    if (condition == null || tempRaw == null) {
      console.warn("[weatherClient] OWM timemachine response missing fields.", entry);
      return null;
    }

    return {
      condition:   toTitleCase(condition),
      description: toTitleCase(description ?? condition),
      tempF:       Math.round(tempRaw),
    };
  } catch (err) {
    console.warn("[weatherClient] Historical weather fetch failed (non-fatal):", err);
    return null;
  }
}

/** Converts "thunderstorm" → "Thunderstorm", "CLEAR" → "Clear", etc. */
function toTitleCase(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
