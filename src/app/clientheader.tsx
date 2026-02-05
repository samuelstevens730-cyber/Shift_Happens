/**
 * Client Header Component
 *
 * Global navigation header displayed on all pages.
 * Handles auth state to show Login/Logout button appropriately.
 * Preserves current path in login redirect so users return after auth.
 */

// src/app/ClientHeader.tsx  (CLIENT component)
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function ClientHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [hasPinSession, setHasPinSession] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  // Subscribe to auth state changes to update Login/Logout button
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setIsLoggedIn(!!data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setIsLoggedIn(!!session?.user);
      setAccessToken(session?.access_token ?? null);
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
      if (profileId) setProfileId(profileId);
    };
    readPin();
    window.addEventListener("storage", readPin);
    return () => window.removeEventListener("storage", readPin);
  }, []);

  useEffect(() => {
    let alive = true;

    async function loadAdminRoleAndProfile() {
      const { data: userData } = await supabase.auth.getUser();
      if (!alive) return;
      const user = userData?.user;
      if (!user) {
        setIsAdmin(false);
        if (!hasPinSession) setProfileId(null);
        return;
      }

      const { data: roleRow } = await supabase
        .from("app_users")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      setIsAdmin(roleRow?.role === "manager");

      if (accessToken) {
        const res = await fetch("/api/me/profile", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (!alive) return;
          setProfileId(data.profileId ?? null);
        }
      }
    }

    loadAdminRoleAndProfile();
    return () => {
      alive = false;
    };
  }, [accessToken, hasPinSession]);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  // Preserve current path so user returns here after login
  const loginHref = `/login?next=${encodeURIComponent(pathname || "/")}`;

  const scheduleHref = profileId ? `/schedule?profileId=${encodeURIComponent(profileId)}` : "/schedule";
  const shiftsHref = profileId ? `/shifts?profileId=${encodeURIComponent(profileId)}` : "/shifts";

  const isAdminRoute = useMemo(() => pathname?.startsWith("/admin"), [pathname]);
  if (!isAdminRoute) return null;

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

        {/* Right: Home + Nav */}
        <nav className="flex items-center gap-2">
          <Link href="/" className="btn-secondary px-4 py-2">
            Home
          </Link>

          {(isLoggedIn || hasPinSession) && (
            <>
              <Link href={scheduleHref} className="btn-secondary px-4 py-2">
                My Schedule
              </Link>
              <Link href={shiftsHref} className="btn-secondary px-4 py-2">
                My Shifts
              </Link>
            </>
          )}

          {isAdmin && (
            <Link href="/admin" className="btn-secondary px-4 py-2">
              Admin
            </Link>
          )}

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
