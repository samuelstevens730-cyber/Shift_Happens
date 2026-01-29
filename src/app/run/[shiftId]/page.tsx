import { redirect } from "next/navigation";

export default async function RunShiftPage({
  params,
  searchParams,
}: {
  params: Promise<{ shiftId: string }>;
  searchParams?: Promise<{ t?: string }>;
}) {
  const { shiftId } = await params;
  const sp = searchParams ? await searchParams : undefined;
  const token = sp?.t ?? "";
  const qs = token ? `?t=${encodeURIComponent(token)}` : "";

  redirect(`/shift/${shiftId}${qs}`);
}
