import { useCallback, useEffect, useMemo, useState } from "react";
import type { SafeCloseoutExpenseRow, SafeCloseoutPhotoRow, SafeCloseoutRow } from "@/types/safeLedger";

type StoreSettings = {
  store_id: string;
  safe_ledger_enabled: boolean;
  safe_deposit_tolerance_cents: number;
  safe_denom_tolerance_cents: number;
  safe_photo_retention_days: number;
  safe_photo_purge_day_of_month: number;
};

export type SafeCloseoutContext = {
  settings: StoreSettings;
  closeout: SafeCloseoutRow | null;
  expenses: SafeCloseoutExpenseRow[];
  photos: SafeCloseoutPhotoRow[];
};

export type SafeCloseoutMode = "task" | "gate";

type UseSafeCloseoutParams = {
  storeId: string | null;
  shiftId: string | null;
  businessDate: string | null;
  authToken: string | null;
  canUseSafeCloseout: boolean;
  splitFromClockoutFlow: boolean;
};

export function useSafeCloseout({
  storeId,
  shiftId,
  businessDate,
  authToken,
  canUseSafeCloseout,
  splitFromClockoutFlow,
}: UseSafeCloseoutParams) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<SafeCloseoutContext | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<SafeCloseoutMode>("task");

  const loadContext = useCallback(async () => {
    if (!canUseSafeCloseout || !storeId || !businessDate || !authToken) {
      setContext(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ storeId, date: businessDate });
      const res = await fetch(`/api/closeout/context?${query.toString()}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const json = (await res.json()) as SafeCloseoutContext & { error?: string };
      if (!res.ok) {
        throw new Error(json?.error || "Failed to load safe closeout context.");
      }
      setContext(json);
    } catch (e: unknown) {
      setContext(null);
      setError(e instanceof Error ? e.message : "Failed to load safe closeout context.");
    } finally {
      setLoading(false);
    }
  }, [authToken, businessDate, canUseSafeCloseout, storeId]);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  const isEnabled = useMemo(() => {
    return Boolean(canUseSafeCloseout && context?.settings?.safe_ledger_enabled);
  }, [canUseSafeCloseout, context?.settings?.safe_ledger_enabled]);

  const status = context?.closeout?.status ?? null;
  const hasDraft = status === "draft" || status === "warn" || status === "fail";
  const isPassed = status === "pass";
  const shouldGateClockOut = isEnabled && !isPassed && !splitFromClockoutFlow;

  const openWizard = useCallback((nextMode: SafeCloseoutMode) => {
    setMode(nextMode);
    setIsOpen(true);
  }, []);

  const closeWizard = useCallback(() => {
    setIsOpen(false);
  }, []);

  const refresh = useCallback(async () => {
    await loadContext();
  }, [loadContext]);

  return {
    loading,
    error,
    context,
    isEnabled,
    hasDraft,
    isPassed,
    shouldGateClockOut,
    isOpen,
    mode,
    openWizard,
    closeWizard,
    refresh,
    shiftId,
    storeId,
    businessDate,
  };
}
