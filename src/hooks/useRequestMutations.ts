import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type MutationResult<T> = {
  ok: boolean;
  data?: T;
  error?: string;
  status?: number;
};

async function getAuthToken(): Promise<string | null> {
  if (typeof window !== "undefined") {
    const pinToken = sessionStorage.getItem("sh_pin_token");
    if (pinToken) return pinToken;
  }
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export function useRequestMutations() {
  const [loading, setLoading] = useState(false);

  const submitSwapRequest = useCallback(
    async (payload: { scheduleShiftId: string; reason?: string | null; expiresHours?: number | null }) => {
      setLoading(true);
      try {
        const token = await getAuthToken();
        if (!token) return { ok: false, error: "Unauthorized.", status: 401 } satisfies MutationResult<never>;

        const res = await fetch("/api/requests/shift-swap", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) return { ok: false, error: data?.error ?? "Request failed", status: res.status };
        return { ok: true, data, status: res.status };
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const submitTimeOffRequest = useCallback(
    async (payload: { storeId: string; startDate: string; endDate: string; reason?: string | null }) => {
      setLoading(true);
      try {
        const token = await getAuthToken();
        if (!token) return { ok: false, error: "Unauthorized.", status: 401 } satisfies MutationResult<never>;

        const res = await fetch("/api/requests/time-off", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) return { ok: false, error: data?.error ?? "Request failed", status: res.status };
        return { ok: true, data, status: res.status };
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const submitTimesheetChange = useCallback(
    async (payload: {
      shiftId: string;
      requestedStartedAt?: string | null;
      requestedEndedAt?: string | null;
      reason: string;
    }) => {
      setLoading(true);
      try {
        const token = await getAuthToken();
        if (!token) return { ok: false, error: "Unauthorized.", status: 401 } satisfies MutationResult<never>;

        const res = await fetch("/api/requests/timesheet", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) return { ok: false, error: data?.error ?? "Request failed", status: res.status };
        return { ok: true, data, status: res.status };
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const cancelShiftSwapRequest = useCallback(async (requestId: string) => {
    setLoading(true);
    try {
      const token = await getAuthToken();
      if (!token) return { ok: false, error: "Unauthorized.", status: 401 } satisfies MutationResult<never>;

      const res = await fetch(`/api/requests/shift-swap/${requestId}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) return { ok: false, error: data?.error ?? "Request failed", status: res.status };
      return { ok: true, data, status: res.status };
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    loading,
    submitSwapRequest,
    submitTimeOffRequest,
    submitTimesheetChange,
    cancelShiftSwapRequest,
  };
}
