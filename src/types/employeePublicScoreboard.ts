import type { EmployeeScoreRow } from "@/types/employeeScore";
import type { AvatarOptions } from "@/components/UserAvatar";

export type PublicScoreRow = {
  profileId: string;
  employeeName: string | null;
  score: number;
  grade: "A" | "B" | "C" | "D";
  avatarStyle: string | null;
  avatarSeed: string | null;
  avatarOptions: AvatarOptions;
  avatarUploadUrl: string | null;
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
