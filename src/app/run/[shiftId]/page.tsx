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
  const paramsOut = new URLSearchParams();
  if (token) paramsOut.set("t", token);
  if (sp?.reused) paramsOut.set("reused", sp.reused);
  if (sp?.startedAt) paramsOut.set("startedAt", sp.startedAt);
  const qs = paramsOut.toString() ? `?${paramsOut.toString()}` : "";

  redirect(`/shift/${shiftId}${qs}`);
}
