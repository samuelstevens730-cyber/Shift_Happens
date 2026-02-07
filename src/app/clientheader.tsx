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
    <header className="sticky top-0 z-40 bg-[rgba(10,12,16,0.92)] backdrop-blur border-b border-white/10">
      <div className="w-full px-3 py-2 flex items-center gap-3">
        <Link href="/" aria-label="Go to home" className="shrink-0">
          <Image
            src="/brand/no_cap_logo.jpg"
            alt="No Cap Smoke Shop"
            width={56}
            height={56}
            priority
            className="h-12 w-12 rounded-full object-cover"
          />
        </Link>

        <nav className="min-w-0 flex-1 overflow-x-auto">
          <div className="flex items-center gap-5 whitespace-nowrap pr-2">
            <Link
              href="/"
              className={`bento-nav-link ${pathname === "/" ? "bento-nav-active" : "bento-nav-inactive"}`}
            >
              HOME
            </Link>

            {(isLoggedIn || hasPinSession) && (
              <>
                <Link
                  href={scheduleHref}
                  className={`bento-nav-link ${pathname === "/schedule" ? "bento-nav-active" : "bento-nav-inactive"}`}
                >
                  MY SCHEDULE
                </Link>
                <Link
                  href={shiftsHref}
                  className={`bento-nav-link ${pathname === "/shifts" ? "bento-nav-active" : "bento-nav-inactive"}`}
                >
                  MY SHIFTS
                </Link>
              </>
            )}

            {isAdmin && (
              <Link
                href="/admin"
                className={`bento-nav-link ${pathname?.startsWith("/admin") ? "bento-nav-active" : "bento-nav-inactive"}`}
              >
                ADMIN
              </Link>
            )}

            {isLoggedIn ? (
              <button onClick={handleLogout} className="bento-nav-link bento-nav-inactive">
                LOGOUT
              </button>
            ) : (
              <Link href={loginHref} className="bento-nav-link bento-nav-inactive">
                LOGIN
              </Link>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}
