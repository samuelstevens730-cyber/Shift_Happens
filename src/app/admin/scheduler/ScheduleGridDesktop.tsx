"use client";

import {
  Assignment,
  SHIFT_TYPES,
  Store,
  assignmentKey,
  calcHours,
  formatTimeLabel,
  hashColor,
  TemplateRow,
} from "./useSchedulerState";

type Props = {
  stores: Store[];
  dates: string[];
  assignments: Record<string, Assignment>;
  employeesByStore: Record<string, Array<{ id: string; name: string }>>;
  templateLookup: (storeId: string, dateStr: string, shiftType: "open" | "close") => TemplateRow | undefined;
  onEmployeeChange: (storeId: string, dateStr: string, shiftType: "open" | "close", profileId: string) => void;
  onModeChange: (storeId: string, dateStr: string, shiftType: "open" | "close", shiftMode: Assignment["shiftMode"]) => void;
  onOtherTimeChange: (
    storeId: string,
    dateStr: string,
    shiftType: "open" | "close",
    field: "start" | "end",
    value: string
  ) => void;
};

export default function ScheduleGridDesktop({
  stores,
  dates,
  assignments,
  employeesByStore,
  templateLookup,
  onEmployeeChange,
  onModeChange,
  onOtherTimeChange,
}: Props) {
  return (
    <div className="card card-pad overflow-x-auto hidden md:block">
      <table className="w-full text-sm">
        <thead className="bg-black/40">
          <tr>
            <th className="text-left px-2 py-2">Date</th>
            {stores.map(store =>
              SHIFT_TYPES.map(shift => (
                <th key={`${store.id}-${shift.key}`} className="text-left px-2 py-2">
                  {store.name} {shift.label}
                </th>
              ))
            )}
          </tr>
        </thead>
        <tbody>
          {dates.map(dateStr => (
            <tr key={dateStr} className="border-t border-white/10">
              <td className="px-2 py-2 whitespace-nowrap">{dateStr}</td>
              {stores.map(store =>
                SHIFT_TYPES.map(shift => {
                  const key = assignmentKey(store.id, dateStr, shift.key);
                  const current = assignments[key];
                  const employees = employeesByStore[store.id] ?? [];
                  const tpl = templateLookup(store.id, dateStr, shift.key);
                  const cellStart = current?.shiftMode === "other" ? current?.scheduledStart : tpl?.start_time;
                  const cellEnd = current?.shiftMode === "other" ? current?.scheduledEnd : tpl?.end_time;
                  const cellHours = cellStart && cellEnd ? calcHours(cellStart, cellEnd).toFixed(2) : null;
                  return (
                    <td key={key} className="px-2 py-2 align-top min-w-[220px]">
                      <div className="space-y-1">
                        <select
                          className="select text-sm"
                          value={current?.profileId ?? ""}
                          onChange={e => onEmployeeChange(store.id, dateStr, shift.key, e.target.value)}
                        >
                          <option value="">Unassigned</option>
                          {employees.map(p => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        <select
                          className="select text-sm"
                          value={current?.shiftMode ?? "standard"}
                          onChange={e => onModeChange(store.id, dateStr, shift.key, e.target.value as Assignment["shiftMode"])}
                        >
                          <option value="standard">Standard</option>
                          <option value="double">Double</option>
                          <option value="other">Other</option>
                        </select>
                        {current?.shiftMode === "other" && (
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              type="time"
                              className="input text-sm"
                              value={current?.scheduledStart ?? ""}
                              onChange={e => onOtherTimeChange(store.id, dateStr, shift.key, "start", e.target.value)}
                            />
                            <input
                              type="time"
                              className="input text-sm"
                              value={current?.scheduledEnd ?? ""}
                              onChange={e => onOtherTimeChange(store.id, dateStr, shift.key, "end", e.target.value)}
                            />
                          </div>
                        )}
                        <div className="text-xs muted">
                          {cellStart && cellEnd ? `${formatTimeLabel(cellStart)} - ${formatTimeLabel(cellEnd)}` : "Template missing"}
                        </div>
                        {current?.profileId && (
                          <div className={`text-xs px-2 py-1 rounded border flex items-center justify-between gap-2 ${hashColor(current.profileId)}`}>
                            <span>{employees.find(p => p.id === current.profileId)?.name ?? "Employee"}</span>
                            {cellHours && <span className="ml-auto">{cellHours} hrs</span>}
                          </div>
                        )}
                      </div>
                    </td>
                  );
                })
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
