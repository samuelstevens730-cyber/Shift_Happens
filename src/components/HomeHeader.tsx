"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import UserAvatar, { type AvatarOptions } from "@/components/UserAvatar";

interface HomeHeaderProps {
  isManager?: boolean;
  isAuthenticated?: boolean;
  profileId?: string | null;
  onLogin?: () => void;
}

const PIN_TOKEN_KEY = "sh_pin_token";

type HeaderAvatar = {
  avatar_style: string | null;
  avatar_seed: string | null;
  avatar_options: AvatarOptions;
  avatar_upload_url: string | null;
};

export default function HomeHeader({
  isManager = false,
  isAuthenticated = false,
  profileId = null,
  onLogin,
}: HomeHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [avatar, setAvatar] = useState<HeaderAvatar | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!isAuthenticated) {
        setAvatar(null);
        return;
      }
      const pinToken = typeof window !== "undefined" ? sessionStorage.getItem(PIN_TOKEN_KEY) : null;
      let token = pinToken ?? "";
      if (!token) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        token = session?.access_token ?? "";
      }
      if (!token) return;
      const res = await fetch("/api/me/avatar", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const json = (await res.json()) as HeaderAvatar;
      if (!mounted) return;
      setAvatar({
        avatar_style: json.avatar_style ?? "avataaars",
        avatar_seed: json.avatar_seed ?? profileId ?? null,
        avatar_options: json.avatar_options ?? {},
        avatar_upload_url: json.avatar_upload_url ?? null,
      });
    })();
    return () => {
      mounted = false;
    };
  }, [isAuthenticated, profileId]);

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
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 overflow-hidden rounded-full border border-white/20 bg-black">
              <UserAvatar
                seed={avatar?.avatar_seed ?? profileId}
                style={avatar?.avatar_style ?? "avataaars"}
                options={avatar?.avatar_options ?? {}}
                uploadUrl={avatar?.avatar_upload_url ?? null}
                alt="My avatar"
              />
            </div>
            <button onClick={handleLogout} className="bento-nav-link bento-nav-inactive">
              LOGOUT
            </button>
          </div>
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
