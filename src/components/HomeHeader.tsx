"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import UserAvatar, { type AvatarOptions } from "@/components/UserAvatar";
import EmployeeBottomNav from "@/components/EmployeeBottomNav";
import EmployeeShellFX from "@/components/EmployeeShellFX";
import { Home, Clock, CalendarDays, Star, ShieldCheck } from "lucide-react";

interface HomeHeaderProps {
  isManager?: boolean;
  isAuthenticated?: boolean;
  profileId?: string | null;
  onLogin?: () => void;
  utilityText?: string | null;
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
  utilityText = null,
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

  async function handleLogout() {
    await supabase.auth.signOut();
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("sh_pin_token");
      sessionStorage.removeItem("sh_pin_store_id");
      sessionStorage.removeItem("sh_pin_profile_id");
    }
    router.push("/");
  }

  const scheduleHref = profileId ? `/schedule?profileId=${encodeURIComponent(profileId)}` : "/schedule";
  const shiftsHref = profileId ? `/shifts?profileId=${encodeURIComponent(profileId)}` : "/shifts";

  const sidebarLinks = [
    { href: "/", label: "Home", icon: Home },
    { href: shiftsHref, label: "My Shifts", icon: Clock },
    { href: scheduleHref, label: "Schedule", icon: CalendarDays },
    { href: "/reviews", label: "Reviews", icon: Star },
    ...(isManager ? [{ href: "/admin", label: "Admin", icon: ShieldCheck }] : []),
  ];

  const isSidebarActive = (href: string) =>
    href === "/" ? pathname === "/" : !!(pathname?.startsWith(href.split("?")[0]));

  return (
    <>
      {!pathname?.startsWith("/admin") ? <EmployeeShellFX /> : null}

      {/* Desktop sidebar — hidden on mobile via CSS */}
      {!pathname?.startsWith("/admin") ? (
        <nav className="employee-desktop-sidebar">
          <div className="employee-sidebar-brand">
            <Link href="/" className="employee-sidebar-logo-wrap" aria-label="Go to home">
              <span className="employee-header-logo-glow" aria-hidden="true" />
              <Image
                src="/brand/no_cap_logo.png"
                alt="No Cap Smoke Shop"
                width={96}
                height={96}
                priority
                className="employee-header-logo"
              />
            </Link>
            <div className="employee-header-copy">
              <div className="employee-header-title">Shift Happens</div>
              <div className="employee-header-subtitle">Let's track it.</div>
            </div>
          </div>

          <div className="employee-sidebar-nav">
            {sidebarLinks.map((link) => {
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`employee-sidebar-link ${isSidebarActive(link.href) ? "employee-sidebar-link-active" : ""}`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {link.label}
                </Link>
              );
            })}
          </div>

          <div className="employee-sidebar-footer">
            {isAuthenticated ? (
              <>
                <Link href="/avatar" className="employee-sidebar-avatar" aria-label="Open avatar settings">
                  <UserAvatar
                    seed={avatar?.avatar_seed ?? profileId}
                    style={avatar?.avatar_style ?? "avataaars"}
                    options={avatar?.avatar_options ?? {}}
                    uploadUrl={avatar?.avatar_upload_url ?? null}
                    alt="My avatar"
                  />
                </Link>
                <button onClick={handleLogout} className="employee-header-logout">
                  Logout
                </button>
              </>
            ) : (
              <button
                onClick={() => (onLogin ? onLogin() : router.push(`/login?next=${encodeURIComponent(pathname || "/")}`)) }
                className="employee-header-logout"
              >
                Login
              </button>
            )}
          </div>
        </nav>
      ) : null}

      <header className="employee-header">
        <div className="employee-header-brand">
          <Link href="/" className="employee-header-logo-wrap" aria-label="Go to home">
            <span className="employee-header-logo-glow" aria-hidden="true" />
            <Image
              src="/brand/no_cap_logo.png"
              alt="No Cap Smoke Shop"
              width={96}
              height={96}
              priority
              className="employee-header-logo"
            />
          </Link>
          <div className="employee-header-copy">
            <div className="employee-header-title">Shift Happens</div>
            <div className="employee-header-subtitle">Let's track it.</div>
            {utilityText ? <div className="employee-header-utility">{utilityText}</div> : null}
          </div>
        </div>

        <div className="employee-header-actions">
          {isAuthenticated ? (
            <>
              <Link href="/avatar" className="employee-header-avatar" aria-label="Open avatar settings">
                <UserAvatar
                  seed={avatar?.avatar_seed ?? profileId}
                  style={avatar?.avatar_style ?? "avataaars"}
                  options={avatar?.avatar_options ?? {}}
                  uploadUrl={avatar?.avatar_upload_url ?? null}
                  alt="My avatar"
                />
              </Link>
              {isManager ? (
                <Link href="/admin" className="employee-header-admin">
                  Admin
                </Link>
              ) : null}
              <button onClick={handleLogout} className="employee-header-logout">
                Logout
              </button>
            </>
          ) : (
            <button
              onClick={() => (onLogin ? onLogin() : router.push(`/login?next=${encodeURIComponent(pathname || "/")}`))}
              className="employee-header-logout"
            >
              Login
            </button>
          )}
        </div>
      </header>

      {!pathname?.startsWith("/admin") ? <EmployeeBottomNav profileId={profileId} isManager={isManager} /> : null}
    </>
  );
}
