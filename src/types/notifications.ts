export const NOTIFICATION_PRIORITIES = ["high", "normal"] as const;

export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

export const NOTIFICATION_TYPES = [
  "manager_message",
  "schedule_change",
  "swap_approved",
  "swap_denied",
  "swap_offer_accepted",
  "coverage_approved",
  "coverage_denied",
  "time_off_approved",
  "time_off_denied",
  "swap_offer_received",
  "swap_offer_declined",
  "timesheet_approved",
  "timesheet_denied",
  "swap_pending_approval",
  "coverage_pending_approval",
  "early_clock_in_pending_approval",
  "early_clock_in_approved",
  "early_clock_in_denied",
  "task_skipped",
  "drawer_variance",
  "safe_closeout_failed",
  "override_pending",
  "manual_close_pending",
  "unscheduled_shift",
  "safe_closeout_review",
  "time_off_pending_approval",
  "timesheet_pending_approval",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_ENTITY_TYPES = [
  "shift_swap_request",
  "coverage_shift_request",
  "early_clock_in_request",
  "time_off_request",
  "timesheet_change_request",
  "shift",
  "safe_closeout",
] as const;

export type NotificationEntityType = (typeof NOTIFICATION_ENTITY_TYPES)[number];

export type NotificationRow = {
  id: string;
  recipient_profile_id: string;
  source_store_id: string | null;
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

export type BellNotificationItem = Pick<
  NotificationRow,
  | "id"
  | "notification_type"
  | "priority"
  | "title"
  | "body"
  | "entity_type"
  | "entity_id"
  | "read_at"
  | "dismissed_at"
  | "created_at"
> & {
  is_task: false;
};

export type BellTaskItem = {
  id: string;
  title: string;
  body: string;
  created_at: string;
  completed_at: string | null;
  is_task: true;
};

export type BellItem = BellNotificationItem | BellTaskItem;

export type BellListResponse = {
  notifications: BellNotificationItem[];
  tasks: BellTaskItem[];
};

export type BellCountResponse = {
  unread_count: number;
};
