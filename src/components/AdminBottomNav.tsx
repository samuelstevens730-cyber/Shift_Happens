"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  ClipboardList, MoreHorizontal, PenSquare, Wallet,
  Activity, BookOpen, CalendarDays, ChevronRight, Clock,
  ChevronDown, CreditCard, FileBarChart, Settings, ShieldCheck, Sparkles, Star, Users, Zap,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import QuickSendModal from "./QuickSendModal";

type Store = { id: string; name: string };
type User = { id: string; name: string; active: boolean; storeIds: string[] };
type Props = { stores: Store[]; users: User[]; pendingRequests: number };

export default function AdminBottomNav({ stores, users, pendingRequests }: Props) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [quickSendOpen, setQuickSendOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => getInitialOpenGroups(pathname));

  const isActive = (href: string) =>
    pathname === href || (href !== "/admin" && pathname?.startsWith(`${href}/`));

  const navGroups = [
    {
      label: "Live Ops",
      items: [
        { href: "/admin/requests", label: "Requests", icon: ClipboardList },
        { href: "/admin/variances", label: "Variances", icon: Activity },
        { href: "/admin/open-shifts", label: "Open Shifts", icon: Clock },
        { href: "/admin/overrides", label: "Overrides", icon: ShieldCheck },
        { href: "/admin/coverage-shifts", label: "Coverage Shifts", icon: ChevronRight },
        { href: "/admin/early-clock-in-requests", label: "Early Clock-Ins", icon: Clock },
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

  function toggleGroup(label: string) {
    setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  }

  return (
    <>
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center bg-[rgba(12,15,18,0.96)] backdrop-blur-[16px] border-t border-white/8 pb-[env(safe-area-inset-bottom)]">
        {/* Home */}
        <Link href="/admin" className={`flex-1 flex flex-col items-center gap-1 py-2 text-[10px] font-medium ${isActive("/admin") ? "text-[var(--green)]" : "text-[var(--muted)]"}`}>
          <Zap className="h-5 w-5" strokeWidth={1.8} />
          <span>Home</span>
        </Link>

        {/* Requests */}
        <Link href="/admin/requests" className={`flex-1 flex flex-col items-center gap-1 py-2 text-[10px] font-medium relative ${isActive("/admin/requests") ? "text-[var(--green)]" : "text-[var(--muted)]"}`}>
          <div className="relative">
            <ClipboardList className="h-5 w-5" strokeWidth={1.8} />
            {pendingRequests > 0 && (
              <span className="absolute -top-1 -right-2 rounded-full bg-[var(--danger)] px-1 text-[9px] font-bold text-white leading-tight">
                {pendingRequests}
              </span>
            )}
          </div>
          <span>Requests</span>
        </Link>

        {/* Compose — center action tab */}
        <button
          onClick={() => setQuickSendOpen(true)}
          className="flex-1 flex flex-col items-center gap-1 py-2 text-[10px] font-medium text-[var(--purple)]"
        >
          <PenSquare className="h-5 w-5" strokeWidth={1.8} />
          <span>Send</span>
        </button>

        {/* Payroll */}
        <Link href="/admin/payroll" className={`flex-1 flex flex-col items-center gap-1 py-2 text-[10px] font-medium ${isActive("/admin/payroll") ? "text-[var(--green)]" : "text-[var(--muted)]"}`}>
          <Wallet className="h-5 w-5" strokeWidth={1.8} />
          <span>Payroll</span>
        </Link>

        {/* More */}
        <button
          onClick={() => setMoreOpen(true)}
          className="flex-1 flex flex-col items-center gap-1 py-2 text-[10px] font-medium text-[var(--muted)]"
        >
          <MoreHorizontal className="h-5 w-5" strokeWidth={1.8} />
          <span>More</span>
        </button>
      </nav>

      {/* More sheet — full nav */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="bg-[var(--card)] border-white/8 max-h-[80vh] overflow-y-auto rounded-t-2xl z-[60]">
          <SheetHeader className="mb-4">
            <SheetTitle className="font-[family-name:var(--font-display)] text-lg font-bold uppercase tracking-tight text-[var(--text)]">
              Navigation
            </SheetTitle>
          </SheetHeader>
          <div className="space-y-2">
            <Link
              href="/admin"
              onClick={() => setMoreOpen(false)}
              className={`flex items-center gap-2.5 px-3 py-3 rounded-xl text-sm transition-colors ${
                isActive("/admin")
                  ? "text-[var(--green)] bg-[rgba(32,240,138,0.08)] border border-[rgba(32,240,138,0.16)]"
                  : "text-[var(--text)] bg-white/[0.03] border border-white/8 hover:bg-white/5"
              }`}
            >
              <Zap className="h-4 w-4 flex-shrink-0" strokeWidth={1.8} />
              <span className="font-medium">Command Center</span>
            </Link>

            {navGroups.map((group) => (
              <Collapsible
                key={group.label}
                open={openGroups[group.label] ?? false}
                onOpenChange={() => toggleGroup(group.label)}
              >
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] overflow-hidden">
                  <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-white/[0.03]">
                    <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]/85">
                      {group.label}
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 text-[var(--muted)] transition-transform duration-200 ${
                        openGroups[group.label] ? "rotate-180" : "rotate-0"
                      }`}
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-2 pb-2 space-y-1">
                      {group.items.map(({ href, label, icon: Icon }) => (
                        <Link
                          key={href}
                          href={href}
                          onClick={() => setMoreOpen(false)}
                          className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm transition-colors ${
                            isActive(href)
                              ? "text-[var(--green)] bg-[rgba(32,240,138,0.08)] border border-[rgba(32,240,138,0.14)]"
                              : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-white/5 border border-transparent"
                          }`}
                        >
                          <Icon className="h-4 w-4 flex-shrink-0" strokeWidth={1.8} />
                          <span className="truncate">{label}</span>
                        </Link>
                      ))}
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <QuickSendModal
        open={quickSendOpen}
        onClose={() => setQuickSendOpen(false)}
        stores={stores}
        users={users}
      />
    </>
  );
}

function getInitialOpenGroups(pathname: string | null): Record<string, boolean> {
  const matches = (hrefs: string[]) =>
    hrefs.some((h) => pathname === h || pathname?.startsWith(`${h}/`));
  return {
    "Live Ops": matches(["/admin/requests", "/admin/variances", "/admin/open-shifts", "/admin/overrides", "/admin/coverage-shifts", "/admin/early-clock-in-requests"]),
    "Scheduling": matches(["/admin/scheduler", "/admin/shifts", "/admin/employee-schedules", "/admin/assignments"]),
    "Payroll & Finance": matches(["/admin/payroll", "/admin/payroll/reconciliation", "/admin/safe-ledger", "/admin/shift-sales"]),
    "Reports": matches(["/admin/reports/store-sales", "/admin/reports/performance-summary", "/admin/employee-scoreboard", "/admin/cleaning/report"]),
    "People & Config": matches(["/admin/users", "/admin/reviews", "/admin/cleaning", "/admin/settings"]),
  };
}
