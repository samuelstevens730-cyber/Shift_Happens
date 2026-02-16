export type DashboardActionCategory = "people" | "money" | "scheduling" | "approvals";
export type DashboardActionSeverity = "high" | "medium" | "low";
export type StoreHealthGrade = "A" | "B" | "C" | "D";

export type DashboardStore = {
  id: string;
  name: string;
};

export type DashboardActionItem = {
  id: string;
  category: DashboardActionCategory;
  severity: DashboardActionSeverity;
  title: string;
  description: string;
  store_id: string | null;
  created_at: string | null;
};

export type DashboardToplineByStore = Record<
  string,
  {
    totalSales: number;
    cashSales: number;
    cardSales: number;
    otherSales: number;
    closeoutStatus: string | null;
    closeoutVariance: number;
  }
>;

export type DashboardSalesPoint = {
  date: string;
  cash: number;
  card: number;
  other: number;
  total: number;
  status: string;
};

export type DashboardHealthSignal = {
  name: string;
  score: number;
  maxScore: number;
};

export type DashboardStoreHealth = {
  grade: StoreHealthGrade;
  score: number;
  signals: DashboardHealthSignal[];
};

export type DashboardResponse = {
  stores: DashboardStore[];
  topline: DashboardToplineByStore;
  openShifts: number;
  pendingApprovals: number;
  actions: Record<DashboardActionCategory, DashboardActionItem[]>;
  actionCounts: Record<DashboardActionCategory, number>;
  salesHistory: Record<string, DashboardSalesPoint[]>;
  health: Record<string, DashboardStoreHealth>;
};
