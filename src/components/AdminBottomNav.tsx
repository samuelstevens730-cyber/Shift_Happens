"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  ClipboardList, MoreHorizontal, PenSquare, Wallet,
  Activity, BookOpen, CalendarDays, ChevronRight, Clock,
  CreditCard, FileBarChart, Settings, ShieldCheck, Sparkles, Star, Users, Zap,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import QuickSendModal from "./QuickSendModal";

type Store = { id: string; name: string };
type User = { id: string; name: string; active: boolean; storeIds: string[] };
type Props = { stores: Store[]; users: User[]; pendingRequests: number };

export default function AdminBottomNav({ stores, users, pendingRequests }: Props) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [quickSendOpen, setQuickSendOpen] = useState(false);

  const isActive = (href: string) =>
    pathname === href || (href !== "/admin" && pathname?.startsWith(`${href}/`));

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
          <div className="grid grid-cols-2 gap-1">
            {[
              { href: "/admin", label: "Command Center", icon: Zap },
              { href: "/admin/requests", label: "Requests", icon: ClipboardList },
              { href: "/admin/variances", label: "Variances", icon: Activity },
              { href: "/admin/open-shifts", label: "Open Shifts", icon: Clock },
              { href: "/admin/overrides", label: "Overrides", icon: ShieldCheck },
              { href: "/admin/coverage-shifts", label: "Coverage Shifts", icon: ChevronRight },
              { href: "/admin/scheduler", label: "Scheduler", icon: CalendarDays },
              { href: "/admin/shifts", label: "Shifts", icon: Clock },
              { href: "/admin/employee-schedules", label: "Emp. Schedules", icon: BookOpen },
              { href: "/admin/assignments", label: "Assignments", icon: ClipboardList },
              { href: "/admin/payroll", label: "Payroll", icon: Wallet },
              { href: "/admin/payroll/reconciliation", label: "Reconciliation", icon: CreditCard },
              { href: "/admin/safe-ledger", label: "Safe Ledger", icon: ShieldCheck },
              { href: "/admin/shift-sales", label: "Shift Sales", icon: FileBarChart },
              { href: "/admin/reports/store-sales", label: "Store Sales", icon: FileBarChart },
              { href: "/admin/reports/performance-summary", label: "Performance", icon: Sparkles },
              { href: "/admin/employee-scoreboard", label: "Scoreboard", icon: Star },
              { href: "/admin/cleaning/report", label: "Cleaning Report", icon: ClipboardList },
              { href: "/admin/users", label: "Employees", icon: Users },
              { href: "/admin/reviews", label: "Reviews", icon: Star },
              { href: "/admin/cleaning", label: "Cleaning Tasks", icon: ClipboardList },
              { href: "/admin/settings", label: "Settings", icon: Settings },
            ].map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMoreOpen(false)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                  pathname === href || pathname?.startsWith(`${href}/`)
                    ? "text-[var(--green)] bg-[rgba(32,240,138,0.07)]"
                    : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-white/5"
                }`}
              >
                <Icon className="h-4 w-4 flex-shrink-0" strokeWidth={1.8} />
                <span className="truncate">{label}</span>
              </Link>
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
