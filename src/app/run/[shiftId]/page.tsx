/**
 * Run Shift Page - Redirect Handler
 *
 * Intermediate route that redirects to the actual shift page.
 * Preserves QR token and reuse indicators in the redirect.
 *
 * This exists to handle the clock-in flow where open/double shifts
 * initially route here before landing on the shift detail page.
 * Allows for future pre-shift logic if needed.
 */

import { redirect } from "next/navigation";

export default async function RunShiftPage({
  params,
  searchParams,
}: {
  params: Promise<{ shiftId: string }>;
  searchParams?: Promise<{ t?: string; reused?: string; startedAt?: string }>;
}) {
  const { shiftId } = await params;
  const sp = searchParams ? await searchParams : undefined;
  const token = sp?.t ?? "";
  // Build query string preserving all relevant params
  const paramsOut = new URLSearchParams();
  if (token) paramsOut.set("t", token);
  if (sp?.reused) paramsOut.set("reused", sp.reused);
  if (sp?.startedAt) paramsOut.set("startedAt", sp.startedAt);
  const qs = paramsOut.toString() ? `?${paramsOut.toString()}` : "";

  redirect(`/shift/${shiftId}${qs}`);
}
