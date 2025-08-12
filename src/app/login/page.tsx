"use client";

import { supabase } from "@/lib/supabaseClient";
import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa, type ViewType } from "@supabase/auth-ui-shared";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

export default function LoginPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<ViewType>("sign_in");

  const origin =
    typeof window !== "undefined" ? window.location.origin : undefined;
  const resetRedirect =
    origin && view === "forgotten_password" ? `${origin}/auth/reset` : undefined;

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (data.session) router.replace("/clock");
      else setReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, session: Session | null) => {
        if (event === "SIGNED_IN" && session) {
          router.replace("/clock");
        }
      }
    );

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  if (!ready) return null;

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-md rounded-2xl shadow p-6 border">
        <h1 className="text-2xl font-semibold mb-4">Shift Happens</h1>
        <Auth
          supabaseClient={supabase}
          providers={[]}
          view={view}
          appearance={{ theme: ThemeSupa }}
          redirectTo={resetRedirect}
          onViewChange={setView}
        />
      </div>
    </div>
  );
}
