"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import AdminSidebar from "@/components/AdminSidebar";
import AdminBottomNav from "@/components/AdminBottomNav";
import AdminMobileHeader from "@/components/AdminMobileHeader";
import EmployeeShellFX from "@/components/EmployeeShellFX";
import { resetBrowserAuthState } from "@/lib/browserAuthCleanup";

type Store = { id: string; name: string };
type User = { id: string; name: string; active: boolean; storeIds: string[] };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [pendingRequests, setPendingRequests] = useState(0);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setAuthError(null);

        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (!alive) return;

        if (userError) {
          setAuthed(false);
          setAuthError("Your saved session could not be restored.");
          return;
        }

        if (!user) {
          const path = window.location.pathname;
          router.replace(`/login?next=${encodeURIComponent(path)}`);
          return;
        }

        const { data: authSession } = await supabase.auth.getSession();
        const token = authSession.session?.access_token ?? "";

        if (!alive) return;

        if (!token) {
          setAuthed(false);
          setAuthError("Your saved session could not be restored.");
          return;
        }

        setAuthed(true);

        const [usersRes, badgeRes] = await Promise.all([
          fetch("/api/admin/users", { headers: { Authorization: `Bearer ${token}` } }),
          fetch("/api/admin/badge-counts", { headers: { Authorization: `Bearer ${token}` } }),
        ]);

        if (!alive) return;

        if (usersRes.ok) {
          const usersJson = (await usersRes.json()) as { users?: User[]; stores?: Store[] };
          setUsers((usersJson.users ?? []).filter((u) => u.active));
          if (usersJson.stores) setStores(usersJson.stores);
        }

        if (badgeRes.ok) {
          const badgeJson = (await badgeRes.json()) as {
            pendingRequests: number;
            unreviewedVariances: number;
          };
          setPendingRequests(badgeJson.pendingRequests ?? 0);
        }
      } catch {
        if (!alive) return;
        setAuthed(false);
        setAuthError("Your saved session could not be restored.");
      }
    })();

    return () => {
      alive = false;
    };
  }, [router]);

  async function handleRecoverSession() {
    await resetBrowserAuthState();
    const path = window.location.pathname;
    router.replace(`/login?next=${encodeURIComponent(path)}`);
  }

  if (authError) {
    return (
      <div className="admin-shell min-h-screen grid place-items-center p-4">
        <EmployeeShellFX />
        <div className="card card-pad relative z-10 w-full max-w-md space-y-4 text-center">
          <div className="font-[family-name:var(--font-display)] text-2xl font-black uppercase tracking-tight">
            Session problem detected
          </div>
          <p className="text-sm text-[var(--muted)]">
            Your saved login state looks stale or corrupted. Clear this browser&apos;s app session and sign in again.
          </p>
          <button
            type="button"
            className="btn-primary w-full px-4 py-2 text-sm"
            onClick={() => void handleRecoverSession()}
          >
            Clear session and sign in
          </button>
        </div>
      </div>
    );
  }

  if (!authed) return null;

  return (
    <div className="admin-shell min-h-screen">
      <EmployeeShellFX />
      <AdminSidebar stores={stores} users={users} />
      <div className="lg:ml-[224px] min-h-screen pb-20 lg:pb-0">
        <AdminMobileHeader />
        {children}
      </div>
      <AdminBottomNav stores={stores} users={users} pendingRequests={pendingRequests} />
    </div>
  );
}
