"use client";
/**
 * Manage vehicle groups: create, rename, pick members, delete. The server re-checks the
 * permission and that every vehicle belongs to the organization.
 */
import { ArrowLeft, Plus, Trash2, Users } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Checkbox, Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import type { GroupDto } from "@/lib/vehicle-groups";

type VehicleOpt = { id: string; name: string; licensePlate: string | null };

export function GroupsDialog({ open, onOpenChange, groups, onChanged }: { open: boolean; onOpenChange: (o: boolean) => void; groups: GroupDto[]; onChanged: () => void }) {
  // null = the list of groups; "new" = creating; otherwise the group being edited.
  const [editing, setEditing] = useState<GroupDto | "new" | null>(null);
  const [vehicles, setVehicles] = useState<VehicleOpt[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<GroupDto | null>(null);

  useEffect(() => {
    if (!open) return;
    setEditing(null);
    setError(null);
    let live = true;
    api<{ vehicles: VehicleOpt[] }>("/api/vehicles")
      .then((r) => live && setVehicles(r.vehicles))
      .catch((e) => live && setLoadError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [open]);

  const start = (g: GroupDto | "new") => {
    setEditing(g);
    setName(g === "new" ? "" : g.name);
    setPicked(new Set(g === "new" ? [] : g.vehicleIds));
    setSearch("");
    setError(null);
  };

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (vehicles ?? []).filter((v) => !q || v.name.toLowerCase().includes(q) || (v.licensePlate ?? "").toLowerCase().includes(q));
  }, [vehicles, search]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const json = { name: name.trim(), vehicleIds: [...picked] };
      if (editing === "new") await api("/api/vehicle-groups", { method: "POST", json });
      else await api(`/api/vehicle-groups/${editing.id}`, { method: "PATCH", json });
      toast.success(editing === "new" ? "Group created." : "Group saved.");
      onChanged();
      setEditing(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
        <DialogContent
          title={editing === null ? "Vehicle groups" : editing === "new" ? "New group" : `Edit ${editing.name}`}
          description={editing === null ? "Group vehicles by region, customer or type, then filter the vehicle list, the map and reports by group." : "A vehicle can be in more than one group."}
        >
          {editing === null ? (
            <>
              {groups.length === 0 ? (
                <p className="m-0 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">No groups yet.</p>
              ) : (
                <ul className="m-0 max-h-80 list-none divide-y divide-border overflow-y-auto rounded-lg border border-border p-0">
                  {groups.map((g) => (
                    <li key={g.id} className="flex items-center gap-2 px-3 py-2">
                      <button type="button" className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left" onClick={() => start(g)}>
                        <span className="block truncate text-sm font-medium text-foreground">{g.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {g.vehicleIds.length} {g.vehicleIds.length === 1 ? "vehicle" : "vehicles"}
                        </span>
                      </button>
                      <Button variant="ghost" size="sm" onClick={() => start(g)}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" aria-label={`Delete ${g.name}`} onClick={() => setDeleting(g)}>
                        <Trash2 />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <DialogFooter>
                <Button variant="secondary" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
                <Button onClick={() => start("new")}>
                  <Plus /> New group
                </Button>
              </DialogFooter>
            </>
          ) : (
            <form method="post" onSubmit={save} className="grid gap-4">
              <Field id="vg-name" label="Group name" required>
                <Input id="vg-name" value={name} maxLength={60} required autoFocus onChange={(e) => setName(e.target.value)} />
              </Field>
              <fieldset className="m-0 grid gap-2 border-0 p-0">
                <legend className="mb-1 flex w-full items-center justify-between text-sm font-medium">
                  <span>Vehicles</span>
                  <span className="text-xs font-normal text-muted-foreground">{picked.size} selected</span>
                </legend>
                {loadError ? (
                  <Alert tone="danger">{loadError}</Alert>
                ) : vehicles === null ? (
                  <p className="m-0 text-sm text-muted-foreground">Loading vehicles…</p>
                ) : vehicles.length === 0 ? (
                  <p className="m-0 text-sm text-muted-foreground">Add vehicles first, then put them in groups.</p>
                ) : (
                  <>
                    {vehicles.length > 8 && <Input type="search" aria-label="Search vehicles" placeholder="Search vehicles…" value={search} onChange={(e) => setSearch(e.target.value)} />}
                    <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
                      {shown.length === 0 ? (
                        <p className="m-0 px-3 py-4 text-center text-sm text-muted-foreground">No vehicles match.</p>
                      ) : (
                        shown.map((v) => (
                          <label key={v.id} className="flex cursor-pointer items-center gap-2.5 border-b border-border px-3 py-2 text-sm last:border-b-0 hover:bg-muted/60">
                            <Checkbox
                              checked={picked.has(v.id)}
                              onChange={(e) => {
                                const next = new Set(picked);
                                if (e.target.checked) next.add(v.id);
                                else next.delete(v.id);
                                setPicked(next);
                              }}
                            />
                            <span className="min-w-0 flex-1 truncate">{v.name}</span>
                            {v.licensePlate && <span className="shrink-0 text-xs text-muted-foreground">{v.licensePlate}</span>}
                          </label>
                        ))
                      )}
                    </div>
                  </>
                )}
              </fieldset>
              {error && <Alert tone="danger">{error}</Alert>}
              <DialogFooter>
                <Button type="button" variant="ghost" disabled={busy} onClick={() => setEditing(null)}>
                  <ArrowLeft /> Back
                </Button>
                <Button type="submit" loading={busy} disabled={name.trim() === ""}>
                  <Users /> {editing === "new" ? "Create group" : "Save group"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete the group ${deleting?.name ?? ""}?`}
        description="The vehicles themselves are not deleted or changed."
        confirmLabel="Delete group"
        destructive
        onConfirm={async () => {
          try {
            await api(`/api/vehicle-groups/${deleting!.id}`, { method: "DELETE" });
            toast.success("Group deleted.");
            onChanged();
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
    </>
  );
}
