/**
 * Employee Dashboard - entry after PIN auth
 */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import PinGate from "@/components/PinGate";

type Store = { id: string; name: string; expected_drawer_cents: number };
type Profile = { id: string; name: string; active: boolean | null };

export default function EmployeeDashboard() {
  const [loading, setLoading] = useState(true);
  const [stores, setStores] = useState<Store[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [storeId, setStoreId] = useState("");
  const [profileId, setProfileId] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: storeData } = await supabase
          .from("stores")
          .select("id, name, expected_drawer_cents")
          .order("name", { ascending: true })
          .returns<Store[]>();

        const { data: profileData } = await supabase
          .from("profiles")
          .select("id, name, active")
          .order("name", { ascending: true })
          .returns<Profile[]>();

        if (!alive) return;
        const filteredProfiles = (profileData ?? []).filter(p => p.active !== false);
        setStores(storeData ?? []);
        setProfiles(filteredProfiles);
        if (!storeId) setStoreId(storeData?.[0]?.id ?? "");
        if (!profileId) setProfileId(filteredProfiles?.[0]?.id ?? "");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [storeId, profileId]);

  return (
    <div className="app-shell">
      <div className="max-w-md mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <span className="text-xs muted">Employee</span>
        </div>

        <div className="card card-pad space-y-3">
          <div className="text-sm muted">Quick links</div>
          <Link className="btn-primary px-4 py-2 text-center" href="/dashboard/shifts">
            My Shifts
          </Link>
          <Link className="btn-secondary px-4 py-2 text-center" href="/dashboard/schedule">
            My Schedule
          </Link>
        </div>
      </div>

      <PinGate
        loading={loading}
        stores={stores}
        profiles={profiles}
        qrToken=""
        tokenStore={null}
        storeId={storeId}
        setStoreId={setStoreId}
        profileId={profileId}
        setProfileId={setProfileId}
      />
    </div>
  );
}
