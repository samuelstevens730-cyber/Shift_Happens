import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.94.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PIN_HMAC_SECRET = Deno.env.get("PIN_HMAC_SECRET")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const PBKDF2_ITERATIONS = 150_000;
const PBKDF2_HASH = "SHA-256";
const DERIVED_KEY_BYTES = 32;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

async function hashPin(pin: string, salt?: Uint8Array) {
  const encoder = new TextEncoder();
  const saltBytes = salt ?? crypto.getRandomValues(new Uint8Array(16));
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
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH,
    },
    keyMaterial,
    DERIVED_KEY_BYTES * 8
  );
  const hashBytes = new Uint8Array(derivedBits);
  const encodedSalt = base64(saltBytes);
  const encodedHash = base64(hashBytes);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${encodedSalt}$${encodedHash}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : null;
    if (!token) {
      return Response.json({ error: "Authentication required" }, { status: 401, headers: corsHeaders });
    }

    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData?.user) {
      return Response.json({ error: "Invalid session" }, { status: 401, headers: corsHeaders });
    }

    const { data: managerRow, error: managerErr } = await supabase
      .from("app_users")
      .select("role")
      .eq("id", authData.user.id)
      .maybeSingle();
    if (managerErr) {
      return Response.json({ error: managerErr.message }, { status: 500, headers: corsHeaders });
    }
    if (!managerRow || managerRow.role !== "manager") {
      return Response.json({ error: "Not authorized" }, { status: 403, headers: corsHeaders });
    }

    const { profile_id, pin }: { profile_id: string; pin: string } = await req.json();

    if (!profile_id || !pin || !/^\d{4}$/.test(pin)) {
      return Response.json({ error: "Invalid profile_id or PIN format" }, { status: 400, headers: corsHeaders });
    }

    const { data: profileStores, error: profileStoreErr } = await supabase
      .from("store_memberships")
      .select("store_id")
      .eq("profile_id", profile_id);
    if (profileStoreErr) {
      return Response.json({ error: profileStoreErr.message }, { status: 500, headers: corsHeaders });
    }

    const { data: managerStores, error: managerStoreErr } = await supabase
      .from("store_managers")
      .select("store_id")
      .eq("user_id", authData.user.id);
    if (managerStoreErr) {
      return Response.json({ error: managerStoreErr.message }, { status: 500, headers: corsHeaders });
    }

    const profileStoreIds = new Set((profileStores ?? []).map(s => s.store_id));
    const managerStoreIds = (managerStores ?? []).map(s => s.store_id);
    const hasAccess = managerStoreIds.some(id => profileStoreIds.has(id));
    if (!hasAccess) {
      return Response.json({ error: "Not authorized" }, { status: 403, headers: corsHeaders });
    }

    const pinFingerprint = await getPinFingerprint(pin);
    const pinHash = await hashPin(pin);

    const { error } = await supabase
      .from("profiles")
      .update({
        pin_hash: pinHash,
        pin_fingerprint: pinFingerprint,
        pin_failed_attempts: 0,
        pin_locked_until: null,
      })
      .eq("id", profile_id);

    if (error) {
      return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
    }

    return Response.json({ ok: true }, { headers: corsHeaders });
  } catch (err) {
    console.error("set-pin error:", err);
    return Response.json({ error: "Server error" }, { status: 500, headers: corsHeaders });
  }
});
