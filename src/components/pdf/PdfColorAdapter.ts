export type PdfColorSet = {
  background: string;
  text: string;
  border: string;
};

const DEFAULT_COLORS: PdfColorSet = {
  background: "#E5E7EB",
  text: "#111827",
  border: "#9CA3AF",
};

const CLASS_COLOR_MAP: Array<{ token: string; colors: PdfColorSet }> = [
  {
    token: "green",
    colors: { background: "#D1FAE5", text: "#065F46", border: "#34D399" },
  },
  {
    token: "purple",
    colors: { background: "#E9D5FF", text: "#6B21A8", border: "#A78BFA" },
  },
  {
    token: "cyan",
    colors: { background: "#CFFAFE", text: "#155E75", border: "#22D3EE" },
  },
  {
    token: "amber",
    colors: { background: "#FEF3C7", text: "#92400E", border: "#F59E0B" },
  },
  {
    token: "pink",
    colors: { background: "#FCE7F3", text: "#9D174D", border: "#EC4899" },
  },
];

export function classToPdfColors(className?: string): PdfColorSet {
  if (!className) return DEFAULT_COLORS;
  const lower = className.toLowerCase();
  const found = CLASS_COLOR_MAP.find(item => lower.includes(item.token));
  return found?.colors ?? DEFAULT_COLORS;
}

