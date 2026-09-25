"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { Copy, KeyRound, MoreHorizontal, ShieldCheck, UserMinus, UserPlus, Users } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { DataTable, type ColumnMeta } from "@/components/app/data-table";
import { SegmentedFilter } from "@/components/app/filter-bar";
import { PageHeader } from "@/components/app/page-header";
import { SearchInput } from "@/components/app/search-input";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { useListParams } from "@/components/app/use-list-params";
import { Alert } from "@/components/ui/alert";
import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import type { MemberDto } from "@/lib/team";
import type { TeamListQuery, TeamPage } from "@/lib/team-list";

const ROLES = ["ORG_ADMIN", "FLEET_MANAGER", "DISPATCHER", "VIEWER"] as const;
type Role = (typeof ROLES)[number];
const ROLE_LABEL: Record<string, string> = { ORG_ADMIN: "Org Admin", FLEET_MANAGER: "Fleet Manager", DISPATCHER: "Dispatcher", VIEWER: "Viewer" };
const ROLE_HELP: Record<Role, string> = {
  ORG_ADMIN: "Everything, including team, billing and devices.",
  FLEET_MANAGER: "Vehicles, device assignment, zones, alerts, reports, maintenance.",
  DISPATCHER: "Sees the fleet and history; manages alert rules.",
  VIEWER: "Read-only: live map, vehicles, history, alerts."
};

function lastActive(iso: string | null) {
  if (!iso) return "Never signed in";
  const d = Math.round((Date.now() - Date.parse(iso)) / 86_400_000);
  return d <= 0 ? "Today" : d === 1 ? "Yesterday" : `${d} days ago`;
}

export function TeamView({ data, query, you, canManage }: { data: TeamPage; query: TeamListQuery; you: string; canManage: boolean }) {
  const { set, refresh, pending } = useListParams();
  const [adding, setAdding] = useState(false);
  const [roleFor, setRoleFor] = useState<MemberDto | null>(null);
  const [resetting, setResetting] = useState<MemberDto | null>(null);
  const [removing, setRemoving] = useState<MemberDto | null>(null);
  // One-time secret; kept only in memory until dismissed.
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);
  const filtered = query.search !== "" || query.role !== "all";

  const columns = useMemo<ColumnDef<MemberDto, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Member",
        meta: { sortKey: "name" } as ColumnMeta,
        cell: ({ row }) => {
          const m = row.original;
          return (
            <div className="min-w-0">
              <div className="font-medium">
                {m.name} {m.userId === you && <span className="font-normal text-muted-foreground">(you)</span>}
              </div>
              <div className="break-all text-xs text-muted-foreground">{m.email}</div>
            </div>
          );
        }
      },
      {
        id: "role",
        header: "Role",
        meta: { sortKey: "role" } as ColumnMeta,
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5">
            {ROLE_LABEL[row.original.role]}
            {row.original.isSuperAdmin && <StatusBadge tone="primary" label="Platform admin" />}
          </span>
        )
      },
      { id: "lastActive", header: "Last active", meta: { sortKey: "lastActive", className: "whitespace-nowrap" } as ColumnMeta, cell: ({ row }) => lastActive(row.original.lastSignInAt) },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (row.original.lastSignInAt ? <StatusBadge tone="success" label="Active" /> : <StatusBadge tone="warning" label="Invited" />)
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        meta: { className: "w-0 text-right" } as ColumnMeta,
        cell: ({ row }) => (canManage && row.original.userId !== you ? <RowMenu m={row.original} /> : null)
      }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [you, canManage]
  );

  function RowMenu({ m }: { m: MemberDto }) {
    return (
      <div onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label={`Actions for ${m.name}`} size="icon-sm" variant="ghost">
              <MoreHorizontal aria-hidden="true" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => setRoleFor(m)}>
              <ShieldCheck aria-hidden="true" /> Change role
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setResetting(m)}>
              <KeyRound aria-hidden="true" /> Reset password
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => setRemoving(m)}>
              <UserMinus aria-hidden="true" /> Remove from team
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Team"
        description="People who can sign in to your organization and what each role can do."
        breadcrumbs={[{ label: "Settings" }, { label: "Team" }]}
        actions={
          canManage && (
            <Button onClick={() => setAdding(true)}>
              <UserPlus /> Add member
            </Button>
          )
        }
      />
      <Card>
        <DataTable<MemberDto>
          columns={columns}
          data={data.items}
          getRowId={(m) => m.userId}
          total={data.total}
          page={data.page}
          pageSize={data.pageSize}
          sort={query.sort}
          direction={query.direction}
          onSort={(k, d) => set({ sort: k, direction: d })}
          onPage={(p) => set({ page: p })}
          loading={pending}
          toolbar={
            <>
              <SearchInput value={query.search} onChange={(v) => set({ search: v })} placeholder="Search name or email…" label="Search team" className="sm:w-64" />
              <SegmentedFilter
                label="Filter by role"
                value={query.role}
                onChange={(v) => set({ role: v === "all" ? null : v })}
                options={[{ value: "all", label: "All", count: data.counts.all ?? 0 }, ...ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r]!, count: data.counts[r] ?? 0 }))]}
              />
            </>
          }
          mobileRow={(m) => (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 text-sm">
                <div className="font-medium">
                  {m.name} {m.userId === you && <span className="font-normal text-muted-foreground">(you)</span>}
                </div>
                <div className="break-all text-xs text-muted-foreground">{m.email}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {ROLE_LABEL[m.role]} · {lastActive(m.lastSignInAt)}
                </div>
              </div>
              {canManage && m.userId !== you && <RowMenu m={m} />}
            </div>
          )}
          empty={filtered ? <EmptyState icon={Users} title="No members match" /> : <EmptyState icon={Users} title="No team members yet" />}
        />
      </Card>

      <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        {ROLES.map((r) => (
          <p key={r} className="m-0">
            <strong className="text-foreground">{ROLE_LABEL[r]}:</strong> {ROLE_HELP[r]}
          </p>
        ))}
      </div>

      {canManage && (
        <>
          <AddMemberDialog
            open={adding}
            onOpenChange={setAdding}
            onAdded={(email, out) => {
              if (out.temporaryPassword) setSecret({ email, password: out.temporaryPassword });
              else toast.success(out.emailed ? `Invitation sent to ${email}.` : `${email} added.`);
              refresh();
            }}
          />
          <RoleDialog
            member={roleFor}
            onClose={() => setRoleFor(null)}
            onSaved={(m, r) => {
              toast.success(`${m.name} is now ${ROLE_LABEL[r]}.`);
              refresh();
            }}
          />
          <ConfirmDialog
            open={resetting !== null}
            onOpenChange={(o) => !o && setResetting(null)}
            title={`Reset ${resetting?.name ?? ""}'s password?`}
            description="Their current password stops working and they are signed out everywhere. They get an email link to choose a new one."
            confirmLabel="Reset password"
            onConfirm={async () => {
              if (!resetting) return;
              try {
                const out = await api<{ temporaryPassword: string | null; emailed: boolean }>(`/api/team/${resetting.userId}/reset-password`, { method: "POST" });
                if (out.temporaryPassword) setSecret({ email: resetting.email, password: out.temporaryPassword });
                else toast.success(`Password reset email sent to ${resetting.email}.`);
                setResetting(null);
              } catch (err) {
                toast.error(errorMessage(err));
              }
            }}
          />
          <ConfirmDialog
            open={removing !== null}
            onOpenChange={(o) => !o && setRemoving(null)}
            title={`Remove ${removing?.name ?? ""} from the team?`}
            description="They lose access to this organization immediately. Their account isn't deleted."
            confirmLabel="Remove"
            destructive
            onConfirm={async () => {
              if (!removing) return;
              try {
                await api(`/api/team/${removing.userId}`, { method: "DELETE" });
                toast.success(`${removing.name} removed.`);
                setRemoving(null);
                refresh();
              } catch (err) {
                toast.error(errorMessage(err));
              }
            }}
          />
        </>
      )}

      <Dialog open={secret !== null} onOpenChange={(o) => !o && setSecret(null)}>
        {secret && (
          <DialogContent title="One-time temporary password" description={`For ${secret.email}. Email couldn't be sent, so share this privately. It's shown only once; ask them to change it under My account.`}>
            <code className="block select-all break-all rounded-md border border-border bg-canvas px-3 py-2 text-lg">{secret.password}</code>
            <DialogFooter>
              <Button
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard?.writeText(secret.password);
                  toast.success("Copied.");
                }}
              >
                <Copy /> Copy
              </Button>
              <Button onClick={() => setSecret(null)}>Done</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

function AddMemberDialog({ open, onOpenChange, onAdded }: { open: boolean; onOpenChange: (o: boolean) => void; onAdded: (email: string, out: { temporaryPassword: string | null; emailed: boolean }) => void }) {
  const [role, setRole] = useState<Role>("VIEWER");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email") ?? "").trim();
    setBusy(true);
    setError(null);
    try {
      const out = await api<{ temporaryPassword: string | null; emailed: boolean }>("/api/team", { method: "POST", json: { name: f.get("name"), email, role } });
      onOpenChange(false);
      onAdded(email, out);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent title="Add a team member" description="They get an email with a link to set their password.">
        <form method="post" onSubmit={submit} className="grid gap-4">
          <Field id="tm-name" label="Full name" required>
            <Input id="tm-name" name="name" required maxLength={200} autoComplete="off" />
          </Field>
          <Field id="tm-email" label="Email" required>
            <Input id="tm-email" name="email" type="email" required maxLength={254} autoComplete="off" />
          </Field>
          <Field id="tm-role" label="Role" description={ROLE_HELP[role]}>
            <Select id="tm-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          </Field>
          {error && <Alert tone="danger">{error}</Alert>}
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Add member
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RoleDialog({ member, onClose, onSaved }: { member: MemberDto | null; onClose: () => void; onSaved: (m: MemberDto, r: Role) => void }) {
  const [role, setRole] = useState<Role>("VIEWER");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);
  if (member && member.userId !== lastId) {
    setLastId(member.userId);
    setRole(member.role as Role);
    setError(null);
  }
  return (
    <Dialog open={member !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      {member && (
        <DialogContent title={`Change role for ${member.name}`}>
          <form
            method="post"
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                await api(`/api/team/${member.userId}`, { method: "PATCH", json: { role } });
                onClose();
                onSaved(member, role);
              } catch (err) {
                // e.g. "An organization must keep at least one Org Admin"
                setError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <fieldset className="m-0 grid gap-2 border-0 p-0">
              <legend className="sr-only">Role</legend>
              {ROLES.map((r) => (
                <label key={r} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
                  <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} className="mt-0.5 accent-primary" />
                  <span>
                    <span className="block text-sm font-medium">{ROLE_LABEL[r]}</span>
                    <span className="block text-xs text-muted-foreground">{ROLE_HELP[r]}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {error && <Alert tone="danger">{error}</Alert>}
            <DialogFooter>
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" loading={busy} disabled={role === member.role}>
                Save role
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
