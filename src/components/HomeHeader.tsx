"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

interface HomeHeaderProps {
  isManager?: boolean;
  isAuthenticated?: boolean;
  profileId?: string | null;
  onLogin?: () => void;
}

export default function HomeHeader({
  isManager = false,
  isAuthenticated = false,
  profileId = null,
  onLogin,
}: HomeHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    // Clear PIN session too
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("sh_pin_token");
      sessionStorage.removeItem("sh_pin_store_id");
      sessionStorage.removeItem("sh_pin_profile_id");
    }
    router.push("/");
  };

  const scheduleHref = profileId ? `/schedule?profileId=${encodeURIComponent(profileId)}` : "/schedule";
  const shiftsHref = profileId ? `/shifts?profileId=${encodeURIComponent(profileId)}` : "/shifts";

  return (
    <div className="bento-top-bar">
      <Image
        src="/brand/no_cap_logo.jpg"
        alt="No Cap Smoke Shop"
        width={120}
        height={120}
        priority
        className="bento-logo"
      />
      <nav className="bento-nav">
        <Link
          href="/"
          className={`bento-nav-link ${pathname === "/" ? "bento-nav-active" : "bento-nav-inactive"}`}
        >
          HOME
        </Link>
        {(isAuthenticated || profileId) && (
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
        {isManager && (
          <Link
            href="/admin"
            className={`bento-nav-link ${pathname === "/admin" ? "bento-nav-active" : "bento-nav-inactive"}`}
          >
            ADMIN
          </Link>
        )}
        {isAuthenticated ? (
          <button onClick={handleLogout} className="bento-nav-link bento-nav-inactive">
            LOGOUT
          </button>
        ) : (
          <button
            onClick={() => (onLogin ? onLogin() : router.push(`/login?next=${encodeURIComponent(pathname || "/")}`))}
            className="bento-nav-link bento-nav-inactive"
          >
            LOGIN
          </button>
        )}
      </nav>
    </div>
  );
}
