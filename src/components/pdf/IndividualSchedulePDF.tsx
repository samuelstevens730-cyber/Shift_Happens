"use client";

import { Document, Page, Text, View } from "@react-pdf/renderer";
import type { Assignment, Store, TemplateRow } from "@/app/admin/scheduler/useSchedulerState";
import { pdfStyles } from "./PdfStyles";
import { ProfileInfo, buildEmployeeSections, monthLabel, periodLabel } from "./pdfData";

type Props = {
  stores: Store[];
  dates: string[];
  assignments: Record<string, Assignment>;
  templates: TemplateRow[];
  profiles: ProfileInfo[];
  periodStart: string;
  periodEnd: string;
};

export default function IndividualSchedulePDF(props: Props) {
  const sections = buildEmployeeSections({
    stores: props.stores,
    dates: props.dates,
    assignments: props.assignments,
    templates: props.templates,
    profiles: props.profiles,
  });

  return (
    <Document>
      {sections.map(section => (
        <Page key={section.profileId} size="A4" style={pdfStyles.pagePortrait}>
          <Text style={pdfStyles.title}>NO CAP SMOKE SHOP SCHEDULE</Text>
          <Text style={pdfStyles.subtitle}>Employee: {section.name}</Text>
          <Text style={pdfStyles.subtitle}>{monthLabel(props.periodStart)}</Text>
          <Text style={pdfStyles.subtitle}>Pay Period: {periodLabel(props.periodStart, props.periodEnd)}</Text>

          <View style={[pdfStyles.table, { marginTop: 8 }]}>
            <View style={pdfStyles.tableRow}>
              <View style={[pdfStyles.th, { width: 150 }]}><Text>DATE</Text></View>
              <View style={[pdfStyles.th, { width: 110 }]}><Text>TIME IN</Text></View>
              <View style={[pdfStyles.th, { width: 110 }]}><Text>TIME OUT</Text></View>
              <View style={[pdfStyles.th, { width: 80, borderRightWidth: 0 }]}><Text>TOTAL HOURS</Text></View>
            </View>
            {section.rows.map(row => (
              <View key={`${section.profileId}-${row.date}`} style={pdfStyles.tableRow}>
                <View style={[pdfStyles.td, { width: 150 }]}><Text>{row.label}</Text></View>
                <View style={[pdfStyles.td, { width: 110 }]}><Text>{row.timeIn}</Text></View>
                <View style={[pdfStyles.td, { width: 110 }]}><Text>{row.timeOut}</Text></View>
                <View style={[pdfStyles.td, { width: 80, borderRightWidth: 0 }]}><Text>{row.totalHours.toFixed(2)}</Text></View>
              </View>
            ))}
          </View>

          <View style={pdfStyles.footerBlock}>
            <Text style={pdfStyles.sectionTitle}>TOTAL</Text>
            <Text>{section.totalHours.toFixed(2)} hours</Text>
          </View>
        </Page>
      ))}
    </Document>
  );
}

