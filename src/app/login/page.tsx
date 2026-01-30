/**
 * Login Page - Admin Authentication
 *
 * Provides email/password authentication for admin users using Supabase Auth UI.
 * After successful login, redirects to the path specified in ?next= query param
 * (defaults to /clock for employees, but admin access typically uses ?next=/admin).
 *
 * Password reset uses a custom handler to ensure the redirect URL points to
 * /auth/reset (required because Supabase Auth UI's built-in reset doesn't
 * allow custom redirect URLs that are in our allowed list).
 *
 * Note: Employee clock-in/out does NOT require authentication.
 */

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
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const [nextPath, setNextPath] = useState<string | null>(null);

  /**
   * Custom password reset handler.
   * Uses prompt() for simplicity - sends reset email with redirect to /auth/reset.
   * This workaround ensures the redirect URL is in Supabase's allowed list.
   */
  async function handleForgot() {
    const email = prompt("Enter your email for password reset");
    if (!email) return;
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${origin}/auth/reset`,
      });
      if (error) throw error;
      alert("Check your email for the reset link.");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to send reset email.";
      alert(message);
    }
  }

  // Extract redirect destination from query string
  useEffect(() => {
    if (typeof window === "undefined") return;
    const next = new URLSearchParams(window.location.search).get("next") || "/clock";
    setNextPath(next);
  }, []);

  // Check existing session and listen for auth state changes
  useEffect(() => {
    if (!nextPath) return;
    let mounted = true;

    // If already logged in, redirect immediately
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (data.session) router.replace(nextPath);
      else setReady(true);
    });

    // Listen for login events to trigger redirect
    const { data: sub } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, session: Session | null) => {
        if (event === "SIGNED_IN" && session) {
          router.replace(nextPath);
        }
      }
    );

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [router, nextPath]);

  // Don't render until we've checked session state
  if (!ready || !nextPath) return null;

  return (
    <div className="app-shell grid place-items-center">
      <div className="w-full max-w-md card card-pad space-y-4">
        <h1 className="text-2xl font-semibold">Shift Happens</h1>
        <Auth
          supabaseClient={supabase}
          providers={[]}
          appearance={{ theme: ThemeSupa }}
          redirectTo={`${origin}${nextPath}`}
        />
        <button
          className="btn-secondary px-3 py-2 text-sm w-full"
          onClick={handleForgot}
        >
          Forgot password?
        </button>
      </div>
    </div>
  );
}
