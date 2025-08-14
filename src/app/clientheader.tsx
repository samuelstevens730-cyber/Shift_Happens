// src/app/ClientHeader.tsx  (CLIENT component)
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function ClientHeader() {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);

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

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (!isLoggedIn) return null;

  return (
    <header className="p-4 flex justify-end border-b">
      <button onClick={handleLogout} className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded">
        Logout
      </button>
    </header>
  );
}
