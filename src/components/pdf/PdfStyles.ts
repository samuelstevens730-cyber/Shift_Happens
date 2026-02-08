import { Font, StyleSheet } from "@react-pdf/renderer";

Font.registerHyphenationCallback(word => [word]);

export const pdfStyles = StyleSheet.create({
  pageLandscape: {
    paddingTop: 16,
    paddingBottom: 16,
    paddingHorizontal: 18,
    fontSize: 8,
    fontFamily: "Helvetica",
    color: "#111827",
  },
  pagePortrait: {
    paddingTop: 20,
    paddingBottom: 20,
    paddingHorizontal: 22,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#111827",
  },
  title: {
    fontSize: 12,
    fontWeight: 700,
    marginBottom: 2,
    textTransform: "uppercase",
  },
  subtitle: {
    fontSize: 8,
    color: "#374151",
    marginBottom: 1,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 700,
    marginBottom: 6,
  },
  table: {
    borderWidth: 1,
    borderColor: "#9CA3AF",
    borderStyle: "solid",
  },
  tableRow: {
    flexDirection: "row",
  },
  th: {
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#9CA3AF",
    backgroundColor: "#F3F4F6",
    paddingVertical: 3,
    paddingHorizontal: 4,
    fontWeight: 700,
  },
  td: {
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#D1D5DB",
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  footerBlock: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    padding: 6,
  },
});

