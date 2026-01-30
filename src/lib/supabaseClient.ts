/**
 * Supabase Browser Client
 *
 * Client-side Supabase instance for use in React components.
 * Uses the anon key which respects Row-Level Security policies.
 * Session is persisted in localStorage and auto-refreshed.
 *
 * Note: detectSessionInUrl=true is required for OAuth and password reset flows
 * to automatically parse tokens from URL fragments.
 */

// src/lib/supabaseClient.ts
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL in env.");
if (!SUPABASE_ANON_KEY) throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY in env.");

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // Let supabase-js pick the right storage in the browser.
    // (Do NOT try to "fake" storage on the server.)
  },
});
