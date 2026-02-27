"use client";

/**
 * /admin/reports/store-sales
 *
 * Executive Store Report — per-store aggregated sales, RPLH, cash-flow,
 * weather context, and velocity maps.
 * Outputs: web UI cards, plain-text LLM export (copy), and PDF download.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import type { StorePeriodSummary } from "@/lib/storeReportAnalyzer";
import { pdf } from "@react-pdf/renderer";
import { StoreReportPDF } from "@/components/pdf/StoreReportPDF";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cstDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function d(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function pct(value: number): string {
  return `${value}%`;
}

function hrs(hours: number): string {
  return hours.toFixed(1);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface StoreOption {
  id: string;
  name: string;
}

// ─── Block Components ─────────────────────────────────────────────────────────

function BlockA({ s }: { s: StorePeriodSummary }) {
  return (
    <div className="border rounded p-4 space-y-1">
      <div className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-2">Top-Line Velocity &amp; Efficiency</div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <div>
          <span className="text-zinc-500">Gross Sales</span>
          <div className="text-xl font-semibold">
            {s.grossSalesCents != null ? d(s.grossSalesCents) : "—"}
          </div>
        </div>
        <div>
          <span className="text-zinc-500">RPLH</span>
          <div className="text-xl font-semibold">
            {s.rplhCents != null ? d(s.rplhCents) : "—"}
          </div>
        </div>
        <div>
          <span className="text-zinc-500">Total Transactions</span>
          <div className="text-lg font-medium">
            {s.totalTransactions != null ? s.totalTransactions : "—"}
          </div>
        </div>
        <div>
          <span className="text-zinc-500">Avg Basket Size</span>
          <div className="text-lg font-medium">
            {s.avgBasketSizeCents != null ? d(s.avgBasketSizeCents) : "—"}
          </div>
        </div>
        <div>
          <span className="text-zinc-500">Total Labor Hours</span>
          <div className="text-lg font-medium">{hrs(s.totalLaborHours)}</div>
        </div>
      </div>
    </div>
  );
}

function BlockB({ s }: { s: StorePeriodSummary }) {
  const hasData = s.cashPct != null || s.depositVarianceCents != null;
  return (
    <div className="border rounded p-4 space-y-2">
      <div className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-2">Risk &amp; Cash Flow</div>
      {hasData ? (
        <div className="space-y-2 text-sm">
          {s.cashPct != null && s.cardPct != null ? (
            <div>
              <span className="text-zinc-500">Payment Split</span>
              <div className="font-medium">
                {pct(s.cashPct)} Cash / {pct(s.cardPct)} Card
                <span className="text-xs text-zinc-500 ml-2">
                  ({s.safeCloseoutDayCount} days)
                </span>
              </div>
            </div>
          ) : (
            <div className="text-zinc-500 italic">Payment split: N/A — no safe closeout data</div>
          )}
          {s.depositVarianceCents != null ? (
            <div>
              <span className="text-zinc-500">Deposit Variance (Shrink)</span>
              <div
                className={`font-medium ${
                  s.depositVarianceCents < 0
                    ? "text-red-400"
                    : s.depositVarianceCents > 0
                    ? "text-emerald-400"
                    : "text-zinc-300"
                }`}
              >
                {s.depositVarianceCents < 0 ? "-" : s.depositVarianceCents > 0 ? "+" : ""}
                {d(Math.abs(s.depositVarianceCents))}
              </div>
            </div>
          ) : (
            <div className="text-zinc-500 italic">Deposit variance: N/A — no safe closeout data</div>
          )}
        </div>
      ) : (
        <div className="text-zinc-500 italic text-sm">
          No safe closeout data for this period. Block B requires the safe ledger feature.
        </div>
      )}
    </div>
  );
}

function BlockC({ s }: { s: StorePeriodSummary }) {
  return (
    <div className="border rounded p-4 space-y-2">
      <div className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-2">Environmental Context</div>
      {s.weatherTrend != null ? (
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-3">
            <span className="text-zinc-500">Trend</span>
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium ${
                s.weatherTrend === "Volatile"
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                  : "bg-zinc-700 text-zinc-300"
              }`}
            >
              {s.weatherTrend}
            </span>
            {s.dominantWeatherCondition && (
              <span className="text-zinc-400">· Dominant: {s.dominantWeatherCondition}</span>
            )}
          </div>
          {s.weatherDays.length > 0 && (
            <div className="space-y-0.5 max-h-40 overflow-y-auto">
              {s.weatherDays.map((day) => {
                const startLabel = day.startDesc ?? day.startCondition;
                const start = day.startTempF != null
                  ? `${startLabel} (${day.startTempF}°F)`
                  : startLabel ?? "—";
                const endLabel = day.endDesc ?? day.endCondition;
                const end = endLabel != null
                  ? day.endTempF != null
                    ? `${endLabel} (${day.endTempF}°F)`
                    : endLabel
                  : null;
                return (
                  <div key={day.date} className="text-xs text-zinc-400 font-mono">
                    {day.date}: {start}{end ? ` → ${end}` : ""}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="text-zinc-500 italic text-sm">
          No weather data — shifts in this period predate weather capture, or store coordinates are not configured.
        </div>
      )}
    </div>
  );
}

function VelocityCard({ s }: { s: StorePeriodSummary }) {
  return (
    <div className="border rounded p-4 space-y-2">
      <div className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-2">Velocity Map</div>
      {s.bestDay || s.worstDay || s.bestShiftType ? (
        <div className="space-y-1.5 text-sm">
          {s.bestDay && (
            <div>
              <span className="text-zinc-500">Best Day</span>
              <div className="font-medium">
                {s.bestDay.label} — {d(s.bestDay.avgSalesCents)} avg
                {s.bestDay.avgTransactions != null ? `, ${s.bestDay.avgTransactions} txn` : ""}
              </div>
            </div>
          )}
          {s.worstDay && s.worstDay.label !== s.bestDay?.label && (
            <div>
              <span className="text-zinc-500">Worst Day</span>
              <div className="font-medium text-zinc-400">
                {s.worstDay.label} — {d(s.worstDay.avgSalesCents)} avg
                {s.worstDay.avgTransactions != null ? `, ${s.worstDay.avgTransactions} txn` : ""}
              </div>
            </div>
          )}
          {s.bestShiftType && (
            <div>
              <span className="text-zinc-500">Best Shift Type</span>
              <div className="font-medium capitalize">
                {s.bestShiftType.label} — {d(s.bestShiftType.avgSalesCents)} avg
                {s.bestShiftType.avgTransactions != null ? `, ${s.bestShiftType.avgTransactions} txn` : ""}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-zinc-500 italic text-sm">No complete sales records for velocity analysis.</div>
      )}
    </div>
  );
}

// ─── Store Card ───────────────────────────────────────────────────────────────

function StoreCard({ s }: { s: StorePeriodSummary }) {
  return (
    <div className="rounded-lg border border-zinc-700 overflow-hidden">
      <div className="bg-zinc-800 px-4 py-3 flex items-center gap-3">
        <span className="text-lg font-semibold">{s.storeName}</span>
        <span className="text-xs text-zinc-500">{s.periodFrom} – {s.periodTo}</span>
      </div>
      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <BlockA s={s} />
        <BlockB s={s} />
        <BlockC s={s} />
        <VelocityCard s={s} />
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StoreReportPage() {
  const router = useRouter();
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [stores, setStores] = useState<StoreOption[]>([]);

  // Controls
  const today = cstDateKey(new Date());
  const twoWeeksAgo = cstDateKey(addDays(new Date(), -13));
  const [from, setFrom] = useState(twoWeeksAgo);
  const [to, setTo] = useState(today);
  const [storeId, setStoreId] = useState("all");

  // State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<StorePeriodSummary[] | null>(null);
  const [llmText, setLlmText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Auth ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token ?? null;
      setAuthToken(token);
      if (!token) { router.push("/admin/login"); return; }
      // Load store dropdown
      fetch("/api/admin/reports/store-sales?meta=true", {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((json) => setStores(json.stores ?? []))
        .catch(() => {});
    });
  }, [router]);

  // ── Generate ──────────────────────────────────────────────────────────────

  const generate = useCallback(async () => {
    if (!authToken) return;
    setLoading(true);
    setError(null);
    setSummaries(null);
    setLlmText(null);

    try {
      const params = new URLSearchParams({ from, to, storeId, format: "json" });
      const res = await fetch(`/api/admin/reports/store-sales?${params}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to load report."); return; }
      setSummaries(json.summaries ?? []);

      // Also fetch the text format for the LLM export
      const textParams = new URLSearchParams({ from, to, storeId, format: "text" });
      const textRes = await fetch(`/api/admin/reports/store-sales?${textParams}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (textRes.ok) {
        setLlmText(await textRes.text());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [authToken, from, to, storeId]);

  // ── Copy ──────────────────────────────────────────────────────────────────

  async function handleCopy() {
    if (!llmText) return;
    try {
      await navigator.clipboard.writeText(llmText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      if (textareaRef.current) {
        textareaRef.current.select();
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
  }

  // ── PDF Download ──────────────────────────────────────────────────────────

  async function handlePdf() {
    if (!summaries) return;
    setPdfLoading(true);
    try {
      const blob = await pdf(
        <StoreReportPDF summaries={summaries} from={from} to={to} />
      ).toBlob();
      downloadBlob(blob, `store-report-${from}-to-${to}.pdf`);
    } catch (e) {
      console.error("PDF generation failed:", e);
    } finally {
      setPdfLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-zinc-900 text-zinc-100 p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">Store Report</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Aggregated store-level sales, efficiency, cash flow, and weather context.
        </p>
      </div>

      {/* Controls */}
      <div className="border border-zinc-700 rounded-lg p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-zinc-500 block mb-1">From</label>
            <input
              type="date"
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500 block mb-1">To</label>
            <input
              type="date"
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Store</label>
            <select
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
            >
              <option value="all">Both Stores</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>
        <button
          onClick={generate}
          disabled={loading}
          className="bg-zinc-100 text-zinc-900 px-5 py-2 rounded font-medium text-sm hover:bg-white disabled:opacity-50"
        >
          {loading ? "Generating…" : "Generate Report"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="border border-red-500/40 bg-red-500/10 rounded p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Results */}
      {summaries && summaries.length > 0 && (
        <div className="space-y-6">
          {/* Action bar */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleCopy}
              className="border border-zinc-600 rounded px-4 py-1.5 text-sm hover:bg-zinc-800"
            >
              {copied ? "✓ Copied" : "Copy LLM Export"}
            </button>
            <button
              onClick={handlePdf}
              disabled={pdfLoading}
              className="border border-zinc-600 rounded px-4 py-1.5 text-sm hover:bg-zinc-800 disabled:opacity-50"
            >
              {pdfLoading ? "Generating PDF…" : "Download PDF"}
            </button>
          </div>

          {/* Store cards */}
          <div className="space-y-6">
            {summaries.map((s) => (
              <StoreCard key={s.storeId} s={s} />
            ))}
          </div>

          {/* LLM Export textarea */}
          {llmText && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-500 font-medium">LLM Export (plain text)</span>
                <button
                  onClick={handleCopy}
                  className="text-xs border border-zinc-600 rounded px-3 py-1 hover:bg-zinc-800"
                >
                  {copied ? "✓ Copied" : "Copy"}
                </button>
              </div>
              <textarea
                ref={textareaRef}
                readOnly
                value={llmText}
                className="w-full h-64 bg-zinc-900 border border-zinc-700 rounded p-3 text-xs font-mono text-zinc-300 resize-y"
              />
            </div>
          )}
        </div>
      )}

      {summaries && summaries.length === 0 && (
        <div className="border border-zinc-700 rounded p-6 text-center text-zinc-500 text-sm">
          No data found for the selected period and store.
        </div>
      )}
    </div>
  );
}
