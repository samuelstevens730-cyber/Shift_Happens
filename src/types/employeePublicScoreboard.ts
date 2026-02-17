import type { EmployeeScoreRow } from "@/types/employeeScore";

export type PublicScoreRow = {
  profileId: string;
  employeeName: string | null;
  score: number;
  grade: "A" | "B" | "C" | "D";
};

export type EmployeePublicScoreboardResponse = {
  stores: Array<{ id: string; name: string }>;
  publicRows: PublicScoreRow[];
  myRow: EmployeeScoreRow | null;
  managerRows: PublicScoreRow[];
  winner: PublicScoreRow | null;
  from: string;
  to: string;
  minShiftsForRanking: number;
};
