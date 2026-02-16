export type SafeCloseoutStatus = "draft" | "pass" | "warn" | "fail" | "locked";

export type SafeCloseoutDenoms = {
  "100"?: number;
  "50"?: number;
  "20"?: number;
  "10"?: number;
  "5"?: number;
  "1"?: number;
  coin_cents?: number;
};

export interface SafeCloseoutRow {
  id: string;
  store_id: string;
  business_date: string;
  shift_id: string | null;
  profile_id: string;
  status: SafeCloseoutStatus;
  cash_sales_cents: number;
  card_sales_cents: number;
  other_sales_cents: number;
  expected_deposit_cents: number;
  actual_deposit_cents: number;
  denom_total_cents: number;
  drawer_count_cents: number | null;
  variance_cents: number;
  denoms_jsonb: SafeCloseoutDenoms;
  deposit_override_reason: string | null;
  validation_attempts: number;
  requires_manager_review: boolean;
  reviewed_at: string | null;
  reviewed_by: string | null;
  edited_at: string | null;
  edited_by: string | null;
  is_historical_backfill: boolean;
  created_at: string;
  updated_at: string;
}

export interface SafeCloseoutExpenseRow {
  id: string;
  closeout_id: string;
  amount_cents: number;
  category: string;
  note: string | null;
  created_at: string;
}

export type SafeCloseoutPhotoType = "deposit_required" | "pos_optional";

export interface SafeCloseoutPhotoRow {
  id: string;
  closeout_id: string;
  photo_type: SafeCloseoutPhotoType;
  storage_path: string | null;
  thumb_path: string | null;
  purge_after: string | null;
  created_at: string;
}

export interface SubmitSafeCloseoutResult {
  status: Extract<SafeCloseoutStatus, "pass" | "warn" | "fail">;
  requires_manager_review: boolean;
  validation_attempts: number;
  variance_cents: number;
  expected_deposit_cents: number;
  actual_deposit_cents: number;
  denom_total_cents: number;
  denom_variance_cents: number;
}
