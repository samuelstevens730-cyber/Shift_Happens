// src/app/ClientHeader.tsx  (CLIENT component)
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function ClientHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setIsLoggedIn(!!data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setIsLoggedIn(!!session?.user);
    });

    if (!sub || !sub.subscription) {
      return;
    }

    return () => sub?.subscription?.unsubscribe();
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  const loginHref = `/login?next=${encodeURIComponent(pathname || "/")}`;

  return (
    <header className="sticky top-0 z-40 header-bar backdrop-blur">
      <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between gap-3">
        {/* Left: logo links home */}
        <Link href="/" className="flex items-center gap-3" aria-label="Go to home">
          <Image
            src="/brand/no_cap_logo.jpg"
            alt="No Cap Smoke Shop"
            width={220}
            height={56}
            priority
            className="h-10 sm:h-12 md:h-14 w-auto"
          />
          <span className="hidden sm:inline text-sm font-semibold tracking-wide text-[var(--text)]">
            Shift Happens
          </span>
        </Link>

        {/* Right: Home + Login/Logout */}
        <nav className="flex items-center gap-2">
          <Link href="/" className="btn-secondary px-4 py-2">
            Home
          </Link>

          {isLoggedIn ? (
            <button
              onClick={handleLogout}
              className="btn-danger px-4 py-2"
            >
              Logout
            </button>
          ) : (
            <Link
              href={loginHref}
              className="btn-primary px-4 py-2"
            >
              Login
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
