"use client";

import { supabase } from "@/lib/supabaseClient";
import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

export default function LoginPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // 1) If a recovery link lands here (root/login), bounce straight to /auth/reset
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hasCode = new URLSearchParams(window.location.search).has("code");
    const isRecoveryHash = window.location.hash.includes("type=recovery");
    if (hasCode || isRecoveryHash) {
      router.replace("/auth/reset");
    }
  }, [router]);

  // 2) Normal auth lifecycle: signed-in -> /clock, password recovery -> /auth/reset
  useEffect(() => {
    let alive = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      if (data.session) router.replace("/clock");
      else setReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, session: Session | null) => {
        if (event === "PASSWORD_RECOVERY") {
          router.replace("/auth/reset");
          return;
        }
        if (event === "SIGNED_IN" && session) {
          router.replace("/clock");
        }
      }
    );

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    if (!email) {
      setErr("Enter your email.");
      return;
    }
    try {
      setSending(true);
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${origin}/auth/reset`,
      });
      if (error) throw error;
      setMsg("Reset link sent. Check your email.");
    } catch (e: any) {
      setErr(e.message ?? "Failed to send reset email.");
    } finally {
      setSending(false);
    }
  }

  if (!ready) return null;

  const redirectTo =
    typeof window !== "undefined"
      ? `${window.location.origin}/auth/reset`
      : undefined; // used by Auth's built-in "Forgot password?" too

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-md rounded-2xl shadow p-6 border space-y-4">
        <h1 className="text-2xl font-semibold">Shift Happens</h1>

        {/* Sign-in only; post-login redirect handled via onAuthStateChange */}
        <Auth
          supabaseClient={supabase}
          providers={[]}
          appearance={{ theme: ThemeSupa }}
          view="sign_in"
          redirectTo={redirectTo}
        />

        {/* Our explicit reset sender so we always control the redirect */}
        <div className="border-t pt-4 space-y-2">
          <h2 className="text-sm font-medium">Forgot your password?</h2>
          {err && (
            <div className="text-sm text-red-600 border border-red-300 rounded p-2">
              {err}
            </div>
          )}
          {msg && (
            <div className="text-sm text-green-700 border border-green-300 rounded p-2">
              {msg}
            </div>
          )}
          <form onSubmit={handleForgot} className="flex gap-2">
            <input
              type="email"
              placeholder="you@example.com"
              className="flex-1 border rounded p-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            <button
              type="submit"
              disabled={sending}
              className="px-3 py-2 rounded bg-black text-white disabled:opacity-50"
            >
              {sending ? "Sending…" : "Send link"}
            </button>
          </form>
          <p className="text-xs text-gray-600">
            The email link will open <code>/auth/reset</code>.
          </p>
        </div>
      </div>
    </div>
  );
}
