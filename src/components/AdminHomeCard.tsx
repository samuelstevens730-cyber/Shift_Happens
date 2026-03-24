"use client";

/**
 * AdminHomeCard
 *
 * Appears on the employee home page for managers/admins only.
 * Shows a quick-glance business snapshot: sales, who's in, pending actions.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import {
  ArrowRight,
  DollarSign,
  TrendingUp,
  Users,
  UserX,
  AlertCircle,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

type ClockedInPerson = {
  name: string;
  storeName: string;
  since: string;
};

type ScheduledPerson = {
  name: string;
  storeName: string;
};

type Snapshot = {
  yesterdaySales: number | null;
  weeklySales: number | null;
  clockedIn: ClockedInPerson[];
  notClockedIn: ScheduledPerson[];
  scheduledToday: number;
  pendingRequests: number;
  unreviewedVariances: number;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function formatCents(cents: number | null): string {
  if (cents === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatSince(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });
}

// ── Component ──────────────────────────────────────────────────────────────

export default function AdminHomeCard() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    async function fetchSnapshot() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;

        const res = await fetch("/api/admin/home-snapshot", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) return;
        const json = await res.json();
        if (alive) setSnapshot(json);
      } catch {
        // silently fail — card just won't render
      } finally {
        if (alive) setLoading(false);
      }
    }

    fetchSnapshot();
    return () => { alive = false; };
  }, []);

  // Don't take up space while loading or on error
  if (loading || !snapshot) return null;

  const totalActions = snapshot.pendingRequests + snapshot.unreviewedVariances;
  const coverageLabel =
    snapshot.scheduledToday === 0
      ? snapshot.clockedIn.length > 0
        ? `${snapshot.clockedIn.length} in`
        : "No one in"
      : `${snapshot.clockedIn.length} of ${snapshot.scheduledToday} in`;

  return (
    <section className="admin-home-card">
      {/* Header */}
      <div className="admin-home-card-header">
        <span className="admin-home-card-label">Manager Snapshot</span>
        <Link href="/admin" className="admin-home-card-link">
          Full Dashboard <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {/* Sales stats — 2 tiles side by side */}
      <div className="admin-home-card-sales">
        <div className="admin-home-stat">
          <div className="admin-home-stat-icon">
            <DollarSign className="h-3.5 w-3.5" />
          </div>
          <div className="admin-home-stat-body">
            <div className="admin-home-stat-label">Yesterday</div>
            <div className="admin-home-stat-value">{formatCents(snapshot.yesterdaySales)}</div>
          </div>
        </div>
        <div className="admin-home-stat">
          <div className="admin-home-stat-icon admin-home-stat-icon--green">
            <TrendingUp className="h-3.5 w-3.5" />
          </div>
          <div className="admin-home-stat-body">
            <div className="admin-home-stat-label">Week to Date</div>
            <div className="admin-home-stat-value">{formatCents(snapshot.weeklySales)}</div>
          </div>
        </div>
      </div>

      {/* Clocked In */}
      <div className="admin-home-section">
        <div className="admin-home-section-header">
          <Users className="h-3.5 w-3.5" />
          <span>Clocked In</span>
          <span className="admin-home-coverage-badge">{coverageLabel}</span>
        </div>
        {snapshot.clockedIn.length === 0 ? (
          <p className="admin-home-empty">Nobody is clocked in right now.</p>
        ) : (
          <ul className="admin-home-person-list">
            {snapshot.clockedIn.map((p, i) => (
              <li key={i} className="admin-home-person-row">
                <span className="admin-home-person-name">{p.name}</span>
                <span className="admin-home-person-meta">
                  {p.storeName}{p.storeName && p.since ? " · " : ""}{p.since ? `since ${formatSince(p.since)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Not Clocked In — only shown if someone is scheduled but missing */}
      {snapshot.notClockedIn.length > 0 && (
        <div className="admin-home-section">
          <div className="admin-home-section-header">
            <UserX className="h-3.5 w-3.5 text-[var(--danger)]" />
            <span className="text-[var(--danger)]">Not Clocked In</span>
          </div>
          <ul className="admin-home-person-list">
            {snapshot.notClockedIn.map((p, i) => (
              <li key={i} className="admin-home-person-row">
                <span className="admin-home-person-name">{p.name}</span>
                <span className="admin-home-person-meta">{p.storeName}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Pending Actions */}
      <Link href="/admin" className="admin-home-actions-row">
        <div className="admin-home-section-header">
          <AlertCircle className="h-3.5 w-3.5" />
          <span>Pending Actions</span>
        </div>
        <div className="admin-home-action-pills">
          {totalActions === 0 ? (
            <span className="admin-home-pill admin-home-pill--clear">All Clear</span>
          ) : (
            <>
              {snapshot.pendingRequests > 0 && (
                <span className="admin-home-pill admin-home-pill--requests">
                  {snapshot.pendingRequests} Request{snapshot.pendingRequests !== 1 ? "s" : ""}
                </span>
              )}
              {snapshot.unreviewedVariances > 0 && (
                <span className="admin-home-pill admin-home-pill--variance">
                  {snapshot.unreviewedVariances} Variance{snapshot.unreviewedVariances !== 1 ? "s" : ""}
                </span>
              )}
            </>
          )}
          <ArrowRight className="h-3.5 w-3.5 text-[var(--muted)] ml-auto" />
        </div>
      </Link>
    </section>
  );
}
