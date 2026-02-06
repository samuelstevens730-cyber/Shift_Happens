import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type TimesheetRequest = {
  id: string;
  shift_id: string;
  store_id: string;
  requester_profile_id: string;
  requested_started_at: string | null;
  requested_ended_at: string | null;
  original_started_at: string;
  original_ended_at: string | null;
  reason: string;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  denial_reason: string | null;
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

export function useTimesheetRequests() {
  const [rows, setRows] = useState<TimesheetRequest[]>([]);
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
    const res = await fetch("/api/requests/timesheet", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error ?? "Failed to load timesheet requests.");
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
