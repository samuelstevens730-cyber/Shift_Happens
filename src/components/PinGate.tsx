/**
 * PIN Gate - reusable employee PIN modal
 *
 * Ensures employees authenticate with PIN before accessing employee flows.
 * Locks selected store/employee after successful auth.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabaseClient";

type Store = { id: string; name: string };
type Profile = { id: string; name: string; active: boolean | null };

const PIN_TOKEN_KEY = "sh_pin_token";
const PIN_STORE_KEY = "sh_pin_store_id";
const PIN_PROFILE_KEY = "sh_pin_profile_id";

type PinGateProps = {
  loading: boolean;
  stores: Store[];
  profiles: Profile[];
  qrToken: string;
  tokenStore: Store | null;
  storeId: string;
  setStoreId: (id: string) => void;
  profileId: string;
  setProfileId: (id: string) => void;
  onLockChange?: (locked: boolean) => void;
  onAuthorized?: (token: string) => void;
  onClose?: () => void; // Optional close callback for modal usage
};

export default function PinGate({
  loading,
  stores,
  profiles,
  qrToken,
  tokenStore,
  storeId,
  setStoreId,
  profileId,
  setProfileId,
  onLockChange,
  onAuthorized,
  onClose,
}: PinGateProps) {
  const [pinToken, setPinToken] = useState<string | null>(null);
  const [pinStoreId, setPinStoreId] = useState<string | null>(null);
  const [pinProfileId, setPinProfileId] = useState<string | null>(null);
  const [pinModalOpen, setPinModalOpen] = useState(true);
  const [managerSession, setManagerSession] = useState(false);
  const [pinLockedSelection, setPinLockedSelection] = useState(false);
  const [pinValue, setPinValue] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinLoading, setPinLoading] = useState(false);
  const [pinShake, setPinShake] = useState(false);
  const pinInputRef = useRef<HTMLInputElement | null>(null);

  const activeStoreId = tokenStore?.id ?? storeId ?? "";

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedToken = sessionStorage.getItem(PIN_TOKEN_KEY);
    const storedStore = sessionStorage.getItem(PIN_STORE_KEY);
    const storedProfile = sessionStorage.getItem(PIN_PROFILE_KEY);
    if (storedToken && storedStore && storedProfile) {
      setPinToken(storedToken);
      setPinStoreId(storedStore);
      setPinProfileId(storedProfile);
      setPinLockedSelection(true);
      setStoreId(storedStore);
      setProfileId(storedProfile);
      setPinModalOpen(false);
      onLockChange?.(true);
      onAuthorized?.(storedToken);
    }
  }, [setStoreId, setProfileId, onLockChange, onAuthorized]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      setManagerSession(Boolean(data?.session?.user));
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setManagerSession(Boolean(session?.user));
    });

    return () => {
      alive = false;
      sub?.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (managerSession) {
      setPinModalOpen(false);
      return;
    }
    if (loading) {
      setPinModalOpen(true);
      return;
    }
    if (!pinToken || !pinStoreId || !pinProfileId || pinStoreId !== activeStoreId) {
      setPinModalOpen(true);
    } else {
      setPinModalOpen(false);
    }
  }, [activeStoreId, pinToken, pinStoreId, pinProfileId, managerSession, loading]);

  useEffect(() => {
    onLockChange?.(pinLockedSelection);
  }, [pinLockedSelection, onLockChange]);

  useEffect(() => {
    if (!pinModalOpen) return;
    setPinValue("");
    setPinError(null);
    setTimeout(() => pinInputRef.current?.focus(), 0);
  }, [pinModalOpen]);

  if (!pinModalOpen || managerSession || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/70 p-4">
      <div className={`card card-pad w-full max-w-md space-y-4 ${pinShake ? "shake" : ""}`}>
        <div className="flex items-center justify-between">
          {onClose && (
            <button
              onClick={onClose}
              className="text-sm muted hover:text-[var(--text)] transition-colors"
              type="button"
            >
              ← Back
            </button>
          )}
          <div className="text-lg font-semibold text-center flex-1">Employee PIN</div>
          {onClose && <div className="w-10" />} {/* Spacer for centering */}
        </div>
        <div className="text-xs muted text-center">Enter your 4-digit PIN to continue.</div>

        {!qrToken && (
          <div className="space-y-2">
            <label className="text-sm muted">Store</label>
            <select
              className="select"
              value={storeId}
              onChange={e => setStoreId(e.target.value)}
              disabled={pinLoading || pinLockedSelection || loading}
            >
              {stores.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {qrToken && tokenStore && (
          <div className="text-xs muted text-center">
            Token store: <b>{tokenStore.name}</b>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-sm muted">Employee</label>
          <select
            className="select"
            value={profileId}
            onChange={e => setProfileId(e.target.value)}
            disabled={pinLoading || pinLockedSelection || loading}
          >
            {profiles.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {loading && <div className="text-xs muted text-center">Loading stores and employees…</div>}

        <div className="space-y-3">
          <button
            type="button"
            className="flex w-full items-center justify-center gap-3"
            onClick={() => pinInputRef.current?.focus()}
          >
            {Array.from({ length: 4 }).map((_, idx) => {
              const filled = pinValue[idx] ?? "";
              return (
                <div
                  key={idx}
                  className={`h-12 w-12 rounded-xl border text-center text-xl font-semibold ${
                    filled ? "border-[rgba(32,240,138,0.6)] bg-[rgba(32,240,138,0.15)]" : "border-white/20"
                  }`}
                >
                  {filled ? "•" : ""}
                </div>
              );
            })}
          </button>
          <input
            ref={pinInputRef}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            autoFocus
            className="sr-only"
            value={pinValue}
            onChange={e => {
              const next = e.target.value.replace(/\D/g, "").slice(0, 4);
              setPinValue(next);
            }}
          />
        </div>

        {pinError && <div className="banner banner-error text-sm text-center">{pinError}</div>}

        <button
          className="btn-primary w-full py-2 text-sm disabled:opacity-50"
          disabled={pinLoading || pinValue.length !== 4 || !activeStoreId || !profileId || loading}
          onClick={async () => {
            if (!activeStoreId) {
              setPinError("Select a store to continue.");
              return;
            }
            if (!profileId) {
              setPinError("Select your name to continue.");
              return;
            }
            setPinLoading(true);
            setPinError(null);
            try {
              const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/employee-auth`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
                },
                body: JSON.stringify({ store_id: activeStoreId, profile_id: profileId, pin: pinValue }),
              });
              const json = await res.json();
              if (!res.ok) {
                if (res.status === 403 && json?.error) {
                  setPinError("PIN auth not enabled for this store.");
                } else if (res.status === 429) {
                  const mins = json?.retry_after_minutes || json?.locked_for_minutes || 5;
                  setPinError(`Account locked. Try in ${mins} minutes.`);
                } else if (res.status === 401 && json?.attempts_remaining === 1) {
                  setPinError("Invalid PIN. You have 1 more try before lockout.");
                } else {
                  setPinError("Invalid PIN.");
                }
                setPinValue("");
                setPinShake(true);
                setTimeout(() => setPinShake(false), 400);
                return;
              }
              const token = json?.token as string | undefined;
              if (!token) {
                setPinError("Authentication failed.");
                setPinValue("");
                setPinShake(true);
                setTimeout(() => setPinShake(false), 400);
                return;
              }
              setPinToken(token);
              setPinStoreId(activeStoreId);
              setPinProfileId(profileId);
              setPinLockedSelection(true);
              if (typeof window !== "undefined") {
                sessionStorage.setItem(PIN_TOKEN_KEY, token);
                sessionStorage.setItem(PIN_STORE_KEY, activeStoreId);
                sessionStorage.setItem(PIN_PROFILE_KEY, profileId);
              }
              setStoreId(activeStoreId);
              setProfileId(profileId);
              onAuthorized?.(token);
              setPinModalOpen(false);
            } catch {
              setPinError("Authentication failed.");
              setPinValue("");
              setPinShake(true);
              setTimeout(() => setPinShake(false), 400);
            } finally {
              setPinLoading(false);
            }
          }}
        >
          {pinLoading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/40 border-t-black" />
              Verifying...
            </span>
          ) : (
            "Enter"
          )}
        </button>
      </div>
    </div>,
    document.body
  );
}
