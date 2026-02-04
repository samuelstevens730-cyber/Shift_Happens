/**
 * Home Page - Asymmetric Bento Layout
 *
 * New Flow:
 * - On load: Check for existing JWT (admin session) or PIN token (employee session)
 * - No auth: Show modal with Employee/Admin choice
 *   - Employee → PIN entry → JWT token → Home screen
 *   - Admin → Login screen → Session → Home screen
 * - Has auth: Show home screen directly with appropriate cards
 *
 * Bento Layout:
 * ┌─────────────────┬───────────────┐
 * │   TIME CLOCK    │  MY SCHEDULE  │
 * │    (large)      │   (medium)    │
 * │   50% width     │   50% width   │
 * │   60% height    │   60% height  │
 * ├─────────────────┴───────────────┤
 * │         DASHBOARD               │
 * │        100% width               │
 * │        25% height               │
 * ├─────────────────┬───────────────┤
 * │    REQUESTS     │     ADMIN     │
 * │   50% width     │   50% width   │
 * │   15% height    │   15% height  │
 * └─────────────────┴───────────────┘
 */

"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import PinGate from "@/components/PinGate";

// Storage keys (match PinGate.tsx)
const PIN_TOKEN_KEY = "sh_pin_token";
const PIN_STORE_KEY = "sh_pin_store_id";
const PIN_PROFILE_KEY = "sh_pin_profile_id";

type Store = { id: string; name: string };
type Profile = { id: string; name: string; active: boolean | null };

export default function Home() {
  const router = useRouter();
  const pathname = usePathname();

  // Auth state
  const [hasAdminAuth, setHasAdminAuth] = useState(false);
  const [hasPinAuth, setHasPinAuth] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  // Modal state
  const [showAuthModal, setShowAuthModal] = useState(false);

  // PIN gate state
  const [showPinGate, setShowPinGate] = useState(false);
  const [pinLoading, setPinLoading] = useState(true);
  const [stores, setStores] = useState<Store[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [storeId, setStoreId] = useState("");
  const [profileId, setProfileId] = useState("");

  // Check for existing auth on mount
  useEffect(() => {
    let alive = true;

    async function checkAuth() {
      // Check for admin session
      const { data: { session } } = await supabase.auth.getSession();
      const adminAuthed = !!session?.user;

      // Check for PIN session
      let pinAuthed = false;
      if (typeof window !== "undefined") {
        const pinToken = sessionStorage.getItem(PIN_TOKEN_KEY);
        const pinStore = sessionStorage.getItem(PIN_STORE_KEY);
        const pinProfile = sessionStorage.getItem(PIN_PROFILE_KEY);
        pinAuthed = !!(pinToken && pinStore && pinProfile);
      }

      if (!alive) return;

      setHasAdminAuth(adminAuthed);
      setHasPinAuth(pinAuthed);
      setAuthChecked(true);

      // If no auth at all, show the auth choice modal
      if (!adminAuthed && !pinAuthed) {
        setShowAuthModal(true);
      }
    }

    checkAuth();

    // Subscribe to auth changes
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const authed = !!session?.user;
      setHasAdminAuth(authed);
      if (authed) {
        setShowAuthModal(false);
      }
    });

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  // Listen for PIN auth changes (in case user logs in via PIN in another tab)
  useEffect(() => {
    const checkPinAuth = () => {
      if (typeof window === "undefined") return;
      const pinToken = sessionStorage.getItem(PIN_TOKEN_KEY);
      const pinStore = sessionStorage.getItem(PIN_STORE_KEY);
      const pinProfile = sessionStorage.getItem(PIN_PROFILE_KEY);
      const pinAuthed = !!(pinToken && pinStore && pinProfile);
      setHasPinAuth(pinAuthed);
      if (pinAuthed) {
        setShowAuthModal(false);
        setShowPinGate(false);
      }
    };

    window.addEventListener("storage", checkPinAuth);
    return () => window.removeEventListener("storage", checkPinAuth);
  }, []);

  // Hide original header on home page
  useEffect(() => {
    const header = document.querySelector("header");
    if (header) {
      header.style.display = "none";
    }
    return () => {
      if (header) {
        header.style.display = "";
      }
    };
  }, []);

  // Fetch stores/profiles when showing PIN gate
  useEffect(() => {
    if (!showPinGate) return;

    let alive = true;
    setPinLoading(true);

    async function loadData() {
      try {
        const [storesRes, profilesRes] = await Promise.all([
          supabase.from("stores").select("id, name").order("name"),
          supabase.from("profiles").select("id, name, active").order("name"),
        ]);

        if (!alive) return;

        const storesData = storesRes.data || [];
        const profilesData = (profilesRes.data || []).filter(
          (p) => p.active !== false
        );

        setStores(storesData);
        setProfiles(profilesData);

        // Set defaults
        if (storesData.length > 0 && !storeId) {
          setStoreId(storesData[0].id);
        }
        if (profilesData.length > 0 && !profileId) {
          setProfileId(profilesData[0].id);
        }
      } finally {
        if (alive) setPinLoading(false);
      }
    }

    loadData();
    return () => { alive = false; };
  }, [showPinGate, storeId, profileId]);

  // Handle PIN authorization success
  const handlePinAuthorized = () => {
    setHasPinAuth(true);
    setShowPinGate(false);
    setShowAuthModal(false);
  };

  // Handle Employee choice
  const handleEmployeeChoice = () => {
    setShowAuthModal(false);
    setShowPinGate(true);
  };

  // Handle Admin choice
  const handleAdminChoice = () => {
    router.push("/login?next=/");
  };

  // Determine which cards to show
  const showTimeClock = true; // Always show
  const showMySchedule = hasPinAuth || hasAdminAuth; // Needs auth
  const showDashboard = hasPinAuth || hasAdminAuth; // Needs auth
  const showRequests = hasPinAuth || hasAdminAuth; // Needs auth
  const showAdmin = hasAdminAuth; // Only admin

  // Nav items based on auth state
  const navItems = [
    { href: "/", label: "HOME" },
    { href: "/admin", label: "ADMIN" },
    { href: "/dashboard", label: "DASHBOARD" },
    ...(hasAdminAuth
      ? [{ href: "#logout", label: "LOGOUT", isLogout: true }]
      : [{ href: "/login", label: "LOGIN" }]),
  ];

  if (!authChecked) {
    return (
      <div className="bento-shell flex items-center justify-center">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  return (
    <div className="bento-shell">
      {/* Top Bar: Logo + Nav */}
      <div className="bento-top-bar">
        <Image
          src="/brand/no_cap_logo.jpg"
          alt="No Cap Smoke Shop"
          width={80}
          height={80}
          priority
          className="bento-logo"
        />
        <nav className="bento-nav">
          {navItems.map((item) => {
            const isActive = pathname === item.href && !item.isLogout;
            const baseClasses = "bento-nav-link";
            const activeClasses = "bento-nav-active";
            const inactiveClasses = "bento-nav-inactive";

            if (item.isLogout) {
              return (
                <button
                  key="logout"
                  onClick={async () => {
                    await supabase.auth.signOut();
                    setHasAdminAuth(false);
                    router.push("/");
                  }}
                  className={`${baseClasses} ${inactiveClasses}`}
                >
                  {item.label}
                </button>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${baseClasses} ${isActive ? activeClasses : inactiveClasses}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Bento Grid - Fills remaining viewport */}
      <div className="bento-grid">
        {/* Row 1: Time Clock (large) | My Schedule (medium) */}
        {showTimeClock && (
          <Link href="/clock" className="bento-card bento-time-clock">
            <span className="bento-card-title">TIME CLOCK</span>
          </Link>
        )}
        
        {showMySchedule ? (
          <Link href="/dashboard/schedule" className="bento-card bento-my-schedule">
            <span className="bento-card-title">MY SCHEDULE</span>
          </Link>
        ) : (
          <div className="bento-card bento-my-schedule bento-card-disabled">
            <span className="bento-card-title">MY SCHEDULE</span>
          </div>
        )}

        {/* Row 2: Dashboard (wide) */}
        {showDashboard ? (
          <Link href="/dashboard" className="bento-card bento-dashboard">
            <span className="bento-card-title">DASHBOARD</span>
          </Link>
        ) : (
          <div className="bento-card bento-dashboard bento-card-disabled">
            <span className="bento-card-title">DASHBOARD</span>
          </div>
        )}

        {/* Row 3: Requests | Admin */}
        {showRequests ? (
          <Link href="/dashboard/shifts" className="bento-card bento-requests">
            <span className="bento-card-title">REQUESTS</span>
          </Link>
        ) : (
          <div className="bento-card bento-requests bento-card-disabled">
            <span className="bento-card-title">REQUESTS</span>
          </div>
        )}
        
        {showAdmin ? (
          <Link href="/admin" className="bento-card bento-admin">
            <span className="bento-card-title">ADMIN</span>
          </Link>
        ) : (
          <div className="bento-card bento-admin bento-card-disabled">
            <span className="bento-card-title">ADMIN</span>
          </div>
        )}
      </div>

      {/* Auth Choice Modal */}
      {showAuthModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 p-4">
          <div className="card card-pad w-full max-w-sm space-y-6">
            <div className="text-center space-y-2">
              <h2 className="text-xl font-semibold">Welcome</h2>
              <p className="text-sm muted">Choose how you&apos;d like to sign in</p>
            </div>

            <div className="space-y-3">
              <button
                onClick={handleEmployeeChoice}
                className="home-card home-card-green w-full"
              >
                <span className="text-lg">Employee</span>
                <span className="text-xs muted mt-1">Sign in with PIN</span>
              </button>

              <button
                onClick={handleAdminChoice}
                className="home-card home-card-pink w-full"
              >
                <span className="text-lg">Admin</span>
                <span className="text-xs muted mt-1">Sign in with email</span>
              </button>
            </div>

            <div className="text-xs muted text-center">
              Time Clock is available without signing in
            </div>
          </div>
        </div>
      )}

      {/* PIN Gate Modal */}
      {showPinGate && (
        <PinGate
          loading={pinLoading}
          stores={stores}
          profiles={profiles}
          qrToken=""
          tokenStore={null}
          storeId={storeId}
          setStoreId={setStoreId}
          profileId={profileId}
          setProfileId={setProfileId}
          onLockChange={() => {}}
          onAuthorized={handlePinAuthorized}
          onClose={() => {
            setShowPinGate(false);
            setShowAuthModal(true);
          }}
        />
      )}
    </div>
  );
}
