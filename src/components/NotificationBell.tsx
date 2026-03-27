"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, Loader2, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { cn } from "@/lib/utils";
import type {
  BellCountResponse,
  BellItem,
  BellListResponse,
  BellNotificationItem,
  BellTaskItem,
} from "@/types/notifications";

const COUNT_POLL_MS = 30_000;
const PIN_TOKEN_KEY = "sh_pin_token";

function combineBellItems(
  notifications: Omit<BellNotificationItem, "is_task">[],
  tasks: BellTaskItem[]
): BellItem[] {
  const notificationItems: BellItem[] = notifications.map((notification) => ({
      ...notification,
      is_task: false as const,
    }));

  return [...notificationItems, ...tasks].sort((left, right) => {
    return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
  });
}

function formatTimestamp(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export default function NotificationBell() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const latestCountRequestRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<BellItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [countLoading, setCountLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  /**
   * Resolves auth headers for the current user.
   * Returns null if no token is available — callers must skip the fetch in that case.
   * Tries Supabase session first (managers), falls back to PIN token (employees).
   */
  const getAuthHeaders = useEffectEvent(async (includeJson = false): Promise<Record<string, string> | null> => {
    // Try Supabase session first (managers with Supabase auth)
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session?.access_token) {
      return {
        ...(includeJson ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${session.access_token}`,
      };
    }

    // Fall back to PIN token (employees with custom JWT auth)
    const pinToken =
      typeof window !== "undefined" ? window.sessionStorage.getItem(PIN_TOKEN_KEY) : null;

    if (pinToken) {
      return {
        ...(includeJson ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${pinToken}`,
      };
    }

    // No token available yet — caller should skip the request
    return null;
  });

  const fetchUnreadCount = useEffectEvent(async (showSpinner = false) => {
    const requestId = latestCountRequestRef.current + 1;
    latestCountRequestRef.current = requestId;

    if (showSpinner) {
      setCountLoading(true);
    }

    try {
      const headers = await getAuthHeaders();
      if (!headers) return; // no token yet — skip silently, next poll will retry

      const response = await fetch("/api/notifications/count", {
        method: "GET",
        cache: "no-store",
        headers,
      });

      if (!response.ok) {
        throw new Error("Failed to load notification count");
      }

      const data = (await response.json()) as BellCountResponse;
      if (latestCountRequestRef.current === requestId) {
        setUnreadCount(data.unread_count ?? 0);
      }
    } catch {
      if (showSpinner && latestCountRequestRef.current === requestId) {
        setUnreadCount(0);
      }
    } finally {
      if (showSpinner && latestCountRequestRef.current === requestId) {
        setCountLoading(false);
      }
    }
  });

  const fetchItems = useEffectEvent(async () => {
    setListLoading(true);
    setListError(null);

    try {
      const headers = await getAuthHeaders();
      if (!headers) {
        setListError("Not authenticated");
        return;
      }

      const response = await fetch("/api/notifications", {
        method: "GET",
        cache: "no-store",
        headers,
      });

      const data: unknown = await response.json();

      if (!response.ok) {
        const errorMessage =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof data.error === "string"
            ? data.error
            : "Failed to load notifications";
        throw new Error(errorMessage);
      }

      const listData = data as BellListResponse;
      setItems(combineBellItems(listData.notifications ?? [], listData.tasks ?? []));
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Failed to load notifications");
      setItems([]);
    } finally {
      setListLoading(false);
    }
  });

  useEffect(() => {
    void fetchUnreadCount(true);

    const intervalId = window.setInterval(() => {
      void fetchUnreadCount();
    }, COUNT_POLL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  // fetchUnreadCount is a useEffectEvent — must NOT be in deps array
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    void fetchItems();
  // fetchItems is a useEffectEvent — must NOT be in deps array
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Panel is portaled to document.body — track its DOM node so the
  // click-outside handler can still check containment correctly.
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const insideBell  = rootRef.current?.contains(target) ?? false;
      const insidePanel = panelRef.current?.contains(target) ?? false;
      if (!insideBell && !insidePanel) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  async function dismiss(id: string) {
    setActionError(null);
    setDismissingId(id);

    try {
      const dismissedItem = items.find(
        (item): item is BellNotificationItem => !item.is_task && item.id === id
      );
      const headers = await getAuthHeaders(true);
      if (!headers) return;
      const response = await fetch(`/api/notifications/${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ dismiss: true }),
      });

      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "Failed to dismiss notification");
      }

      setItems((currentItems) => currentItems.filter((item) => item.is_task || item.id !== id));
      if (dismissedItem && !dismissedItem.read_at) {
        setUnreadCount((currentCount) => Math.max(0, currentCount - 1));
      }
      void fetchUnreadCount();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to dismiss notification");
    } finally {
      setDismissingId(null);
    }
  }

  async function markAllRead() {
    setActionError(null);
    setMarkingAllRead(true);

    try {
      const headers = await getAuthHeaders(true);
      if (!headers) return;
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers,
      });

      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "Failed to mark notifications as read");
      }

      setUnreadCount(0);
      setItems((currentItems) =>
        currentItems.map((item) =>
          item.is_task ? item : { ...item, read_at: item.read_at ?? new Date().toISOString() }
        )
      );
      void fetchUnreadCount();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Failed to mark notifications as read"
      );
    } finally {
      setMarkingAllRead(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      {/* Bell trigger — ghost style to sit cleanly in the dark sidebar header */}
      <button
        ref={bellRef}
        type="button"
        aria-label="Open notifications"
        aria-expanded={open}
        onClick={() => {
          setActionError(null);
          setOpen((current) => {
            if (!current && bellRef.current) {
              const rect = bellRef.current.getBoundingClientRect();
              setPanelPos({ top: rect.bottom + 8, left: rect.left });
            }
            return !current;
          });
        }}
        className={cn(
          "relative flex h-8 w-8 items-center justify-center rounded-md transition-colors",
          open
            ? "bg-white/10 text-[var(--text)]"
            : "text-[var(--muted)] hover:bg-white/5 hover:text-[var(--text)]"
        )}
      >
        <Bell className="h-4 w-4" strokeWidth={1.8} />
        {!countLoading && unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[9px] font-bold leading-none text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open && panelPos ? createPortal(
        <div
          ref={panelRef}
          style={{ position: "fixed", top: panelPos.top, left: panelPos.left, zIndex: 200, width: "20rem" }}
          className="overflow-hidden rounded-xl border border-white/10 bg-[rgba(8,10,9,0.97)] shadow-2xl backdrop-blur-xl"
        >

          {/* Header */}
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--text)]">Notifications</div>
              <div className="text-xs text-[var(--muted)]">
                {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void markAllRead()}
                disabled={markingAllRead || unreadCount === 0}
                className="flex h-7 items-center gap-1.5 rounded-md border border-white/10 px-2.5 text-xs text-[var(--muted)] transition-colors hover:border-white/20 hover:text-[var(--text)] disabled:pointer-events-none disabled:opacity-40"
              >
                {markingAllRead ? <Loader2 className="h-3 w-3 animate-spin" /> : "Mark all read"}
              </button>
              <button
                type="button"
                aria-label="Close notifications"
                onClick={() => setOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-white/5 hover:text-[var(--text)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="border-t border-white/7" />

          {/* Action error banner */}
          {actionError ? (
            <div className="border-b border-[var(--danger)]/20 bg-[rgba(255,92,107,0.08)] px-4 py-2 text-xs text-[var(--danger)]">
              {actionError}
            </div>
          ) : null}

          {/* List */}
          <div className="max-h-[28rem] overflow-y-auto">
            {listLoading ? (
              <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-[var(--muted)]">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            ) : listError ? (
              <div className="px-4 py-10 text-center text-sm text-[var(--muted)]">{listError}</div>
            ) : items.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-[var(--muted)]">
                No notifications or tasks right now.
              </div>
            ) : (
              <div>
                {items.map((item, index) => {
                  const isUnread = !item.is_task && !item.read_at;
                  const isHighPriority = !item.is_task && item.priority === "high";
                  const showDismiss = !item.is_task;

                  return (
                    <div key={`${item.is_task ? "task" : "notification"}-${item.id}`}>
                      {index > 0 ? <div className="border-t border-white/7" /> : null}
                      <div
                        className={cn(
                          "px-4 py-3 transition-colors",
                          isUnread ? "bg-[rgba(32,240,138,0.04)]" : "bg-transparent"
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                            {/* Title row */}
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={cn("text-sm font-medium", isUnread ? "text-[var(--text)]" : "text-[var(--muted)]")}>
                                {item.title}
                              </span>
                              {isUnread ? (
                                <span
                                  className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--green)]"
                                  aria-label="Unread"
                                />
                              ) : null}
                              {isHighPriority ? (
                                <span className="rounded-full bg-[rgba(255,92,107,0.15)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--danger)]">
                                  Urgent
                                </span>
                              ) : null}
                              {item.is_task ? (
                                <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
                                  During shift
                                </span>
                              ) : null}
                            </div>
                            {/* Body */}
                            <div className="text-xs text-[var(--muted)]">
                              {item.body || (item.is_task ? "Task assigned for the current shift." : "")}
                            </div>
                            {/* Timestamp */}
                            <div className="text-[11px] text-[var(--muted)]/50">
                              {formatTimestamp(item.created_at)}
                            </div>
                          </div>

                          {showDismiss ? (
                            <button
                              type="button"
                              disabled={dismissingId === item.id}
                              onClick={() => void dismiss(item.id)}
                              className="flex h-6 items-center rounded px-2 text-[11px] text-[var(--muted)] transition-colors hover:text-[var(--danger)] disabled:pointer-events-none disabled:opacity-40"
                            >
                              {dismissingId === item.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                "Dismiss"
                              )}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}
