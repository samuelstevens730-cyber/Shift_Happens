// src/lib/supabaseClient.ts
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL in env.");
}
if (!SUPABASE_ANON_KEY) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY in env.");
}

// Browser-only client (anon). Use for reads + any RLS-safe stuff.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
<<<<<<< HEAD
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Explicit so this file can never blow up if imported in a non-browser context
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
    // Optional to be explicit; defaults to true
    detectSessionInUrl: true,
  },
});
=======
  auth: { persistSession: false, autoRefreshToken: false },
});
>>>>>>> 8ee0349 (Full app update: remove auth for employees, auth only for managers. Login via URL token for timeclock access.)
