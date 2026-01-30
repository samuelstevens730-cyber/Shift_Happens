/**
 * Password Reset Page - Set New Password
 *
 * Handles the password reset flow after user clicks the email link.
 * Supabase sends reset links in two formats depending on configuration:
 * 1. PKCE style: ?code=xxx (newer, more secure)
 * 2. Token hash style: ?token_hash=xxx or #access_token=xxx (legacy)
 *
 * Flow:
 * 1. Extract code/token from URL (query string or hash fragment)
 * 2. Exchange for a recovery session with Supabase
 * 3. Show password reset form
 * 4. Update password and sign out
 * 5. Redirect to login page
 *
 * Security: Signs out after password change to clear the recovery session.
 */

"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

function ResetPasswordInner() {
  const router = useRouter();
  const q = useSearchParams();

  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [saving, setSaving] = useState(false);

  // On mount, validate the reset token and establish a recovery session
  useEffect(() => {
    let alive = true;

    async function bootstrap() {
      setError(null);

      // Supabase may put tokens in query string OR hash fragment
      const url = new URL(window.location.href);
      const search = url.searchParams;
      const hash = new URLSearchParams(url.hash.replace(/^#/, ""));

      const code = search.get("code") || hash.get("code");
      const token_hash = search.get("token_hash") || hash.get("token_hash");

      try {
        if (code) {
          // PKCE / verification-code style (newer Supabase projects)
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (token_hash) {
          // Legacy token-hash style
          const { error } = await supabase.auth.verifyOtp({
            type: "recovery",
            token_hash,
          });
          if (error) throw error;
        }
        // Else: hash access_token style should be auto-parsed by detectSessionInUrl=true

        // Verify we have a valid recovery session
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("This reset link is invalid or expired. Request a new one.");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (alive) setError(msg);
      } finally {
        if (alive) setPending(false);
      }
    }

    void bootstrap();
    return () => { alive = false; };
  }, [q]);

  async function submit() {
    setError(null);
    if (pw1.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (pw1 !== pw2) {
      setError("Passwords do not match.");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw1 });
      if (error) throw error;

      // Clear the recovery session and redirect to login
      await supabase.auth.signOut();
      router.replace("/login");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  if (pending) return <div className="p-6">Checking your link…</div>;

  return (
    <div className="min-h-screen p-6 grid place-items-center">
      <div className="w-full max-w-sm border rounded-2xl p-4 space-y-3">
        <h1 className="text-xl font-semibold">Set a new password</h1>

        {error && (
          <div className="text-sm text-red-600 border border-red-300 rounded p-3">
            {error}
          </div>
        )}

        <label className="text-sm">New password</label>
        <input
          type="password"
          className="w-full border rounded p-2"
          value={pw1}
          onChange={(e) => setPw1(e.target.value)}
        />

        <label className="text-sm">Confirm password</label>
        <input
          type="password"
          className="w-full border rounded p-2"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
        />

        <button
          disabled={saving}
          onClick={submit}
          className="w-full rounded bg-black text-white py-2 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Update password"}
        </button>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading…</div>}>
      <ResetPasswordInner />
    </Suspense>
  );
}
