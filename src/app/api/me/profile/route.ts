/**
 * GET /api/me/profile - Get authenticated user's employee profile
 *
 * Returns the employee profile linked to the authenticated Supabase user.
 * Used by managers to get their own profileId for clock-in without PIN.
 *
 * Authentication: Bearer token required (Supabase access token)
 *
 * Returns:
 * - Success: { profileId: string, name: string, storeIds: string[] }
 * - Error: { error: string }
 *
 * Business logic:
 * - Verifies Supabase auth token
 * - Looks up profile via profiles.auth_user_id
 * - Returns stores the user manages (from store_managers)
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function getBearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  return token && token !== "null" && token !== "undefined" ? token : null;
}

export async function GET(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ error: "Missing authorization token" }, { status: 401 });
    }

    // Verify Supabase auth token
    const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) {
      return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
    }

    // Look up profile linked to this auth user
    const { data: profile, error: profileErr } = await supabaseServer
      .from("profiles")
      .select("id, name, active")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (profileErr) {
      console.error("Profile lookup error:", profileErr);
      return NextResponse.json({ error: "Profile lookup failed" }, { status: 500 });
    }

    if (!profile) {
      return NextResponse.json(
        { error: "No employee profile linked to this account. Contact admin to link your profile." },
        { status: 404 }
      );
    }

    if (profile.active === false) {
      return NextResponse.json({ error: "Profile is inactive" }, { status: 403 });
    }

    // Get stores this user manages
    const { data: managerStores, error: storeErr } = await supabaseServer
      .from("store_managers")
      .select("store_id")
      .eq("user_id", user.id);

    if (storeErr) {
      console.error("Store manager lookup error:", storeErr);
      return NextResponse.json({ error: "Store access lookup failed" }, { status: 500 });
    }

    const storeIds = (managerStores ?? []).map((s) => s.store_id);

    return NextResponse.json({
      profileId: profile.id,
      name: profile.name,
      storeIds,
    });
  } catch (e: unknown) {
    console.error("Profile lookup error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to get profile" },
      { status: 500 }
    );
  }
}
