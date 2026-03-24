"use client";

import { useState, useEffect } from "react";
import { Send } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Store = { id: string; name: string };
type User = { id: string; name: string; active: boolean; storeIds: string[] };

type Props = {
  open: boolean;
  onClose: () => void;
  stores: Store[];
  users: User[];
};

export default function QuickSendModal({ open, onClose, stores, users }: Props) {
  const [type, setType] = useState<"message" | "task">("message");
  const [targetType, setTargetType] = useState<"store" | "employee">("store");
  const [targetStoreId, setTargetStoreId] = useState(stores[0]?.id ?? "");
  const [targetProfileId, setTargetProfileId] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const activeUsers = users.filter((u) => u.active);

  useEffect(() => {
    if (!open) {
      setType("message");
      setTargetType("store");
      setTargetStoreId(stores[0]?.id ?? "");
      setTargetProfileId("");
      setMessage("");
      setError(null);
      setSent(false);
    }
  }, [open, stores]);

  async function handleSend() {
    if (!message.trim()) { setError("Message is required."); return; }
    if (targetType === "store" && !targetStoreId) { setError("Select a store."); return; }
    if (targetType === "employee" && !targetProfileId) { setError("Select an employee."); return; }

    try {
      setSending(true);
      setError(null);
      const { data: auth } = await supabase.auth.getSession();
      const token = auth.session?.access_token ?? "";
      if (!token) { setError("Not authenticated."); return; }

      const res = await fetch("/api/admin/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          type,
          message: message.trim(),
          targetStoreId: targetType === "store" ? targetStoreId : undefined,
          targetProfileId: targetType === "employee" ? targetProfileId : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to send.");

      setMessage("");
      setSent(true);
      setTimeout(() => { setSent(false); onClose(); }, 1500);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to send.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="bg-[var(--card)] border-white/8 text-[var(--text)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-[family-name:var(--font-display)] text-xl font-bold uppercase tracking-tight">
            Quick Send
          </DialogTitle>
        </DialogHeader>

        {sent ? (
          <div className="py-6 text-center text-[var(--green)] font-semibold">Sent ✓</div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1 text-sm text-[var(--muted)]">
                <span>Type</span>
                <Select value={type} onValueChange={(v) => setType(v as "message" | "task")}>
                  <SelectTrigger className="input"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="message">Message</SelectItem>
                    <SelectItem value="task">Task</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1 text-sm text-[var(--muted)]">
                <span>Target</span>
                <Select value={targetType} onValueChange={(v) => setTargetType(v as "store" | "employee")}>
                  <SelectTrigger className="input"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="store">Store</SelectItem>
                    <SelectItem value="employee">Employee</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {targetType === "store" ? (
              <div className="flex flex-col gap-1 text-sm text-[var(--muted)]">
                <span>Store</span>
                <Select value={targetStoreId} onValueChange={setTargetStoreId}>
                  <SelectTrigger className="input"><SelectValue placeholder="Select store" /></SelectTrigger>
                  <SelectContent>
                    {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="flex flex-col gap-1 text-sm text-[var(--muted)]">
                <span>Employee</span>
                <Select value={targetProfileId} onValueChange={setTargetProfileId}>
                  <SelectTrigger className="input"><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>
                    {activeUsers.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex flex-col gap-1 text-sm text-[var(--muted)]">
              <span>Message / Task Details</span>
              <textarea
                className="textarea min-h-[80px] w-full"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type what should be done or communicated..."
              />
            </div>

            {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

            <div className="flex justify-end">
              <button
                className="btn-secondary inline-flex items-center gap-2 px-4 py-2 text-sm"
                onClick={() => void handleSend()}
                disabled={sending}
              >
                <Send className="h-4 w-4" />
                {sending ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
