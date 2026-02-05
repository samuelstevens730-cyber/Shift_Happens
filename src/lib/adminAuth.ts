/**
 * Admin Authentication Helpers
 *
 * Shared utilities for admin API route authentication.
 * Extracted to reduce duplication across ~10 admin route files.
 */
import { supabaseServer } from "@/lib/supabaseServer";

/**
 * Extract Bearer token from Authorization header.
 * @param req - The incoming request
 * @returns The token string, or null if header is missing/invalid
 */
export function getBearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  return auth.slice(7);
}

/**
 * Get store IDs where the user is a manager.
 * @param userId - The authenticated user's ID
 * @returns Array of store ID strings
 * @throws Error if database query fails
 */
export async function getManagerStoreIds(userId: string): Promise<string[]> {
  const { data, error } = await supabaseServer
    .from("store_managers")
    .select("store_id")
    .eq("user_id", userId)
    .returns<{ store_id: string }[]>();
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => r.store_id);
}
