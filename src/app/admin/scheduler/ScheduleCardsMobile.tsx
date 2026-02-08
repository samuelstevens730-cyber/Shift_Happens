"use client";

import { useMemo, useRef, useState } from "react";
import {
  Assignment,
  SHIFT_TYPES,
  Store,
  TemplateRow,
  assignmentKey,
  calcHours,
  formatTimeLabel,
} from "./useSchedulerState";
import { getEmployeeColorClass } from "@/lib/employeeColors";

type Props = {
  stores: Store[];
  dates: string[];
  assignments: Record<string, Assignment>;
  scheduleMap: Record<string, { id: string; status: string }>;
  employeesByStore: Record<string, Array<{ id: string; name: string }>>;
  templateLookup: (storeId: string, dateStr: string, shiftType: "open" | "close") => TemplateRow | undefined;
  unassignedKeys: Set<string>;
  conflictKeys: Set<string>;
  saving: boolean;
  onEmployeeChange: (storeId: string, dateStr: string, shiftType: "open" | "close", profileId: string) => void;
  onModeChange: (storeId: string, dateStr: string, shiftType: "open" | "close", shiftMode: Assignment["shiftMode"]) => void;
  onOtherTimeChange: (
    storeId: string,
    dateStr: string,
    shiftType: "open" | "close",
    field: "start" | "end",
    value: string
  ) => void;
  onSaveDraft: () => void;
  onPublish: () => void;
  onJumpTotals: () => void;
};

function statusPill(scheduleStatus: string | undefined, hasIssues: boolean) {
  if (hasIssues) return "Incomplete";
  if (scheduleStatus === "published") return "Published";
  if (scheduleStatus === "draft") return "Draft";
  return "Missing";
}

function statusPillClass(pill: string) {
  if (pill === "Published") return "border-emerald-400/40 text-emerald-200 bg-emerald-500/10";
  if (pill === "Incomplete") return "border-amber-400/40 text-amber-200 bg-amber-500/10";
  if (pill === "Missing") return "border-rose-400/40 text-rose-200 bg-rose-500/10";
  return "border-white/20 text-white/80 bg-white/5";
}

export default function ScheduleCardsMobile({
  stores,
  dates,
  assignments,
  scheduleMap,
  employeesByStore,
  templateLookup,
  unassignedKeys,
  conflictKeys,
  saving,
  onEmployeeChange,
  onModeChange,
  onOtherTimeChange,
  onSaveDraft,
  onPublish,
  onJumpTotals,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [incompleteCursor, setIncompleteCursor] = useState(-1);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const selectRefs = useRef<Record<string, HTMLSelectElement | null>>({});

  const cards = useMemo(() => {
    const rows: Array<{ cardKey: string; date: string; store: Store; issueKeys: string[]; incompleteKeys: string[] }> = [];
    for (const date of dates) {
      for (const store of stores) {
        const issueKeys: string[] = [];
        const incompleteKeys: string[] = [];
        for (const shift of SHIFT_TYPES) {
          const key = assignmentKey(store.id, date, shift.key);
          if (unassignedKeys.has(key)) incompleteKeys.push(key);
          if (unassignedKeys.has(key) || conflictKeys.has(key)) issueKeys.push(key);
        }
        rows.push({ cardKey: `${date}|${store.id}`, date, store, issueKeys, incompleteKeys });
      }
    }
    return rows;
  }, [dates, stores, unassignedKeys, conflictKeys]);

  const visibleCards = useMemo(() => {
    if (!issuesOnly) return cards;
    return cards.filter(card => card.issueKeys.length > 0);
  }, [cards, issuesOnly]);

  const allIncompleteByOrder = useMemo(() => cards.flatMap(card => card.incompleteKeys.map(key => ({ cardKey: card.cardKey, key }))), [cards]);

  function toggleCard(cardKey: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(cardKey)) next.delete(cardKey);
      else next.add(cardKey);
      return next;
    });
  }

  function jumpToNextIncomplete() {
    if (!allIncompleteByOrder.length) return;
    const nextIndex = (incompleteCursor + 1) % allIncompleteByOrder.length;
    setIncompleteCursor(nextIndex);
    const target = allIncompleteByOrder[nextIndex];
    setExpanded(prev => new Set(prev).add(target.cardKey));
    cardRefs.current[target.cardKey]?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      selectRefs.current[target.key]?.focus();
    }, 200);
  }

  function jumpToIssues() {
    setIssuesOnly(true);
    const firstIssue = cards.find(card => card.issueKeys.length > 0);
    if (!firstIssue) return;
    cardRefs.current[firstIssue.cardKey]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="md:hidden pb-[12.5rem]">
      <div className="space-y-3">
        {visibleCards.map(card => {
          const scheduleStatus = scheduleMap[card.store.id]?.status;
          const hasIssues = card.issueKeys.length > 0;
          const pill = statusPill(scheduleStatus, hasIssues);
          const cardExpanded = expanded.has(card.cardKey);

          let dayHours = 0;
            const summaries = SHIFT_TYPES.map(shift => {
            const key = assignmentKey(card.store.id, card.date, shift.key);
            const assignment = assignments[key];
            const employees = employeesByStore[card.store.id] ?? [];
            const employeeName = assignment?.profileId ? employees.find(x => x.id === assignment.profileId)?.name ?? "Employee" : "Unassigned";
            const tpl = templateLookup(card.store.id, card.date, shift.key);
            const startAt = assignment?.shiftMode === "other" ? assignment.scheduledStart : tpl?.start_time;
            const endAt = assignment?.shiftMode === "other" ? assignment.scheduledEnd : tpl?.end_time;
            const hours = assignment?.profileId && startAt && endAt ? calcHours(startAt, endAt) : 0;
            dayHours += hours;
            return {
              shift,
              key,
              assignment,
              employeeName,
              startAt,
              endAt,
              hours,
              hasIssue: unassignedKeys.has(key) || conflictKeys.has(key),
              conflict: conflictKeys.has(key),
              colorClass: assignment?.profileId ? getEmployeeColorClass(assignment.profileId) : "",
            };
          });

          return (
            <div
              key={card.cardKey}
              ref={el => {
                cardRefs.current[card.cardKey] = el;
              }}
              className="card card-pad"
            >
              <button
                type="button"
                className="w-full text-left"
                aria-expanded={cardExpanded}
                aria-controls={`scheduler-card-body-${card.cardKey}`}
                onClick={() => toggleCard(card.cardKey)}
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{card.date}</div>
                    <div className="text-xs muted">{card.store.name}</div>
                  </div>
                  <div className="text-right">
                    <div className={`text-xs px-2 py-1 rounded border inline-block ${statusPillClass(pill)}`}>{pill}</div>
                    <div className="text-xs muted mt-1">{dayHours.toFixed(2)} hrs</div>
                  </div>
                </div>
                <div className="mt-2 text-xs muted space-y-1">
                  {summaries.map(item => (
                    <div key={item.key} className="flex items-center gap-2">
                      <span>{item.shift.label}:</span>
                      {item.assignment?.profileId ? (
                        <span className={`px-2 py-0.5 rounded border ${item.colorClass}`}>
                          {item.employeeName}
                          {item.hours > 0 ? ` (${item.hours.toFixed(1)}h)` : ""}
                        </span>
                      ) : (
                        <span>Unassigned</span>
                      )}
                      {item.hasIssue ? <span>- needs attention</span> : null}
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-xs muted">{cardExpanded ? "Collapse details" : "Expand details"}</div>
              </button>

              {cardExpanded && (
                <div id={`scheduler-card-body-${card.cardKey}`} className="mt-3 space-y-3">
                  {summaries.map(item => {
                    const employees = employeesByStore[card.store.id] ?? [];
                    return (
                      <div key={item.key} className="border border-white/10 rounded p-3 space-y-2">
                        <div className="text-sm font-medium flex items-center justify-between">
                          <span>{item.shift.label}</span>
                          {item.conflict && <span className="text-xs text-amber-300">Conflict detected</span>}
                        </div>
                        <select
                          ref={el => {
                            selectRefs.current[item.key] = el;
                          }}
                          className="select w-full"
                          value={item.assignment?.profileId ?? ""}
                          onChange={e => onEmployeeChange(card.store.id, card.date, item.shift.key, e.target.value)}
                        >
                          <option value="">Unassigned</option>
                          {employees.map(p => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        <select
                          className="select w-full"
                          value={item.assignment?.shiftMode ?? "standard"}
                          onChange={e => onModeChange(card.store.id, card.date, item.shift.key, e.target.value as Assignment["shiftMode"])}
                        >
                          <option value="standard">Standard</option>
                          <option value="double">Double</option>
                          <option value="other">Other</option>
                        </select>
                        {item.assignment?.shiftMode === "other" && (
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              type="time"
                              className="input"
                              value={item.assignment?.scheduledStart ?? ""}
                              onChange={e => onOtherTimeChange(card.store.id, card.date, item.shift.key, "start", e.target.value)}
                            />
                            <input
                              type="time"
                              className="input"
                              value={item.assignment?.scheduledEnd ?? ""}
                              onChange={e => onOtherTimeChange(card.store.id, card.date, item.shift.key, "end", e.target.value)}
                            />
                          </div>
                        )}
                        <div className="text-xs muted flex items-center justify-between">
                          <span>
                            {item.startAt && item.endAt
                              ? `${formatTimeLabel(item.startAt)} - ${formatTimeLabel(item.endAt)}`
                              : "Template missing"}
                          </span>
                          {item.hours > 0 && <span>{item.hours.toFixed(2)} hrs</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {visibleCards.length === 0 && (
          <div className="card card-pad text-sm muted">No issue cards found. Toggle off issues filter to view all cards.</div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-white/20 bg-[#0f1115]/95 backdrop-blur p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="grid grid-cols-2 gap-2 mb-2">
          <button className="btn-secondary px-3 py-2 disabled:opacity-50" onClick={jumpToNextIncomplete} disabled={!allIncompleteByOrder.length}>
            Next incomplete
          </button>
          <button className="btn-secondary px-3 py-2 disabled:opacity-50" onClick={jumpToIssues} disabled={!cards.some(card => card.issueKeys.length > 0)}>
            Jump to issues
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button className="btn-secondary px-3 py-2" onClick={onSaveDraft} disabled={saving}>
            {saving ? "Saving..." : "Save Draft"}
          </button>
          <button className="btn-primary px-3 py-2" onClick={onPublish} disabled={saving}>
            Publish
          </button>
          <button className="btn-secondary px-3 py-2" onClick={onJumpTotals}>
            Totals/Review
          </button>
        </div>
        <div className="mt-2 text-xs muted flex items-center justify-between">
          <span>{issuesOnly ? "Issues filter: On" : "Issues filter: Off"}</span>
          {issuesOnly && (
            <button className="underline" onClick={() => setIssuesOnly(false)}>
              Show all
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

