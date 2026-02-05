/**
 * Shift Auth - Dual authentication for clock-in/clock-out endpoints
 *
 * Supports two authentication methods:
 * 1. Employee PIN JWT - Custom JWTs issued by employee-auth edge function
 * 2. Manager Supabase Auth - Standard Supabase access tokens for managers
 *
 * The resolved auth context includes profile_id and store access info.
 * Managers can only clock in for themselves (profile linked via auth_user_id).
 * Employees can clock in at any store they have membership for.
 */

import { jwtVerify, importJWK, JWTPayload } from "jose";
import { supabaseServer } from "./supabaseServer";

// Public key for verifying employee PIN JWTs (ES256)
// This should match the private key in JWT_SECRET env var on edge functions
const JWT_PUBLIC_KEY = process.env.JWT_PUBLIC_KEY;
const DEBUG_AUTH = process.env.DEBUG_AUTH === "1";

export type AuthType = "employee" | "manager";

export type AuthContext = {
  authType: AuthType;
  profileId: string;
  storeIds: string[];
  authUserId?: string; // Only for manager auth
};

export type AuthResult =
  | { ok: true; auth: AuthContext }
  | { ok: false; error: string; status: number };

/**
 * Extract Bearer token from Authorization header
 */
function getBearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  return token && token !== "null" && token !== "undefined" ? token : null;
}

/**
 * Verify employee PIN JWT and extract claims
 */
async function verifyEmployeeJwt(
  token: string
): Promise<{ ok: true; payload: JWTPayload } | { ok: false; error: string }> {
  if (!JWT_PUBLIC_KEY) {
    console.error("JWT_PUBLIC_KEY not configured");
    return { ok: false, error: "Server configuration error" };
  }

  try {
    const jwk = JSON.parse(JWT_PUBLIC_KEY);
    // Remove private key component if accidentally included
    const { d: _d, ...publicJwk } = jwk;
    const key = await importJWK(publicJwk, "ES256");
    const { payload } = await jwtVerify(token, key);
    return { ok: true, payload };
  } catch (err) {
    console.error("Employee JWT verification failed:", err);
    if (DEBUG_AUTH) {
      const name = err instanceof Error ? err.name : "Error";
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Invalid or expired token (${name}: ${message})` };
    }
    return { ok: false, error: "Invalid or expired token" };
  }
}

/**
 * Verify Supabase auth token and resolve manager's profile
 */
async function verifyManagerAuth(
  token: string
): Promise<AuthResult> {
  // Verify token with Supabase
  const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) {
    return { ok: false, error: "Invalid session", status: 401 };
  }

  // Look up manager's profile via auth_user_id
  const { data: profile, error: profileErr } = await supabaseServer
    .from("profiles")
    .select("id, active")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (profileErr) {
    console.error("Profile lookup error:", profileErr);
    return { ok: false, error: "Profile lookup failed", status: 500 };
  }

  if (!profile) {
    return {
      ok: false,
      error: "No employee profile linked to this account. Contact admin to link your profile.",
      status: 403,
    };
  }

  if (profile.active === false) {
    return { ok: false, error: "Profile is inactive", status: 403 };
  }

  // Get stores this manager manages
  const { data: managerStores, error: storeErr } = await supabaseServer
    .from("store_managers")
    .select("store_id")
    .eq("user_id", user.id);

  if (storeErr) {
    console.error("Store manager lookup error:", storeErr);
    return { ok: false, error: "Store access lookup failed", status: 500 };
  }

  const storeIds = (managerStores ?? []).map((s) => s.store_id);

  if (storeIds.length === 0) {
    return {
      ok: false,
      error: "You are not assigned as manager to any stores",
      status: 403,
    };
  }

  return {
    ok: true,
    auth: {
      authType: "manager",
      profileId: profile.id,
      storeIds,
      authUserId: user.id,
    },
  };
}

/**
 * Authenticate a shift request using either employee PIN JWT or manager Supabase auth.
 *
 * Tries employee JWT first (starts with "ey"), then falls back to Supabase auth.
 */
export async function authenticateShiftRequest(req: Request): Promise<AuthResult> {
  const token = getBearerToken(req);

  if (!token) {
    return { ok: false, error: "Missing authorization token", status: 401 };
  }

  // Employee JWTs are JWTs (start with "ey" for base64 JSON header)
  // Supabase access tokens also start with "ey" but we can differentiate
  // by trying employee JWT verification first (it will fail for Supabase tokens)

  // Try employee PIN JWT first
  const employeeResult = await verifyEmployeeJwt(token);

  if (employeeResult.ok) {
    const payload = employeeResult.payload;
    const profileId = payload.profile_id as string | undefined;
    const storeIds = payload.store_ids as string[] | undefined;
    const storeId = payload.store_id as string | undefined;

    if (!profileId) {
      return { ok: false, error: "Invalid token: missing profile_id", status: 401 };
    }

    return {
      ok: true,
      auth: {
        authType: "employee",
        profileId,
        storeIds: storeIds ?? (storeId ? [storeId] : []),
      },
    };
  }

  // Employee JWT failed, try Supabase manager auth
  const managerResult = await verifyManagerAuth(token);
  if (!managerResult.ok && DEBUG_AUTH) {
    return {
      ok: false,
      status: managerResult.status,
      error: `${managerResult.error} (employeeJWT: ${employeeResult.error})`,
    };
  }
  return managerResult;
}

/**
 * Validate that the authenticated user can clock in/out at the specified store.
 */
export function validateStoreAccess(auth: AuthContext, storeId: string): boolean {
  return auth.storeIds.includes(storeId);
}

/**
 * Validate that the profileId in request matches authenticated profile.
 * For employees: must match exactly
 * For managers: must match (managers can only clock themselves in)
 */
export function validateProfileAccess(
  auth: AuthContext,
  requestedProfileId: string
): { ok: true } | { ok: false; error: string } {
  if (auth.profileId !== requestedProfileId) {
    return {
      ok: false,
      error: auth.authType === "manager"
        ? "Managers can only clock in/out for themselves via this endpoint"
        : "Profile ID does not match authenticated user",
    };
  }
  return { ok: true };
}
