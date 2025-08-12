"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function ResetPasswordPage() {
  const router = useRouter();
  const q = useSearchParams();

  const [pending, setPending] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [pw1, setPw1]       = useState("");
  const [pw2, setPw2]       = useState("");
  const [saving, setSaving] = useState(false);

  // Supabase sends ?code=... on password recovery; exchange for a session first
  useEffect(() => {
    (async () => {
      const code = q.get("code");
      if (!code) { setError("Missing reset code."); setPending(false); return; }
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) { setError(error.message); setPending(false); return; }
      setPending(false);
    })();
  }, [q]);

  async function submit() {
    setError(null);
    if (pw1.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (pw1 !== pw2)    { setError("Passwords do not match."); return; }

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pw1 });
    setSaving(false);
    if (error) { setError(error.message); return; }

    router.replace("/login"); // or wherever you land post-reset
  }

  if (pending) return <div className="p-6">Checking your link…</div>;

  return (
    <div className="min-h-screen p-6 grid place-items-center">
      <div className="w-full max-w-sm border rounded-2xl p-4 space-y-3">
        <h1 className="text-xl font-semibold">Set a new password</h1>
        {error && <div className="text-sm text-red-600 border border-red-300 rounded p-3">{error}</div>}

        <label className="text-sm">New password</label>
        <input type="password" className="w-full border rounded p-2"
               value={pw1} onChange={e => setPw1(e.target.value)} />

        <label className="text-sm">Confirm password</label>
        <input type="password" className="w-full border rounded p-2"
               value={pw2} onChange={e => setPw2(e.target.value)} />

        <button disabled={saving}
                onClick={submit}
                className="w-full rounded bg-black text-white py-2 disabled:opacity-50">
          {saving ? "Saving…" : "Update password"}
        </button>
      </div>
    </div>
  );
}
