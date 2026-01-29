import { Suspense } from "react";
import ClockPageClient from "./ClockPageClient";

export const dynamic = "force-dynamic";

export default function ClockPage() {
  return (
    <Suspense fallback={<div className="app-shell">Loading...</div>}>
      <ClockPageClient />
    </Suspense>
  );
}
