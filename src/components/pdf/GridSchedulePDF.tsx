"use client";

import { Document, Page, Text, View } from "@react-pdf/renderer";
import { format, parseISO } from "date-fns";
import type { Assignment, Store, TemplateRow } from "@/app/admin/scheduler/useSchedulerState";
import { pdfStyles } from "./PdfStyles";
import {
  GridRow,
  ProfileInfo,
  buildEmployeeStoreTotals,
  buildGridRows,
  monthLabel,
  periodLabel,
} from "./pdfData";

type Props = {
  stores: Store[];
  dates: string[];
  assignments: Record<string, Assignment>;
  templates: TemplateRow[];
  profilesById: Record<string, ProfileInfo>;
  colorClassByProfileId: Record<string, string>;
  periodStart: string;
  periodEnd: string;
};

function renderGridTable(rows: GridRow[], dates: string[]) {
  const leftWidth = 72;
  const dateWidth = Math.max(34, Math.floor((785 - leftWidth) / Math.max(dates.length, 1)));

  return (
    <View style={pdfStyles.table}>
      <View style={pdfStyles.tableRow}>
        <View style={[pdfStyles.th, { width: leftWidth }]}>
          <Text>Store / Shift</Text>
        </View>
        {dates.map(date => (
          <View key={`h-${date}`} style={[pdfStyles.th, { width: dateWidth, borderRightWidth: 0 }]}>
            <Text>{format(parseISO(date), "EEE M/d")}</Text>
          </View>
        ))}
      </View>
      {rows.map(row => (
        <View key={row.rowKey} style={pdfStyles.tableRow}>
          <View style={[pdfStyles.td, { width: leftWidth }]}>
            <Text>{row.storeName} {row.shiftLabel}</Text>
          </View>
          {row.cells.map(cell => (
            <View
              key={cell.key}
              style={[
                pdfStyles.td,
                {
                  width: dateWidth,
                  borderRightWidth: 0,
                  backgroundColor: cell.profileId ? cell.colorBackground : "#FFFFFF",
                  borderColor: cell.profileId ? cell.colorBorder : "#D1D5DB",
                },
              ]}
            >
              <Text style={{ color: cell.profileId ? cell.colorText : "#6B7280", fontSize: 7 }}>
                {cell.firstName}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

export default function GridSchedulePDF(props: Props) {
  const rows = buildGridRows({
    stores: props.stores,
    dates: props.dates,
    assignments: props.assignments,
    templates: props.templates,
    profilesById: props.profilesById,
    colorClassByProfileId: props.colorClassByProfileId,
  });

  const employeeStoreTotals = buildEmployeeStoreTotals(rows, props.profilesById);

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={pdfStyles.pageLandscape}>
        <Text style={pdfStyles.title}>NO CAP SMOKE SHOP LV 1&2 SCHEDULE</Text>
        <Text style={pdfStyles.subtitle}>{monthLabel(props.periodStart)}</Text>
        <Text style={pdfStyles.subtitle}>Pay Period: {periodLabel(props.periodStart, props.periodEnd)}</Text>

        <View style={{ marginTop: 8 }}>{renderGridTable(rows, props.dates)}</View>

        <View style={pdfStyles.footerBlock}>
          <Text style={pdfStyles.sectionTitle}>Employee Totals By Store</Text>
          {Object.entries(employeeStoreTotals).map(([profileId, byStore]) => {
            const profile = props.profilesById[profileId];
            const chunks = Object.entries(byStore).map(([storeName, hours]) => `${storeName}: ${hours.toFixed(2)}h`);
            return (
              <Text key={`emp-total-${profileId}`}>
                {profile?.name ?? profileId.slice(0, 8)} - {chunks.join(" | ")}
              </Text>
            );
          })}
        </View>
      </Page>
    </Document>
  );
}
