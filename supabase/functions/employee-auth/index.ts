import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { create } from "https://deno.land/x/djwt@v3.0.2/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const JWT_SECRET = Deno.env.get("JWT_SECRET")!;
const PIN_HMAC_SECRET = Deno.env.get("PIN_HMAC_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PBKDF2_ITERATIONS = 150_000;
const PBKDF2_HASH = "SHA-256";
const DERIVED_KEY_BYTES = 32;

async function getPinFingerprint(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(PIN_HMAC_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(pin));
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function base64(bytes: Uint8Array) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(str: string) {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hashPin(pin: string, salt: Uint8Array, iterations: number) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pin),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: PBKDF2_HASH,
    },
    keyMaterial,
    DERIVED_KEY_BYTES * 8
  );
  return new Uint8Array(derivedBits);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function verifyPin(pin: string, stored: string) {
  // format: pbkdf2$iterations$saltBase64$hashBase64
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  const salt = fromBase64(parts[2]);
  const hash = fromBase64(parts[3]);
  if (!Number.isFinite(iterations)) return false;
  const derived = await hashPin(pin, salt, iterations);
  return timingSafeEqual(hash, derived);
}

async function signJwt(payload: Record<string, unknown>, jwkJson: string): Promise<string> {
  let jwk: Record<string, string>;
  try {
    jwk = JSON.parse(jwkJson);
  } catch {
    throw new Error("JWT_SECRET must be a JSON-encoded private JWK string.");
  }
  if (!jwk?.d || !jwk?.x || !jwk?.y || !jwk?.crv) {
    throw new Error("JWT signing key must be a full private JWK (with d, x, y, crv).");
  }
  // Deno's crypto importKey rejects key_ops in some JWKs.
  const { key_ops: _keyOps, use: _use, alg: _alg, ...jwkForImport } = jwk;
  const key = await crypto.subtle.importKey(
    "jwk",
    jwkForImport,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const header: Record<string, string> = { alg: "ES256", typ: "JWT" };
  if (jwk.kid) header.kid = jwk.kid;
  return await create(header, payload, key);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    if (!JWT_SECRET || !PIN_HMAC_SECRET) {
      throw new Error("Missing JWT_SECRET or PIN_HMAC_SECRET in edge function secrets.");
    }
    const { store_id, profile_id, pin }: { store_id: string; profile_id: string; pin: string } = await req.json();

    if (!store_id || !profile_id || !pin || !/^\d{4}$/.test(pin)) {
      return Response.json({ error: "Invalid store_id, profile_id or PIN format" }, { status: 400, headers: corsHeaders });
    }

    const { data: settings, error: settingsError } = await supabase
      .from("store_settings")
      .select("v2_pin_auth_enabled, pin_max_attempts, pin_lockout_minutes")
      .eq("store_id", store_id)
      .single();

    if (settingsError || !settings?.v2_pin_auth_enabled) {
      return Response.json({ error: "PIN auth not enabled for this store" }, { status: 403, headers: corsHeaders });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, pin_hash, pin_locked_until, pin_failed_attempts")
      .eq("id", profile_id)
      .eq("active", true)
      .single();

    if (profileError || !profile || !profile.pin_hash) {
      return Response.json({ error: "Invalid credentials" }, { status: 401, headers: corsHeaders });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("store_memberships")
      .select("store_id")
      .eq("profile_id", profile.id)
      .eq("store_id", store_id)
      .single();

    if (membershipError || !membership) {
      return Response.json({ error: "Invalid credentials" }, { status: 401, headers: corsHeaders });
    }

    if (profile.pin_locked_until && new Date(profile.pin_locked_until) > new Date()) {
      const minutesLeft = Math.ceil(
        (new Date(profile.pin_locked_until).getTime() - Date.now()) / 60000
      );
      return Response.json(
        { error: "Account locked", retry_after_minutes: minutesLeft },
        { status: 429, headers: corsHeaders }
      );
    }

    const validPin = await verifyPin(pin, profile.pin_hash);

    if (!validPin) {
      const { data: updated } = await supabase
        .from("profiles")
        .update({
          pin_failed_attempts: (profile.pin_failed_attempts || 0) + 1
        })
        .eq("id", profile.id)
        .select("pin_failed_attempts")
        .single();

      const attempts = updated?.pin_failed_attempts || 0;
      const maxAttempts = settings.pin_max_attempts || 3;

      if (attempts >= maxAttempts) {
        const lockoutMinutes = settings.pin_lockout_minutes ?? 5;
        const lockedUntil = new Date(Date.now() + lockoutMinutes * 60000).toISOString();

        await supabase
          .from("profiles")
          .update({ pin_locked_until: lockedUntil })
          .eq("id", profile.id);

        return Response.json(
          { error: "Too many failed attempts", locked_for_minutes: lockoutMinutes },
          { status: 429, headers: corsHeaders }
        );
      }

      return Response.json(
        { error: "Invalid credentials", attempts_remaining: maxAttempts - attempts },
        { status: 401, headers: corsHeaders }
      );
    }

    await supabase
      .from("profiles")
      .update({
        pin_failed_attempts: 0,
        pin_locked_until: null
      })
      .eq("id", profile.id);

    const { data: memberships } = await supabase
      .from("store_memberships")
      .select("store_id")
      .eq("profile_id", profile.id);

    const storeIds = memberships?.map(m => m.store_id) || [store_id];

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: profile.id,
      role: "authenticated",
      profile_id: profile.id,
      store_id: store_id,
      store_ids: storeIds,
      iat: now,
      exp: now + (4 * 60 * 60),
    };

    const jwt = await signJwt(payload, JWT_SECRET);

    return Response.json({
      token: jwt,
      expires_in: 14400,
      profile: {
        id: profile.id,
        store_id: store_id,
        stores: storeIds
      }
    }, { headers: corsHeaders });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Auth error:", err);
    return Response.json({ error: "Authentication failed", detail: message }, { status: 500, headers: corsHeaders });
  }
});
