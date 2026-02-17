export type EmployeeScoreCategoryKey =
  | "sales_raw"
  | "sales_adjusted"
  | "attendance"
  | "punctuality"
  | "accuracy"
  | "cash_handling"
  | "task_master";

export type EmployeeScoreCategory = {
  key: EmployeeScoreCategoryKey;
  label: string;
  maxPoints: number;
  points: number | null;
  available: boolean;
  detail: string;
};

export type EmployeeScoreRow = {
  profileId: string;
  employeeName: string | null;
  shiftsWorked: number;
  ranked: boolean;
  score: number;
  grade: "A" | "B" | "C" | "D";
  rawAvgSalesPerShiftCents: number | null;
  adjustedAvgSalesPerShiftCents: number | null;
  categories: EmployeeScoreCategory[];
};

export type EmployeeScoreboardResponse = {
  stores: Array<{ id: string; name: string }>;
  rows: EmployeeScoreRow[];
  from: string;
  to: string;
  minShiftsForRanking: number;
};
