export default function ShiftDonePage() {
  return (
    <div className="flex flex-col items-center justify-center h-screen text-center p-6">
      <h1 className="text-3xl font-bold mb-4">
        ✅ Thanks for another dope day in the No Cap Crew!
      </h1>
      <p className="text-lg mb-6">
        Your shift has been successfully closed. Time to kick back — you earned it.
      </p>
      <a
        href="/clock"
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        Back to Clock Page
      </a>
    </div>
  );
}
