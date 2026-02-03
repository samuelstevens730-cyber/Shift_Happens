/**
 * Client Header Component
 *
 * Global navigation header displayed on all pages.
 * Handles auth state to show Login/Logout button appropriately.
 * Preserves current path in login redirect so users return after auth.
 */

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
  const [hasPinSession, setHasPinSession] = useState(false);

  // Subscribe to auth state changes to update Login/Logout button
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

  useEffect(() => {
    const readPin = () => {
      if (typeof window === "undefined") return;
      const token = sessionStorage.getItem("sh_pin_token");
      const storeId = sessionStorage.getItem("sh_pin_store_id");
      const profileId = sessionStorage.getItem("sh_pin_profile_id");
      setHasPinSession(Boolean(token && storeId && profileId));
    };
    readPin();
    window.addEventListener("storage", readPin);
    return () => window.removeEventListener("storage", readPin);
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  // Preserve current path so user returns here after login
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

          {(isLoggedIn || hasPinSession) && (
            <Link href="/dashboard" className="btn-secondary px-4 py-2">
              Dashboard
            </Link>
          )}

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
