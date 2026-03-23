"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, FileText, Home, ShieldCheck, Star, TimerReset } from "lucide-react";

type EmployeeBottomNavProps = {
  profileId?: string | null;
  isManager?: boolean;
};

function isActive(pathname: string | null, candidates: string[]) {
  return candidates.some((candidate) => pathname === candidate || pathname?.startsWith(`${candidate}/`));
}

export default function EmployeeBottomNav({ profileId = null, isManager = false }: EmployeeBottomNavProps) {
  const pathname = usePathname();
  const scheduleHref = profileId ? `/schedule?profileId=${encodeURIComponent(profileId)}` : "/schedule";
  const shiftsHref = profileId ? `/shifts?profileId=${encodeURIComponent(profileId)}` : "/shifts";

  const items = [
    { href: "/", label: "Home", icon: Home, active: isActive(pathname, ["/"]) },
    { href: scheduleHref, label: "Schedule", icon: CalendarDays, active: isActive(pathname, ["/schedule", "/dashboard/schedule"]) },
    { href: shiftsHref, label: "Shifts", icon: TimerReset, active: isActive(pathname, ["/shifts", "/dashboard/shifts"]) },
    { href: "/dashboard/requests", label: "Requests", icon: FileText, active: isActive(pathname, ["/dashboard/requests"]) },
    { href: "/reviews", label: "Reviews", icon: Star, active: isActive(pathname, ["/reviews", "/scoreboard", "/dashboard/scoreboard"]) },
    ...(isManager ? [{ href: "/admin", label: "Admin", icon: ShieldCheck, active: isActive(pathname, ["/admin"]) }] : []),
  ];

  return (
    <nav className="employee-bottom-nav" aria-label="Primary">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`employee-bottom-link ${item.active ? "employee-bottom-link-active" : ""}`}
          >
            <Icon className="h-5 w-5" strokeWidth={1.8} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
