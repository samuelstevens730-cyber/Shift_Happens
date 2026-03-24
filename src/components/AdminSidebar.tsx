"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity, BookOpen, CalendarDays, ChevronRight, ClipboardList,
  Clock, CreditCard, FileBarChart, PenSquare, Settings,
  ShieldCheck, Sparkles, Star, Users, Wallet, Zap,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import QuickSendModal from "./QuickSendModal";

type Store = { id: string; name: string };
type User = { id: string; name: string; active: boolean; storeIds: string[] };

type Props = {
  stores: Store[];
  users: User[];
};

type NavItem = { href: string; label: string; icon: React.ElementType; badge?: number };
type NavGroup = { label: string; items: NavItem[] };

function NavLink({ item, pathname }: { item: NavItem; pathname: string | null }) {
  const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
        active
          ? "text-[var(--green)] bg-[rgba(32,240,138,0.07)] border-l-2 border-[var(--green)] pl-[10px]"
          : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-white/5"
      }`}
    >
      <Icon className="h-4 w-4 flex-shrink-0" strokeWidth={1.8} />
      <span className="flex-1 truncate">{item.label}</span>
      {typeof item.badge === "number" && item.badge > 0 && (
        <span className="rounded-full bg-[var(--danger)] px-1.5 py-0.5 text-[10px] font-bold text-white leading-none">
          {item.badge}
        </span>
      )}
    </Link>
  );
}

export default function AdminSidebar({ stores, users }: Props) {
  const pathname = usePathname();
  const [quickSendOpen, setQuickSendOpen] = useState(false);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [unreviewedVariances, setUnreviewedVariances] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getSession();
        const token = auth.session?.access_token ?? "";
        if (!token) return;
        const res = await fetch("/api/admin/badge-counts", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || !alive) return;
        const json = await res.json() as { pendingRequests: number; unreviewedVariances: number };
        setPendingRequests(json.pendingRequests ?? 0);
        setUnreviewedVariances(json.unreviewedVariances ?? 0);
      } catch {
        // silently fail — badges are best-effort
      }
    })();
    return () => { alive = false; };
  }, []);

  const groups: NavGroup[] = [
    {
      label: "Live Ops",
      items: [
        { href: "/admin/requests", label: "Requests", icon: ClipboardList, badge: pendingRequests },
        { href: "/admin/variances", label: "Variances", icon: Activity, badge: unreviewedVariances },
        { href: "/admin/open-shifts", label: "Open Shifts", icon: Clock },
        { href: "/admin/overrides", label: "Overrides", icon: ShieldCheck },
        { href: "/admin/coverage-shifts", label: "Coverage Shifts", icon: ChevronRight },
      ],
    },
    {
      label: "Scheduling",
      items: [
        { href: "/admin/scheduler", label: "Scheduler", icon: CalendarDays },
        { href: "/admin/shifts", label: "Shifts", icon: Clock },
        { href: "/admin/employee-schedules", label: "Emp. Schedules", icon: BookOpen },
        { href: "/admin/assignments", label: "Assignments", icon: ClipboardList },
      ],
    },
    {
      label: "Payroll & Finance",
      items: [
        { href: "/admin/payroll", label: "Payroll", icon: Wallet },
        { href: "/admin/payroll/reconciliation", label: "Reconciliation", icon: CreditCard },
        { href: "/admin/safe-ledger", label: "Safe Ledger", icon: ShieldCheck },
        { href: "/admin/shift-sales", label: "Shift Sales", icon: FileBarChart },
      ],
    },
    {
      label: "Reports",
      items: [
        { href: "/admin/reports/store-sales", label: "Store Sales", icon: FileBarChart },
        { href: "/admin/reports/performance-summary", label: "Performance", icon: Sparkles },
        { href: "/admin/employee-scoreboard", label: "Scoreboard", icon: Star },
        { href: "/admin/cleaning/report", label: "Cleaning Report", icon: ClipboardList },
      ],
    },
    {
      label: "People & Config",
      items: [
        { href: "/admin/users", label: "Employees", icon: Users },
        { href: "/admin/reviews", label: "Reviews", icon: Star },
        { href: "/admin/cleaning", label: "Cleaning Tasks", icon: ClipboardList },
        { href: "/admin/settings", label: "Settings", icon: Settings },
      ],
    },
  ];

  return (
    <>
      <aside className="fixed left-0 top-0 bottom-0 w-[224px] z-30 hidden lg:flex flex-col bg-[rgba(8,10,9,0.92)] backdrop-blur-[18px] border-r border-white/7 overflow-y-auto">
        {/* Home link */}
        <div className="px-3 pt-6 pb-2">
          <Link
            href="/admin"
            className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-semibold transition-colors ${
              pathname === "/admin"
                ? "text-[var(--green)] bg-[rgba(32,240,138,0.07)]"
                : "text-[var(--text)] hover:bg-white/5"
            }`}
          >
            <Zap className="h-4 w-4" strokeWidth={2} />
            <span>Command Center</span>
          </Link>
        </div>

        {/* Nav groups */}
        <nav className="flex-1 px-3 space-y-4 pb-4">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="px-3 mb-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]/50">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink key={item.href} item={item} pathname={pathname} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Compose button */}
        <div className="px-3 pb-6 border-t border-white/7 pt-3">
          <button
            onClick={() => setQuickSendOpen(true)}
            className="btn-secondary w-full flex items-center justify-center gap-2 px-3 py-2 text-sm"
          >
            <PenSquare className="h-4 w-4" />
            Quick Send
          </button>
        </div>
      </aside>

      <QuickSendModal
        open={quickSendOpen}
        onClose={() => setQuickSendOpen(false)}
        stores={stores}
        users={users}
      />
    </>
  );
}
