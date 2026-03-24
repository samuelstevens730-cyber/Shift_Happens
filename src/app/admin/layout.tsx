"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import AdminSidebar from "@/components/AdminSidebar";
import AdminBottomNav from "@/components/AdminBottomNav";

type Store = { id: string; name: string };
type User = { id: string; name: string; active: boolean; storeIds: string[] };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [stores, setStores] = useState<Store[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [pendingRequests, setPendingRequests] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Auth check — same pattern used by existing admin pages
        const { data: { user } } = await supabase.auth.getUser();
        if (!alive) return;
        if (!user) {
          const path = window.location.pathname;
          router.replace(`/login?next=${encodeURIComponent(path)}`);
          return;
        }
        setAuthed(true);

        // Fetch stores, users, and badge counts in parallel
        const { data: authSession } = await supabase.auth.getSession();
        const token = authSession.session?.access_token ?? "";
        if (!token || !alive) return;

        const [usersRes, badgeRes] = await Promise.all([
          fetch("/api/admin/users", { headers: { Authorization: `Bearer ${token}` } }),
          fetch("/api/admin/badge-counts", { headers: { Authorization: `Bearer ${token}` } }),
        ]);

        if (!alive) return;

        if (usersRes.ok) {
          const usersJson = await usersRes.json() as { users?: User[]; stores?: Store[] };
          setUsers((usersJson.users ?? []).filter((u) => u.active));
          // /api/admin/users returns stores alongside users
          if (usersJson.stores) setStores(usersJson.stores);
        }

        if (badgeRes.ok) {
          const badgeJson = await badgeRes.json() as { pendingRequests: number; unreviewedVariances: number };
          setPendingRequests(badgeJson.pendingRequests ?? 0);
        }
      } catch {
        // silently fail — pages handle their own errors
      }
    })();
    return () => { alive = false; };
  }, [router]);

  if (!authed) return null; // auth redirect in progress

  return (
    <div className="flex min-h-screen">
      <AdminSidebar stores={stores} users={users} />
      {/* Content area — fills remaining width via flex-1; overflow-y: auto so full-width pages scroll correctly */}
      <div className="flex-1 min-h-0 overflow-y-auto pb-20 lg:pb-0">
        {children}
      </div>
      <AdminBottomNav stores={stores} users={users} pendingRequests={pendingRequests} />
    </div>
  );
}
