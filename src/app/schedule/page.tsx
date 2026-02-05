import { redirect } from "next/navigation";

export default function ScheduleRedirect({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      value.forEach(v => params.append(key, v));
    } else if (value) {
      params.set(key, value);
    }
  }
  const qs = params.toString();
  redirect(qs ? `/dashboard/schedule?${qs}` : "/dashboard/schedule");
}
