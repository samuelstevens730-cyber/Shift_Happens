export type ShiftScoreRow = {
  shiftId: string | null;           // null = missed scheduled shift (absent)
  scheduleShiftId: string | null;
  date: string;                     // YYYY-MM-DD (CST business date)
  storeName: string;
  shiftType: "open" | "close" | "double" | "other" | null;
  attended: boolean;

  // Informational values (shown as columns, not used in composite)
  salesRawCents: number | null;
  salesAdjustedCents: number | null;
  scheduledStartMin: number | null; // minutes since midnight CST (null if unscheduled)
  actualStartMin: number | null;    // minutes since midnight CST (null if absent)
  effectiveLateMinutes: number | null; // after 5-min grace period
  drawerAbsDeltaCents: number | null;
  closeoutVarianceCents: number | null;
  cleaningCompleted: number;
  cleaningTotal: number;

  // Per-shift point scores (null = metric has no data for this shift)
  attendancePoints: number | null;    // 15 if worked, 0 if absent; null if not scheduled
  punctualityPoints: number | null;   // 0–15; null if not scheduled or no start time
  accuracyPoints: number | null;      // 0–20; null if no drawer data
  cashHandlingPoints: number | null;  // 0–10; null if no closeout data
  taskPoints: number | null;          // 0–10; null if no task data

  compositeScore: number | null;      // 0–100 normalized; null if no metrics available
};

export type ShiftBreakdownResponse = {
  profileId: string;
  employeeName: string | null;
  rows: ShiftScoreRow[];
  from: string;
  to: string;
};
