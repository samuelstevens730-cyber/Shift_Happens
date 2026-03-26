import { redirect } from "next/navigation";

export default async function ShiftsRedirect({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(resolvedSearchParams)) {
    if (Array.isArray(value)) {
      value.forEach(v => params.append(key, v));
    } else if (value) {
      params.set(key, value);
    }
  }
  const qs = params.toString();
  redirect(qs ? `/dashboard/shifts?${qs}` : "/dashboard/shifts");
}
