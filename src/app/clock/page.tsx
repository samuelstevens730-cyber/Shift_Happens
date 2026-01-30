/**
 * Clock Page - Entry Point
 *
 * Server component wrapper for the clock-in flow.
 * Uses Suspense to handle useSearchParams() in the client component.
 * force-dynamic ensures QR token is always read fresh from URL.
 */

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
