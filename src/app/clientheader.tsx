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
    let alive = true;

    // Prime from current session; don't set state after unmount
    supabase.auth
      .getUser()
      .then(({ data }) => { if (alive) setIsLoggedIn(!!data.user); })
      .catch(() => { /* header stays quiet */ });

    // Auth listener (v2 shape) + safe cleanup
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (alive) setIsLoggedIn(!!session?.user);
    });

    return () => {
      alive = false;
      try { subscription?.unsubscribe(); } catch { /* nothing to clean */ }
    };
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  const loginHref = `/login?next=${encodeURIComponent(pathname || "/")}`;

  return (
    <header className="sticky top-0 z-40 border-b bg-white/90 backdrop-blur">
      <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between gap-3">
        {/* Left: logo links home */}
        <Link href="/" className="flex items-center gap-2" aria-label="Go to home">
          <Image
            src="/brand/nocap-logo.jpg"
            alt="No Cap Smoke Shop"
            width={140}
            height={32}
            priority
            className="h-8 w-auto"
          />
          <span className="sr-only">Home</span>
        </Link>

        {/* Right: Home + Login/Logout */}
        <nav className="flex items-center gap-2">
          <Link href="/" className="border px-4 py-2 rounded hover:bg-gray-50">
            Home
          </Link>

          {isLoggedIn ? (
            <button
              onClick={handleLogout}
              className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded"
            >
              Logout
            </button>
          ) : (
            <Link
              href={loginHref}
              className="bg-black hover:bg-black/90 text-white px-4 py-2 rounded"
            >
              Login
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
