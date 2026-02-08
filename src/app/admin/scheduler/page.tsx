/**
 * Schedule Builder - Manager UI
 */
"use client";

import ScheduleCardsMobile from "./ScheduleCardsMobile";
import ScheduleGridDesktop from "./ScheduleGridDesktop";
import { useSchedulerState } from "./useSchedulerState";

export default function AdminSchedulerPage() {
  const {
    loading,
    isAuthed,
    error,
    setError,
    info,
    setInfo,
    month,
    setMonth,
    half,
    setHalf,
    stores,
    templates,
    memberships,
    assignments,
    saving,
    periodStart,
    periodEnd,
    dates,
    scheduleMap,
    employeesByStore,
    templateLookup,
    totals,
    weeklyWarnings,
    conflicts,
    conflictKeys,
    unassignedKeys,
    handleEmployeeChange,
    handleModeChange,
    handleOtherTimeChange,
    ensureSchedules,
    saveDraft,
    publishSchedules,
  } = useSchedulerState();

  function jumpToTotals() {
    document.getElementById("totals-review")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (loading) return <div className="app-shell">Loading...</div>;
  if (!isAuthed) return null;

  return (
    <div className="app-shell">
      <div className="max-w-6xl mx-auto space-y-6 pb-[12.5rem] md:pb-0">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Scheduler</h1>
          <div className="text-xs muted">Admin</div>
        </div>

        {error && (
          <div className="banner banner-error text-sm flex items-center justify-between gap-3">
            <span>{error}</span>
            <button className="underline" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}
        {info && (
          <div className="banner banner-warning text-sm flex items-center justify-between gap-3">
            <span>{info}</span>
            <button className="underline" onClick={() => setInfo(null)}>
              Dismiss
            </button>
          </div>
        )}
        {!error && stores.length > 0 && templates.length === 0 && (
          <div className="banner banner-warning text-sm">
            Templates not found. Run the scheduler template seed (shift_templates) before scheduling.
          </div>
        )}

        {conflicts.length > 0 && (
          <div className="banner banner-error text-sm">
            <div className="font-semibold">Double-booking detected</div>
            <ul className="list-disc pl-5">
              {conflicts.map(item => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {weeklyWarnings.length > 0 && (
          <div className="banner text-sm">
            <div className="font-semibold">40+ hour warnings</div>
            <ul className="list-disc pl-5">
              {weeklyWarnings.map(item => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="card card-pad grid gap-4 sm:grid-cols-4 items-end">
          <div>
            <label className="text-sm muted">Month</label>
            <input type="month" className="input" value={month} onChange={e => setMonth(e.target.value)} />
          </div>
          <div>
            <label className="text-sm muted">Pay period</label>
            <select className="select" value={half} onChange={e => setHalf(e.target.value as "first" | "second")}> 
              <option value="first">1st-15th</option>
              <option value="second">16th-EOM</option>
            </select>
          </div>
          <div className="text-sm muted">
            {periodStart} to {periodEnd}
            <div className="text-xs muted">Times shown in CST.</div>
          </div>
          <div className="flex gap-2 justify-end flex-wrap">
            <button className="btn-secondary px-4 py-2" onClick={() => void ensureSchedules()}>
              Create/Load
            </button>
            <div className="hidden md:flex gap-2">
              <button className="btn-primary px-4 py-2 disabled:opacity-50" onClick={saveDraft} disabled={saving}>
                {saving ? "Saving..." : "Save Draft"}
              </button>
              <button className="btn-primary px-4 py-2 disabled:opacity-50" onClick={publishSchedules} disabled={saving}>
                Publish
              </button>
            </div>
          </div>
        </div>

        <ScheduleGridDesktop
          stores={stores}
          dates={dates}
          assignments={assignments}
          employeesByStore={employeesByStore}
          templateLookup={templateLookup}
          onEmployeeChange={handleEmployeeChange}
          onModeChange={handleModeChange}
          onOtherTimeChange={handleOtherTimeChange}
        />

        <ScheduleCardsMobile
          stores={stores}
          dates={dates}
          assignments={assignments}
          scheduleMap={scheduleMap}
          employeesByStore={employeesByStore}
          templateLookup={templateLookup}
          unassignedKeys={unassignedKeys}
          conflictKeys={conflictKeys}
          saving={saving}
          onEmployeeChange={handleEmployeeChange}
          onModeChange={handleModeChange}
          onOtherTimeChange={handleOtherTimeChange}
          onSaveDraft={saveDraft}
          onPublish={publishSchedules}
          onJumpTotals={jumpToTotals}
        />

        <div id="totals-review" className="card card-pad grid gap-3 sm:grid-cols-3 scroll-mt-24">
          <div>
            <div className="text-sm font-medium">Total hours by store</div>
            <div className="text-sm muted space-y-1">
              {stores.map(s => (
                <div key={s.id} className="flex items-center justify-between">
                  <span>{s.name}</span>
                  <span>{(totals.byStore[s.id] ?? 0).toFixed(2)} hrs</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-sm font-medium">Total hours by employee</div>
            <div className="text-sm muted space-y-1 max-h-48 overflow-auto">
              {Object.entries(totals.byEmployee).map(([profileId, hours]) => {
                const name = memberships.find(m => m.profile?.id === profileId)?.profile?.name ?? profileId.slice(0, 8);
                return (
                  <div key={profileId} className="flex items-center justify-between">
                    <span>{name}</span>
                    <span>{hours.toFixed(2)} hrs</span>
                  </div>
                );
              })}
              {!Object.keys(totals.byEmployee).length && <div>No assignments yet.</div>}
            </div>
          </div>
          <div>
            <div className="text-sm font-medium">Grand total</div>
            <div className="text-2xl font-semibold">{totals.grandTotal.toFixed(2)} hrs</div>
            <div className="text-xs muted">Overnight shifts handled (end &lt; start).</div>
          </div>
        </div>
      </div>
    </div>
  );
}
