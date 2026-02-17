export type ShiftSalesRow = {
  shiftId: string;
  storeId: string;
  storeName: string | null;
  profileId: string;
  employeeName: string | null;
  shiftType: "open" | "close" | "double" | "other";
  businessDate: string;
  startedAt: string;
  endedAt: string | null;
  salesCents: number | null;
  formula: string;
  openXReportCents: number | null;
  priorXReportCents: number | null;
  zReportCents: number | null;
  beginningXReportCents: number | null;
  midnightXReportCents: number | null;
  isRolloverNight: boolean;
};

export type ShiftSalesResponse = {
  stores: Array<{ id: string; name: string }>;
  rows: ShiftSalesRow[];
  from: string;
  to: string;
};
