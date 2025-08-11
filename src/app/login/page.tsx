"use client";

import { supabase } from "@/lib/supabaseClient";
import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    // If already logged in, bounce
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (data.session) router.replace("/clock");
      else setReady(true);
    });

    // Also listen for auth state changes and redirect after sign-in
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        router.replace("/clock");
      }
    });

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
          view="sign_in"
          appearance={{ theme: ThemeSupa }}
          // good to keep, but our onAuthStateChange handles the push
          redirectTo={typeof window !== "undefined" ? window.location.origin + "/clock" : undefined}
        />
      </div>
    </div>
  );
}
