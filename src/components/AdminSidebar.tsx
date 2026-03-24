"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity, ArrowRightLeft, BookOpen, CalendarDays, ChevronDown, ClipboardList,
  Clock, CreditCard, FileBarChart, PenSquare, Settings,
  ShieldCheck, Sparkles, Star, Users, Wallet, Zap,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import QuickSendModal from "./QuickSendModal";
import UserAvatar, { type AvatarOptions } from "@/components/UserAvatar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

type Store = { id: string; name: string };
type User = { id: string; name: string; active: boolean; storeIds: string[] };

type Props = {
  stores: Store[];
  users: User[];
};

type NavItem = { href: string; label: string; icon: React.ElementType; badge?: number };
type NavGroup = { label: string; items: NavItem[] };

type AvatarData = {
  avatar_style: string | null;
  avatar_seed: string | null;
  avatar_options: AvatarOptions;
  avatar_upload_url: string | null;
};

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

function getInitialOpenGroups(pathname: string | null): Record<string, boolean> {
  const matches = (hrefs: string[]) =>
    hrefs.some((h) => pathname === h || pathname?.startsWith(`${h}/`));
  return {
    "Live Ops": matches(["/admin/requests", "/admin/variances", "/admin/open-shifts", "/admin/overrides", "/admin/coverage-shifts"]),
    "Scheduling": matches(["/admin/scheduler", "/admin/shifts", "/admin/employee-schedules", "/admin/assignments"]),
    "Payroll & Finance": matches(["/admin/payroll", "/admin/safe-ledger", "/admin/shift-sales"]),
    "Reports": matches(["/admin/reports", "/admin/employee-scoreboard", "/admin/cleaning/report"]),
    "People & Config": matches(["/admin/users", "/admin/reviews", "/admin/cleaning", "/admin/settings"]),
  };
}

export default function AdminSidebar({ stores, users }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [quickSendOpen, setQuickSendOpen] = useState(false);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [unreviewedVariances, setUnreviewedVariances] = useState(0);
  const [avatar, setAvatar] = useState<AvatarData | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    getInitialOpenGroups(pathname)
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getSession();
        const token = auth.session?.access_token ?? "";
        if (!token) return;

        if (auth.session?.user?.id) setUserId(auth.session.user.id);

        const [badgeRes, avatarRes] = await Promise.all([
          fetch("/api/admin/badge-counts", { headers: { Authorization: `Bearer ${token}` } }),
          fetch("/api/me/avatar", { headers: { Authorization: `Bearer ${token}` } }),
        ]);

        if (!alive) return;

        if (badgeRes.ok) {
          const json = await badgeRes.json() as { pendingRequests: number; unreviewedVariances: number };
          setPendingRequests(json.pendingRequests ?? 0);
          setUnreviewedVariances(json.unreviewedVariances ?? 0);
        }

        if (avatarRes.ok) {
          const json = await avatarRes.json() as AvatarData;
          setAvatar({
            avatar_style: json.avatar_style ?? "avataaars",
            avatar_seed: json.avatar_seed ?? null,
            avatar_options: json.avatar_options ?? {},
            avatar_upload_url: json.avatar_upload_url ?? null,
          });
        }
      } catch {
        // silently fail — badges and avatar are best-effort
      }
    })();
    return () => { alive = false; };
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("sh_pin_token");
      sessionStorage.removeItem("sh_pin_store_id");
      sessionStorage.removeItem("sh_pin_profile_id");
    }
    router.push("/");
  }

  const groups: NavGroup[] = [
    {
      label: "Live Ops",
      items: [
        { href: "/admin/requests", label: "Requests", icon: ClipboardList, badge: pendingRequests },
        { href: "/admin/variances", label: "Variances", icon: Activity, badge: unreviewedVariances },
        { href: "/admin/open-shifts", label: "Open Shifts", icon: Clock },
        { href: "/admin/overrides", label: "Overrides", icon: ShieldCheck },
        { href: "/admin/coverage-shifts", label: "Coverage Shifts", icon: ArrowRightLeft },
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
      <aside className="fixed left-0 top-0 bottom-0 w-[224px] z-30 hidden lg:flex flex-col bg-[rgba(8,10,9,0.92)] backdrop-blur-[18px] border-r border-white/7 overflow-y-auto">

        {/* Brand — logo + app name, links back to employee home */}
        <div className="px-4 pt-5 pb-4 border-b border-white/7">
          <Link href="/" className="flex items-center gap-3 group" aria-label="Return to home">
            <div className="relative flex-shrink-0">
              <span className="employee-header-logo-glow" aria-hidden="true" />
              <Image
                src="/brand/no_cap_logo.jpg"
                alt="No Cap Smoke Shop"
                width={36}
                height={36}
                priority
                className="employee-header-logo rounded-lg"
              />
            </div>
            <div>
              <div className="text-sm font-bold text-[var(--text)] leading-tight">Shift Happens</div>
              <div className="text-[10px] text-[var(--muted)] leading-tight">Admin</div>
            </div>
          </Link>
        </div>

        {/* Home / Command Center link */}
        <div className="px-3 pt-3 pb-1">
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
        <nav className="flex-1 px-3 space-y-1 pb-4">
          {groups.map((group) => (
            <Collapsible
              key={group.label}
              open={openGroups[group.label] ?? false}
              onOpenChange={() => toggleGroup(group.label)}
            >
              <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-1.5 rounded-md hover:bg-white/5 transition-colors group">
                <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]/60 group-hover:text-[var(--muted)]">
                  {group.label}
                </span>
                <ChevronDown
                  className={`h-3 w-3 text-[var(--muted)]/40 transition-transform duration-200 ${
                    openGroups[group.label] ? "rotate-0" : "-rotate-90"
                  }`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="space-y-0.5 pt-0.5 pb-1">
                  {group.items.map((item) => (
                    <NavLink key={item.href} item={item} pathname={pathname} />
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </nav>

        {/* Footer — Quick Send + avatar + logout */}
        <div className="px-3 pb-5 border-t border-white/7 pt-3 space-y-3">
          <button
            onClick={() => setQuickSendOpen(true)}
            className="btn-secondary w-full flex items-center justify-center gap-2 px-3 py-2 text-sm"
          >
            <PenSquare className="h-4 w-4" />
            Quick Send
          </button>

          <div className="flex items-center justify-between px-1">
            <Link href="/avatar" aria-label="Avatar settings" className="employee-sidebar-avatar">
              <UserAvatar
                seed={avatar?.avatar_seed ?? userId}
                style={avatar?.avatar_style ?? "avataaars"}
                options={avatar?.avatar_options ?? {}}
                uploadUrl={avatar?.avatar_upload_url ?? null}
                alt="My avatar"
              />
            </Link>
            <button
              onClick={handleLogout}
              className="text-xs text-[var(--muted)] hover:text-[var(--danger)] transition-colors"
            >
              Logout
            </button>
          </div>
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
