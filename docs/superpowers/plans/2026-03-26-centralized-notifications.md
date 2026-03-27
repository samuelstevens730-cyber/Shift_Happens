# Centralized Notifications System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ad-hoc shift-scoped message delivery with a `notifications` table that powers a persistent bell icon for both employees and managers, with all notification types priority-categorized for future FCM push notification support.

**Architecture:** A new `notifications` table is the source of truth for all per-recipient, informational notifications (messages, approvals, operational alerts). `shift_assignments` is retained for two purposes: (1) manager-assigned tasks (ad-hoc checklist items distinct from `cleaning_task_completions`), and (2) store-targeted lazy-delivery messages — assignments created with `target_store_id` that are held undelivered until the next employee clocks in at that store. Only profile-targeted `type='message'` records migrate out of `shift_assignments` into `notifications`; store-targeted messages remain in `shift_assignments` and continue to use existing clock-in delivery logic unchanged.

A `createNotification()` server utility handles per-recipient inserts; `createStoreNotification()` fans out to all managers at a store (one row per manager, so `recipient_profile_id` is always set and read/dismiss state is never shared). All notification API routes use `authenticateShiftRequest()` which handles both employee PIN JWT (no Supabase auth account) and manager Supabase JWT. Clock-out blocks on both pending tasks (from `shift_assignments`) AND unread manager messages (from `notifications`); the shift detail page and end-shift route check both sources.

**Tech Stack:** Next.js 16 App Router, Supabase (PostgreSQL), TypeScript, shadcn/ui

---

## Scope Note

This plan (Plan A) covers the full notification system end-to-end. A future **Plan B** will wire in Firebase Cloud Messaging using the `priority` field and FCM-ready columns scaffolded here.

---

## Notification Type Reference

The following `notification_type` values and their priorities are the contract for the entire system. Every `createNotification()` call must use one of these types.

| `notification_type` | Recipient | Priority | Description |
|---|---|---|---|
| `manager_message` | Employee | **high** | Direct message from a manager |
| `schedule_change` | Employee | **high** | Their shift was edited or deleted |
| `swap_approved` | Employee | **high** | Swap request approved by manager |
| `swap_denied` | Employee | **high** | Swap request denied by manager |
| `swap_offer_accepted` | Employee | **high** | Offered shift accepted (pending manager approval) |
| `coverage_approved` | Employee | **high** | Coverage request approved |
| `coverage_denied` | Employee | **high** | Coverage request denied |
| `time_off_approved` | Employee | **high** | Time off request approved |
| `time_off_denied` | Employee | **high** | Time off request denied |
| `swap_offer_received` | Employee | **normal** | Someone offered to take their shift |
| `swap_offer_declined` | Employee | **normal** | Their offer was declined |
| `timesheet_approved` | Employee | **normal** | Timesheet correction approved |
| `timesheet_denied` | Employee | **normal** | Timesheet correction denied |
| `swap_pending_approval` | Manager | **high** | Swap request needs manager approval |
| `coverage_pending_approval` | Manager | **high** | Coverage request needs manager approval |
| `task_skipped` | Manager | **high** | Cleaning task was skipped |
| `drawer_variance` | Manager | **high** | Drawer count out of threshold |
| `safe_closeout_failed` | Manager | **high** | Safe closeout failed validation |
| `override_pending` | Manager | **normal** | Shift variance/override needs review |
| `manual_close_pending` | Manager | **normal** | Manually closed shift needs review |
| `unscheduled_shift` | Manager | **normal** | Unscheduled shift detected |
| `safe_closeout_review` | Manager | **normal** | Safe closeout needs review (warn status) |
| `time_off_pending_approval` | Manager | **normal** | Time off request needs approval |
| `timesheet_pending_approval` | Manager | **normal** | Timesheet correction needs approval |

---

## File Map

### New Files
| File | Responsibility |
|---|---|
| `supabase/migrations/20260326_notifications.sql` | Creates `notifications` table and RLS policies; migrates existing `shift_assignments` messages |
| `src/types/notifications.ts` | TypeScript types for notification rows, bell counts, panel items |
| `src/lib/notifications.ts` | `createNotification()` server-side utility — the single insertion point |
| `src/app/api/notifications/route.ts` | `GET` list of notifications for current user; `PATCH` bulk mark-read |
| `src/app/api/notifications/[id]/route.ts` | `PATCH` to dismiss a single notification |
| `src/app/api/notifications/count/route.ts` | `GET` unread badge count (lightweight — bell polls this) |
| `src/components/NotificationBell.tsx` | Bell icon + badge + dropdown panel (employee + manager variant) |

### Modified Files
| File | Change |
|---|---|
| `src/app/api/admin/assignments/route.ts` | POST: for `type='message'` with `target_profile_id` → create a `notifications` record (immediate delivery); for `type='message'` with `target_store_id` → unchanged, stays in `shift_assignments` (lazy delivery on clock-in) |
| `src/app/api/messages/[id]/dismiss/route.ts` | Redirect: now dismisses from `notifications` table, not `shift_assignments` |
| `src/app/api/end-shift/route.ts` | Clock-out blocking: checks pending tasks (`shift_assignments`) AND unread manager messages (`notifications`); both block clock-out |
| `src/app/page.tsx` | Home banner: query `notifications` table instead of `shift_assignments` |
| `src/app/shift/[id]/page.tsx` | Tasks from `shift_assignments`; notifications from `notifications`; tasks read-only in bell |
| `src/components/HomeHeader.tsx` | Add `<NotificationBell />` |
| `src/components/AdminSidebar.tsx` | Add `<NotificationBell />` |
| `src/app/api/requests/shift-swap/[id]/approve/route.ts` | Add `createNotification` for both parties after RPC |
| `src/app/api/requests/shift-swap/[id]/deny/route.ts` | Add `createNotification` for requesting employee |
| `src/app/api/requests/coverage-shift/[id]/approve/route.ts` | Add `createNotification` for employee |
| `src/app/api/requests/coverage-shift/[id]/deny/route.ts` | Add `createNotification` for employee |
| `src/app/api/requests/time-off/[id]/approve/route.ts` | Add `createNotification` for employee |
| `src/app/api/requests/time-off/[id]/deny/route.ts` | Add `createNotification` for employee |
| `src/app/api/requests/timesheet/[id]/approve/route.ts` | Add `createNotification` for employee |
| `src/app/api/requests/timesheet/[id]/deny/route.ts` | Add `createNotification` for employee |
| `src/app/api/admin/shifts/[shiftId]/route.ts` | Add `createNotification` (schedule_change) on PATCH/DELETE if shift has a profile |
| `src/app/api/admin/safe-ledger/route.ts` | Add `createNotification` (safe_closeout_failed / safe_closeout_review) on POST |
| `src/app/api/end-shift/route.ts` | Add `createNotification` (override_pending) when `requires_override` is set to `true` |

---

## Task 1: Database Migration — Create `notifications` Table

**Files:**
- Create: `supabase/migrations/20260326_notifications.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260326_notifications.sql

-- ── NOTIFICATIONS TABLE ───────────────────────────────────────────────────────
CREATE TABLE public.notifications (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Every notification targets exactly one profile (fan-out happens at write time).
  -- Store-targeted events are fanned out to individual manager profiles before insert.
  recipient_profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Optional: records which store triggered this notification (traceability / FCM routing).
  -- NOT used for querying — the bell always queries by recipient_profile_id.
  source_store_id       uuid REFERENCES public.stores(id) ON DELETE SET NULL,

  -- Content
  notification_type     text        NOT NULL,
  priority              text        NOT NULL DEFAULT 'normal'
                          CHECK (priority IN ('high', 'normal')),
  title                 text        NOT NULL,
  body                  text        NOT NULL,

  -- Deep-link context (for tapping a notification to navigate)
  entity_type           text,   -- 'shift_swap_request' | 'coverage_shift_request' |
                                --  'time_off_request'   | 'timesheet_change_request' |
                                --  'shift'              | 'safe_closeout'
  entity_id             uuid,

  -- Per-user interaction state (never shared across recipients)
  read_at               timestamptz,
  dismissed_at          timestamptz,

  -- FCM-ready fields (unused until Plan B / Firebase wiring)
  push_sent_at          timestamptz,
  push_message_id       text,

  -- Metadata
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES auth.users(id),

  -- Soft delete
  deleted_at            timestamptz,
  deleted_by            uuid
);

-- Index for the bell query (hot path — always queries by recipient_profile_id)
CREATE INDEX idx_notifications_recipient_profile
  ON public.notifications (recipient_profile_id, created_at DESC)
  WHERE deleted_at IS NULL AND dismissed_at IS NULL;

-- ── ROW LEVEL SECURITY ────────────────────────────────────────────────────────
-- NOTE: All API routes use supabaseServer (service role) which bypasses RLS entirely.
-- Employees authenticate via custom PIN JWT — they have no Supabase auth.users account,
-- so auth.uid()-based policies would never match for them anyway.
-- RLS is enabled as a safety net but all access control is enforced in route code.
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Service role bypasses all policies. No additional policies needed.
-- If a user-scoped client is ever used in future, add policies here.

-- ── MIGRATE EXISTING shift_assignments MESSAGES ───────────────────────────────
-- Convert profile-targeted type='message' records into notifications.
-- Store-targeted messages (target_store_id IS NOT NULL) are intentionally skipped:
-- they used "next shift" delivery semantics (claimed on clock-in) and may have been
-- delivered to 0 or many employees. They cannot be safely attributed to a single
-- recipient_profile_id. These are legacy data and can be reviewed/dismissed in the
-- existing admin assignments UI.
INSERT INTO public.notifications (
  recipient_profile_id,
  source_store_id,
  notification_type,
  priority,
  title,
  body,
  read_at,
  dismissed_at,
  created_at,
  created_by,
  deleted_at,
  deleted_by
)
SELECT
  target_profile_id,
  NULL,              -- no source_store for legacy migrated messages
  'manager_message',
  'high',
  'Message from manager',
  message,
  acknowledged_at,   -- treat prior ack as "read"
  acknowledged_at,   -- and "dismissed"
  created_at,
  created_by,
  deleted_at,
  deleted_by
FROM public.shift_assignments
WHERE type = 'message'
  AND target_profile_id IS NOT NULL  -- profile-targeted only
  AND deleted_at IS NULL;

-- Soft-delete of migrated profile-targeted messages is intentionally deferred
-- to Task 18 (final cleanup), after all app reads have been cut over to the
-- notifications table. Do NOT add a soft-delete here.
```

- [ ] **Step 2: Apply the migration**

```bash
# From project root
npx supabase db push
# OR if using local dev:
npx supabase migration up
```

Expected: migration applies without errors; `notifications` table exists with the migrated rows.

- [ ] **Step 3: Verify in Supabase dashboard (or psql)**

```sql
SELECT notification_type, priority, COUNT(*)
FROM public.notifications
GROUP BY notification_type, priority;
-- Should show 'manager_message' / 'high' rows matching old shift_assignments messages
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260326_notifications.sql
git commit -m "feat: add notifications table and migrate shift_assignments messages"
```

---

## Task 2: TypeScript Types

**Files:**
- Create: `src/types/notifications.ts`

- [ ] **Step 1: Write the types**

```typescript
// src/types/notifications.ts

export type NotificationPriority = 'high' | 'normal';

export type NotificationType =
  // Employee — high priority
  | 'manager_message'
  | 'schedule_change'
  | 'swap_approved'
  | 'swap_denied'
  | 'swap_offer_accepted'
  | 'coverage_approved'
  | 'coverage_denied'
  | 'time_off_approved'
  | 'time_off_denied'
  // Employee — normal priority
  | 'swap_offer_received'
  | 'swap_offer_declined'
  | 'timesheet_approved'
  | 'timesheet_denied'
  // Manager — high priority
  | 'swap_pending_approval'
  | 'coverage_pending_approval'
  | 'task_skipped'
  | 'drawer_variance'
  | 'safe_closeout_failed'
  // Manager — normal priority
  | 'override_pending'
  | 'manual_close_pending'
  | 'unscheduled_shift'
  | 'safe_closeout_review'
  | 'time_off_pending_approval'
  | 'timesheet_pending_approval';

export type NotificationEntityType =
  | 'shift_swap_request'
  | 'coverage_shift_request'
  | 'time_off_request'
  | 'timesheet_change_request'
  | 'shift'
  | 'safe_closeout';

export type NotificationRow = {
  id: string;
  recipient_profile_id: string;   // always set — fan-out guarantees this
  source_store_id: string | null; // optional metadata
  notification_type: NotificationType;
  priority: NotificationPriority;
  title: string;
  body: string;
  entity_type: NotificationEntityType | null;
  entity_id: string | null;
  read_at: string | null;
  dismissed_at: string | null;
  push_sent_at: string | null;
  push_message_id: string | null;
  created_at: string;
  created_by: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
};

// ── Bell types ──────────────────────────────────────────────────────────────

export type BellNotificationItem = {
  id: string;
  notification_type: NotificationType;
  priority: NotificationPriority;
  title: string;
  body: string;
  entity_type: NotificationEntityType | null;
  entity_id: string | null;
  read_at: string | null;
  dismissed_at: string | null;
  created_at: string;
  /** Always false — notifications are dismissible from the bell */
  is_task: false;
};

export type BellTaskItem = {
  id: string;           // shift_assignment id
  title: string;        // derived from message field
  body: string;
  created_at: string;
  completed_at: string | null;
  /** Always true — tasks are read-only in the bell */
  is_task: true;
};

export type BellItem = BellNotificationItem | BellTaskItem;

export type BellCountResponse = {
  unread_count: number;   // undismissed notifications (not tasks)
};

export type BellListResponse = {
  notifications: BellNotificationItem[];
  tasks: BellTaskItem[];
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors introduced.

- [ ] **Step 3: Commit**

```bash
git add src/types/notifications.ts
git commit -m "feat: add TypeScript types for notifications and bell"
```

---

## Task 3: `createNotification()` Server Utility

**Files:**
- Create: `src/lib/notifications.ts`

This is the single insertion point for all notification creation across the codebase. Every route that needs to notify someone calls this function.

- [ ] **Step 1: Write the utility**

```typescript
// src/lib/notifications.ts
import { supabaseServer } from '@/lib/supabaseServer';
import type { NotificationType, NotificationPriority, NotificationEntityType } from '@/types/notifications';

export type CreateNotificationInput = {
  /** Target a specific profile (required) */
  recipientProfileId: string;
  /** Optional: store that triggered this notification (traceability metadata only) */
  sourceStoreId?: string;
  notificationType: NotificationType;
  priority: NotificationPriority;
  title: string;
  body: string;
  entityType?: NotificationEntityType;
  entityId?: string;
  /** auth.users.id of the actor creating the notification */
  createdBy?: string;
};

export type CreateStoreNotificationInput = Omit<CreateNotificationInput, 'recipientProfileId'> & {
  /** Fan-out: creates one notification row per manager at this store */
  storeId: string;
};

/**
 * Insert a notification for a specific profile.
 * Silently logs errors — a notification failure never breaks the primary action.
 */
export async function createNotification(
  input: CreateNotificationInput
): Promise<void> {
  const { error } = await supabaseServer.from('notifications').insert({
    recipient_profile_id: input.recipientProfileId,
    source_store_id:      input.sourceStoreId  ?? null,
    notification_type:    input.notificationType,
    priority:             input.priority,
    title:                input.title,
    body:                 input.body,
    entity_type:          input.entityType     ?? null,
    entity_id:            input.entityId       ?? null,
    created_by:           input.createdBy      ?? null,
  });

  if (error) {
    console.error('[createNotification] Insert failed:', error.message);
  }
}

/**
 * Fan-out: create one notification per manager at the given store.
 * Queries store_managers → profiles to resolve recipient_profile_ids.
 * Use this for all store-level events (safe closeout fail, override pending, etc.).
 */
export async function createStoreNotification(
  input: CreateStoreNotificationInput
): Promise<void> {
  // Get all manager user_ids for this store
  const { data: managers, error: managerErr } = await supabaseServer
    .from('store_managers')
    .select('user_id')
    .eq('store_id', input.storeId);

  if (managerErr || !managers || managers.length === 0) {
    console.error('[createStoreNotification] No managers found for store:', input.storeId);
    return;
  }

  // Resolve profile IDs from auth user IDs
  const { data: profiles, error: profileErr } = await supabaseServer
    .from('profiles')
    .select('id')
    .in('auth_user_id', managers.map((m: { user_id: string }) => m.user_id));

  if (profileErr || !profiles || profiles.length === 0) {
    console.error('[createStoreNotification] No profiles found for managers');
    return;
  }

  // Create one row per manager (fan-out)
  await Promise.all(
    profiles.map((p: { id: string }) =>
      createNotification({
        ...input,
        recipientProfileId: p.id,
        sourceStoreId: input.storeId,
      })
    )
  );
}

/**
 * Convenience: notify multiple profiles at once (e.g., both parties in a swap).
 */
export async function createNotifications(
  inputs: CreateNotificationInput[]
): Promise<void> {
  await Promise.all(inputs.map(createNotification));
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/notifications.ts
git commit -m "feat: add createNotification server utility"
```

---

## Task 4: Bell Count API

**Files:**
- Create: `src/app/api/notifications/count/route.ts`

This is the lightweight endpoint the bell icon polls to show the unread badge count.

- [ ] **Step 1: Write the route**

```typescript
// src/app/api/notifications/count/route.ts
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { authenticateShiftRequest } from '@/lib/shiftAuth';

export async function GET(req: Request) {
  // authenticateShiftRequest handles both employee PIN JWT and manager Supabase JWT.
  // Employees have no Supabase auth.users account — DO NOT use supabaseServer.auth.getUser() here.
  const authResult = await authenticateShiftRequest(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  // Fan-out at write time means every notification row has recipient_profile_id set.
  // Simple query — no store lookup needed at read time for either employees or managers.
  const { count, error } = await supabaseServer
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_profile_id', authResult.auth.profileId)
    .is('dismissed_at', null)
    .is('deleted_at', null);

  if (error) {
    console.error('[GET /api/notifications/count]', error.message);
    return NextResponse.json({ unread_count: 0 });
  }

  return NextResponse.json({ unread_count: count ?? 0 });
}
```

- [ ] **Step 2: Start dev server and verify the endpoint**

```bash
npm run dev
# In another terminal:
curl -H "Authorization: Bearer <your-dev-token>" http://localhost:3000/api/notifications/count
# Expected: { "unread_count": <number> }
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/notifications/count/route.ts
git commit -m "feat: add notification bell count API"
```

---

## Task 5: Notification List & Dismiss APIs

**Files:**
- Create: `src/app/api/notifications/route.ts`
- Create: `src/app/api/notifications/[id]/route.ts`
- Modify: `src/app/api/messages/[id]/dismiss/route.ts`

- [ ] **Step 1: Write the list route**

```typescript
// src/app/api/notifications/route.ts
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { authenticateShiftRequest } from '@/lib/shiftAuth';

export async function GET(req: Request) {
  // Works for both employee PIN JWT and manager Supabase JWT
  const authResult = await authenticateShiftRequest(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const profileId = authResult.auth.profileId;

  // Fetch notifications (most recent 50, not deleted)
  const { data: notifications, error: notifError } = await supabaseServer
    .from('notifications')
    .select(
      'id, notification_type, priority, title, body, entity_type, entity_id, read_at, dismissed_at, created_at'
    )
    .eq('recipient_profile_id', profileId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(50);

  if (notifError) {
    console.error('[GET /api/notifications]', notifError.message);
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 });
  }

  // Fetch pending manager-assigned tasks from shift_assignments (read-only in bell)
  // Note: these are manager-assigned ad-hoc tasks, NOT shift checklist or cleaning items
  const { data: tasks } = await supabaseServer
    .from('shift_assignments')
    .select('id, message, created_at, completed_at')
    .eq('type', 'task')
    .eq('target_profile_id', profileId)
    .is('completed_at', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(20);

  const bellTasks = (tasks ?? []).map((t: {
    id: string;
    message: string;
    created_at: string;
    completed_at: string | null;
  }) => ({
    id: t.id,
    title: 'Shift Task',
    body: t.message,
    created_at: t.created_at,
    completed_at: t.completed_at,
    is_task: true as const,
  }));

  return NextResponse.json({
    notifications: notifications ?? [],
    tasks: bellTasks,
  });
}

// Bulk mark-all-read
export async function PATCH(req: Request) {
  const authResult = await authenticateShiftRequest(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  await supabaseServer
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_profile_id', authResult.auth.profileId)
    .is('read_at', null)
    .is('deleted_at', null);

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Write the single-notification dismiss route**

```typescript
// src/app/api/notifications/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { authenticateShiftRequest } from '@/lib/shiftAuth';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authResult = await authenticateShiftRequest(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const body = await req.json().catch(() => ({}));
  const now = new Date().toISOString();

  const updateFields: Record<string, string> = { read_at: now };
  if (body.dismiss === true) {
    updateFields.dismissed_at = now;
  }

  const { error } = await supabaseServer
    .from('notifications')
    .update(updateFields)
    .eq('id', id)
    .eq('recipient_profile_id', authResult.auth.profileId); // ownership check

  if (error) {
    console.error('[PATCH /api/notifications/[id]]', error.message);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: Update the legacy dismiss route to forward to new table**

Open `src/app/api/messages/[id]/dismiss/route.ts`. Replace its body with a redirect to the new endpoint, or update it to dismiss from `notifications` using the same logic as the new route above. The simplest approach is to keep the route but point it at `notifications`:

```typescript
// src/app/api/messages/[id]/dismiss/route.ts
// Updated: dismisses from notifications table (migration moved messages there)
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { authenticateShiftRequest } from '@/lib/shiftAuth';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authResult = await authenticateShiftRequest(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const now = new Date().toISOString();

  const { error } = await supabaseServer
    .from('notifications')
    .update({ read_at: now, dismissed_at: now })
    .eq('id', id)
    .eq('recipient_profile_id', authResult.auth.profileId);

  if (error) {
    console.error('[POST /api/messages/[id]/dismiss]', error.message);
    return NextResponse.json({ error: 'Dismiss failed' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/notifications/route.ts \
        src/app/api/notifications/[id]/route.ts \
        src/app/api/messages/[id]/dismiss/route.ts
git commit -m "feat: add notifications list/dismiss API routes"
```

---

## Task 6: `NotificationBell` Component

**Files:**
- Create: `src/components/NotificationBell.tsx`

This component renders as a bell icon with a badge count. Clicking it opens a dropdown panel listing notifications (dismissible) and tasks (read-only). It is shared between employee and manager layouts.

- [ ] **Step 1: Write the component**

```tsx
// src/components/NotificationBell.tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import type { BellItem, BellListResponse, BellCountResponse } from '@/types/notifications';

const POLL_INTERVAL_MS = 30_000; // poll count every 30s

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<BellItem[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // ── Badge count (lightweight poll) ────────────────────────────────────────
  const fetchCount = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications/count');
      if (!res.ok) return;
      const data: BellCountResponse = await res.json();
      setUnreadCount(data.unread_count);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchCount();
    const interval = setInterval(fetchCount, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchCount]);

  // ── Full list (fetched when panel opens) ──────────────────────────────────
  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/notifications');
      if (!res.ok) return;
      const data: BellListResponse = await res.json();
      const combined: BellItem[] = [
        ...data.notifications.map(n => ({ ...n, is_task: false as const })),
        ...data.tasks,
      ].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setItems(combined);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchItems();
  }, [open, fetchItems]);

  // ── Close on outside click ────────────────────────────────────────────────
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // ── Dismiss a notification ─────────────────────────────────────────────────
  const dismiss = async (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    setUnreadCount(prev => Math.max(0, prev - 1));
    await fetch(`/api/notifications/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dismiss: true }),
    });
  };

  // ── Mark all read ─────────────────────────────────────────────────────────
  const markAllRead = async () => {
    setUnreadCount(0);
    setItems(prev =>
      prev.map(i => (i.is_task ? i : { ...i, read_at: new Date().toISOString() }))
    );
    await fetch('/api/notifications', { method: 'PATCH' });
  };

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(prev => !prev)}
        className="relative p-2 rounded-full hover:bg-muted transition-colors"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div className="absolute right-0 top-10 z-50 w-80 rounded-lg border bg-background shadow-lg">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3">
            <span className="font-semibold text-sm">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Mark all read
              </button>
            )}
          </div>
          <Separator />

          {/* List */}
          <ScrollArea className="max-h-[420px]">
            {loading ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                Loading…
              </div>
            ) : items.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                You're all caught up!
              </div>
            ) : (
              <ul className="divide-y">
                {items.map(item => (
                  <li
                    key={item.id}
                    className={`flex items-start gap-3 px-4 py-3 ${
                      !item.is_task && !item.read_at ? 'bg-muted/40' : ''
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{item.title}</span>
                        {item.is_task && (
                          <Badge variant="outline" className="shrink-0 text-[10px] px-1 py-0">
                            During shift
                          </Badge>
                        )}
                        {!item.is_task && item.priority === 'high' && !item.read_at && (
                          <span className="h-2 w-2 rounded-full bg-destructive shrink-0" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {item.body}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {new Date(item.created_at).toLocaleString()}
                      </p>
                    </div>

                    {/* Only notifications can be dismissed; tasks are read-only */}
                    {!item.is_task && (
                      <button
                        onClick={() => dismiss(item.id)}
                        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-0.5"
                        aria-label="Dismiss"
                      >
                        ×
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/NotificationBell.tsx
git commit -m "feat: add NotificationBell component"
```

---

## Task 7: Wire Bell Into Nav (Employee + Manager)

**Files:**
- Modify: `src/components/HomeHeader.tsx`
- Modify: `src/components/AdminSidebar.tsx`

- [ ] **Step 1: Read both files first**

```bash
# Check current imports and structure before editing
head -50 src/components/HomeHeader.tsx
head -50 src/components/AdminSidebar.tsx
```

- [ ] **Step 2: Add bell to employee `HomeHeader`**

Open `src/components/HomeHeader.tsx`. Add the import at the top:

```typescript
import { NotificationBell } from '@/components/NotificationBell';
```

Find the header JSX and add `<NotificationBell />` next to the existing nav icons. It should sit in the top-right area of the header, near other action icons. For example, in the header's right-side container:

```tsx
{/* Add before or after the existing right-side icons */}
<NotificationBell />
```

- [ ] **Step 3: Add bell to admin `AdminSidebar`**

Open `src/components/AdminSidebar.tsx`. Add the import at the top:

```typescript
import { NotificationBell } from '@/components/NotificationBell';
```

Find the sidebar header or top section (where the logo / store name appears) and add the bell there, positioned so it's always visible regardless of scroll:

```tsx
{/* In the sidebar header section, next to store name or logo */}
<NotificationBell />
```

- [ ] **Step 4: Start dev server and visually verify**

```bash
npm run dev
```

- Navigate to the employee home page — bell icon should appear in the header
- Navigate to any `/admin` page — bell icon should appear in the sidebar header
- Bell should show badge count if any unread notifications exist

- [ ] **Step 5: Commit**

```bash
git add src/components/HomeHeader.tsx src/components/AdminSidebar.tsx
git commit -m "feat: wire NotificationBell into employee header and admin sidebar"
```

---

## Task 8: Update Home Page Banner

**Files:**
- Modify: `src/app/page.tsx` (lines ~674–694)

The home page currently fetches from `shift_assignments` where `type='message'`. Update it to query `notifications` instead.

- [ ] **Step 1: Read the current banner implementation**

```bash
sed -n '660,710p' src/app/page.tsx
```

- [ ] **Step 2: Replace the `shift_assignments` message query**

Find the query that looks like:
```typescript
// OLD — remove this
supabase
  .from('shift_assignments')
  .select('id, message, created_at')
  .eq('type', 'message')
  .eq('target_profile_id', profileId)
  .is('deleted_at', null)
  .is('acknowledged_at', null)
  .order('created_at', { ascending: false })
  .limit(1)
```

Replace with:
```typescript
// NEW — query from notifications
supabase
  .from('notifications')
  .select('id, title, body, priority, created_at')
  .eq('recipient_profile_id', profileId)
  .is('dismissed_at', null)
  .is('deleted_at', null)
  .order('created_at', { ascending: false })
  .limit(1)
```

- [ ] **Step 3: Update banner display fields**

The banner currently uses `message` field. Update it to use `body` (and optionally show `title`):

```tsx
{/* In the banner JSX */}
<p className="font-medium">{notification.title}</p>
<p className="text-sm">{notification.body}</p>
```

The dismiss button currently calls `POST /api/messages/[id]/dismiss` — this still works since we updated that route in Task 5. No change needed for the dismiss action.

- [ ] **Step 4: Verify in browser**

- Log in as an employee who has an existing notification (migrated from old messages)
- Banner should appear on the home page showing the notification
- Dismiss it — banner should disappear and bell count should decrease

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: update home page notification banner to use notifications table"
```

---

## Task 9: Update Shift Detail Page

**Files:**
- Modify: `src/app/shift/[id]/page.tsx`

The shift detail page currently fetches assignments with `delivered_shift_id = shiftId` for both tasks and messages. We need to:
1. Keep fetching **tasks** from `shift_assignments` (those delivered to this shift)
2. Replace message fetching with **all undismissed notifications** for the employee (from `notifications` table)
3. **Update** the clock-out block to check **both** pending tasks AND unread `manager_message` notifications — both must be resolved before the employee can clock out (see Task 9 Step 4 and Task 10 for full implementation)

- [ ] **Step 1: Read the relevant section**

```bash
sed -n '1250,1360p' src/app/shift/[id]/page.tsx
```

- [ ] **Step 2: Update the data fetching**

Find where the shift page fetches `shift_assignments`. Split it into two queries:

```typescript
// KEEP: tasks delivered to this shift
const { data: shiftTasks } = await supabase
  .from('shift_assignments')
  .select('id, type, message, created_at, created_by, delivered_at, completed_at')
  .eq('delivered_shift_id', shiftId)
  .eq('type', 'task')
  .is('deleted_at', null);

// NEW: all pending notifications for this employee (bell reminder on shift page)
const { data: pendingNotifications } = await supabase
  .from('notifications')
  .select('id, notification_type, priority, title, body, entity_type, entity_id, read_at, dismissed_at, created_at')
  .eq('recipient_profile_id', profileId)
  .is('dismissed_at', null)
  .is('deleted_at', null)
  .order('created_at', { ascending: false });
```

- [ ] **Step 3: Update the render sections**

Replace the "Manager Messages" section with a "Notifications" section that:
- Shows `pendingNotifications` (not shift_assignments messages)
- Each notification has a dismiss button calling `PATCH /api/notifications/[id]` with `{ dismiss: true }`
- Tasks are read-only from the bell perspective but have the complete button on the shift page

```tsx
{/* Notifications section */}
{pendingNotifications && pendingNotifications.length > 0 && (
  <section>
    <h3 className="font-semibold mb-2">Notifications</h3>
    <ul className="space-y-2">
      {pendingNotifications.map(n => (
        <li key={n.id} className="flex items-start justify-between gap-2 rounded-md border p-3">
          <div>
            <p className="font-medium text-sm">{n.title}</p>
            <p className="text-xs text-muted-foreground">{n.body}</p>
          </div>
          <button
            onClick={() => dismissNotification(n.id)}
            className="text-muted-foreground hover:text-foreground shrink-0"
          >
            Dismiss
          </button>
        </li>
      ))}
    </ul>
  </section>
)}

{/* Tasks section — unchanged, still blocks clock-out */}
{shiftTasks && shiftTasks.length > 0 && (
  <section>
    <h3 className="font-semibold mb-2">Tasks</h3>
    {/* existing task render logic */}
  </section>
)}
```

- [ ] **Step 4: Update the clock-out UI condition**

Clock-out should block on **both** incomplete tasks AND unread manager messages. Find the condition that drives the clock-out button disabled state and update it:

```typescript
// Incomplete manager-assigned tasks
const pendingTaskCount = (shiftTasks ?? []).filter(t => !t.completed_at).length;

// Unread manager messages (now in notifications table, not shift_assignments)
const pendingMessageCount = (pendingNotifications ?? []).filter(
  n => n.notification_type === 'manager_message' && !n.dismissed_at
).length;

const canClockOut = pendingTaskCount === 0 && pendingMessageCount === 0;
```

Update the disabled message shown to the employee to be combined:

```tsx
{!canClockOut && (
  <p className="text-sm text-destructive">
    {pendingMessageCount > 0 && pendingTaskCount > 0
      ? 'Unread messages and incomplete tasks must be resolved before clocking out.'
      : pendingMessageCount > 0
      ? 'Unread messages must be dismissed before clocking out.'
      : 'Incomplete tasks must be completed before clocking out.'}
  </p>
)}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/shift/[id]/page.tsx
git commit -m "feat: update shift detail page — notifications + tasks/messages block clock-out"
```

---

## Task 10: Update Clock-Out API — Block on Tasks AND Manager Messages

**Files:**
- Modify: `src/app/api/end-shift/route.ts` (lines ~192–208)

- [ ] **Step 1: Read the current blocking logic**

```bash
sed -n '190,215p' src/app/api/end-shift/route.ts
```

- [ ] **Step 2: Replace the single query with two parallel checks**

The current query checks `shift_assignments` for both tasks and messages. Replace it with:
- `shift_assignments` for pending tasks (type='task', completed_at IS NULL)
- `notifications` for unread manager messages (notification_type='manager_message', dismissed_at IS NULL) for the shift's employee

```typescript
// Run both checks in parallel
const [pendingTasksResult, pendingMessagesResult] = await Promise.all([
  // Incomplete manager-assigned tasks delivered to this shift
  supabaseServer
    .from('shift_assignments')
    .select('id', { count: 'exact', head: true })
    .eq('delivered_shift_id', body.shiftId)
    .eq('type', 'task')
    .is('completed_at', null)
    .is('deleted_at', null),

  // Unread manager messages for this employee (from notifications table)
  supabaseServer
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_profile_id', shift.profile_id)
    .eq('notification_type', 'manager_message')
    .is('dismissed_at', null)
    .is('deleted_at', null),
]);

const pendingTaskCount    = pendingTasksResult.count    ?? 0;
const pendingMessageCount = pendingMessagesResult.count ?? 0;

if (pendingTaskCount > 0 || pendingMessageCount > 0) {
  const reason =
    pendingTaskCount > 0 && pendingMessageCount > 0
      ? 'Unread messages and incomplete tasks must be resolved before clocking out.'
      : pendingTaskCount > 0
      ? 'Incomplete tasks must be completed before clocking out.'
      : 'Unread messages must be dismissed before clocking out.';

  return NextResponse.json({ error: reason }, { status: 400 });
}
```

> **Important:** Read the actual file lines before editing. The pattern above shows the intent — match it to the real variable names and structure in the route.

- [ ] **Step 3: Verify clock-out blocking**

- Start a shift, assign it a manager-assigned task → clock-out blocked ("Incomplete tasks...")
- Start a shift, send a manager message to the employee → clock-out blocked ("Unread messages...")
- Both exist → clock-out blocked ("Unread messages and incomplete tasks...")
- Complete task + dismiss message → clock-out succeeds

- [ ] **Step 4: Commit**

```bash
git add src/app/api/end-shift/route.ts
git commit -m "feat: clock-out blocks on pending tasks and unread manager messages"
```

---

## Task 11: Update Admin Message Creation Route

**Files:**
- Modify: `src/app/api/admin/assignments/route.ts`

Currently, when an admin POSTs a new assignment with `type='message'`, it always creates a `shift_assignments` record. Change this for **profile-targeted messages only**: if `target_profile_id` is set, create a `notifications` record for immediate delivery instead. Store-targeted messages (`target_store_id`) keep their existing `shift_assignments` insert unchanged — they use lazy "next clock-in" delivery. `type='task'` is always unchanged.

- [ ] **Step 1: Read the POST handler**

```bash
sed -n '280,310p' src/app/api/admin/assignments/route.ts
```

- [ ] **Step 2: Add the import**

At the top of the file — only `createNotification` is needed, not `createStoreNotification`:
```typescript
import { createNotification } from '@/lib/notifications';
```

- [ ] **Step 3: Update the POST handler**

Find where the route inserts into `shift_assignments`. Branch on message target:

```typescript
// In the POST handler, after validating the body:
if (body.type === 'message') {
  if (body.target_profile_id) {
    // Direct message to a specific employee → notifications table (immediate delivery)
    await createNotification({
      recipientProfileId: body.target_profile_id,
      notificationType:   'manager_message',
      priority:           'high',
      title:              'Message from manager',
      body:               body.message,
      createdBy:          user.id,
    });
    return NextResponse.json({ success: true });
  }

  // Store-targeted messages keep their existing "lazy delivery" semantics:
  // they are delivered to the next employee who clocks in at that store.
  // These stay in shift_assignments — fall through to the existing insert logic below.
}

// type === 'task', OR type === 'message' with target_store_id → shift_assignments (unchanged)
const { data, error } = await supabaseServer
  .from('shift_assignments')
  .insert({ ...taskData })
  .select()
  .single();
// ... rest of existing insert logic
```

> **Note:** Only the `createNotification` import is needed here — `createStoreNotification` is not used in this route.

- [ ] **Step 4: Verify in admin panel**

- Go to `/admin/assignments`
- Create a new message targeting an employee
- Check `notifications` table in Supabase — a `manager_message` row should appear
- Check `shift_assignments` — no new message row should be created
- The employee's bell should show the new message

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/assignments/route.ts
git commit -m "feat: admin message creation now writes to notifications table"
```

---

## Task 12: Swap Request Notifications

**Files:**
- Modify: `src/app/api/requests/shift-swap/[id]/approve/route.ts`
- Modify: `src/app/api/requests/shift-swap/[id]/deny/route.ts`

**Swap approval notifies:** both the requesting employee AND the employee who offered.
**Swap denial notifies:** the requesting employee.
**Swap offer received (when someone offers):** find the route where an employee submits an offer on an existing swap request and notify the request owner.

- [ ] **Step 1: Read the approve route**

```bash
cat src/app/api/requests/shift-swap/[id]/approve/route.ts
```

- [ ] **Step 2: Add imports to both routes**

```typescript
import { createNotifications } from '@/lib/notifications';
```

- [ ] **Step 3: Update the approve route**

Before the RPC call, fetch the swap request and its selected offer to get both employee IDs.
The requester is on `shift_swap_requests.requester_profile_id`. The accepting offerer is in
`shift_swap_offers` joined via `shift_swap_requests.selected_offer_id`:

```typescript
// At the top of the handler, before the RPC:
const { id: requestId } = await params;

const { data: swapRequest } = await supabaseServer
  .from('shift_swap_requests')
  .select('requester_profile_id, selected_offer_id, id')
  .eq('id', requestId)
  .single();

// Get the offerer's profile_id from the selected offer (if one was selected)
let offererProfileId: string | null = null;
if (swapRequest?.selected_offer_id) {
  const { data: offer } = await supabaseServer
    .from('shift_swap_offers')
    .select('offerer_profile_id')
    .eq('id', swapRequest.selected_offer_id)
    .single();
  offererProfileId = offer?.offerer_profile_id ?? null;
}
```

After the RPC succeeds, send notifications to both parties:

```typescript
// After successful RPC:
if (swapRequest) {
  await createNotifications([
    {
      recipientProfileId: swapRequest.requester_profile_id,
      notificationType: 'swap_approved',
      priority: 'high',
      title: 'Shift swap approved',
      body: 'Your shift swap request has been approved by a manager.',
      entityType: 'shift_swap_request',
      entityId: swapRequest.id,
      createdBy: user.id,
    },
    ...(offererProfileId ? [{
      recipientProfileId: offererProfileId,
      notificationType: 'swap_approved' as const,
      priority: 'high' as const,
      title: 'Shift swap approved',
      body: 'The swap you offered to cover has been approved. Check your schedule.',
      entityType: 'shift_swap_request' as const,
      entityId: swapRequest.id,
      createdBy: user.id,
    }] : []),
  ]);
}
```

- [ ] **Step 4: Update the deny route**

```typescript
// Before RPC — fetch request (correct column name is requester_profile_id):
const { id: requestId } = await params;

const { data: swapRequest } = await supabaseServer
  .from('shift_swap_requests')
  .select('requester_profile_id, id')
  .eq('id', requestId)
  .single();

// After successful RPC:
if (swapRequest) {
  await createNotification({
    recipientProfileId: swapRequest.requester_profile_id,
    notificationType: 'swap_denied',
    priority: 'high',
    title: 'Shift swap denied',
    body: denialReason
      ? `Your shift swap request was denied: ${denialReason}`
      : 'Your shift swap request was denied by a manager.',
    entityType: 'shift_swap_request',
    entityId: swapRequest.id,
    createdBy: user.id,
  });
}
```

Don't forget to import `createNotification` (singular) in the deny route too.

- [ ] **Step 5: Find and update the "submit offer" route**

```bash
grep -r "shift_swap" src/app/api --include="*.ts" -l
```

Find the route where an employee submits an offer on an open swap request (likely `POST /api/requests/shift-swap/[id]/offer` or similar). After the offer is recorded, notify the original requester:

```typescript
await createNotification({
  recipientProfileId: swapRequest.requester_profile_id,  // correct column name
  notificationType: 'swap_offer_received',
  priority: 'normal',
  title: 'Someone offered to take your shift',
  body: `An employee has offered to take your shift. Check the swap request for details.`,
  entityType: 'shift_swap_request',
  entityId: params.id,
  createdBy: user.id,
});
```

Also notify all managers of the store that a swap needs approval (fan-out):

```typescript
import { createStoreNotification } from '@/lib/notifications';

await createStoreNotification({
  storeId,  // store_id of the shift being swapped
  notificationType: 'swap_pending_approval',
  priority: 'high',
  title: 'Shift swap needs approval',
  body: `A shift swap request is pending your approval.`,
  entityType: 'shift_swap_request',
  entityId: params.id,
  createdBy: user.id,
});
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/requests/shift-swap/
git commit -m "feat: wire notifications for swap request approve/deny/offer events"
```

---

## Task 13: Coverage Request Notifications

**Files:**
- Modify: `src/app/api/requests/coverage-shift/[id]/approve/route.ts`
- Modify: `src/app/api/requests/coverage-shift/[id]/deny/route.ts`

- [ ] **Step 1: Add import to both routes**

```typescript
import { createNotification } from '@/lib/notifications';
```

- [ ] **Step 2: Update approve route**

Before the `supabaseServer.from('coverage_shift_requests').update(...)`, fetch the request.
The correct column is `profile_id` (not `requesting_profile_id`):

```typescript
const { id: requestId } = await params;

const { data: coverageRequest } = await supabaseServer
  .from('coverage_shift_requests')
  .select('profile_id, id')
  .eq('id', requestId)
  .single();
```

After successful update:

```typescript
if (coverageRequest) {
  await createNotification({
    recipientProfileId: coverageRequest.profile_id,
    notificationType: 'coverage_approved',
    priority: 'high',
    title: 'Coverage request approved',
    body: 'Your coverage request has been approved.',
    entityType: 'coverage_shift_request',
    entityId: coverageRequest.id,
    createdBy: user.id,
  });
}
```

- [ ] **Step 3: Update deny route**

```typescript
// After successful update:
if (coverageRequest) {
  await createNotification({
    recipientProfileId: coverageRequest.profile_id,
    notificationType: 'coverage_denied',
    priority: 'high',
    title: 'Coverage request denied',
    body: denialReason
      ? `Your coverage request was denied: ${denialReason}`
      : 'Your coverage request was denied.',
    entityType: 'coverage_shift_request',
    entityId: coverageRequest.id,
    createdBy: user.id,
  });
}
```

- [ ] **Step 4: Notify managers when coverage is submitted**

Find the route where an employee submits a coverage request (likely `POST /api/requests/coverage-shift`). Add import:

```typescript
import { createNotification, createStoreNotification } from '@/lib/notifications';
```

After successful creation, fan-out to all managers at the store:

```typescript
await createStoreNotification({
  storeId,  // store_id of the shift needing coverage
  notificationType: 'coverage_pending_approval',
  priority: 'high',
  title: 'Coverage request needs approval',
  body: `An employee has requested coverage for a shift.`,
  entityType: 'coverage_shift_request',
  entityId: newRequest.id,
  createdBy: user.id,
});
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/requests/coverage-shift/
git commit -m "feat: wire notifications for coverage request approve/deny/submit events"
```

---

## Task 14: Time-Off Request Notifications

**Files:**
- Modify: `src/app/api/requests/time-off/[id]/approve/route.ts`
- Modify: `src/app/api/requests/time-off/[id]/deny/route.ts`

Priority: **high** for both approval and denial (employee needs to know so they can make plans).

- [ ] **Step 1: Add imports to both routes**

```typescript
import { createNotification } from '@/lib/notifications';
```

- [ ] **Step 2: Fetch the request in both routes before the RPC**

```typescript
const { data: timeOffRequest } = await supabase
  .from('time_off_requests')
  .select('profile_id, id, start_date, end_date')
  .eq('id', params.id)
  .single();
```

- [ ] **Step 3: Add notification after approve RPC**

```typescript
// After successful RPC:
if (timeOffRequest) {
  await createNotification({
    recipientProfileId: timeOffRequest.profile_id,
    notificationType: 'time_off_approved',
    priority: 'high',
    title: 'Time off approved',
    body: `Your time off request has been approved.`,
    entityType: 'time_off_request',
    entityId: timeOffRequest.id,
    createdBy: user.id,
  });
}
```

- [ ] **Step 4: Add notification after deny RPC**

```typescript
if (timeOffRequest) {
  await createNotification({
    recipientProfileId: timeOffRequest.profile_id,
    notificationType: 'time_off_denied',
    priority: 'high',
    title: 'Time off denied',
    body: denialReason
      ? `Your time off request was denied: ${denialReason}`
      : 'Your time off request was denied.',
    entityType: 'time_off_request',
    entityId: timeOffRequest.id,
    createdBy: user.id,
  });
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/requests/time-off/
git commit -m "feat: wire high-priority notifications for time-off approve/deny"
```

---

## Task 15: Timesheet Correction Notifications

**Files:**
- Modify: `src/app/api/requests/timesheet/[id]/approve/route.ts`
- Modify: `src/app/api/requests/timesheet/[id]/deny/route.ts`

Priority: **normal** (informational follow-up, not time-sensitive).

- [ ] **Step 1: Add imports to both routes**

```typescript
import { createNotification } from '@/lib/notifications';
```

- [ ] **Step 2: Fetch request before RPC in both routes**

The correct column is `requester_profile_id` (not `profile_id`):

```typescript
const { id: requestId } = await params;

const { data: timesheetRequest } = await supabaseServer
  .from('timesheet_change_requests')
  .select('requester_profile_id, id')
  .eq('id', requestId)
  .single();
```

- [ ] **Step 3: Add notification in approve route (after RPC)**

```typescript
if (timesheetRequest) {
  await createNotification({
    recipientProfileId: timesheetRequest.requester_profile_id,
    notificationType: 'timesheet_approved',
    priority: 'normal',
    title: 'Timesheet correction approved',
    body: 'Your timesheet correction request has been approved.',
    entityType: 'timesheet_change_request',
    entityId: timesheetRequest.id,
    createdBy: user.id,
  });
}
```

- [ ] **Step 4: Add notification in deny route (after RPC)**

```typescript
if (timesheetRequest) {
  await createNotification({
    recipientProfileId: timesheetRequest.requester_profile_id,
    notificationType: 'timesheet_denied',
    priority: 'normal',
    title: 'Timesheet correction denied',
    body: denialReason
      ? `Your timesheet correction was denied: ${denialReason}`
      : 'Your timesheet correction request was denied.',
    entityType: 'timesheet_change_request',
    entityId: timesheetRequest.id,
    createdBy: user.id,
  });
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/requests/timesheet/
git commit -m "feat: wire normal-priority notifications for timesheet correction approve/deny"
```

---

## Task 16: Schedule Change Notifications

**Files:**
- Modify: `src/app/api/admin/shifts/[shiftId]/route.ts`

When a manager edits or removes a shift that belongs to a specific employee (`profile_id` is set on the shift), notify that employee.

- [ ] **Step 1: Read the PATCH and DELETE handlers**

```bash
sed -n '50,260p' src/app/api/admin/shifts/[shiftId]/route.ts
```

- [ ] **Step 2: Add import**

```typescript
import { createNotification } from '@/lib/notifications';
```

- [ ] **Step 3: Add notification in PATCH handler (edit)**

At the end of the PATCH handler, after the update succeeds, check if the shift has an assigned employee:

```typescript
// After successful update — notify the employee if shift is assigned to someone
if (updatedShift?.profile_id) {
  const changedFields: string[] = [];
  if (body.planned_start_at) changedFields.push('start time');
  if (body.ended_at) changedFields.push('end time');

  await createNotification({
    recipientProfileId: updatedShift.profile_id,
    notificationType: 'schedule_change',
    priority: 'high',
    title: 'Your shift was updated',
    body: changedFields.length > 0
      ? `A manager updated your shift (${changedFields.join(', ')}).`
      : 'A manager made changes to your shift.',
    entityType: 'shift',
    entityId: updatedShift.id,
    createdBy: user.id,
  });
}
```

- [ ] **Step 4: Add notification in DELETE handler (remove)**

```typescript
// After successful soft-delete — notify the employee
if (deletedShift?.profile_id) {
  await createNotification({
    recipientProfileId: deletedShift.profile_id,
    notificationType: 'schedule_change',
    priority: 'high',
    title: 'Your shift was removed',
    body: 'A manager removed a shift from your schedule. Please check your schedule.',
    entityType: 'shift',
    entityId: params.shiftId,
    createdBy: user.id,
  });
}
```

> **Note:** The PATCH handler also handles manual close reviews (updating `manual_closed_review_status`). Skip the notification for those — they are manager-to-manager actions, not schedule changes. Add a guard: only notify if `body.planned_start_at || body.ended_at || body.shift_type` is being changed.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/shifts/[shiftId]/route.ts
git commit -m "feat: wire high-priority schedule change notifications on shift edit/delete"
```

---

## Task 17: Manager System Notifications

**Files:**
- Modify: `src/app/api/admin/safe-ledger/route.ts`
- Modify: `src/app/api/end-shift/route.ts`

These cover: safe closeout failed/warn, shift variance (override_pending), and future hooks for skipped tasks / drawer variance.

### 17a — Safe Closeout Notifications

- [ ] **Step 1: Read the safe-ledger POST route**

```bash
sed -n '60,120p' src/app/api/admin/safe-ledger/route.ts
```

- [ ] **Step 2: Add import**

```typescript
import { createNotification } from '@/lib/notifications';
```

- [ ] **Step 3: Add import and notification after safe closeout is created**

```typescript
import { createStoreNotification } from '@/lib/notifications';
```

Find where the POST route determines `status` and inserts the safe closeout. After the insert succeeds, fan-out to all managers at the store:

```typescript
// After successful insert:
if (newCloseout.status === 'fail') {
  await createStoreNotification({
    storeId: newCloseout.store_id,
    notificationType: 'safe_closeout_failed',
    priority: 'high',
    title: 'Safe closeout failed',
    body: `The safe closeout for ${newCloseout.business_date} failed validation. Immediate review required.`,
    entityType: 'safe_closeout',
    entityId: newCloseout.id,
    createdBy: user.id,
  });
} else if (newCloseout.status === 'warn' || newCloseout.requires_manager_review) {
  await createStoreNotification({
    storeId: newCloseout.store_id,
    notificationType: 'safe_closeout_review',
    priority: 'normal',
    title: 'Safe closeout needs review',
    body: `The safe closeout for ${newCloseout.business_date} needs manager review.`,
    entityType: 'safe_closeout',
    entityId: newCloseout.id,
    createdBy: user.id,
  });
}
```

- [ ] **Step 4: Commit the safe-ledger change**

```bash
git add src/app/api/admin/safe-ledger/route.ts
git commit -m "feat: wire manager notifications for safe closeout fail/warn"
```

### 17b — Shift Override / Variance Notification

- [ ] **Step 5: Read the end-shift route around requires_override logic**

```bash
sed -n '625,670p' src/app/api/end-shift/route.ts
```

- [ ] **Step 6: Add import and notification when `requires_override` is set**

```typescript
import { createStoreNotification } from '@/lib/notifications';
```

Find where `requires_override: true` is set in the shift update. After the shift update succeeds, fan-out to store managers:

```typescript
// Only fire if requires_override is newly being set (not already set)
if (requiresOverride && !shift.requires_override) {
  await createStoreNotification({
    storeId: shift.store_id,
    notificationType: 'override_pending',
    priority: 'normal',
    title: 'Shift variance needs review',
    body: `A shift ended with a time variance that needs manager review.`,
    entityType: 'shift',
    entityId: shift.id,
  });
}
```

- [ ] **Step 7: Add notification when manual close occurs**

In the same route, find where `manual_closed: true` is set on the shift. After that update:

```typescript
await createStoreNotification({
  storeId: shift.store_id,
  notificationType: 'manual_close_pending',
  priority: 'normal',
  title: 'Manual shift close needs review',
  body: `A shift was manually closed and needs manager review.`,
  entityType: 'shift',
  entityId: shift.id,
});
```

- [ ] **Step 8: Commit**

```bash
git add src/app/api/end-shift/route.ts
git commit -m "feat: wire manager notifications for shift override and manual close events"
```

---

## Task 18: Smoke Test, Bell Auth, & Final Cleanup

- [ ] **Step 1: Wire the bell component's auth token**

The `NotificationBell` component calls `/api/notifications/count` and `/api/notifications` via `fetch`. These routes use `authenticateShiftRequest`, which reads the Bearer token from the Authorization header. The component needs to pass the token.

Find how the employee home page (`src/app/page.tsx`) currently accesses the employee JWT (likely a React context, Zustand store, or cookie) and follow the same pattern in `NotificationBell.tsx`:

```typescript
// Example — adapt to match however the home page reads its token:
const token = useAuthStore(state => state.token); // or however it's stored

const fetchCount = useCallback(async () => {
  const res = await fetch('/api/notifications/count', {
    headers: { Authorization: `Bearer ${token}` },
  });
  // ...
}, [token]);

const fetchItems = useCallback(async () => {
  const res = await fetch('/api/notifications', {
    headers: { Authorization: `Bearer ${token}` },
  });
  // ...
}, [token]);

const dismiss = async (id: string) => {
  await fetch(`/api/notifications/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ dismiss: true }),
  });
};

const markAllRead = async () => {
  await fetch('/api/notifications', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
  });
};
```

- [ ] **Step 2: End-to-end smoke test — employee bell**

1. Log in as an employee (PIN JWT)
2. Bell icon appears in the header with correct badge count
3. Open the bell → shows notifications and any pending manager-assigned tasks (read-only)
4. Dismiss a notification → removed from panel, count decreases
5. Tasks show "During shift" badge, no dismiss button
6. Go to the home page → banner shows if unread notifications exist
7. Go to a shift detail page → notifications appear as reminders, tasks appear with complete buttons

- [ ] **Step 3: End-to-end smoke test — manager bell**

1. Log in as a manager (Supabase JWT)
2. Bell icon appears in admin sidebar with badge count
3. Approve a swap request → both employees' bells update (fan-out created individual rows)
4. Deny a time-off request → employee receives high-priority notification
5. Submit a safe closeout with a failing status → ALL managers at that store see `safe_closeout_failed` in their bells

- [ ] **Step 4: Verify clock-out blocking**

1. Assign a manager message to an employee, start their shift → clock-out blocked ("Unread messages...")
2. Employee dismisses the message via the shift page → clock-out unblocked
3. Assign a task to an employee, start their shift → clock-out blocked ("Incomplete tasks...")
4. Both exist simultaneously → clock-out blocked ("Unread messages and incomplete tasks...")
5. Resolve both → clock-out succeeds

- [ ] **Step 5: Check for TypeScript errors**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 6: Soft-delete migrated messages from shift_assignments**

All reads have now been migrated to the notifications table. Safe to clean up the old message rows. Run this as a one-off migration or directly in Supabase:

```sql
-- supabase/migrations/20260327_cleanup_migrated_messages.sql
-- Soft-delete profile-targeted message rows that were migrated to the notifications
-- table in 20260326_notifications.sql.
--
-- Store-targeted messages (target_store_id IS NOT NULL) are intentionally NOT touched
-- here — they retain their "lazy delivery on clock-in" semantics and are still read
-- and delivered via shift_assignments by the clock-in logic.
UPDATE public.shift_assignments
SET deleted_at = now()
WHERE type = 'message'
  AND target_profile_id IS NOT NULL
  AND deleted_at IS NULL;
```

Apply it:
```bash
npx supabase db push
```

Verify:
```sql
-- Profile-targeted messages should all be soft-deleted
SELECT COUNT(*) FROM shift_assignments
WHERE type = 'message'
  AND target_profile_id IS NOT NULL
  AND deleted_at IS NULL;
-- Expected: 0

-- Store-targeted messages should be untouched
SELECT COUNT(*) FROM shift_assignments
WHERE type = 'message'
  AND target_store_id IS NOT NULL
  AND deleted_at IS NULL;
-- Expected: whatever existed before (no change)
```

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: centralized notifications system — bell, triggers, auth, schema complete"
```

---

## Out of Scope (Plan B — FCM Push Notifications)

The following are explicitly deferred to a separate plan once this system is stable:

- Firebase Cloud Messaging SDK integration
- Device token registration (`fcm_tokens` table)
- Sending push payloads for `priority = 'high'` notifications
- Updating `push_sent_at` and `push_message_id` on the notification record
- Notification permission prompting in the browser/PWA

The `priority`, `push_sent_at`, and `push_message_id` columns scaffolded in Task 1 are ready for Plan B without any schema changes.

---

## Deferred: Remaining Notification Triggers

The following notification types are defined in the type contract and TypeScript types but require locating their trigger routes before wiring. All follow the exact same pattern as Tasks 12–17.

### swap_offer_accepted / swap_offer_declined

When a requester selects or declines an offer, the offering employee should be notified:

```bash
# Find the select/decline offer routes:
grep -r "shift_swap" src/app/api --include="*.ts" -l
# Look for: POST /api/requests/shift-swap/[id]/select or /offers/[offerId]/decline
```

- **`swap_offer_accepted`** (high) → notify `offerer_profile_id` from `shift_swap_offers`
- **`swap_offer_declined`** (normal) → notify `offerer_profile_id` from `shift_swap_offers`

### unscheduled_shift

When an employee clocks in and the shift is detected as unscheduled (`shift_source: "manual"`), notify the store managers:

```bash
# Trigger is in the start-shift route:
grep -r "unscheduled\|shift_source\|manual" src/app/api/start-shift --include="*.ts"
```

- **`unscheduled_shift`** (normal) → `recipientStoreId: shift.store_id`

### time_off_pending_approval / timesheet_pending_approval

When an employee submits a time-off or timesheet request, notify the store managers:

```bash
# Find the creation routes:
grep -r "time_off_requests\|timesheet_change_requests" src/app/api/requests --include="*.ts" -l
# Look for POST handlers (not the approve/deny ones)
```

- **`time_off_pending_approval`** (normal) → `recipientStoreId` of the employee's store
- **`timesheet_pending_approval`** (normal) → `recipientStoreId` of the employee's store

### task_skipped / drawer_variance

High-priority manager notifications requiring trigger location:

```bash
# Find cleaning task skip logic:
grep -r "skipped\|task_skip\|cleaning" src/app/api --include="*.ts" -l

# Find drawer variance threshold check:
grep -r "isOutOfThreshold\|drawer_variance\|drawerVariance" src/app/api --include="*.ts" -l
```

- **`task_skipped`** (high) → `recipientStoreId`, triggered when a cleaning task is marked skipped
- **`drawer_variance`** (high) → `recipientStoreId`, triggered when `isOutOfThreshold` returns true in `src/lib/kioskRules.ts`
