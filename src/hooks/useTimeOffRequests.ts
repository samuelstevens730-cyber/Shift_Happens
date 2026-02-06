import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type TimeOffRequest = {
  id: string;
  store_id: string;
  profile_id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  denial_reason: string | null;
  created_at: string;
  updated_at: string;
};

type TimeOffBlock = {
  id: string;
  profile_id: string;
  start_date: string;
  end_date: string;
  request_id: string | null;
  created_by: string | null;
  created_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
};

async function getAuthToken(): Promise<string | null> {
  if (typeof window !== "undefined") {
    const pinToken = sessionStorage.getItem("sh_pin_token");
    if (pinToken) return pinToken;
  }
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export function useTimeOffRequests() {
  const [requests, setRequests] = useState<TimeOffRequest[]>([]);
  const [blocks, setBlocks] = useState<TimeOffBlock[]>([]);
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

    const [reqRes, blockRes] = await Promise.all([
      fetch("/api/requests/time-off", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/time-off-blocks", { headers: { Authorization: `Bearer ${token}` } }),
    ]);

    const reqJson = await reqRes.json();
    const blockJson = await blockRes.json();

    if (!reqRes.ok) {
      setError(reqJson?.error ?? "Failed to load time off requests.");
      setLoading(false);
      return;
    }
    if (!blockRes.ok) {
      setError(blockJson?.error ?? "Failed to load time off blocks.");
      setLoading(false);
      return;
    }

    setRequests(reqJson?.rows ?? []);
    setBlocks(blockJson?.rows ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { requests, blocks, loading, error, refresh: fetchData };
}
