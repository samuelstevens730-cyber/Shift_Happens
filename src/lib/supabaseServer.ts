/**
 * Supabase Server Client
 *
 * Server-side Supabase instance using service role key.
 * BYPASSES Row-Level Security - use only in API routes for admin operations.
 * Session persistence disabled since this runs in stateless API contexts.
 *
 * Security: Never expose SUPABASE_SERVICE_ROLE_KEY to the client.
 */

// src/lib/supabaseServer.ts
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL.");
if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");

export const supabaseServer = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
