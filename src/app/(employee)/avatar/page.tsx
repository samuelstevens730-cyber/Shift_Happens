"use client";

import Link from "next/link";
import AvatarStudio from "@/components/avatar/AvatarStudio";

export default function AvatarPage() {
  return (
    <div className="app-shell">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold">Character Creator</h1>
          <Link href="/scoreboard" className="btn-secondary px-3 py-1.5">
            Back to Rankings
          </Link>
        </div>
        <AvatarStudio />
      </div>
    </div>
  );
}
