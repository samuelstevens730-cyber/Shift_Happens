"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Store = { id: string; name: string };
type UserRow = { id: string; name: string; active: boolean; storeIds: string[] };

type UsersResponse = { stores: Store[]; users: UserRow[] } | { error: string };
type SimpleResponse = { ok: true } | { error: string };

export default function UsersAdminPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAuthed, setIsAuthed] = useState(false);
  const [stores, setStores] = useState<Store[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);

  const [newName, setNewName] = useState("");
  const [newActive, setNewActive] = useState(true);
  const [newStoreIds, setNewStoreIds] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!alive) return;
        if (!user) {
          router.replace("/login?next=/admin/users");
          return;
        }
        setIsAuthed(true);
      } catch (e: unknown) {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [router]);

  const loadUsers = async () => {
    setError(null);
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || "";
    if (!token) {
      router.replace("/login?next=/admin/users");
      return;
    }

    const res = await fetch("/api/admin/users", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json()) as UsersResponse;
    if (!res.ok || "error" in json) {
      setError("error" in json ? json.error : "Failed to load users.");
      return;
    }

    setStores(json.stores);
    setUsers(json.users);
    setNewStoreIds(prev => {
      const next = { ...prev };
      json.stores.forEach(s => {
        if (!(s.id in next)) next[s.id] = false;
      });
      return next;
    });
  };

  useEffect(() => {
    if (!isAuthed) return;
    void loadUsers();
  }, [isAuthed]);

  const storeIdToName = useMemo(() => {
    const map = new Map<string, string>();
    stores.forEach(s => map.set(s.id, s.name));
    return map;
  }, [stores]);

  const newSelectedStoreIds = useMemo(() => {
    return Object.entries(newStoreIds).filter(([, v]) => v).map(([id]) => id);
  }, [newStoreIds]);

  const canCreate = newName.trim().length > 0 && newSelectedStoreIds.length > 0 && !saving;

  async function createUser() {
    if (!canCreate) return;
    setSaving(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      if (!token) {
        router.replace("/login?next=/admin/users");
        return;
      }

      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: newName.trim(),
          active: newActive,
          storeIds: newSelectedStoreIds,
        }),
      });
      const json = (await res.json()) as SimpleResponse;
      if (!res.ok || "error" in json) {
        setError("error" in json ? json.error : "Failed to create user.");
        return;
      }

      setNewName("");
      setNewActive(true);
      setNewStoreIds(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(k => { next[k] = false; });
        return next;
      });
      await loadUsers();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create user.");
    } finally {
      setSaving(false);
    }
  }

  async function updateUser(user: UserRow, storeIds: string[]) {
    setSaving(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      if (!token) {
        router.replace("/login?next=/admin/users");
        return;
      }

      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: user.name.trim(),
          active: user.active,
          storeIds,
        }),
      });
      const json = (await res.json()) as SimpleResponse;
      if (!res.ok || "error" in json) {
        setError("error" in json ? json.error : "Failed to update user.");
        return;
      }
      await loadUsers();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update user.");
    } finally {
      setSaving(false);
    }
  }

  async function deactivateUser(userId: string) {
    setSaving(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      if (!token) {
        router.replace("/login?next=/admin/users");
        return;
      }

      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json()) as SimpleResponse;
      if (!res.ok || "error" in json) {
        setError("error" in json ? json.error : "Failed to deactivate user.");
        return;
      }
      await loadUsers();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to deactivate user.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="app-shell">Loading...</div>;
  if (!isAuthed) return null;

  return (
    <div className="app-shell">
      <div className="max-w-5xl mx-auto space-y-6">
        <h1 className="text-2xl font-semibold">Users</h1>

        {error && <div className="banner banner-error text-sm">{error}</div>}

        <div className="card card-pad space-y-4">
          <div className="text-lg font-medium">Add employee</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm muted">Name</label>
              <input className="input" value={newName} onChange={e => setNewName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm muted">Active</label>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={newActive}
                  onChange={e => setNewActive(e.target.checked)}
                />
                <span className="text-sm">{newActive ? "Active" : "Inactive"}</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm muted">Stores (select at least one)</label>
            <div className="grid gap-2 sm:grid-cols-2">
              {stores.map(s => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(newStoreIds[s.id])}
                    onChange={e => setNewStoreIds(prev => ({ ...prev, [s.id]: e.target.checked }))}
                  />
                  {s.name}
                </label>
              ))}
            </div>
          </div>

          <button
            className="btn-primary px-4 py-2 disabled:opacity-50"
            onClick={createUser}
            disabled={!canCreate}
          >
            Add Employee
          </button>
        </div>

        <div className="space-y-3">
          {users.map(u => (
            <UserCard
              key={u.id}
              user={u}
              stores={stores}
              storeIdToName={storeIdToName}
              onSave={updateUser}
              onDeactivate={deactivateUser}
              saving={saving}
            />
          ))}

          {!users.length && (
            <div className="card card-pad text-center text-sm muted">
              No employees found for your stores.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function UserCard({
  user,
  stores,
  storeIdToName,
  onSave,
  onDeactivate,
  saving,
}: {
  user: UserRow;
  stores: Store[];
  storeIdToName: Map<string, string>;
  onSave: (user: UserRow, storeIds: string[]) => void;
  onDeactivate: (userId: string) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(user.name);
  const [active, setActive] = useState(user.active);
  const [storeIds, setStoreIds] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    stores.forEach(s => { map[s.id] = user.storeIds.includes(s.id); });
    return map;
  });

  useEffect(() => {
    setName(user.name);
    setActive(user.active);
    setStoreIds(() => {
      const map: Record<string, boolean> = {};
      stores.forEach(s => { map[s.id] = user.storeIds.includes(s.id); });
      return map;
    });
  }, [user, stores]);

  const selectedStoreIds = useMemo(() => {
    return Object.entries(storeIds).filter(([, v]) => v).map(([id]) => id);
  }, [storeIds]);

  const canSave = name.trim().length > 0 && selectedStoreIds.length > 0 && !saving;

  return (
    <div className="card card-pad space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm muted">
          ID: <span className="muted">{user.id.slice(0, 8)}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className={active ? "text-[var(--green)]" : "text-[var(--danger)]"}>
            {active ? "Active" : "Inactive"}
          </span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm muted">Name</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <label className="text-sm muted">Active</label>
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
            <span className="text-sm">{active ? "Active" : "Inactive"}</span>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm muted">Stores</label>
        <div className="grid gap-2 sm:grid-cols-2">
          {stores.map(s => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(storeIds[s.id])}
                onChange={e => setStoreIds(prev => ({ ...prev, [s.id]: e.target.checked }))}
              />
              {storeIdToName.get(s.id) ?? s.name}
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          className="btn-primary px-4 py-2 disabled:opacity-50"
          onClick={() => onSave({ ...user, name, active }, selectedStoreIds)}
          disabled={!canSave}
        >
          Save Changes
        </button>
        <button
          className="btn-secondary px-4 py-2 disabled:opacity-50"
          onClick={() => onDeactivate(user.id)}
          disabled={saving || !user.active}
        >
          Deactivate
        </button>
      </div>
    </div>
  );
}
