const EMPLOYEE_COLOR_CLASSES = [
  "bg-green-500/20 text-green-200 border-green-400/40",
  "bg-purple-500/20 text-purple-200 border-purple-400/40",
  "bg-cyan-500/20 text-cyan-200 border-cyan-400/40",
  "bg-amber-500/20 text-amber-200 border-amber-400/40",
  "bg-pink-500/20 text-pink-200 border-pink-400/40",
] as const;
const PURPLE_CLASS = EMPLOYEE_COLOR_CLASSES[1];
const ORANGE_CLASS = EMPLOYEE_COLOR_CLASSES[3];

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function getEmployeeColorClass(profileId: string): string {
  const normalized = profileId.toLowerCase().replace(/-/g, "");
  const index = fnv1a(normalized) % EMPLOYEE_COLOR_CLASSES.length;
  return EMPLOYEE_COLOR_CLASSES[index];
}

export function buildEmployeeColorClassMap(profileIds: string[]): Record<string, string> {
  const uniqueSorted = Array.from(new Set(profileIds.filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const out: Record<string, string> = {};

  uniqueSorted.forEach((profileId, idx) => {
    out[profileId] = EMPLOYEE_COLOR_CLASSES[idx % EMPLOYEE_COLOR_CLASSES.length];
  });

  return out;
}

export function applyPreferredColorOverrides(
  colorMap: Record<string, string>,
  employees: Array<{ id: string; name?: string | null }>
): Record<string, string> {
  const out = { ...colorMap };
  employees.forEach(employee => {
    const name = (employee.name ?? "").trim().toLowerCase();
    if (name === "dorothy") {
      out[employee.id] = PURPLE_CLASS;
      return;
    }
    if (name === "tay") {
      out[employee.id] = ORANGE_CLASS;
    }
  });
  return out;
}
