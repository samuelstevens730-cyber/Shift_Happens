"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { pdf } from "@react-pdf/renderer";
import type { Assignment, MembershipRow, Store, TemplateRow } from "@/app/admin/scheduler/useSchedulerState";
import { applyPreferredColorOverrides, buildEmployeeColorClassMap } from "@/lib/employeeColors";
import GridSchedulePDF from "./GridSchedulePDF";
import IndividualSchedulePDF from "./IndividualSchedulePDF";
import { buildProfileInfo } from "./pdfData";

type Props = {
  stores: Store[];
  dates: string[];
  assignments: Record<string, Assignment>;
  templates: TemplateRow[];
  memberships: MembershipRow[];
  periodStart: string;
  periodEnd: string;
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function ExportScheduleButton(props: Props) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState<"grid" | "individual" | null>(null);

  const profiles = useMemo(() => buildProfileInfo(props.memberships), [props.memberships]);
  const profilesById = useMemo(
    () => Object.fromEntries(profiles.map(profile => [profile.id, profile])),
    [profiles]
  );
  const colorClassByProfileId = useMemo(() => {
    const ids = profiles.map(profile => profile.id);
    const baseMap = buildEmployeeColorClassMap(ids);
    const named = profiles.map(profile => ({ id: profile.id, name: profile.name }));
    return applyPreferredColorOverrides(baseMap, named);
  }, [profiles]);

  async function exportGrid() {
    setExporting("grid");
    try {
      const blob = await pdf(
        <GridSchedulePDF
          stores={props.stores}
          dates={props.dates}
          assignments={props.assignments}
          templates={props.templates}
          profilesById={profilesById}
          colorClassByProfileId={colorClassByProfileId}
          periodStart={props.periodStart}
          periodEnd={props.periodEnd}
        />
      ).toBlob();
      downloadBlob(blob, `schedule-grid-${props.periodStart}_to_${props.periodEnd}.pdf`);
      setOpen(false);
    } finally {
      setExporting(null);
    }
  }

  async function exportIndividual() {
    setExporting("individual");
    try {
      const blob = await pdf(
        <IndividualSchedulePDF
          stores={props.stores}
          dates={props.dates}
          assignments={props.assignments}
          templates={props.templates}
          profiles={profiles}
          periodStart={props.periodStart}
          periodEnd={props.periodEnd}
        />
      ).toBlob();
      downloadBlob(blob, `schedule-individual-${props.periodStart}_to_${props.periodEnd}.pdf`);
      setOpen(false);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="relative">
      <button
        className="btn-secondary px-4 py-2 inline-flex items-center gap-2"
        onClick={() => setOpen(prev => !prev)}
        disabled={!props.stores.length || !props.dates.length || exporting !== null}
      >
        <Download className="h-4 w-4" />
        Export PDF
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 rounded-md border border-white/15 bg-[#111827] shadow-lg z-40 p-2 space-y-2">
          <button
            className="btn-secondary w-full px-3 py-2 text-left disabled:opacity-50"
            disabled={exporting !== null}
            onClick={() => void exportGrid()}
          >
            {exporting === "grid" ? "Generating..." : "Grid Schedule PDF"}
          </button>
          <button
            className="btn-secondary w-full px-3 py-2 text-left disabled:opacity-50"
            disabled={exporting !== null}
            onClick={() => void exportIndividual()}
          >
            {exporting === "individual" ? "Generating..." : "Individual Schedule PDF"}
          </button>
        </div>
      )}
    </div>
  );
}

