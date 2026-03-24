"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import UserAvatar, { type AvatarOptions } from "@/components/UserAvatar";

type AvatarData = {
  avatar_style: string | null;
  avatar_seed: string | null;
  avatar_options: AvatarOptions;
  avatar_upload_url: string | null;
};

export default function AdminMobileHeader() {
  const router = useRouter();
  const [avatar, setAvatar] = useState<AvatarData | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getSession();
        const token = auth.session?.access_token ?? "";
        if (!token) return;
        if (auth.session?.user?.id) setUserId(auth.session.user.id);
        const res = await fetch("/api/me/avatar", { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok || !alive) return;
        const json = await res.json() as AvatarData;
        setAvatar({
          avatar_style: json.avatar_style ?? "avataaars",
          avatar_seed: json.avatar_seed ?? null,
          avatar_options: json.avatar_options ?? {},
          avatar_upload_url: json.avatar_upload_url ?? null,
        });
      } catch {
        // best-effort
      }
    })();
    return () => { alive = false; };
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("sh_pin_token");
      sessionStorage.removeItem("sh_pin_store_id");
      sessionStorage.removeItem("sh_pin_profile_id");
    }
    router.push("/");
  }

  return (
    <header className="employee-header lg:hidden">
      <div className="employee-header-brand">
        <Link href="/" className="employee-header-logo-wrap" aria-label="Return to home">
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
          <div className="employee-header-subtitle">Command Center</div>
        </div>
      </div>

      <div className="employee-header-actions">
        <Link href="/avatar" aria-label="Avatar settings" className="employee-header-avatar">
          <UserAvatar
            seed={avatar?.avatar_seed ?? userId}
            style={avatar?.avatar_style ?? "avataaars"}
            options={avatar?.avatar_options ?? {}}
            uploadUrl={avatar?.avatar_upload_url ?? null}
            alt="My avatar"
          />
        </Link>
        <button onClick={handleLogout} className="employee-header-logout">
          Logout
        </button>
      </div>
    </header>
  );
}
