import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type ShiftSwapRequest = {
  id: string;
  schedule_shift_id: string;
  store_id: string;
  requester_profile_id: string;
  reason: string | null;
  status: string;
  selected_offer_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  denial_reason: string | null;
  expires_at: string;
  nudge_sent_at: string | null;
  created_at: string;
  updated_at: string;
};

async function getAuthToken(): Promise<string | null> {
  if (typeof window !== "undefined") {
    const pinToken = sessionStorage.getItem("sh_pin_token");
    if (pinToken) return pinToken;
  }
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export function useShiftSwapRequests() {
  const [rows, setRows] = useState<ShiftSwapRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const token = await getAuthToken();
    if (!token) {
      setError("Unauthorized.");
      setLoading(false);
      return;
    }
    const res = await fetch("/api/requests/shift-swap", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error ?? "Failed to load swap requests.");
      setLoading(false);
      return;
    }
    setRows(data?.rows ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { rows, loading, error, refresh: fetchData };
}
