import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen p-6">
      <div className="max-w-md mx-auto space-y-4">
        <h1 className="text-2xl font-semibold">Shift Happens</h1>
        <div className="flex gap-4">
          <Link href="/clock" className="flex-1 text-center rounded bg-black text-white py-2">
            Clock
          </Link>
          <Link href="/admin" className="flex-1 text-center rounded border py-2">
            Admin
          </Link>
        </div>
      </div>
    </div>
  );
}
