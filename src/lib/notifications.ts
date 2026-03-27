import type {
  NotificationEntityType,
  NotificationPriority,
  NotificationType,
} from "@/types/notifications";
import { supabaseServer } from "@/lib/supabaseServer";

export type CreateNotificationInput = {
  recipientProfileId: string;
  sourceStoreId?: string;
  notificationType: NotificationType;
  priority: NotificationPriority;
  title: string;
  body: string;
  entityType?: NotificationEntityType;
  entityId?: string;
  createdBy?: string;
};

export type CreateStoreNotificationInput = {
  storeId: string;
  notificationType: NotificationType;
  priority: NotificationPriority;
  title: string;
  body: string;
  entityType?: NotificationEntityType;
  entityId?: string;
  createdBy?: string;
};

type NotificationInsertRow = {
  recipient_profile_id: string;
  source_store_id: string | null;
  notification_type: NotificationType;
  priority: NotificationPriority;
  title: string;
  body: string;
  entity_type: NotificationEntityType | null;
  entity_id: string | null;
  created_by: string | null;
};

function toNotificationInsertRow(input: CreateNotificationInput): NotificationInsertRow {
  return {
    recipient_profile_id: input.recipientProfileId,
    source_store_id: input.sourceStoreId ?? null,
    notification_type: input.notificationType,
    priority: input.priority,
    title: input.title,
    body: input.body,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    created_by: input.createdBy ?? null,
  };
}

async function insertNotifications(rows: NotificationInsertRow[]): Promise<boolean> {
  if (!rows.length) return true;

  try {
    const { error } = await supabaseServer.from("notifications").insert(rows);

    if (error) {
      console.error("Failed to create notifications:", error);
      return false;
    }
  } catch (error) {
    console.error("Unexpected notification insert failure:", error);
    return false;
  }

  return true;
}

export async function createNotification(input: CreateNotificationInput): Promise<boolean> {
  return insertNotifications([toNotificationInsertRow(input)]);
}

export async function createStoreNotification(input: CreateStoreNotificationInput): Promise<boolean> {
  const { data: storeManagers, error: storeManagersError } = await supabaseServer
    .from("store_managers")
    .select("user_id")
    .eq("store_id", input.storeId)
    .returns<Array<{ user_id: string }>>();

  if (storeManagersError) {
    console.error("Failed to load store managers for notification fan-out:", storeManagersError);
    return false;
  }

  const managerUserIds = Array.from(
    new Set((storeManagers ?? []).map(manager => manager.user_id).filter(Boolean))
  );

  if (!managerUserIds.length) {
    console.error("No store managers found for notification fan-out:", { storeId: input.storeId });
    return false;
  }

  const { data: managerProfiles, error: profilesError } = await supabaseServer
    .from("profiles")
    .select("id, auth_user_id")
    .in("auth_user_id", managerUserIds)
    .returns<Array<{ id: string; auth_user_id: string | null }>>();

  if (profilesError) {
    console.error("Failed to resolve manager profiles for notification fan-out:", profilesError);
    return false;
  }

  const recipientProfileIds = Array.from(
    new Set((managerProfiles ?? []).map(profile => profile.id).filter(Boolean))
  );

  if (!recipientProfileIds.length) {
    console.error("No manager profiles found for notification fan-out:", { storeId: input.storeId });
    return false;
  }

  return insertNotifications(
    recipientProfileIds.map(recipientProfileId =>
      toNotificationInsertRow({
        recipientProfileId,
        sourceStoreId: input.storeId,
        notificationType: input.notificationType,
        priority: input.priority,
        title: input.title,
        body: input.body,
        entityType: input.entityType,
        entityId: input.entityId,
        createdBy: input.createdBy,
      })
    )
  );
}

export async function createNotifications(inputs: CreateNotificationInput[]): Promise<boolean> {
  return insertNotifications(inputs.map(toNotificationInsertRow));
}
