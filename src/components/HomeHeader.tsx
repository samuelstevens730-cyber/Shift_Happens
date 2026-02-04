"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

interface HomeHeaderProps {
  isManager?: boolean;
}

export default function HomeHeader({ isManager = false }: HomeHeaderProps) {
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
        {isManager && (
          <Link
            href="/admin"
            className={`bento-nav-link ${pathname === "/admin" ? "bento-nav-active" : "bento-nav-inactive"}`}
          >
            ADMIN
          </Link>
        )}
        <button onClick={handleLogout} className="bento-nav-link bento-nav-inactive">
          LOGOUT
        </button>
      </nav>
    </div>
  );
}
