# Admin Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the admin tile-grid with a persistent sidebar shell, merge the Command Center into `/admin`, and apply the established dark design language across all 23 admin pages.

**Architecture:** A new `admin/layout.tsx` (client component) wraps every `/admin` route, providing auth, the desktop `AdminSidebar`, and mobile `AdminBottomNav`. The `body::before`/`after` pseudo-elements already supply the atmospheric dark background globally — the layout just needs a transparent flex container. A new `GET /api/admin/badge-counts` endpoint powers the sidebar badges. `QuickSendModal` is a shared Dialog used by both nav components. The old `/admin/dashboard` page becomes a redirect to `/admin`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Tailwind CSS v4, Supabase (`@supabase/supabase-js`), shadcn components (`dialog`, `sheet` — sheet needs install), Lucide icons, Recharts.

---

## Spec Reference

`docs/superpowers/specs/2026-03-24-admin-redesign-design.md`

---

## File Map

### New Files
| File | Purpose |
|---|---|
| `src/app/admin/layout.tsx` | Client-component shell: auth check, flex container, renders sidebar + bottom nav |
| `src/components/AdminSidebar.tsx` | Desktop sidebar: 5-group nav, badge counts, compose button |
| `src/components/AdminBottomNav.tsx` | Mobile bottom nav: 5 tabs (Home, Requests, Compose, Payroll, More) |
| `src/components/QuickSendModal.tsx` | Shared Dialog for Quick Send message/task |
| `src/app/api/admin/badge-counts/route.ts` | `GET` — returns `{ pendingRequests, unreviewedVariances }` |

### Modified Files
| File | Change |
|---|---|
| `src/app/layout.tsx` | Remove `<ClientHeader />` usage and import |
| `src/app/admin/page.tsx` | Full rewrite as Command Center (replaces tile grid) |
| `src/app/admin/dashboard/page.tsx` | Replace with `redirect('/admin')` |
| 23 admin pages (Phases 3–5) | Visual treatment: title font, card borders, remove back links |

---

## Visual Treatment Pattern

> **Applies uniformly to every admin page in Phases 3–5. Read this once.**

For each page file, make exactly these changes and nothing else:

**1. Page title** — find the `<h1>` or equivalent title element. Replace its className with:
```tsx
className="font-[family-name:var(--font-display)] text-2xl font-bold uppercase tracking-tight text-[var(--text)]"
```

**2. Back-to-hub link** — remove any `<Link href="/admin">` or `<Link href="/admin/dashboard">` that serves as a navigation back link. The sidebar replaces this.

**3. Card borders** — find shadcn `<Card>` components. Replace:
- `className` on `<Card>`: add `border-white/8 bg-[var(--card)]` (keep any existing layout classes like `col-span-X`)
- Any hardcoded `border-slate-700` or `border-slate-800` in `<table>`, `<thead>`, `<tr>`, `<td>`, `<th>` elements: replace with `border-white/8`
- Any `bg-slate-900` or `bg-slate-950` on table rows/containers: replace with `bg-[var(--card)]` or `bg-[var(--bg1)]`

**4. Commit after each page** with message `style(admin): apply shell treatment to [page-name]`

---

## Phase 1 — Admin Shell

### Task 1: Install Sheet + create badge-counts API endpoint

**Files:**
- Install: `npx shadcn@latest add sheet` → creates `src/components/ui/sheet.tsx`
- Create: `src/app/api/admin/badge-counts/route.ts`

- [ ] **Step 1: Install the shadcn Sheet component**

```bash
cd "C:/Users/samue/Desktop/Shift_Happens/Shift_Happens_08-12-2025"
npx shadcn@latest add sheet
```

Expected: creates `src/components/ui/sheet.tsx`. If prompted for config, accept defaults.

- [ ] **Step 2: Create the badge-counts API route**

Create `src/app/api/admin/badge-counts/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";

export async function GET(req: Request) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const managerStoreIds = await getManagerStoreIds(user.id);
  if (!managerStoreIds.length) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  // Count pending requests across all three request types
  const [swapsRes, timeOffRes, timesheetRes, variancesRes] = await Promise.all([
    supabaseServer
      .from("shift_swap_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .in("store_id", managerStoreIds),
    supabaseServer
      .from("time_off_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .in("store_id", managerStoreIds),
    supabaseServer
      .from("timesheet_change_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .in("store_id", managerStoreIds),
    // Variances: notified_manager=true AND reviewed_at IS NULL, scoped via shifts join
    supabaseServer
      .from("shift_drawer_counts")
      .select("id, shifts!inner(store_id)", { count: "exact", head: true })
      .eq("notified_manager", true)
      .is("reviewed_at", null)
      .in("shifts.store_id", managerStoreIds),
  ]);

  const pendingRequests =
    (swapsRes.count ?? 0) + (timeOffRes.count ?? 0) + (timesheetRes.count ?? 0);
  const unreviewedVariances = variancesRes.count ?? 0;

  return NextResponse.json({ pendingRequests, unreviewedVariances });
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors on the new file.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/badge-counts/route.ts src/components/ui/sheet.tsx
git commit -m "feat(admin): add badge-counts API + install Sheet component"
```

---

### Task 2: Create QuickSendModal

**Files:**
- Create: `src/components/QuickSendModal.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/QuickSendModal.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Store = { id: string; name: string };
type User = { id: string; name: string; active: boolean; storeIds: string[] };

type Props = {
  open: boolean;
  onClose: () => void;
  stores: Store[];
  users: User[];
};

export default function QuickSendModal({ open, onClose, stores, users }: Props) {
  const [type, setType] = useState<"message" | "task">("message");
  const [targetType, setTargetType] = useState<"store" | "employee">("store");
  const [targetStoreId, setTargetStoreId] = useState(stores[0]?.id ?? "");
  const [targetProfileId, setTargetProfileId] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const activeUsers = targetType === "store"
    ? users.filter((u) => u.active)
    : users.filter((u) => u.active && u.storeIds.includes(targetStoreId));

  async function handleSend() {
    if (!message.trim()) { setError("Message is required."); return; }
    if (targetType === "store" && !targetStoreId) { setError("Select a store."); return; }
    if (targetType === "employee" && !targetProfileId) { setError("Select an employee."); return; }

    try {
      setSending(true);
      setError(null);
      const { data: auth } = await supabase.auth.getSession();
      const token = auth.session?.access_token ?? "";
      if (!token) { setError("Not authenticated."); return; }

      const res = await fetch("/api/admin/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          type,
          message: message.trim(),
          targetStoreId: targetType === "store" ? targetStoreId : undefined,
          targetProfileId: targetType === "employee" ? targetProfileId : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to send.");

      setMessage("");
      setSent(true);
      setTimeout(() => { setSent(false); onClose(); }, 1500);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to send.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="bg-[var(--card)] border-white/8 text-[var(--text)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-[family-name:var(--font-display)] text-xl font-bold uppercase tracking-tight">
            Quick Send
          </DialogTitle>
        </DialogHeader>

        {sent ? (
          <div className="py-6 text-center text-[var(--green)] font-semibold">Sent ✓</div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1 text-sm text-[var(--muted)]">
                <span>Type</span>
                <Select value={type} onValueChange={(v) => setType(v as "message" | "task")}>
                  <SelectTrigger className="input"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="message">Message</SelectItem>
                    <SelectItem value="task">Task</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1 text-sm text-[var(--muted)]">
                <span>Target</span>
                <Select value={targetType} onValueChange={(v) => setTargetType(v as "store" | "employee")}>
                  <SelectTrigger className="input"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="store">Store</SelectItem>
                    <SelectItem value="employee">Employee</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {targetType === "store" ? (
              <div className="flex flex-col gap-1 text-sm text-[var(--muted)]">
                <span>Store</span>
                <Select value={targetStoreId} onValueChange={setTargetStoreId}>
                  <SelectTrigger className="input"><SelectValue placeholder="Select store" /></SelectTrigger>
                  <SelectContent>
                    {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="flex flex-col gap-1 text-sm text-[var(--muted)]">
                <span>Employee</span>
                <Select value={targetProfileId} onValueChange={setTargetProfileId}>
                  <SelectTrigger className="input"><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>
                    {activeUsers.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex flex-col gap-1 text-sm text-[var(--muted)]">
              <span>Message / Task Details</span>
              <textarea
                className="textarea min-h-[80px] w-full"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type what should be done or communicated..."
              />
            </div>

            {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

            <div className="flex justify-end">
              <button
                className="btn-secondary inline-flex items-center gap-2 px-4 py-2 text-sm"
                onClick={() => void handleSend()}
                disabled={sending}
              >
                <Send className="h-4 w-4" />
                {sending ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/QuickSendModal.tsx
git commit -m "feat(admin): add QuickSendModal shared component"
```

---

### Task 3: Create AdminSidebar

**Files:**
- Create: `src/components/AdminSidebar.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/AdminSidebar.tsx`:

```tsx
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
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/AdminSidebar.tsx
git commit -m "feat(admin): add AdminSidebar component"
```

---

### Task 4: Create AdminBottomNav

**Files:**
- Create: `src/components/AdminBottomNav.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/AdminBottomNav.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  ClipboardList, Home, MoreHorizontal, PenSquare, Wallet, X, Zap,
  Activity, BookOpen, CalendarDays, ChevronRight, Clock,
  CreditCard, FileBarChart, Settings, ShieldCheck, Sparkles, Star, Users,
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
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/AdminBottomNav.tsx
git commit -m "feat(admin): add AdminBottomNav component"
```

---

### Task 5: Create admin/layout.tsx + retire ClientHeader

**Files:**
- Create: `src/app/admin/layout.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Create the admin layout**

Create `src/app/admin/layout.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import AdminSidebar from "@/components/AdminSidebar";
import AdminBottomNav from "@/components/AdminBottomNav";

type Store = { id: string; name: string };
type User = { id: string; name: string; active: boolean; storeIds: string[] };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [stores, setStores] = useState<Store[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [pendingRequests, setPendingRequests] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Auth check — same pattern used by existing admin pages
        const { data: { user } } = await supabase.auth.getUser();
        if (!alive) return;
        if (!user) {
          const path = window.location.pathname;
          router.replace(`/login?next=${encodeURIComponent(path)}`);
          return;
        }
        setAuthed(true);

        // Fetch stores, users, and badge counts in parallel
        const { data: authSession } = await supabase.auth.getSession();
        const token = authSession.session?.access_token ?? "";
        if (!token || !alive) return;

        const [usersRes, badgeRes] = await Promise.all([
          fetch("/api/admin/users", { headers: { Authorization: `Bearer ${token}` } }),
          fetch("/api/admin/badge-counts", { headers: { Authorization: `Bearer ${token}` } }),
        ]);

        if (!alive) return;

        if (usersRes.ok) {
          const usersJson = await usersRes.json() as { users?: User[]; stores?: Store[] };
          setUsers((usersJson.users ?? []).filter((u) => u.active));
          // Extract stores from users data if available, otherwise fetch separately
          if (usersJson.stores) setStores(usersJson.stores);
        }

        if (badgeRes.ok) {
          const badgeJson = await badgeRes.json() as { pendingRequests: number; unreviewedVariances: number };
          setPendingRequests(badgeJson.pendingRequests ?? 0);
        }
      } catch {
        // silently fail — pages handle their own errors
      }
    })();
    return () => { alive = false; };
  }, [router]);

  if (!authed) return null; // auth redirect in progress

  return (
    {/* Flex row container — sidebar + content. No padding-left hacks; does not collide with .employee-desktop-sidebar rules */}
    <div className="flex min-h-screen">
      <AdminSidebar stores={stores} users={users} />
      {/* Content area — fills remaining width via flex-1; overflow-y: auto so full-width pages scroll correctly */}
      <div className="flex-1 min-h-0 overflow-y-auto pb-20 lg:pb-0">
        {children}
      </div>
      <AdminBottomNav stores={stores} users={users} pendingRequests={pendingRequests} />
    </div>
  );
}
```

> **Note on stores:** Check what `/api/admin/users` actually returns. If it doesn't include stores, add a separate `GET /api/admin/dashboard?from=today&to=today` call or a direct Supabase query for `stores` scoped by manager. Inspect the API response on first test run and adjust if needed.

- [ ] **Step 2: Remove ClientHeader from root layout**

Edit `src/app/layout.tsx`. Remove the import and usage:

```tsx
// REMOVE this line:
import ClientHeader from "./clientheader";

// REMOVE this from the body:
<ClientHeader />
```

The file should look like:
```tsx
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Barlow_Condensed } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

// ... font setup unchanged ...

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} ${barlowCondensed.variable} antialiased`}>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors. If `ClientHeader` is referenced elsewhere, fix those references.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/layout.tsx src/app/layout.tsx
git commit -m "feat(admin): add admin shell layout, retire ClientHeader"
```

---

### Task 6: Smoke test Phase 1

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify auth redirect**

Open an incognito/private browser tab. Navigate to `http://localhost:3000/admin`. Expected: redirects to `/login?next=%2Fadmin`.

- [ ] **Step 3: Verify sidebar renders**

Log in as a manager. Navigate to `/admin`. Expected:
- Left sidebar visible on wide screen (≥1024px)
- All 5 nav groups present with correct links
- "Quick Send" compose button at bottom of sidebar
- Active state highlights "Command Center" link (green, left border)

- [ ] **Step 4: Verify mobile nav**

Resize browser to 375px width. Expected:
- Sidebar hidden
- Bottom nav visible with 5 tabs: Home, Requests, Send (purple), Payroll, More
- Tapping "More" opens Sheet with full nav grid
- Tapping "Send" opens QuickSendModal

- [ ] **Step 5: Verify Quick Send works**

Open the compose modal. Select a store, type a message, hit Send. Expected: "Sent ✓" confirmation, modal closes after 1.5s.

- [ ] **Step 6: Navigate to several admin pages**

Click Requests, Variances, Scheduler in the sidebar. Expected: each page loads, active state updates correctly, no duplicate headers.

---

## Phase 2 — Command Center Hub

### Task 7: Rewrite `/admin/page.tsx` as Command Center

**Files:**
- Modify: `src/app/admin/page.tsx` (full rewrite)

The new `/admin/page.tsx` is a port of `/admin/dashboard/page.tsx` with:
- Removed: tile grid, standalone auth redirect (layout handles it), Quick Send block
- Changed: KPI row layout (2×2 mobile / 4-col desktop, compact tiles), Action Items moved above Sales Block, zero-action green bar
- Same: all helper functions, all useMemo/useEffect logic, Sales Block, Store Health, QuickView dialog

- [ ] **Step 1: Copy dashboard logic into admin/page.tsx**

Open `src/app/admin/dashboard/page.tsx` and `src/app/admin/page.tsx` side by side.

Replace the entire contents of `src/app/admin/page.tsx` with the dashboard logic, **including all imports from dashboard/page.tsx**. Then verify these imports are present (add any missing ones):
- `import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";` — used by filter bar
- `import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";` — used by KPI tiles and Sales Block
- `import { QuickSendModal } from "@/components/QuickSendModal";` — replaces inline Quick Send
- Remove the import of `Link` from `next/link` if it was only used for the back-to-hub link

Then make the following targeted modifications:

**a) Remove the auth/redirect useEffect** — the layout handles this now.

**b) Remove the `users` state and fetch** — `QuickSendModal` gets stores/users from the layout. Remove:
```typescript
// Remove these:
const [users, setUsers] = useState<...>([]);
const [sendingAssignment, setSendingAssignment] = useState(false);
const [quickSend, setQuickSend] = useState<...>(...);
// Remove sendQuickAssignment() function
// Remove the users fetch useEffect
// Remove the visibleUsers useMemo
// Remove the quickSend defaulting useEffect
```

**c) Remove the back-to-hub Link** — no `<Link href="/admin">Back to Admin Hub</Link>` in the JSX.

- [ ] **Step 2: Build the new JSX layout**

Replace the JSX return with this structure:

```tsx
return (
  <div className="app-shell p-3 sm:p-4 lg:p-6">
    <div className="mx-auto w-full max-w-[1600px] space-y-4">

      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold uppercase tracking-tight text-[var(--text)]">
            Command Center
          </h1>
          <p className="text-sm text-[var(--muted)]">
            {cstDateKey(new Date())} · {selectedStoreLabel}
          </p>
        </div>
        {/* Collapsible filter bar trigger */}
        <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
          <CollapsibleTrigger className="rounded-md border border-white/8 px-3 py-1.5 text-xs text-[var(--muted)] hover:bg-white/5">
            {filtersOpen ? "Hide Filters" : "Filters"}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-2 border-white/8 bg-[var(--card)]">
              <CardContent className="pt-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <label className="flex flex-col gap-1 text-sm text-[var(--muted)]">
                    Start Date
                    <input type="date" className="input h-9" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-[var(--muted)]">
                    End Date
                    <input type="date" className="input h-9" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
                  </label>
                  <div className="flex flex-col gap-1 text-sm text-[var(--muted)]">
                    <span>Store</span>
                    <Select value={storeId} onValueChange={setStoreId}>
                      <SelectTrigger className="input h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Stores</SelectItem>
                        {(data?.stores ?? []).map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {loading ? (
        <div className="text-sm text-[var(--muted)] py-8 text-center">Loading...</div>
      ) : (
        <div className="space-y-4">

          {/* KPI row: 2×2 on mobile, 4-col on desktop */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-[var(--card)] border border-white/8 rounded-xl p-3">
              <div className="text-[10px] uppercase tracking-widest text-[var(--muted)] mb-1">Yesterday Sales</div>
              <div className="text-2xl font-bold text-[var(--green)]">{money(topline.totalSales)}</div>
              <div className="hidden lg:block text-[10px] text-[var(--muted)] mt-1">
                Cash {money(topline.cashSales)} · Card {money(topline.cardSales)}
              </div>
            </div>
            <div className="bg-[var(--card)] border border-white/8 rounded-xl p-3">
              <div className="text-[10px] uppercase tracking-widest text-[var(--muted)] mb-1">Closeout</div>
              <div className={`text-2xl font-bold ${
                topline.closeoutStatus === "pass" ? "text-[var(--green)]"
                : topline.closeoutStatus === "warn" ? "text-[#ffa050]"
                : topline.closeoutStatus === "fail" ? "text-[var(--danger)]"
                : "text-[var(--muted)]"
              }`}>
                {topline.closeoutStatus ? topline.closeoutStatus.toUpperCase() : "N/A"}
              </div>
              <div className="text-[10px] text-[var(--muted)] mt-1">Variance {money(topline.closeoutVariance)}</div>
            </div>
            <div className="bg-[var(--card)] border border-white/8 rounded-xl p-3">
              <div className="text-[10px] uppercase tracking-widest text-[var(--muted)] mb-1">Open Shifts</div>
              <div className="text-2xl font-bold text-[var(--purple)]">{data?.openShifts ?? 0}</div>
            </div>
            <div className="bg-[var(--card)] border border-white/8 rounded-xl p-3">
              <div className="text-[10px] uppercase tracking-widest text-[var(--muted)] mb-1">Pending</div>
              <div className={`text-2xl font-bold ${(data?.pendingApprovals ?? 0) > 0 ? "text-[#ffa050]" : "text-[var(--muted)]"}`}>
                {data?.pendingApprovals ?? 0}
              </div>
            </div>
          </div>

          {/* Immediate Action Items */}
          {actionCountsTotal === 0 ? (
            <div className="bg-[var(--green)]/10 border border-[var(--green)]/30 rounded-xl px-4 py-2 text-sm font-medium text-[var(--green)]">
              Immediate Action Items: All Clear
            </div>
          ) : (
            <Card className="border-white/8 bg-[var(--card)]">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="h-4 w-4 text-amber-300" /> Immediate Action Items
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* Filter badges + collapsible — same as current dashboard, verbatim */}
                {/* ... keep existing action items JSX from dashboard/page.tsx ... */}
              </CardContent>
            </Card>
          )}

          {/* Main body: 2/3 + 1/3 */}
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              {/* Sales Block — verbatim from dashboard */}
              <Card className="border-white/8 bg-[var(--card)]">
                {/* ... keep existing sales block JSX ... */}
              </Card>
            </div>
            <div>
              {/* Store Health — verbatim from dashboard */}
              <Card className="border-white/8 bg-[var(--card)]">
                {/* ... keep existing store health JSX ... */}
              </Card>
            </div>
          </section>

          {/* QuickView Dialog — verbatim from dashboard */}
          {/* ... */}

        </div>
      )}
    </div>
  </div>
);
```

> **Approach:** Copy the existing dashboard JSX blocks for Action Items (filter badges, collapsible list, action buttons, mark-reviewed), Sales Block (tabs/table/chart), Store Health, and QuickView Dialog directly from `src/app/admin/dashboard/page.tsx`. Update their `<Card>` className to `border-white/8 bg-[var(--card)]`. The structural novelty is only the KPI tiles layout, the Action Items elevation, and the all-clear bar.

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Load the page and verify**

Navigate to `/admin`. Check:
- KPI tiles show in 2×2 on mobile, 4-wide on desktop
- Filter bar collapses/expands correctly
- Action Items appear below KPIs (green bar if all clear, full section otherwise)
- Sales Block shows table and chart tabs
- Store Health shows per-store grade cards

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/page.tsx
git commit -m "feat(admin): rewrite hub as Command Center, merge dashboard content"
```

---

### Task 8: Convert dashboard to redirect

> **Only do this after Task 6 step 2 confirms auth redirect works in incognito.**

**Files:**
- Modify: `src/app/admin/dashboard/page.tsx`

- [ ] **Step 1: Replace dashboard with redirect**

Replace the entire contents of `src/app/admin/dashboard/page.tsx` with:

```tsx
import { redirect } from "next/navigation";

export default function AdminDashboardRedirect() {
  redirect("/admin");
}
```

- [ ] **Step 2: Verify redirect**

Navigate to `/admin/dashboard`. Expected: immediately redirects to `/admin`.

- [ ] **Step 3: TypeScript check + commit**

```bash
npx tsc --noEmit
git add src/app/admin/dashboard/page.tsx
git commit -m "feat(admin): redirect /admin/dashboard to /admin"
```

---

## Phase 3 — Live Ops Pages

> **Pattern reminder:** For each page, apply the Visual Treatment Pattern defined at the top of this plan. Keep all logic untouched.

### Task 9: `src/app/admin/requests/page.tsx`

- [ ] **Step 1:** Apply visual treatment (title font, card borders, remove back links)
- [ ] **Step 2:** `npx tsc --noEmit` — no errors
- [ ] **Step 3:** Navigate to `/admin/requests`, confirm tabs (Swaps, Time Off, Timesheets) all render, approve/deny actions still work
- [ ] **Step 4:** `git add src/app/admin/requests/page.tsx && git commit -m "style(admin): apply shell treatment to requests"`

---

### Task 10: `src/app/admin/variances/page.tsx`

- [ ] **Step 1:** Apply visual treatment
- [ ] **Step 2:** `npx tsc --noEmit`
- [ ] **Step 3:** Navigate to `/admin/variances`, confirm table loads, review action works
- [ ] **Step 4:** `git commit -m "style(admin): apply shell treatment to variances"`

---

### Task 11: `src/app/admin/open-shifts/page.tsx`

- [ ] **Step 1:** Apply visual treatment
- [ ] **Step 2:** `npx tsc --noEmit`
- [ ] **Step 3:** Navigate to `/admin/open-shifts`, confirm list loads, force-end action present
- [ ] **Step 4:** `git commit -m "style(admin): apply shell treatment to open-shifts"`

---

### Task 12: `src/app/admin/overrides/page.tsx`

- [ ] **Step 1:** Apply visual treatment
- [ ] **Step 2:** `npx tsc --noEmit`
- [ ] **Step 3:** Navigate to `/admin/overrides`, confirm list loads
- [ ] **Step 4:** `git commit -m "style(admin): apply shell treatment to overrides"`

---

### Task 13: `src/app/admin/coverage-shifts/page.tsx`

- [ ] **Step 1:** Apply visual treatment
- [ ] **Step 2:** `npx tsc --noEmit`
- [ ] **Step 3:** Navigate to `/admin/coverage-shifts`, confirm approve/deny workflow works
- [ ] **Step 4:** `git commit -m "style(admin): apply shell treatment to coverage-shifts"`

---

## Phase 4 — Scheduling + Payroll & Finance

### Task 14: `src/app/admin/scheduler/page.tsx`

> **Extra care:** Scheduler is one of the high-risk files noted in AGENTS.md. Apply visual treatment only — do not touch layout or scheduling logic.

- [ ] **Step 1:** Apply visual treatment (title, card borders, back links only — leave scheduler grid/cards completely alone)
- [ ] **Step 2:** `npx tsc --noEmit`
- [ ] **Step 3:** Navigate to `/admin/scheduler`, confirm schedule grid renders on desktop, card view on mobile, publish actions work
- [ ] **Step 4:** `git commit -m "style(admin): apply shell treatment to scheduler"`

---

### Task 15: `src/app/admin/shifts/page.tsx`

- [ ] **Step 1:** Apply visual treatment
- [ ] **Step 2:** `npx tsc --noEmit`
- [ ] **Step 3:** Navigate to `/admin/shifts`, confirm table + filter + edit drawer work
- [ ] **Step 4:** `git commit -m "style(admin): apply shell treatment to shifts"`

---

### Task 16: `src/app/admin/shifts/[shiftId]/page.tsx`

- [ ] **Step 1:** Apply visual treatment (this is a detail page — not in sidebar nav but gets same treatment)
- [ ] **Step 2:** `npx tsc --noEmit`
- [ ] **Step 3:** Click into a shift from the shifts list, confirm detail page renders
- [ ] **Step 4:** `git commit -m "style(admin): apply shell treatment to shift detail"`

---

### Task 17: `src/app/admin/employee-schedules/page.tsx`

- [ ] **Step 1:** Apply visual treatment
- [ ] **Step 2:** `npx tsc --noEmit`
- [ ] **Step 3:** Navigate to `/admin/employee-schedules`, confirm schedule view loads
- [ ] **Step 4:** `git commit -m "style(admin): apply shell treatment to employee-schedules"`

---

### Task 18: `src/app/admin/assignments/page.tsx`

- [ ] **Step 1:** Apply visual treatment
- [ ] **Step 2:** `npx tsc --noEmit`
- [ ] **Step 3:** Navigate to `/admin/assignments`, confirm assignment form works
- [ ] **Step 4:** `git commit -m "style(admin): apply shell treatment to assignments"`

---

### Task 19: `src/app/admin/payroll/page.tsx`

- [ ] **Step 1:** Apply visual treatment
- [ ] **Step 2:** `npx tsc --noEmit`
- [ ] **Step 3:** Navigate to `/admin/payroll`, confirm pay period table loads, export works
- [ ] **Step 4:** `git commit -m "style(admin): apply shell treatment to payroll"`

---

### Task 20: `src/app/admin/payroll/reconciliation/page.tsx`

- [ ] **Step 1:** Apply visual treatment
- [ ] **Step 2:** `npx tsc --noEmit`
- [ ] **Step 3:** Navigate to `/admin/payroll/reconciliation`, confirm page loads
- [ ] **Step 4:** `git commit -m "style(admin): apply shell treatment to payroll-reconciliation"`

---

### Task 21: `src/app/admin/safe-ledger/page.tsx`

- [ ] **Step 1:** Apply visual treatment
- [ ] **Step 2:** `npx tsc --noEmit`
- [ ] **Step 3:** Navigate to `/admin/safe-ledger`, confirm closeout table and review workflow load
- [ ] **Step 4:** `git commit -m "style(admin): apply shell treatment to safe-ledger"`

---

### Task 22: `src/app/admin/shift-sales/page.tsx`

- [ ] **Step 1:** Apply visual treatment
- [ ] **Step 2:** `npx tsc --noEmit`
- [ ] **Step 3:** Navigate to `/admin/shift-sales`, confirm sales table loads
- [ ] **Step 4:** `git commit -m "style(admin): apply shell treatment to shift-sales"`

---

## Phase 5 — Reports + People & Config

### Task 23: `src/app/admin/reports/store-sales/page.tsx`

- [ ] **Step 1:** Apply visual treatment
- [ ] **Step 2:** `npx tsc --noEmit`
- [ ] **Step 3:** Navigate to `/admin/reports/store-sales`, confirm report loads and export works
- [ ] **Step 4:** `git commit -m "style(admin): apply shell treatment to store-sales-report"`

---

### Task 24: `src/app/admin/reports/performance-summary/page.tsx`

- [ ] **Step 1:** Apply visual treatment
- [ ] **Step 2:** `npx tsc --noEmit`
- [ ] **Step 3:** Navigate to `/admin/reports/performance-summary`, confirm report loads
- [ ] **Step 4:** `git commit -m "style(admin): apply shell treatment to performance-report"`

---

### Task 25: `src/app/admin/employee-scoreboard/page.tsx`

- [ ] **Step 1:** Apply visual treatment
- [ ] **Step 2:** `npx tsc --noEmit`
- [ ] **Step 3:** Navigate to `/admin/employee-scoreboard`, confirm scoreboard loads
- [ ] **Step 4:** `git commit -m "style(admin): apply shell treatment to employee-scoreboard"`

---

### Task 26: `src/app/admin/cleaning/report/page.tsx`

- [ ] **Step 1:** Apply visual treatment
- [ ] **Step 2:** `npx tsc --noEmit`
- [ ] **Step 3:** Navigate to `/admin/cleaning/report`, confirm report loads
- [ ] **Step 4:** `git commit -m "style(admin): apply shell treatment to cleaning-report"`

---

### Task 27: `src/app/admin/users/page.tsx`

- [ ] **Step 1:** Apply visual treatment
- [ ] **Step 2:** `npx tsc --noEmit`
- [ ] **Step 3:** Navigate to `/admin/users`, confirm employee list and edit forms work
- [ ] **Step 4:** `git commit -m "style(admin): apply shell treatment to users"`

---

### Task 28: `src/app/admin/reviews/page.tsx`

- [ ] **Step 1:** Apply visual treatment
- [ ] **Step 2:** `npx tsc --noEmit`
- [ ] **Step 3:** Navigate to `/admin/reviews`, confirm approval queue loads
- [ ] **Step 4:** `git commit -m "style(admin): apply shell treatment to reviews"`

---

### Task 29: `src/app/admin/cleaning/page.tsx`

- [ ] **Step 1:** Apply visual treatment
- [ ] **Step 2:** `npx tsc --noEmit`
- [ ] **Step 3:** Navigate to `/admin/cleaning`, confirm cleaning matrix loads
- [ ] **Step 4:** `git commit -m "style(admin): apply shell treatment to cleaning-tasks"`

---

### Task 30: `src/app/admin/settings/page.tsx`

- [ ] **Step 1:** Apply visual treatment
- [ ] **Step 2:** `npx tsc --noEmit`
- [ ] **Step 3:** Navigate to `/admin/settings`, confirm store config and checklists load
- [ ] **Step 4:** `git commit -m "style(admin): apply shell treatment to settings"`

---

## Phase 6 — Verification

### Task 31: Final TypeScript + build + smoke test

- [ ] **Step 1: Full TypeScript check**

```bash
npx tsc --noEmit
```

Expected: zero errors. Fix any remaining type errors before proceeding.

- [ ] **Step 2: Production build**

```bash
npm run build
```

Expected: build succeeds. Ignore any "failed to fetch external font" network errors — those are sandbox/offline artifacts. Fix any actual build errors.

- [ ] **Step 3: Smoke test checklist**

Run the dev server and verify:

| Check | Expected |
|---|---|
| `/admin` in incognito | Redirects to `/login?next=%2Fadmin` |
| Log in → `/admin` | Command Center loads: KPI tiles, action items (or green bar), sales block, store health |
| KPI tiles on mobile (375px) | 2×2 grid, no overflow |
| Sidebar nav on desktop | All 5 groups visible, active state on current page |
| Badge counts | Requests and Variances show counts if items exist |
| Quick Send (sidebar button) | Modal opens, send works, closes after confirm |
| Quick Send (mobile center tab) | Same modal, same behavior |
| "More" bottom nav sheet | Opens with full nav grid, navigating closes sheet |
| `/admin/dashboard` | Redirects to `/admin` |
| Each sidebar link | Page loads, active state correct, no duplicate headers |
| Scheduler page | Grid/card view intact, no visual regression |
| Payroll page | Export still functional |

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(admin): complete admin shell redesign

- Persistent sidebar (desktop) + bottom nav (mobile)
- Command Center hub with KPI tiles, action feed, sales block
- Quick Send modal accessible from nav on all pages
- Visual treatment applied across all 23 admin pages
- /admin/dashboard redirects to /admin"
```
