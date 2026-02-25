"use client";

import { useEffect, useMemo, useState } from "react";
import type { SafeCloseoutContext, SafeCloseoutMode } from "@/hooks/useSafeCloseout";

type ExpenseDraftRow = {
  id: string;
  amount: string;
  note: string;
};

type SubmitStatus = "pass" | "warn" | "fail";

type Props = {
  open: boolean;
  mode: SafeCloseoutMode;
  authToken: string | null;
  storeId: string | null;
  shiftId: string | null;
  businessDate: string | null;
  context: SafeCloseoutContext | null;
  onClose: () => void;
  onSubmitted: (status: SubmitStatus) => void;
  onRefreshContext: () => Promise<void>;
};

function centsFromInput(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function expectedDeposit(cashSalesCents: number, expenseTotalCents: number): number {
  const raw = cashSalesCents - expenseTotalCents;
  if (raw <= 0) return 0;
  return Math.floor((raw + 50) / 100) * 100;
}

function buildExpenseRows(context: SafeCloseoutContext | null): ExpenseDraftRow[] {
  if (!context || context.expenses.length === 0) {
    return [{ id: crypto.randomUUID(), amount: "", note: "" }];
  }
  return context.expenses.map((row) => ({
    id: row.id,
    amount: (row.amount_cents / 100).toFixed(2),
    note: row.note ?? "",
  }));
}

export default function SafeCloseoutWizard({
  open,
  mode,
  authToken,
  storeId,
  shiftId,
  businessDate,
  context,
  onClose,
  onSubmitted,
  onRefreshContext,
}: Props) {
  const [step, setStep] = useState(1);
  const [priorX, setPriorX] = useState("");
  const [cashSales, setCashSales] = useState("");
  const [cardSales, setCardSales] = useState("");
  const [expenses, setExpenses] = useState<ExpenseDraftRow[]>([{ id: crypto.randomUUID(), amount: "", note: "" }]);
  const [denoms, setDenoms] = useState<Record<"100" | "50" | "20" | "10" | "5" | "2" | "1", string>>({
    "100": "",
    "50": "",
    "20": "",
    "10": "",
    "5": "",
    "2": "",
    "1": "",
  });
  const [varianceReason, setVarianceReason] = useState("");
  const [varianceOverride, setVarianceOverride] = useState(false);
  const [drawerCount, setDrawerCount] = useState("");
  const [depositFile, setDepositFile] = useState<File | null>(null);
  const [posFile, setPosFile] = useState<File | null>(null);
  const [depositPath, setDepositPath] = useState<string | null>(null);
  const [posPath, setPosPath] = useState<string | null>(null);
  const [closeoutId, setCloseoutId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [submitResult, setSubmitResult] = useState<{ status: SubmitStatus; message: string } | null>(null);

  const denomTolerance = context?.settings.safe_denom_tolerance_cents ?? 0;
  const closeoutStatus = context?.closeout?.status ?? null;

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setErr(null);
    setStatusNote(null);
    setSubmitResult(null);

    if (context?.closeout) {
      const draft = context.closeout;
      setCloseoutId(draft.id);
      setPriorX((draft.other_sales_cents / 100).toFixed(2));
      setCashSales((draft.cash_sales_cents / 100).toFixed(2));
      setCardSales((draft.card_sales_cents / 100).toFixed(2));
      setDrawerCount(draft.drawer_count_cents != null ? (draft.drawer_count_cents / 100).toFixed(2) : "");
      setVarianceReason(draft.deposit_override_reason ?? "");
      setVarianceOverride(Boolean(draft.deposit_override_reason));

      const nextDenoms = { "100": "", "50": "", "20": "", "10": "", "5": "", "2": "", "1": "" };
      for (const key of Object.keys(nextDenoms) as Array<keyof typeof nextDenoms>) {
        const qty = draft.denoms_jsonb?.[key];
        if (typeof qty === "number" && Number.isFinite(qty) && qty >= 0) {
          nextDenoms[key] = String(qty);
        }
      }
      setDenoms(nextDenoms);
      setExpenses(buildExpenseRows(context));
      const depositPhoto = context.photos.find((photo) => photo.photo_type === "deposit_required");
      const posPhoto = context.photos.find((photo) => photo.photo_type === "pos_optional");
      setDepositPath(depositPhoto?.storage_path ?? null);
      setPosPath(posPhoto?.storage_path ?? null);
    } else {
      setCloseoutId(null);
      setPriorX("");
      setCashSales("");
      setCardSales("");
      setDrawerCount("");
      setVarianceReason("");
      setVarianceOverride(false);
      setDenoms({ "100": "", "50": "", "20": "", "10": "", "5": "", "2": "", "1": "" });
      setExpenses([{ id: crypto.randomUUID(), amount: "", note: "" }]);
      setDepositPath(null);
      setPosPath(null);
    }
    setDepositFile(null);
    setPosFile(null);
  }, [open]);

  const expenseTotalCents = useMemo(() => {
    return expenses.reduce((total, row) => total + (centsFromInput(row.amount) ?? 0), 0);
  }, [expenses]);

  const cashSalesCents = centsFromInput(cashSales) ?? 0;
  const cardSalesCents = centsFromInput(cardSales) ?? 0;
  const priorXCents = centsFromInput(priorX) ?? 0;
  const requiredDepositCents = expectedDeposit(cashSalesCents, expenseTotalCents);

  const denomsJson = useMemo(() => {
    return {
      "100": Number(denoms["100"] || 0),
      "50": Number(denoms["50"] || 0),
      "20": Number(denoms["20"] || 0),
      "10": Number(denoms["10"] || 0),
      "5": Number(denoms["5"] || 0),
      "2": Number(denoms["2"] || 0),
      "1": Number(denoms["1"] || 0),
    };
  }, [denoms]);

  const denomTotalCents = useMemo(() => {
    return (
      denomsJson["100"] * 10000 +
      denomsJson["50"] * 5000 +
      denomsJson["20"] * 2000 +
      denomsJson["10"] * 1000 +
      denomsJson["5"] * 500 +
      denomsJson["2"] * 200 +
      denomsJson["1"] * 100
    );
  }, [denomsJson]);

  const countWithinTolerance = Math.abs(denomTotalCents - requiredDepositCents) <= denomTolerance;

  async function saveDraft() {
    if (!authToken || !storeId || !shiftId || !businessDate) {
      throw new Error("Missing shift or auth context.");
    }
    const payload = {
      storeId,
      date: businessDate,
      shiftId,
      sales_totals: {
        cash_sales_cents: cashSalesCents,
        card_sales_cents: cardSalesCents,
        other_sales_cents: priorXCents,
      },
      drawer_count_cents: centsFromInput(drawerCount),
      denoms_jsonb: denomsJson,
      expenses: expenses
        .map((row) => ({
          amount_cents: centsFromInput(row.amount),
          category: "expense",
          note: row.note.trim() || null,
        }))
        .filter((row) => row.amount_cents != null && row.amount_cents >= 0),
    };

    const res = await fetch("/api/closeout/save-draft", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.error || "Failed to save draft.");
    }
    if (typeof json?.closeoutId === "string") {
      setCloseoutId(json.closeoutId);
    }
    await onRefreshContext();
  }

  async function uploadPhoto(file: File): Promise<string> {
    if (!authToken) throw new Error("Missing auth token.");
    const signRes = await fetch("/api/closeout/upload-url", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ filename: file.name, fileType: file.type }),
    });
    const signJson = await signRes.json();
    if (!signRes.ok) {
      throw new Error(signJson?.error || "Failed to get upload URL.");
    }
    const uploadRes = await fetch(signJson.url, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!uploadRes.ok) {
      throw new Error("Photo upload failed.");
    }
    return String(signJson.path);
  }

  async function nextFromStep(currentStep: number) {
    setErr(null);
    setStatusNote(null);
    if (currentStep === 1) {
      setSaving(true);
      try {
        await saveDraft();
        setStatusNote("? Step 1 saved.");
        setStep(2);
      } catch (e: unknown) {
        setErr(`? ${e instanceof Error ? e.message : "Failed to save draft."}`);
      } finally {
        setSaving(false);
      }
      return;
    }

    if (currentStep === 2) {
      if (centsFromInput(cashSales) == null || centsFromInput(cardSales) == null) {
        setErr("❌ Cash Sales and Card Sales are required.");
        return;
      }
      setSaving(true);
      try {
        await saveDraft();
        setStatusNote("✅ Draft saved. Command captured.");
        setStep(3);
      } catch (e: unknown) {
        setErr(`❌ ${e instanceof Error ? e.message : "Failed to save draft."}`);
      } finally {
        setSaving(false);
      }
      return;
    }

    if (currentStep === 3) {
      const validCounts = (Object.values(denomsJson) as number[]).every((qty) => Number.isInteger(qty) && qty >= 0);
      if (!validCounts) {
        setErr("❌ Bill quantities must be whole numbers >= 0.");
        return;
      }
      if (!countWithinTolerance && !varianceOverride) {
        setErr("❌ Bills do not match required deposit. Fix counts or report variance.");
        return;
      }
      if (varianceOverride && !varianceReason.trim()) {
        setErr("❌ Add a variance reason before continuing.");
        return;
      }
      setSaving(true);
      try {
        await saveDraft();
        setStatusNote(
          countWithinTolerance
            ? "✅ Bills verified."
            : "⚠️ Variance recorded. This closeout may require manager review."
        );
        setStep(4);
      } catch (e: unknown) {
        setErr(`❌ ${e instanceof Error ? e.message : "Failed to save draft."}`);
      } finally {
        setSaving(false);
      }
      return;
    }

    if (currentStep === 4) {
      const cents = centsFromInput(drawerCount);
      if (cents == null || cents <= 0) {
        setErr("❌ Drawer count must be a positive value.");
        return;
      }
      setSaving(true);
      try {
        await saveDraft();
        setStatusNote("✅ Drawer count saved.");
        setStep(5);
      } catch (e: unknown) {
        setErr(`❌ ${e instanceof Error ? e.message : "Failed to save draft."}`);
      } finally {
        setSaving(false);
      }
    }
  }

  async function submitCloseout() {
    setErr(null);
    setStatusNote(null);
    if (!authToken) {
      setErr("❌ Session expired. Please refresh.");
      return;
    }
    if (!closeoutId) {
      setErr("❌ Missing closeout draft. Save first.");
      return;
    }
    if (!depositPath && !depositFile) {
      setErr("❌ Deposit slip photo is required.");
      return;
    }

    setSaving(true);
    try {
      const nextDepositPath = depositPath ?? (depositFile ? await uploadPhoto(depositFile) : null);
      const nextPosPath = posPath ?? (posFile ? await uploadPhoto(posFile) : null);
      if (!nextDepositPath) {
        throw new Error("Deposit photo upload failed.");
      }
      setDepositPath(nextDepositPath);
      setPosPath(nextPosPath);

      const payload = {
        closeoutId,
        sales_totals: {
          cash_sales_cents: cashSalesCents,
          card_sales_cents: cardSalesCents,
          other_sales_cents: priorXCents,
        },
        expenses: expenses
          .map((row) => ({
            amount_cents: centsFromInput(row.amount),
            category: "expense",
            note: row.note.trim() || null,
          }))
          .filter((row) => row.amount_cents != null && row.amount_cents >= 0),
        denoms_json: denomsJson,
        drawer_count_cents: centsFromInput(drawerCount),
        actual_deposit_cents: denomTotalCents,
        deposit_override_reason: varianceOverride ? varianceReason.trim() : null,
        photo_metadata: [
          { photo_type: "deposit_required", storage_path: nextDepositPath },
          ...(nextPosPath ? [{ photo_type: "pos_optional", storage_path: nextPosPath }] : []),
        ],
      };

      const res = await fetch("/api/closeout/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || "Failed to submit closeout.");
      }

      const status = json?.status as SubmitStatus;
      const message = String(json?.message ?? "Closeout submitted.");
      setSubmitResult({ status, message });
      await onRefreshContext();
      onSubmitted(status);
    } catch (e: unknown) {
      setErr(`❌ ${e instanceof Error ? e.message : "Failed to submit closeout."}`);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const readOnlyPassed = closeoutStatus === "pass";
  const progressLabel = readOnlyPassed ? "Safe Closed ✅" : `Step ${step} of 5`;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 p-3 sm:p-4 overflow-y-auto modal-under-header">
      <div className="mx-auto w-full max-w-xl rounded-2xl border border-cyan-400/40 bg-[#0b1220] text-slate-100 shadow-[0_0_0_1px_rgba(6,182,212,0.08)]">
        <div className="flex items-center justify-between border-b border-cyan-400/20 p-4">
          <div>
            <div className="text-lg font-semibold">Safe Closeout Wizard</div>
            <div className="text-xs text-slate-300">{mode === "gate" ? "Clock Out Gate" : "Task Flow"} · {progressLabel}</div>
          </div>
          <button className="rounded border border-slate-500 px-3 py-1 text-sm" onClick={onClose}>Close</button>
        </div>

        <div className="space-y-3 p-4">
          {statusNote && <div className="rounded border border-emerald-400/40 bg-emerald-900/20 p-2 text-sm text-emerald-200">{statusNote}</div>}
          {err && <div className="rounded border border-red-400/50 bg-red-900/30 p-2 text-sm text-red-200">{err}</div>}

          {submitResult && (
            <div
              className={`rounded p-3 text-sm border ${
                submitResult.status === "pass"
                  ? "border-emerald-400/50 bg-emerald-900/30 text-emerald-200"
                  : submitResult.status === "warn"
                    ? "border-amber-400/50 bg-amber-900/30 text-amber-200"
                    : "border-red-400/50 bg-red-900/30 text-red-200"
              }`}
            >
              {submitResult.status === "pass" && "✅ "}
              {submitResult.status === "warn" && "⚠️ "}
              {submitResult.status === "fail" && "❌ "}
              {submitResult.message}
            </div>
          )}

          {readOnlyPassed ? (
            <div className="rounded border border-emerald-400/50 bg-emerald-900/20 p-3 text-sm text-emerald-200">
              ✅ This safe is already closed and passed for this business date.
            </div>
          ) : (
            <>
              {step === 1 && (
                <div className="space-y-2">
                  <div className="text-sm font-semibold">1) Shift Context</div>
                  <label className="text-sm">Prior X Report Total ($)</label>
                  <input className="w-full rounded border border-cyan-400/30 bg-slate-900/50 p-2" inputMode="decimal" value={priorX} onChange={(e) => setPriorX(e.target.value)} />
                </div>
              )}

              {step === 2 && (
                <div className="space-y-3">
                  <div className="text-sm font-semibold">2) The Command (Financials)</div>
                  <label className="text-sm">Cash Sales ($)</label>
                  <input className="w-full rounded border border-cyan-400/30 bg-slate-900/50 p-2" inputMode="decimal" value={cashSales} onChange={(e) => setCashSales(e.target.value)} />
                  <label className="text-sm">Card Sales ($)</label>
                  <input className="w-full rounded border border-cyan-400/30 bg-slate-900/50 p-2" inputMode="decimal" value={cardSales} onChange={(e) => setCardSales(e.target.value)} />
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Expenses</div>
                    {expenses.map((row, index) => (
                      <div key={row.id} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_auto]">
                        <input
                          className="rounded border border-cyan-400/30 bg-slate-900/50 p-2"
                          inputMode="decimal"
                          placeholder="Amount ($)"
                          value={row.amount}
                          onChange={(e) => {
                            setExpenses((prev) => prev.map((item, i) => (i === index ? { ...item, amount: e.target.value } : item)));
                          }}
                        />
                        <input
                          className="rounded border border-cyan-400/30 bg-slate-900/50 p-2"
                          placeholder="Note"
                          value={row.note}
                          onChange={(e) => {
                            setExpenses((prev) => prev.map((item, i) => (i === index ? { ...item, note: e.target.value } : item)));
                          }}
                        />
                        <button
                          className="rounded border border-slate-500 px-3 py-2 text-xs"
                          onClick={() => {
                            setExpenses((prev) => (prev.length === 1 ? prev : prev.filter((item) => item.id !== row.id)));
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <button className="rounded border border-cyan-300 px-3 py-1 text-sm text-cyan-200" onClick={() => setExpenses((prev) => [...prev, { id: crypto.randomUUID(), amount: "", note: "" }])}>
                      + Add Expense
                    </button>
                  </div>
                  <div className="rounded border border-cyan-400/40 bg-cyan-950/40 p-3 text-center text-xl font-extrabold text-cyan-100">
                    REQUIRED DEPOSIT: {dollars(requiredDepositCents)}
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-3">
                  <div className="text-sm font-semibold">3) The Verification (Bills Only)</div>
                  {(["100", "50", "20", "10", "5", "2", "1"] as const).map((key) => (
                    <div key={key} className="grid grid-cols-[90px_1fr] items-center gap-2">
                      <label className="text-sm">${key} bills</label>
                      <input
                        className="w-full rounded border border-cyan-400/30 bg-slate-900/50 p-2"
                        inputMode="numeric"
                        placeholder="0"
                        value={denoms[key]}
                        onChange={(e) => setDenoms((prev) => ({ ...prev, [key]: e.target.value.replace(/[^\d]/g, "") }))}
                      />
                    </div>
                  ))}
                  <div className={`rounded border p-2 text-sm ${countWithinTolerance ? "border-emerald-400/50 bg-emerald-900/20 text-emerald-200" : "border-amber-400/50 bg-amber-900/20 text-amber-200"}`}>
                    {countWithinTolerance ? "✅ Count verified." : "⚠️ Count mismatch."} Current Count: {dollars(denomTotalCents)} · Required: {dollars(requiredDepositCents)}
                  </div>
                  {!countWithinTolerance && (
                    <div className="space-y-2 rounded border border-red-400/40 bg-red-900/20 p-2">
                      <button
                        className="rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white"
                        onClick={() => {
                          setVarianceOverride(true);
                          if (!varianceReason.trim()) {
                            setVarianceReason("Bills counted do not match required deposit.");
                          }
                        }}
                      >
                        Report Variance
                      </button>
                      {varianceOverride && (
                        <textarea
                          className="w-full rounded border border-red-400/40 bg-slate-900/60 p-2 text-sm"
                          rows={2}
                          value={varianceReason}
                          onChange={(e) => setVarianceReason(e.target.value)}
                          placeholder="Variance reason (required)"
                        />
                      )}
                    </div>
                  )}
                </div>
              )}

              {step === 4 && (
                <div className="space-y-2">
                  <div className="text-sm font-semibold">4) The Remainder</div>
                  <label className="text-sm">Drawer Count ($)</label>
                  <input className="w-full rounded border border-cyan-400/30 bg-slate-900/50 p-2" inputMode="decimal" value={drawerCount} onChange={(e) => setDrawerCount(e.target.value)} />
                </div>
              )}

              {step === 5 && (
                <div className="space-y-3">
                  <div className="text-sm font-semibold">5) Evidence & Submit</div>
                  <div className="space-y-1">
                    <label className="text-sm">Deposit Slip (Required)</label>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => setDepositFile(e.target.files?.[0] ?? null)}
                    />
                    {depositPath && <div className="text-xs text-emerald-300">✅ Deposit slip uploaded.</div>}
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm">Z-Report (Optional)</label>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => setPosFile(e.target.files?.[0] ?? null)}
                    />
                    {posPath && <div className="text-xs text-emerald-300">✅ Z-report uploaded.</div>}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-cyan-400/20 p-4">
          <button
            className="rounded border border-slate-500 px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={saving || readOnlyPassed || step <= 1}
            onClick={() => setStep((prev) => Math.max(1, prev - 1))}
          >
            Back
          </button>
          <div className="flex gap-2">
            {!readOnlyPassed && step < 5 && (
              <button className="rounded bg-cyan-600 px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50" disabled={saving} onClick={() => void nextFromStep(step)}>
                {saving ? "Saving..." : "Save & Next"}
              </button>
            )}
            {!readOnlyPassed && step === 5 && (
              <button className="rounded bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50" disabled={saving} onClick={() => void submitCloseout()}>
                {saving ? "Submitting..." : "Submit Closeout"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
