import { supabase } from "@/lib/supabaseClient";

const SESSION_STORAGE_KEYS = [
  "sh_pin_token",
  "sh_pin_store_id",
  "sh_pin_profile_id",
  "sh_profile_name",
];

const LOCAL_STORAGE_KEYS = [
  "sh_store",
  "sh_profile",
];

export function clearAppBrowserAuthState() {
  if (typeof window === "undefined") return;

  for (const key of SESSION_STORAGE_KEYS) {
    window.sessionStorage.removeItem(key);
  }

  for (const key of LOCAL_STORAGE_KEYS) {
    window.localStorage.removeItem(key);
  }
}

export async function resetBrowserAuthState() {
  await supabase.auth.signOut().catch(() => undefined);
  clearAppBrowserAuthState();
}
