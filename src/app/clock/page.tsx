import { Suspense } from "react";
import ClockPageClient from "./ClockPageClient";

export const dynamic = "force-dynamic";

export default function ClockPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading...</div>}>
      <ClockPageClient />
    </Suspense>
  );
}
