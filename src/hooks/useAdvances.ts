import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type AdvanceRow = {
  id: string;
  profile_id: string;
  store_id: string | null;
  advance_date: string;
  advance_hours: string;
  cash_amount_cents: number | null;
  note: string | null;
  status: "pending_verification" | "verified" | "voided";
  created_at: string;
  store: { id: string; name: string } | null;
};

type StoreRow = { id: string; name: string };

async function getAuthToken(): Promise<string | null> {
  if (typeof window !== "undefined") {
    const pinToken = sessionStorage.getItem("sh_pin_token");
    if (pinToken) return pinToken;
  }
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export function useAdvances() {
  const [rows, setRows] = useState<AdvanceRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const token = await getAuthToken();
    if (!token) {
      setError("Unauthorized.");
      setLoading(false);
      return;
    }
    const res = await fetch("/api/requests/advances", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json?.error ?? "Failed to load advances.");
      setLoading(false);
      return;
    }
    setRows(json.rows ?? []);
    setStores(json.stores ?? []);
    setLoading(false);
  }, []);

  const submit = useCallback(async (payload: {
    storeId?: string | null;
    advanceDate?: string | null;
    advanceHours: number;
    cashAmountDollars?: number | null;
    note?: string | null;
  }) => {
    const token = await getAuthToken();
    if (!token) {
      return { ok: false as const, error: "Unauthorized." };
    }
    const res = await fetch("/api/requests/advances", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) {
      return { ok: false as const, error: json?.error ?? "Failed to submit advance." };
    }
    await refresh();
    return { ok: true as const };
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { rows, stores, loading, error, refresh, submit };
}
