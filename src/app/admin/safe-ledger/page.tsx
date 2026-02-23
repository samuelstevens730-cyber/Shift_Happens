"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ListRow = {
  id: string;
  store_id: string;
  store_name: string | null;
  business_date: string;
  shift_id: string | null;
  profile_id: string;
  employee_name: string | null;
  status: "draft" | "pass" | "warn" | "fail" | "locked";
  requires_manager_review: boolean;
  validation_attempts: number;
  cash_sales_cents: number;
  card_sales_cents: number;
  other_sales_cents: number;
  expense_total_cents: number;
  variance_cents: number;
  expected_deposit_cents: number;
  actual_deposit_cents: number;
  denom_total_cents: number;
  denoms_jsonb: Record<string, number | undefined>;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  edited_at: string | null;
  edited_by: string | null;
  edited_by_name?: string | null;
  is_historical_backfill: boolean;
};

type Store = { id: string; name: string };
type AdminUser = { id: string; name: string; active: boolean; storeIds: string[] };

type SafePickup = {
  id: string;
  store_id: string;
  store_name: string | null;
  pickup_date: string;
  pickup_at: string;
  amount_cents: number;
  note: string | null;
  recorded_by: string;
  recorded_by_name: string | null;
  created_at: string;
};

type DetailResponse = {
  closeout: ListRow & {
    employee_name: string | null;
    store_name: string | null;
    drawer_count_cents: number | null;
    deposit_override_reason: string | null;
    edited_by_name?: string | null;
  };
  expenses: Array<{ id: string; amount_cents: number; category: string; note: string | null; created_at: string }>;
  photos: Array<{ id: string; photo_type: "deposit_required" | "pos_optional"; storage_path: string | null; signed_url: string | null }>;
};

type PhotoUploadInput = {
  photo_type: "deposit_required" | "pos_optional";
  storage_path: string;
  thumb_path?: string | null;
  purge_after?: string | null;
};

type ExpenseDraft = {
  id?: string;
  amount: string;
  category: string;
  note: string;
};

function money(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "--";
  return `$${(cents / 100).toFixed(2)}`;
}

function toMoneyInput(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "";
  return (cents / 100).toFixed(2);
}

function parseMoneyInputToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

function varianceTone(varianceCents: number): string {
  if (Math.abs(varianceCents) <= 300) return "border-emerald-400/40 bg-emerald-900/20 text-emerald-200";
  if (varianceCents > 0) return "border-sky-400/40 bg-sky-900/20 text-sky-200";
  return "border-red-400/40 bg-red-900/20 text-red-200";
}

function statusChip(row: ListRow) {
  const historicalBadge = row.is_historical_backfill ? (
    <span className="rounded-full border border-sky-300 bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700">HISTORICAL</span>
  ) : null;
  const denomMismatchCents = row.actual_deposit_cents - row.denom_total_cents;
  const denomMismatchBadge = denomMismatchCents !== 0 ? (
    <span className="rounded-full border border-fuchsia-300 bg-fuchsia-100 px-2 py-0.5 text-xs font-semibold text-fuchsia-700">
      DENOM MISMATCH {money(denomMismatchCents)}
    </span>
  ) : null;

  if (row.requires_manager_review) {
    return <div className="flex flex-wrap items-center gap-1"><span className="rounded-full border border-orange-300 bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">REVIEW NEEDED</span>{denomMismatchBadge}{historicalBadge}</div>;
  }
  if (row.status === "pass") {
    return <div className="flex flex-wrap items-center gap-1"><span className="rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">PASS</span>{denomMismatchBadge}{historicalBadge}</div>;
  }
  if (row.status === "warn") {
    return <div className="flex flex-wrap items-center gap-1"><span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">WARN {money(row.variance_cents)}</span>{denomMismatchBadge}{historicalBadge}</div>;
  }
  if (row.status === "fail") {
    return <div className="flex flex-wrap items-center gap-1"><span className="rounded-full border border-red-300 bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">FAIL {money(row.variance_cents)}</span>{denomMismatchBadge}{historicalBadge}</div>;
  }
  return <div className="flex flex-wrap items-center gap-1"><span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{row.status.toUpperCase()}</span>{denomMismatchBadge}{historicalBadge}</div>;
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fromDateKey(key: string): Date {
  return new Date(`${key}T00:00:00`);
}

function weekdayLabel(dateKey: string): string {
  const day = fromDateKey(dateKey).getDay();
  const labels = ["SUN", "MON", "TUES", "WEDS", "THU", "FRI", "SAT"];
  return labels[day] ?? "UNK";
}

function isUuid(value: string | null | undefined): value is string {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function SafeLedgerDashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const source = searchParams.get("source");
  const actionId = searchParams.get("actionId");
  const actionStoreId = searchParams.get("storeId");
  const actionCreatedAt = searchParams.get("createdAt");
  const prefillAdd = searchParams.get("prefillAdd") === "1";
  const prefillStoreId = searchParams.get("prefillStoreId");
  const prefillProfileId = searchParams.get("prefillProfileId");
  const prefillBusinessDate = searchParams.get("prefillBusinessDate");
  const prefillShiftId = searchParams.get("prefillShiftId");
  const targetCloseoutId = actionId?.startsWith("money-") ? actionId.replace("money-", "") : null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ListRow[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [pickups, setPickups] = useState<SafePickup[]>([]);
  const [currentSafeBalanceByStore, setCurrentSafeBalanceByStore] = useState<Record<string, number>>({});
  const [storeId, setStoreId] = useState<string>("all");
  const [from, setFrom] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return toDateKey(d);
  });
  const [to, setTo] = useState<string>(() => toDateKey(new Date()));
  const [showIssuesOnly, setShowIssuesOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isPickupOpen, setIsPickupOpen] = useState(false);
  const [savingAdd, setSavingAdd] = useState(false);
  const [savingPickup, setSavingPickup] = useState(false);
  const [zoomPhoto, setZoomPhoto] = useState<{ url: string; label: string } | null>(null);
  const [editDepositPhotoFile, setEditDepositPhotoFile] = useState<File | null>(null);
  const [editPosPhotoFile, setEditPosPhotoFile] = useState<File | null>(null);
  const [addDepositPhotoFile, setAddDepositPhotoFile] = useState<File | null>(null);
  const [addPosPhotoFile, setAddPosPhotoFile] = useState<File | null>(null);
  const [editExpenses, setEditExpenses] = useState<ExpenseDraft[]>([]);
  const [editForm, setEditForm] = useState({
    status: "pass",
    cashSales: "",
    cardSales: "",
    otherSales: "",
    expectedDeposit: "",
    actualDeposit: "",
    drawerCount: "",
    d100: "0",
    d50: "0",
    d20: "0",
    d10: "0",
    d5: "0",
    d2: "0",
    d1: "0",
  });
  const [addForm, setAddForm] = useState({
    storeId: "",
    profileId: "",
    shiftId: "",
    businessDate: toDateKey(new Date()),
    cashSales: "",
    cardSales: "",
    otherSales: "0",
    actualDeposit: "",
    drawerCount: "200.00",
    expenses: "0",
    depositOverrideReason: "",
    d100: "0",
    d50: "0",
    d20: "0",
    d10: "0",
    d5: "0",
    d2: "0",
    d1: "0",
  });
  const [pickupForm, setPickupForm] = useState({
    storeId: "",
    pickupDate: toDateKey(new Date()),
    amount: "",
    note: "",
  });
  const [quickViewMode, setQuickViewMode] = useState<"week" | "month">("week");
  const [selectedWeek, setSelectedWeek] = useState<string>("1");
  const [hasAppliedDeepLink, setHasAppliedDeepLink] = useState(false);
  const [hasAppliedAddPrefill, setHasAppliedAddPrefill] = useState(false);

  const weekRanges = useMemo(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month, lastDayOfMonth);
    const cappedMonthEnd = today < monthEnd ? today : monthEnd;
    const ranges: Array<{ value: string; label: string; from: string; to: string }> = [];

    for (let week = 1; week <= 5; week += 1) {
      const startDay = (week - 1) * 7 + 1;
      const endDay = Math.min(week * 7, lastDayOfMonth);
      if (startDay > lastDayOfMonth) break;

      const start = new Date(year, month, startDay);
      let end = new Date(year, month, endDay);
      if (end > cappedMonthEnd) end = cappedMonthEnd;
      if (start > end) continue;

      ranges.push({
        value: String(week),
        label: `Week ${week} (${toDateKey(start)} to ${toDateKey(end)})`,
        from: toDateKey(start),
        to: toDateKey(end),
      });
    }

    // fallback so selector always has at least one option
    if (ranges.length === 0) {
      ranges.push({
        value: "1",
        label: `Week 1 (${toDateKey(monthStart)} to ${toDateKey(cappedMonthEnd)})`,
        from: toDateKey(monthStart),
        to: toDateKey(cappedMonthEnd),
      });
    }

    return ranges;
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (source !== "dashboard" || hasAppliedDeepLink) return;
    if (actionStoreId) setStoreId(actionStoreId);
    if (targetCloseoutId) setShowIssuesOnly(true);
    if (actionCreatedAt) {
      const dateKey = actionCreatedAt.slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        const targetDate = new Date(`${dateKey}T00:00:00`);
        if (!Number.isNaN(targetDate.getTime())) {
          const fromDate = new Date(targetDate);
          fromDate.setDate(fromDate.getDate() - 14);
          const today = new Date();
          setFrom(toDateKey(fromDate));
          setTo(toDateKey(today));
        }
      }
    }
  }, [source, hasAppliedDeepLink, actionStoreId, targetCloseoutId, actionCreatedAt]);

  async function withToken() {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token ?? "";
    if (!token) {
      router.replace("/login?next=/admin/safe-ledger");
      return null;
    }
    return token;
  }

  async function loadStores(token: string) {
    const res = await fetch("/api/admin/settings", { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || "Failed to load stores.");
    const nextStores: Store[] = (json?.stores ?? []).map((s: { id: string; name: string }) => ({ id: s.id, name: s.name }));
    setStores(nextStores);
    if (nextStores.length > 0 && storeId === "all") return;
    if (nextStores.length > 0 && !nextStores.some((s) => s.id === storeId)) {
      setStoreId("all");
    }
  }

  async function loadUsers(token: string) {
    const res = await fetch("/api/admin/users", { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || "Failed to load users.");
    setUsers((json?.users ?? []) as AdminUser[]);
  }

  async function loadRows(token: string) {
    const qs = new URLSearchParams({ from, to });
    if (storeId !== "all") qs.set("storeId", storeId);
    if (showIssuesOnly) qs.set("review_needed", "true");
    const res = await fetch(`/api/admin/safe-ledger?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || "Failed to load safe ledger.");
    setRows((json?.rows ?? []) as ListRow[]);
    setPickups((json?.pickups ?? []) as SafePickup[]);
    setCurrentSafeBalanceByStore((json?.current_safe_balance_by_store ?? {}) as Record<string, number>);
  }

  async function loadDetail(token: string, closeoutId: string) {
    const res = await fetch(`/api/admin/safe-ledger/${closeoutId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || "Failed to load detail.");
    setDetail(json as DetailResponse);
  }

  async function uploadPhoto(token: string, file: File): Promise<string> {
    const signedRes = await fetch("/api/admin/safe-ledger/upload-url", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        filename: file.name,
        fileType: file.type || "image/jpeg",
      }),
    });
    const signedJson = await signedRes.json();
    if (!signedRes.ok) throw new Error(signedJson?.error || "Failed to create photo upload URL.");

    const { path, token: uploadToken } = signedJson as { path: string; token: string };
    const { error } = await supabase.storage.from("safe-photos").uploadToSignedUrl(path, uploadToken, file);
    if (error) throw new Error(error.message);
    return path;
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setError(null);
        setLoading(true);
        const token = await withToken();
        if (!token || !alive) return;
        await Promise.all([loadStores(token), loadUsers(token), loadRows(token)]);
      } catch (e: unknown) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load safe ledger.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [storeId, from, to, showIssuesOnly]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setIsEditing(false);
      setEditDepositPhotoFile(null);
      setEditPosPhotoFile(null);
      setEditExpenses([]);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const token = await withToken();
        if (!token || !alive) return;
        setDetailLoading(true);
        await loadDetail(token, selectedId);
        if (!alive) return;
      } catch (e: unknown) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load detail.");
      } finally {
        if (alive) setDetailLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!detail?.closeout) return;
    setEditForm({
      status: detail.closeout.status === "locked" ? "fail" : detail.closeout.status,
      cashSales: toMoneyInput(detail.closeout.cash_sales_cents),
      cardSales: toMoneyInput(detail.closeout.card_sales_cents),
      otherSales: toMoneyInput(detail.closeout.other_sales_cents),
      expectedDeposit: toMoneyInput(detail.closeout.expected_deposit_cents),
      actualDeposit: toMoneyInput(detail.closeout.actual_deposit_cents),
      drawerCount: toMoneyInput(detail.closeout.drawer_count_cents),
      d100: String(Number(detail.closeout.denoms_jsonb?.["100"] ?? 0)),
      d50: String(Number(detail.closeout.denoms_jsonb?.["50"] ?? 0)),
      d20: String(Number(detail.closeout.denoms_jsonb?.["20"] ?? 0)),
      d10: String(Number(detail.closeout.denoms_jsonb?.["10"] ?? 0)),
      d5: String(Number(detail.closeout.denoms_jsonb?.["5"] ?? 0)),
      d2: String(Number(detail.closeout.denoms_jsonb?.["2"] ?? 0)),
      d1: String(Number(detail.closeout.denoms_jsonb?.["1"] ?? 0)),
    });
    setEditExpenses(
      detail.expenses.map((expense) => ({
        id: expense.id,
        amount: toMoneyInput(expense.amount_cents),
        category: expense.category,
        note: expense.note ?? "",
      }))
    );
  }, [detail]);

  const filteredRows = useMemo(() => {
    if (!showIssuesOnly) return rows;
    return rows.filter((r) => r.requires_manager_review || r.status === "warn" || r.status === "fail");
  }, [rows, showIssuesOnly]);

  useEffect(() => {
    if (source !== "dashboard" || hasAppliedDeepLink) return;
    if (!targetCloseoutId) {
      setHasAppliedDeepLink(true);
      return;
    }
    const exists = rows.some((row) => row.id === targetCloseoutId);
    if (exists) {
      setSelectedId(targetCloseoutId);
      setHasAppliedDeepLink(true);
    }
  }, [source, hasAppliedDeepLink, targetCloseoutId, rows]);

  const addFormUsers = useMemo(() => {
    if (!addForm.storeId) return users;
    return users.filter((user) => user.storeIds.includes(addForm.storeId));
  }, [addForm.storeId, users]);

  useEffect(() => {
    if (!isAddOpen) return;
    if (!addForm.storeId && stores.length > 0) {
      setAddForm((prev) => ({ ...prev, storeId: stores[0].id }));
    }
  }, [isAddOpen, addForm.storeId, stores]);

  useEffect(() => {
    if (!isAddOpen || !addForm.storeId) return;
    const validUsers = users.filter((user) => user.storeIds.includes(addForm.storeId));
    if (validUsers.length === 0) return;
    if (!validUsers.some((user) => user.id === addForm.profileId)) {
      setAddForm((prev) => ({ ...prev, profileId: validUsers[0].id }));
    }
  }, [isAddOpen, addForm.storeId, addForm.profileId, users]);

  useEffect(() => {
    if (!prefillAdd || hasAppliedAddPrefill) return;
    if (stores.length === 0) return;

    const selectedStoreId = isUuid(prefillStoreId) && stores.some((s) => s.id === prefillStoreId)
      ? prefillStoreId
      : storeId !== "all"
      ? storeId
      : stores[0]?.id ?? "";

    if (!selectedStoreId) {
      setHasAppliedAddPrefill(true);
      return;
    }

    const scopedUsers = users.filter((user) => user.storeIds.includes(selectedStoreId));
    const selectedProfileId = isUuid(prefillProfileId) && scopedUsers.some((user) => user.id === prefillProfileId)
      ? prefillProfileId
      : scopedUsers[0]?.id ?? "";

    const selectedBusinessDate =
      prefillBusinessDate && /^\d{4}-\d{2}-\d{2}$/.test(prefillBusinessDate)
        ? prefillBusinessDate
        : toDateKey(new Date());

    setAddForm((prev) => ({
      ...prev,
      storeId: selectedStoreId,
      profileId: selectedProfileId,
      shiftId: isUuid(prefillShiftId) ? prefillShiftId : "",
      businessDate: selectedBusinessDate,
    }));
    setIsAddOpen(true);
    setHasAppliedAddPrefill(true);
  }, [
    prefillAdd,
    hasAppliedAddPrefill,
    stores,
    users,
    storeId,
    prefillStoreId,
    prefillProfileId,
    prefillBusinessDate,
    prefillShiftId,
  ]);

  const pickupStoreId = useMemo(() => {
    if (pickupForm.storeId) return pickupForm.storeId;
    if (storeId !== "all") return storeId;
    return stores[0]?.id ?? "";
  }, [pickupForm.storeId, storeId, stores]);

  const suggestedPickupCents = useMemo(
    () => Math.max(0, currentSafeBalanceByStore[pickupStoreId] ?? 0),
    [currentSafeBalanceByStore, pickupStoreId]
  );

  useEffect(() => {
    if (!isPickupOpen) return;
    const defaultStoreId = storeId !== "all" ? storeId : stores[0]?.id ?? "";
    setPickupForm((prev) => ({
      ...prev,
      storeId: prev.storeId || defaultStoreId,
      pickupDate: prev.pickupDate || toDateKey(new Date()),
      amount: prev.amount || toMoneyInput(Math.max(0, currentSafeBalanceByStore[defaultStoreId] ?? 0)),
    }));
  }, [isPickupOpen, storeId, stores, currentSafeBalanceByStore]);

  useEffect(() => {
    if (!isPickupOpen || !pickupStoreId) return;
    setPickupForm((prev) => ({
      ...prev,
      amount: toMoneyInput(Math.max(0, currentSafeBalanceByStore[pickupStoreId] ?? 0)),
    }));
  }, [isPickupOpen, pickupStoreId, currentSafeBalanceByStore]);

  const storeReconciliationSummaries = useMemo(() => {
    const latestPickupByStore = new Map<string, string>();
    for (const pickup of pickups) {
      const current = latestPickupByStore.get(pickup.store_id);
      if (!current || pickup.pickup_date > current) {
        latestPickupByStore.set(pickup.store_id, pickup.pickup_date);
      }
    }

    const byStore = new Map<string, {
      storeId: string;
      storeName: string;
      expectedTotalCents: number;
      actualTotalCents: number;
      lastPickupDate: string | null;
      denoms: Record<"1" | "2" | "5" | "10" | "20" | "50" | "100", number>;
    }>();

    for (const row of filteredRows) {
      const key = row.store_id;
      const lastPickupDate = latestPickupByStore.get(key) ?? null;
      if (lastPickupDate && row.business_date <= lastPickupDate) {
        continue;
      }
      if (!byStore.has(key)) {
        byStore.set(key, {
          storeId: row.store_id,
          storeName: (row.store_name ?? "Unknown Store").toUpperCase(),
          expectedTotalCents: 0,
          actualTotalCents: 0,
          lastPickupDate,
          denoms: { "1": 0, "2": 0, "5": 0, "10": 0, "20": 0, "50": 0, "100": 0 },
        });
      }
      const summary = byStore.get(key)!;
      summary.expectedTotalCents += row.cash_sales_cents - row.expense_total_cents;
      summary.actualTotalCents += row.denom_total_cents;
      summary.denoms["1"] += Number(row.denoms_jsonb?.["1"] ?? 0);
      summary.denoms["2"] += Number(row.denoms_jsonb?.["2"] ?? 0);
      summary.denoms["5"] += Number(row.denoms_jsonb?.["5"] ?? 0);
      summary.denoms["10"] += Number(row.denoms_jsonb?.["10"] ?? 0);
      summary.denoms["20"] += Number(row.denoms_jsonb?.["20"] ?? 0);
      summary.denoms["50"] += Number(row.denoms_jsonb?.["50"] ?? 0);
      summary.denoms["100"] += Number(row.denoms_jsonb?.["100"] ?? 0);
    }

    for (const store of stores) {
      const lastPickupDate = latestPickupByStore.get(store.id) ?? null;
      if (!byStore.has(store.id) && lastPickupDate) {
        byStore.set(store.id, {
          storeId: store.id,
          storeName: store.name.toUpperCase(),
          expectedTotalCents: 0,
          actualTotalCents: 0,
          lastPickupDate,
          denoms: { "1": 0, "2": 0, "5": 0, "10": 0, "20": 0, "50": 0, "100": 0 },
        });
      }
    }

    return Array.from(byStore.values()).sort((a, b) => a.storeName.localeCompare(b.storeName));
  }, [filteredRows, pickups, stores]);

  async function copyText(text: string, successMsg: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast(successMsg);
    } catch {
      setToast("Copy failed.");
    }
  }

  function buildSalesTsv() {
    const orderedRows = [...filteredRows].sort((a, b) => a.business_date.localeCompare(b.business_date));
    const lines: string[] = [];
    for (const row of orderedRows) {
      lines.push(`${weekdayLabel(row.business_date)}\t${(row.cash_sales_cents / 100).toFixed(2)}\t${(row.card_sales_cents / 100).toFixed(2)}`);
    }
    return lines.join("\n");
  }

  function buildDenomTsv() {
    const keys: Array<"1" | "5" | "10" | "20" | "50" | "100"> = ["1", "5", "10", "20", "50", "100"];
    const totals: Record<string, number> = { "1": 0, "5": 0, "10": 0, "20": 0, "50": 0, "100": 0 };
    for (const row of filteredRows) {
      for (const key of keys) {
        totals[key] += Number(row.denoms_jsonb?.[key] ?? 0);
      }
    }
    const lines = ["NOTE\tQTY"];
    for (const key of keys) {
      lines.push(`${key}\t${totals[key]}`);
    }
    return lines.join("\n");
  }

  function applyQuickView() {
    if (quickViewMode === "month") {
      const today = new Date();
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      setFrom(toDateKey(monthStart));
      setTo(toDateKey(today));
      return;
    }

    const selectedRange = weekRanges.find((range) => range.value === selectedWeek) ?? weekRanges[0];
    setFrom(selectedRange.from);
    setTo(selectedRange.to);
  }

  async function markReviewed() {
    if (!detail?.closeout?.id) return;
    try {
      setReviewing(true);
      const token = await withToken();
      if (!token) return;
      const res = await fetch(`/api/admin/safe-ledger/${detail.closeout.id}/review`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reviewed: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to mark as reviewed.");
      setToast("Marked as reviewed.");
      setSelectedId(null);
      await loadRows(token);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to mark reviewed.");
    } finally {
      setReviewing(false);
    }
  }

  async function saveEdits() {
    if (!detail?.closeout?.id) return;

    const cashSalesCents = parseMoneyInputToCents(editForm.cashSales);
    const cardSalesCents = parseMoneyInputToCents(editForm.cardSales);
    const otherSalesCents = parseMoneyInputToCents(editForm.otherSales);
    const actualDepositCents = parseMoneyInputToCents(editForm.actualDeposit);
    const drawerCountCents = editForm.drawerCount.trim() ? parseMoneyInputToCents(editForm.drawerCount) : null;
    const denomValues = {
      "100": Number(editForm.d100 || "0"),
      "50": Number(editForm.d50 || "0"),
      "20": Number(editForm.d20 || "0"),
      "10": Number(editForm.d10 || "0"),
      "5": Number(editForm.d5 || "0"),
      "2": Number(editForm.d2 || "0"),
      "1": Number(editForm.d1 || "0"),
    };
    const denomsInvalid = Object.values(denomValues).some((qty) => !Number.isInteger(qty) || qty < 0);
    const expensePayload: Array<{ amount_cents: number; category: string; note?: string | null }> = [];
    for (const expense of editExpenses) {
      const amountCents = parseMoneyInputToCents(expense.amount);
      const category = expense.category.trim();
      if (amountCents == null || !category) {
        setError("Each expense needs a valid amount and category.");
        return;
      }
      expensePayload.push({
        amount_cents: amountCents,
        category,
        note: expense.note.trim() || null,
      });
    }

    if (
      cashSalesCents == null ||
      cardSalesCents == null ||
      otherSalesCents == null ||
      actualDepositCents == null ||
      (editForm.drawerCount.trim() && drawerCountCents == null) ||
      denomsInvalid
    ) {
      setError("Edit values must be valid non-negative dollar amounts.");
      return;
    }

    try {
      setSavingEdit(true);
      const token = await withToken();
      if (!token) return;
      const expenseTotalCents = expensePayload.reduce((sum, expense) => sum + expense.amount_cents, 0);
      const rawExpectedCents = cashSalesCents - expenseTotalCents;
      const computedExpectedCents = rawExpectedCents < 0 ? 0 : Math.trunc((rawExpectedCents + 50) / 100) * 100;
      setEditForm((prev) => ({ ...prev, expectedDeposit: toMoneyInput(computedExpectedCents) }));
      const photosToAppend: PhotoUploadInput[] = [];
      if (editDepositPhotoFile) {
        const storagePath = await uploadPhoto(token, editDepositPhotoFile);
        photosToAppend.push({ photo_type: "deposit_required", storage_path: storagePath });
      }
      if (editPosPhotoFile) {
        const storagePath = await uploadPhoto(token, editPosPhotoFile);
        photosToAppend.push({ photo_type: "pos_optional", storage_path: storagePath });
      }

      const res = await fetch(`/api/admin/safe-ledger/${detail.closeout.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          status: editForm.status,
          cash_sales_cents: cashSalesCents,
          card_sales_cents: cardSalesCents,
          other_sales_cents: otherSalesCents,
          expected_deposit_cents: computedExpectedCents,
          actual_deposit_cents: actualDepositCents,
          drawer_count_cents: drawerCountCents,
          denoms_jsonb: denomValues,
          expenses_replace: true,
          expenses: expensePayload,
          photos: photosToAppend,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to save closeout edits.");

      await Promise.all([loadRows(token), loadDetail(token, detail.closeout.id)]);
      setIsEditing(false);
      setEditDepositPhotoFile(null);
      setEditPosPhotoFile(null);
      setToast("Closeout updated.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save closeout edits.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function createManualCloseout() {
    const cashSalesCents = parseMoneyInputToCents(addForm.cashSales);
    const cardSalesCents = parseMoneyInputToCents(addForm.cardSales);
    const otherSalesCents = parseMoneyInputToCents(addForm.otherSales);
    const actualDepositCents = parseMoneyInputToCents(addForm.actualDeposit);
    const drawerCountCents = parseMoneyInputToCents(addForm.drawerCount);
    const expensesCents = parseMoneyInputToCents(addForm.expenses);

    const denoms = {
      "100": Number(addForm.d100 || "0"),
      "50": Number(addForm.d50 || "0"),
      "20": Number(addForm.d20 || "0"),
      "10": Number(addForm.d10 || "0"),
      "5": Number(addForm.d5 || "0"),
      "2": Number(addForm.d2 || "0"),
      "1": Number(addForm.d1 || "0"),
    };

    const denomInvalid = Object.values(denoms).some((qty) => !Number.isInteger(qty) || qty < 0);

    if (
      !addForm.storeId ||
      !addForm.profileId ||
      !addForm.businessDate ||
      cashSalesCents == null ||
      cardSalesCents == null ||
      otherSalesCents == null ||
      actualDepositCents == null ||
      drawerCountCents == null ||
      expensesCents == null ||
      denomInvalid
    ) {
      setError("Fill all manual closeout fields with valid non-negative values.");
      return;
    }

    try {
      setSavingAdd(true);
      const token = await withToken();
      if (!token) return;

      const photos: PhotoUploadInput[] = [];
      if (addDepositPhotoFile) {
        const storagePath = await uploadPhoto(token, addDepositPhotoFile);
        photos.push({ photo_type: "deposit_required", storage_path: storagePath });
      }
      if (addPosPhotoFile) {
        const storagePath = await uploadPhoto(token, addPosPhotoFile);
        photos.push({ photo_type: "pos_optional", storage_path: storagePath });
      }

      const res = await fetch("/api/admin/safe-ledger", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          store_id: addForm.storeId,
          profile_id: addForm.profileId,
          shift_id: addForm.shiftId || null,
          business_date: addForm.businessDate,
          cash_sales_cents: cashSalesCents,
          card_sales_cents: cardSalesCents,
          other_sales_cents: otherSalesCents,
          actual_deposit_cents: actualDepositCents,
          drawer_count_cents: drawerCountCents,
          denoms_jsonb: denoms,
          expenses: expensesCents > 0 ? [{ amount_cents: expensesCents, category: "manual_entry", note: "Manual admin entry" }] : [],
          photos,
          deposit_override_reason: addForm.depositOverrideReason.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to create manual closeout.");

      await loadRows(token);
      setIsAddOpen(false);
      setAddDepositPhotoFile(null);
      setAddPosPhotoFile(null);
      setAddForm((prev) => ({
        ...prev,
        shiftId: "",
        businessDate: toDateKey(new Date()),
        cashSales: "",
        cardSales: "",
        otherSales: "0",
        actualDeposit: "",
        drawerCount: "200.00",
        expenses: "0",
        depositOverrideReason: "",
        d100: "0",
        d50: "0",
        d20: "0",
        d10: "0",
        d5: "0",
        d2: "0",
        d1: "0",
      }));
      setToast("Manual closeout added.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create manual closeout.");
    } finally {
      setSavingAdd(false);
    }
  }

  async function createSafePickup() {
    const amountCents = parseMoneyInputToCents(pickupForm.amount);
    if (!pickupStoreId || !pickupForm.pickupDate || amountCents == null) {
      setError("Enter a valid pickup store, date, and amount.");
      return;
    }

    try {
      setSavingPickup(true);
      const token = await withToken();
      if (!token) return;

      const res = await fetch("/api/admin/safe-ledger/pickups", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          store_id: pickupStoreId,
          pickup_date: pickupForm.pickupDate,
          amount_cents: amountCents,
          note: pickupForm.note.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to record pickup.");

      await loadRows(token);
      setIsPickupOpen(false);
      setPickupForm({
        storeId: "",
        pickupDate: toDateKey(new Date()),
        amount: "",
        note: "",
      });
      setToast("Safe pickup recorded.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to record safe pickup.");
    } finally {
      setSavingPickup(false);
    }
  }

  return (
    <div className="space-y-4 p-6 text-slate-100">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h1 className="text-2xl font-semibold">Safe Ledger Dashboard</h1>
        <div className="flex items-center gap-2">
          <Button className="bg-cyan-600 text-white hover:bg-cyan-700" onClick={() => setIsAddOpen(true)}>Add Manual Closeout</Button>
          <Button className="bg-amber-600 text-white hover:bg-amber-700" onClick={() => setIsPickupOpen(true)}>Record Full Pickup</Button>
          <Button className="bg-purple-600 text-white hover:bg-purple-700" onClick={() => void copyText(buildSalesTsv(), "Copied Sales TSV")}>Copy Sales TSV</Button>
          <Button className="bg-purple-600 text-white hover:bg-purple-700" onClick={() => void copyText(buildDenomTsv(), "Copied Denom TSV")}>Copy Denom TSV</Button>
        </div>
      </div>

      {source === "dashboard" && (
        <div className="rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
          Opened from Command Center Action Items. Matching closeout is highlighted when available.
        </div>
      )}

      <div className="rounded-xl border border-cyan-400/30 bg-[#0b1220] p-4">
        <div className="grid gap-3 lg:grid-cols-4">
          <DatePicker label="Start Date" value={from} onChange={setFrom} max={to} />
          <DatePicker label="End Date" value={to} onChange={setTo} min={from} />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">Store</span>
            <select
              className="rounded-md border border-cyan-400/30 bg-slate-900/60 px-2 py-1.5"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
            >
              <option value="all">All Stores</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>{store.name}</option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">Quick View</span>
            <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center">
              <select
                className="w-full min-w-0 rounded-md border border-cyan-400/30 bg-slate-900/60 px-2 py-1.5 md:w-auto"
                value={quickViewMode}
                onChange={(e) => setQuickViewMode(e.target.value as "week" | "month")}
              >
                <option value="week">Weekly (Current Month)</option>
                <option value="month">Month to Date</option>
              </select>
              {quickViewMode === "week" && (
                <select
                  className="w-full min-w-0 rounded-md border border-cyan-400/30 bg-slate-900/60 px-2 py-1.5 md:w-auto"
                  value={selectedWeek}
                  onChange={(e) => setSelectedWeek(e.target.value)}
                >
                  {weekRanges.map((range) => (
                    <option key={range.value} value={range.value}>
                      {range.label}
                    </option>
                  ))}
                </select>
              )}
              <Button className="w-full bg-purple-600 text-white hover:bg-purple-700 md:w-auto" onClick={applyQuickView}>
                Apply
              </Button>
            </div>
          </div>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-200">
          <input type="checkbox" checked={showIssuesOnly} onChange={(e) => setShowIssuesOnly(e.target.checked)} />
          Show Issues Only
        </label>
      </div>
      <div className="rounded-xl border border-cyan-400/30 bg-[#0b1220] p-4">
        <div className="mb-3 text-sm font-semibold text-slate-200">Overall Store Reconciliation (Filtered Results)</div>
        {storeReconciliationSummaries.length === 0 ? (
          <div className="text-sm text-slate-400">No closeouts in current filter range.</div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {storeReconciliationSummaries.map((summary) => {
              const safeVariance = summary.actualTotalCents - summary.expectedTotalCents;
              const safeCleared = summary.expectedTotalCents === 0;
              return (
                <div key={summary.storeId} className="rounded border border-cyan-400/30 bg-slate-900/40 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-cyan-200">{summary.storeName}</div>
                    {safeCleared ? (
                      <span className="rounded-full border border-emerald-300 bg-emerald-900/30 px-2 py-0.5 text-xs font-semibold text-emerald-200">
                        SAFE CLEARED
                      </span>
                    ) : null}
                  </div>
                  <div className="grid gap-2 text-sm md:grid-cols-2">
                    <div>
                      <div className="text-xs uppercase text-slate-400">Expected Total</div>
                      <div>{money(summary.expectedTotalCents)}</div>
                      <div className="text-xs text-slate-500">Cash Sales - Expenses (since last pickup)</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase text-slate-400">Actual Total</div>
                      <div>{money(summary.actualTotalCents)}</div>
                      <div className="text-xs text-slate-500">Denomination Counts (since last pickup)</div>
                    </div>
                    <div className={`rounded border px-2 py-1 ${varianceTone(safeVariance)}`}>
                      <div className="text-xs uppercase">Variance (Actual - Expected)</div>
                      <div className="font-semibold">{money(safeVariance)}</div>
                    </div>
                  </div>
                  {summary.lastPickupDate ? (
                    <div className="mt-2 text-xs text-emerald-300">Baseline reset by full pickup on {summary.lastPickupDate}</div>
                  ) : null}
                  <div className="mt-3 text-xs text-slate-300">
                    Denomination count: 1({summary.denoms["1"]}) 2({summary.denoms["2"]}) 5({summary.denoms["5"]}) 10({summary.denoms["10"]}) 20({summary.denoms["20"]}) 50({summary.denoms["50"]}) 100({summary.denoms["100"]})
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {error && <div className="rounded border border-red-400/50 bg-red-900/30 p-2 text-sm text-red-200">{error}</div>}
      {loading ? (
        <div className="rounded border border-cyan-400/30 bg-[#0b1220] p-4 text-sm text-slate-300">Loading safe ledger...</div>
      ) : (
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Store</TableHead>
                <TableHead>Closer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Variance ($)</TableHead>
                <TableHead>Edited By</TableHead>
                <TableHead>Date Edited</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map((row) => (
                <TableRow
                  key={row.id}
                  className={targetCloseoutId === row.id ? "ring-1 ring-cyan-400/40" : undefined}
                >
                  <TableCell>{row.business_date}</TableCell>
                  <TableCell>{row.store_name ?? "--"}</TableCell>
                  <TableCell>{row.employee_name ?? "--"}</TableCell>
                  <TableCell>{statusChip(row)}</TableCell>
                  <TableCell>{money(row.variance_cents)}</TableCell>
                  <TableCell>{row.edited_by_name ?? row.edited_by ?? "--"}</TableCell>
                  <TableCell>{row.edited_at ? new Date(row.edited_at).toLocaleString() : "--"}</TableCell>
                  <TableCell>
                    <Button variant="secondary" onClick={() => setSelectedId(row.id)}>View</Button>
                  </TableCell>
                </TableRow>
              ))}
              {filteredRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-slate-400">No closeouts for selected filters.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={Boolean(selectedId)} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Safe Closeout Detail</DialogTitle>
            <DialogDescription>
              {detail?.closeout?.store_name ?? "--"} · {detail?.closeout?.business_date ?? "--"} · {detail?.closeout?.employee_name ?? "--"}
            </DialogDescription>
          </DialogHeader>
          {detail?.closeout?.is_historical_backfill && (
            <div className="rounded border border-sky-400/40 bg-sky-900/20 px-3 py-2 text-xs text-sky-200">
              Historical backfill row
            </div>
          )}
          {detailLoading || !detail ? (
            <div className="text-sm text-slate-300">Loading detail...</div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded border border-cyan-400/30 bg-slate-900/40 p-3 text-sm">
                  <div className="font-medium">Cash Sales</div>
                  {isEditing ? (
                    <input
                      className="mt-1 w-full rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1"
                      value={editForm.cashSales}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, cashSales: e.target.value }))}
                    />
                  ) : (
                    <div>{money(detail.closeout.cash_sales_cents)}</div>
                  )}
                </div>
                <div className="rounded border border-cyan-400/30 bg-slate-900/40 p-3 text-sm">
                  <div className="font-medium">Card Sales</div>
                  {isEditing ? (
                    <input
                      className="mt-1 w-full rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1"
                      value={editForm.cardSales}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, cardSales: e.target.value }))}
                    />
                  ) : (
                    <div>{money(detail.closeout.card_sales_cents)}</div>
                  )}
                </div>
                <div className="rounded border border-cyan-400/30 bg-slate-900/40 p-3 text-sm">
                  <div className="font-medium">Drawer Count (Float)</div>
                  {isEditing ? (
                    <input
                      className="mt-1 w-full rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1"
                      value={editForm.drawerCount}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, drawerCount: e.target.value }))}
                    />
                  ) : (
                    <div>{money(detail.closeout.drawer_count_cents)}</div>
                  )}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded border border-cyan-400/30 bg-slate-900/40 p-3 text-sm">
                  <div className="font-medium">Other Sales</div>
                  {isEditing ? (
                    <input
                      className="mt-1 w-full rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1"
                      value={editForm.otherSales}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, otherSales: e.target.value }))}
                    />
                  ) : (
                    <div>{money(detail.closeout.other_sales_cents)}</div>
                  )}
                </div>
                <div className="rounded border border-cyan-400/30 bg-slate-900/40 p-3 text-sm">
                  <div className="font-medium">Edited By</div>
                  <div>{detail.closeout.edited_by_name ?? detail.closeout.edited_by ?? "--"}</div>
                </div>
                <div className="rounded border border-cyan-400/30 bg-slate-900/40 p-3 text-sm">
                  <div className="font-medium">Date Edited</div>
                  <div>{detail.closeout.edited_at ? new Date(detail.closeout.edited_at).toLocaleString() : "--"}</div>
                </div>
              </div>

              <div className="rounded border border-cyan-400/30 bg-slate-900/40 p-3 text-sm">
                <div className="mb-2 font-medium">Expenses</div>
                {isEditing ? (
                  <div className="space-y-2">
                    {editExpenses.map((expense, idx) => (
                      <div key={`${expense.id ?? "new"}-${idx}`} className="grid gap-2 md:grid-cols-12">
                        <input
                          className="md:col-span-3 rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1"
                          placeholder="Amount ($)"
                          value={expense.amount}
                          onChange={(e) => setEditExpenses((prev) => prev.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)))}
                        />
                        <input
                          className="md:col-span-3 rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1"
                          placeholder="Category"
                          value={expense.category}
                          onChange={(e) => setEditExpenses((prev) => prev.map((x, i) => (i === idx ? { ...x, category: e.target.value } : x)))}
                        />
                        <input
                          className="md:col-span-5 rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1"
                          placeholder="Note (optional)"
                          value={expense.note}
                          onChange={(e) => setEditExpenses((prev) => prev.map((x, i) => (i === idx ? { ...x, note: e.target.value } : x)))}
                        />
                        <Button
                          className="md:col-span-1 bg-slate-700 text-slate-100 hover:bg-slate-600"
                          onClick={() => setEditExpenses((prev) => prev.filter((_, i) => i !== idx))}
                        >
                          X
                        </Button>
                      </div>
                    ))}
                    <Button
                      className="bg-slate-700 text-slate-100 hover:bg-slate-600"
                      onClick={() => setEditExpenses((prev) => [...prev, { amount: "0.00", category: "", note: "" }])}
                    >
                      Add Expense
                    </Button>
                  </div>
                ) : detail.expenses.length === 0 ? (
                  <div className="text-slate-400">No expenses.</div>
                ) : (
                  <ul className="space-y-1">
                    {detail.expenses.map((expense) => (
                      <li key={expense.id} className="flex items-center justify-between">
                        <span>{expense.note || expense.category}</span>
                        <span>{money(expense.amount_cents)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded border border-cyan-400/30 bg-slate-900/40 p-3 text-sm">
                <div className="mb-2 font-medium">Denominations (Qty)</div>
                <div className="grid gap-2 md:grid-cols-7">
                  {(["d100", "d50", "d20", "d10", "d5", "d2", "d1"] as const).map((key) => (
                    <label key={key} className="text-xs text-slate-300">
                      {key.replace("d", "$")}
                      {isEditing ? (
                        <input
                          className="mt-1 w-full rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1"
                          value={editForm[key]}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, [key]: e.target.value }))}
                        />
                      ) : (
                        <div className="mt-1 rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1">
                          {Number(detail.closeout.denoms_jsonb?.[key.replace("d", "")] ?? 0)}
                        </div>
                      )}
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded border border-cyan-400/30 bg-slate-900/40 p-3 text-sm">
                  <div className="font-medium">Expected Deposit</div>
                  {isEditing ? (
                    <div>
                      <input
                        className="mt-1 w-full rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1"
                        value={editForm.expectedDeposit}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, expectedDeposit: e.target.value }))}
                      />
                      <div className="mt-1 text-xs text-slate-400">Auto-recalculated from Cash - Expenses when you save.</div>
                    </div>
                  ) : (
                    <div>{money(detail.closeout.expected_deposit_cents)}</div>
                  )}
                </div>
                <div className="rounded border border-cyan-400/30 bg-slate-900/40 p-3 text-sm">
                  <div className="font-medium">Actual Deposit</div>
                  {isEditing ? (
                    <input
                      className="mt-1 w-full rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1"
                      value={editForm.actualDeposit}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, actualDeposit: e.target.value }))}
                    />
                  ) : (
                    <div>{money(detail.closeout.actual_deposit_cents)}</div>
                  )}
                </div>
              </div>
              {isEditing && (
                <div className="rounded border border-cyan-400/30 bg-slate-900/40 p-3 text-sm">
                  <div className="font-medium">Status</div>
                  <select
                    className="mt-1 w-full rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1"
                    value={editForm.status}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, status: e.target.value }))}
                  >
                    <option value="pass">PASS</option>
                    <option value="warn">WARN</option>
                    <option value="fail">FAIL</option>
                    <option value="draft">DRAFT</option>
                  </select>
                </div>
              )}

              <div className="rounded border border-cyan-400/30 bg-slate-900/40 p-3 text-sm">
                <div className="mb-2 font-medium">Evidence</div>
                {isEditing && (
                  <div className="mb-3 grid gap-3 md:grid-cols-2">
                    <label className="flex flex-col gap-1 text-xs text-slate-300">
                      Add Deposit Slip Photo
                      <input
                        type="file"
                        accept="image/*"
                        className="rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1"
                        onChange={(e) => setEditDepositPhotoFile(e.target.files?.[0] ?? null)}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-slate-300">
                      Add POS/Z-Report Photo
                      <input
                        type="file"
                        accept="image/*"
                        className="rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1"
                        onChange={(e) => setEditPosPhotoFile(e.target.files?.[0] ?? null)}
                      />
                    </label>
                  </div>
                )}
                {detail.photos.length === 0 ? (
                  <div className="text-slate-400">No photos uploaded.</div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {detail.photos.map((photo) => (
                      <div key={photo.id} className="space-y-1">
                        <div className="text-xs uppercase text-slate-400">{photo.photo_type.replace("_", " ")}</div>
                        {photo.signed_url ? (
                          <button
                            type="button"
                            className="w-full"
                            onClick={() =>
                              setZoomPhoto({
                                url: photo.signed_url!,
                                label: photo.photo_type.replace("_", " "),
                              })
                            }
                          >
                            <img
                              src={photo.signed_url}
                              alt={photo.photo_type}
                              className="h-48 w-full rounded border border-cyan-400/30 object-cover transition-opacity hover:opacity-90"
                            />
                          </button>
                        ) : (
                          <div className="rounded border border-cyan-400/30 p-3 text-xs text-slate-400">Photo unavailable.</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <Button className="border border-cyan-400/40 bg-slate-900/60 text-slate-100 hover:bg-slate-800" onClick={() => setSelectedId(null)}>Close</Button>
                {isEditing ? (
                  <>
                    <Button className="bg-slate-700 text-slate-100 hover:bg-slate-600" onClick={() => setIsEditing(false)} disabled={savingEdit}>
                      Cancel Edit
                    </Button>
                    <Button className="bg-purple-600 text-white hover:bg-purple-700" onClick={() => void saveEdits()} disabled={savingEdit}>
                      {savingEdit ? "Saving..." : "Save Edit"}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button className="bg-purple-600 text-white hover:bg-purple-700" onClick={() => setIsEditing(true)}>
                      Edit
                    </Button>
                    <Button className="bg-emerald-500 text-black hover:bg-emerald-400" onClick={() => void markReviewed()} disabled={reviewing}>
                      {reviewing ? "Saving..." : "Mark as Reviewed"}
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={isPickupOpen}
        onOpenChange={(open) => {
          setIsPickupOpen(open);
          if (!open) {
            setPickupForm({
              storeId: "",
              pickupDate: toDateKey(new Date()),
              amount: "",
              note: "",
            });
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Full Pickup</DialogTitle>
            <DialogDescription>
              Default amount is current safe cash on hand. Edit if needed, then save pickup to clear safe balance.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="flex flex-col gap-1 text-xs text-slate-300">
                Store
                <select
                  className="rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1"
                  value={pickupStoreId}
                  onChange={(e) => setPickupForm((prev) => ({ ...prev, storeId: e.target.value }))}
                >
                  <option value="">Select store</option>
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>{store.name}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-300">
                Pickup Date
                <input
                  type="date"
                  className="rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1"
                  value={pickupForm.pickupDate}
                  onChange={(e) => setPickupForm((prev) => ({ ...prev, pickupDate: e.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-300">
                Pickup Amount ($)
                <input
                  className="rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1"
                  value={pickupForm.amount}
                  onChange={(e) => setPickupForm((prev) => ({ ...prev, amount: e.target.value }))}
                />
              </label>
            </div>

            <div className="rounded border border-amber-400/30 bg-amber-900/20 p-2 text-xs text-amber-100">
              Suggested full pickup: <span className="font-semibold">{money(suggestedPickupCents)}</span>
            </div>

            <label className="flex flex-col gap-1 text-xs text-slate-300">
              Note
              <input
                className="rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1"
                placeholder="Owner pickup / end-of-period clear"
                value={pickupForm.note}
                onChange={(e) => setPickupForm((prev) => ({ ...prev, note: e.target.value }))}
              />
            </label>

            <div className="flex justify-end gap-2">
              <Button className="border border-cyan-400/40 bg-slate-900/60 text-slate-100 hover:bg-slate-800" onClick={() => setIsPickupOpen(false)} disabled={savingPickup}>
                Cancel
              </Button>
              <Button className="bg-amber-600 text-white hover:bg-amber-700" onClick={() => void createSafePickup()} disabled={savingPickup}>
                {savingPickup ? "Saving..." : "Record Pickup"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isAddOpen}
        onOpenChange={(open) => {
          setIsAddOpen(open);
          if (!open) {
            setAddDepositPhotoFile(null);
            setAddPosPhotoFile(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Manual Safe Closeout</DialogTitle>
            <DialogDescription>Create a closeout and optionally attach photos.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="flex flex-col gap-1 text-xs text-slate-300">
                Store
                <select
                  className="rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1"
                  value={addForm.storeId}
                  onChange={(e) => setAddForm((prev) => ({ ...prev, storeId: e.target.value }))}
                >
                  <option value="">Select store</option>
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>{store.name}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-300">
                Closer
                <select
                  className="rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1"
                  value={addForm.profileId}
                  onChange={(e) => setAddForm((prev) => ({ ...prev, profileId: e.target.value }))}
                >
                  <option value="">Select closer</option>
                  {addFormUsers.map((user) => (
                    <option key={user.id} value={user.id}>{user.name}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-300">
                Business Date
                <input
                  type="date"
                  className="rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1"
                  value={addForm.businessDate}
                  onChange={(e) => setAddForm((prev) => ({ ...prev, businessDate: e.target.value }))}
                />
              </label>
            </div>

            <div className="rounded border border-cyan-400/20 bg-slate-900/30 p-2 text-xs text-slate-300">
              <div className="font-medium text-slate-100">Linked Shift (optional)</div>
              {addForm.shiftId ? (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <code className="rounded bg-slate-950 px-2 py-1 text-[11px]">{addForm.shiftId}</code>
                  <button
                    type="button"
                    className="rounded border border-slate-600 px-2 py-1 text-[11px] hover:bg-slate-800"
                    onClick={() => setAddForm((prev) => ({ ...prev, shiftId: "" }))}
                  >
                    Clear Shift Link
                  </button>
                </div>
              ) : (
                <div className="mt-1 text-slate-400">
                  No shift prefilled. Open this modal from shift detail to auto-link.
                </div>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <label className="flex flex-col gap-1 text-xs text-slate-300">Cash Sales ($)
                <input className="rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1" value={addForm.cashSales} onChange={(e) => setAddForm((prev) => ({ ...prev, cashSales: e.target.value }))} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-300">Card Sales ($)
                <input className="rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1" value={addForm.cardSales} onChange={(e) => setAddForm((prev) => ({ ...prev, cardSales: e.target.value }))} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-300">Actual Deposit ($)
                <input className="rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1" value={addForm.actualDeposit} onChange={(e) => setAddForm((prev) => ({ ...prev, actualDeposit: e.target.value }))} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-300">Expenses ($)
                <input className="rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1" value={addForm.expenses} onChange={(e) => setAddForm((prev) => ({ ...prev, expenses: e.target.value }))} />
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <label className="flex flex-col gap-1 text-xs text-slate-300">Other Sales ($)
                <input className="rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1" value={addForm.otherSales} onChange={(e) => setAddForm((prev) => ({ ...prev, otherSales: e.target.value }))} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-300">Drawer Float ($)
                <input className="rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1" value={addForm.drawerCount} onChange={(e) => setAddForm((prev) => ({ ...prev, drawerCount: e.target.value }))} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-300">Override Reason (Optional)
                <input className="rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1" value={addForm.depositOverrideReason} onChange={(e) => setAddForm((prev) => ({ ...prev, depositOverrideReason: e.target.value }))} />
              </label>
            </div>

            <div className="rounded border border-cyan-400/30 bg-slate-900/40 p-3">
              <div className="mb-2 text-xs font-semibold text-slate-200">Denominations (Qty)</div>
              <div className="grid gap-2 md:grid-cols-7">
                <label className="text-xs text-slate-300">$100<input className="mt-1 w-full rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1" value={addForm.d100} onChange={(e) => setAddForm((prev) => ({ ...prev, d100: e.target.value }))} /></label>
                <label className="text-xs text-slate-300">$50<input className="mt-1 w-full rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1" value={addForm.d50} onChange={(e) => setAddForm((prev) => ({ ...prev, d50: e.target.value }))} /></label>
                <label className="text-xs text-slate-300">$20<input className="mt-1 w-full rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1" value={addForm.d20} onChange={(e) => setAddForm((prev) => ({ ...prev, d20: e.target.value }))} /></label>
                <label className="text-xs text-slate-300">$10<input className="mt-1 w-full rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1" value={addForm.d10} onChange={(e) => setAddForm((prev) => ({ ...prev, d10: e.target.value }))} /></label>
                <label className="text-xs text-slate-300">$5<input className="mt-1 w-full rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1" value={addForm.d5} onChange={(e) => setAddForm((prev) => ({ ...prev, d5: e.target.value }))} /></label>
                <label className="text-xs text-slate-300">$2<input className="mt-1 w-full rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1" value={addForm.d2} onChange={(e) => setAddForm((prev) => ({ ...prev, d2: e.target.value }))} /></label>
                <label className="text-xs text-slate-300">$1<input className="mt-1 w-full rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1" value={addForm.d1} onChange={(e) => setAddForm((prev) => ({ ...prev, d1: e.target.value }))} /></label>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-slate-300">
                Deposit Slip Photo (Optional)
                <input
                  type="file"
                  accept="image/*"
                  className="rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1"
                  onChange={(e) => setAddDepositPhotoFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-300">
                POS/Z-Report Photo (Optional)
                <input
                  type="file"
                  accept="image/*"
                  className="rounded border border-cyan-400/30 bg-slate-900/60 px-2 py-1"
                  onChange={(e) => setAddPosPhotoFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>

            <div className="flex justify-end gap-2">
              <Button className="border border-cyan-400/40 bg-slate-900/60 text-slate-100 hover:bg-slate-800" onClick={() => setIsAddOpen(false)} disabled={savingAdd}>
                Cancel
              </Button>
              <Button className="bg-cyan-600 text-white hover:bg-cyan-700" onClick={() => void createManualCloseout()} disabled={savingAdd}>
                {savingAdd ? "Saving..." : "Create Closeout"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {toast && (
        <div className="fixed right-4 top-4 z-50 rounded border border-cyan-400/40 bg-[#0b1220] px-3 py-2 text-sm text-slate-100 shadow">
          {toast}
        </div>
      )}

      {zoomPhoto && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4"
          onClick={() => setZoomPhoto(null)}
        >
          <div className="w-full max-w-6xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between text-sm text-slate-200">
              <span className="uppercase">{zoomPhoto.label}</span>
              <Button
                className="border border-cyan-400/40 bg-slate-900/60 text-slate-100 hover:bg-slate-800"
                onClick={() => setZoomPhoto(null)}
              >
                Close
              </Button>
            </div>
            <img
              src={zoomPhoto.url}
              alt={zoomPhoto.label}
              className="max-h-[85vh] w-full rounded border border-cyan-400/40 object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function SafeLedgerDashboardPage() {
  return (
    <Suspense fallback={<div className="space-y-4 p-6 text-slate-100">Loading safe ledger...</div>}>
      <SafeLedgerDashboardContent />
    </Suspense>
  );
}
