import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { KeyRound, Plus, ShieldCheck, Trash2, UserCog, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useConfirm } from "@/components/confirm-dialog";
import { UserAvatar } from "@/components/user-avatar";
import {
  createMemberFn,
  deleteMemberFn,
  listUsersFn,
  resetMemberPasswordFn,
  setMemberPermissionsFn,
  updateMemberFn,
} from "@/lib/users.functions";
import { errMsg, invalidateFor, rowsQuery, usersQueryKey } from "@/lib/queries";
import { passwordProblems } from "@/lib/password";
import {
  displayNameOf,
  grantsFromMatrix,
  normalizeUsername,
  usernameProblems,
  type MatrixValue,
} from "@/lib/users";
import { useI18n } from "@/lib/i18n";
import type { Account } from "@/lib/schemas";

type User = Awaited<ReturnType<typeof listUsersFn>>["users"][number];

/**
 * Settings → Pengguna (v18, admin only): family members, their per-wallet access (view/manage),
 * deactivate, reset password and delete. The owner (APP_USERNAME) is shown but never editable.
 */
export function UsersCard() {
  const { t } = useI18n();
  const list = useServerFn(listUsersFn);
  const q = useQuery({ queryKey: usersQueryKey, queryFn: () => list(), retry: false });
  const accounts = (useQuery(rowsQuery("accounts")).data ?? []) as Account[];
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);
  const ready = q.data?.ready ?? false;

  return (
    <Card className="mt-4 min-w-0 p-5">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Users className="size-4" /> {t("Pengguna")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Tambahkan anggota keluarga dan pilih dompet yang boleh mereka lihat atau kelola.")}
          </p>
        </div>
        {ready ? (
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" /> {t("Tambah anggota")}
          </Button>
        ) : null}
      </div>
      {q.isError ? <p className="mt-3 text-sm text-destructive">{errMsg(q.error)}</p> : null}
      {q.data && !ready ? (
        <p className="mt-3 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          {t("Jalankan bagian v17 dan v18 di supabase/schema.sql untuk menambahkan anggota.")}
        </p>
      ) : null}
      {q.data ? (
        <ul className="mt-4 divide-y rounded-lg border">
          {q.data.users.map((u) => (
            <UserRow
              key={u.id ?? u.username}
              user={u}
              accounts={accounts}
              onEdit={() => setEditing(u)}
              onReset={() => setResetting(u)}
            />
          ))}
        </ul>
      ) : null}
      <AddMemberDialog open={adding} onOpenChange={setAdding} />
      {editing ? (
        <EditMemberDialog
          user={editing}
          accounts={accounts}
          onOpenChange={(o) => !o && setEditing(null)}
        />
      ) : null}
      {resetting ? (
        <ResetPasswordDialog user={resetting} onOpenChange={(o) => !o && setResetting(null)} />
      ) : null}
    </Card>
  );
}

function UserRow({
  user,
  accounts,
  onEdit,
  onReset,
}: {
  user: User;
  accounts: Account[];
  onEdit: () => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const ask = useConfirm();
  const update = useServerFn(updateMemberFn);
  const del = useServerFn(deleteMemberFn);
  const name = displayNameOf(user);
  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? t("Akun dihapus");

  async function refresh() {
    await qc.invalidateQueries({ queryKey: usersQueryKey });
    await invalidateFor(qc, "app_users");
  }

  async function toggleActive(active: boolean) {
    if (!user.id) return;
    try {
      await update({ data: { id: user.id, is_active: active } });
      toast.success(active ? t("Anggota diaktifkan") : t("Anggota dinonaktifkan"));
      await refresh();
    } catch (e) {
      toast.error(t(errMsg(e)));
    }
  }

  async function remove() {
    if (!user.id) return;
    if (
      !(await ask.confirm(`${t("Hapus anggota")} ${name}?`, {
        description: t(
          "Akun login dan hak aksesnya dihapus. Transaksi yang sudah dicatat tetap ada.",
        ),
        confirmLabel: t("Ya, hapus"),
        destructive: true,
      }))
    )
      return;
    try {
      await del({ data: { id: user.id } });
      toast.success(t("Dihapus"));
      await refresh();
    } catch (e) {
      toast.error(t(errMsg(e)));
    }
  }

  return (
    <li className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-3 p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
      <UserAvatar src={null} name={user.display_name} username={user.username} className="size-9" />
      <div className="min-w-0">
        <p className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate font-medium">{name}</span>
          {user.owner ? (
            <Badge variant="secondary" className="gap-1">
              <ShieldCheck className="size-3" /> {t("Pemilik")}
            </Badge>
          ) : (
            <Badge variant="outline">{t("Anggota")}</Badge>
          )}
          {!user.is_active ? <Badge variant="outline">{t("Nonaktif")}</Badge> : null}
          {user.must_change_password ? (
            <Badge variant="outline">{t("Menunggu ganti password")}</Badge>
          ) : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">@{user.username}</p>
        {user.owner ? (
          <p className="mt-1 text-xs text-muted-foreground">{t("Akses penuh ke semua data.")}</p>
        ) : user.grants.length ? (
          <ul className="mt-1 flex flex-wrap gap-1">
            {user.grants.map((g) => (
              <li key={g.account_id}>
                <Badge variant="outline" className="max-w-full font-normal">
                  <span className="truncate">{nameOf(g.account_id)}</span>
                  <span className="text-muted-foreground">
                    · {g.level === "manage" ? t("Kelola") : t("Lihat")}
                  </span>
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">{t("Belum punya akses dompet.")}</p>
        )}
      </div>
      {user.owner ? null : (
        <div className="col-span-2 flex flex-wrap items-center justify-end gap-1 sm:col-span-1">
          <label className="mr-1 flex items-center gap-2 text-xs text-muted-foreground">
            <Switch
              checked={user.is_active}
              onCheckedChange={(v) => void toggleActive(v)}
              aria-label={t("Aktif")}
            />
            {t("Aktif")}
          </label>
          <Button size="sm" variant="outline" onClick={onEdit}>
            <UserCog className="size-4" /> {t("Akses")}
          </Button>
          <Button size="icon" variant="ghost" onClick={onReset} aria-label={t("Reset password")}>
            <KeyRound className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => void remove()} aria-label={t("Hapus")}>
            <Trash2 className="size-4 text-expense" />
          </Button>
        </div>
      )}
      {ask.element}
    </li>
  );
}

function AddMemberDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const create = useServerFn(createMemberFn);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const u = normalizeUsername(username);
  const uProblems = username ? usernameProblems(u, null) : [];
  const pProblems = password ? passwordProblems(password, { username: u }) : [];
  const canSubmit = !busy && !!u && !!password && !uProblems.length && !pProblems.length;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      const res = await create({ data: { username: u, display_name: displayName, password } });
      if (!res.ok) {
        toast.error(t(res.error));
        return;
      }
      toast.success(t("Anggota ditambahkan. Atur akses dompetnya."));
      setUsername("");
      setDisplayName("");
      setPassword("");
      onOpenChange(false);
      await qc.invalidateQueries({ queryKey: usersQueryKey });
      await invalidateFor(qc, "app_users");
    } catch (err) {
      toast.error(t(errMsg(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Tambah anggota")}</DialogTitle>
          <DialogDescription>
            {t("Anggota wajib mengganti password sementara saat login pertama.")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="m-username">{t("Username")}</Label>
            <Input
              id="m-username"
              autoComplete="off"
              autoCapitalize="none"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="anak"
            />
            <p className="text-xs text-muted-foreground">
              {t("Username tidak bisa diubah setelah dibuat.")}
            </p>
            {uProblems.map((p) => (
              <p key={p} className="text-xs text-expense">
                {t(p)}
              </p>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-name">{t("Nama lengkap")}</Label>
            <Input
              id="m-name"
              value={displayName}
              maxLength={80}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t("Opsional. Jika kosong, username yang ditampilkan.")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-password">{t("Password sementara")}</Label>
            <Input
              id="m-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {pProblems.map((p) => (
              <p key={p} className="text-xs text-expense">
                {t(p)}
              </p>
            ))}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!canSubmit}>
              {busy ? t("Menyimpan…") : t("Tambah anggota")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditMemberDialog({
  user,
  accounts,
  onOpenChange,
}: {
  user: User;
  accounts: Account[];
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const update = useServerFn(updateMemberFn);
  const setPerms = useServerFn(setMemberPermissionsFn);
  const [displayName, setDisplayName] = useState(user.display_name ?? "");
  const [matrix, setMatrix] = useState<Record<string, MatrixValue>>(() =>
    Object.fromEntries(user.grants.map((g) => [g.account_id, g.level])),
  );
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user.id) return;
    setBusy(true);
    try {
      if ((displayName.trim() || null) !== (user.display_name ?? null))
        await update({ data: { id: user.id, display_name: displayName } });
      await setPerms({ data: { id: user.id, grants: grantsFromMatrix(matrix) } });
      toast.success(t("Tersimpan"));
      onOpenChange(false);
      await qc.invalidateQueries({ queryKey: usersQueryKey });
      await invalidateFor(qc, "app_users");
    } catch (err) {
      toast.error(t(errMsg(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("Akses")} · {displayNameOf(user)}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Lihat: saldo, transaksi, dan laporan dompet. Kelola: juga mencatat, mengubah, dan menghapus transaksinya.",
            )}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="e-username">{t("Username")}</Label>
            <Input id="e-username" value={user.username} readOnly disabled />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="e-name">{t("Nama lengkap")}</Label>
            <Input
              id="e-name"
              value={displayName}
              maxLength={80}
              placeholder={user.username}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">{t("Akses dompet")}</legend>
            {accounts.length ? (
              <ul className="divide-y rounded-lg border">
                {accounts.map((a) => (
                  <li
                    key={a.id}
                    className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 p-2.5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{a.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {a.currency}
                        {a.archived ? ` · ${t("Arsip")}` : ""}
                      </span>
                    </span>
                    <Select
                      value={matrix[a.id] ?? "none"}
                      onValueChange={(v) => setMatrix((m) => ({ ...m, [a.id]: v as MatrixValue }))}
                    >
                      <SelectTrigger className="w-32" aria-label={`${t("Akses")} ${a.name}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t("Tanpa akses")}</SelectItem>
                        <SelectItem value="view">{t("Lihat")}</SelectItem>
                        <SelectItem value="manage">{t("Kelola")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("Belum ada akun.")}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {t("Transfer butuh akses Kelola di kedua dompet.")}
            </p>
          </fieldset>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? t("Menyimpan…") : t("Simpan")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  user,
  onOpenChange,
}: {
  user: User;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const reset = useServerFn(resetMemberPasswordFn);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const problems = password ? passwordProblems(password, { username: user.username }) : [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user.id || !password || problems.length) return;
    setBusy(true);
    try {
      const res = await reset({ data: { id: user.id, password } });
      if (!res.ok) {
        toast.error(t(res.error));
        return;
      }
      toast.success(t("Password direset. Anggota keluar dari semua perangkat."));
      onOpenChange(false);
      await qc.invalidateQueries({ queryKey: usersQueryKey });
    } catch (err) {
      toast.error(t(errMsg(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("Reset password")} · {displayNameOf(user)}
          </DialogTitle>
          <DialogDescription>
            {t("Anggota wajib mengganti password sementara saat login pertama.")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="r-password">{t("Password sementara")}</Label>
            <Input
              id="r-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {problems.map((p) => (
              <p key={p} className="text-xs text-expense">
                {t(p)}
              </p>
            ))}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy || !password || !!problems.length}>
              {busy ? t("Menyimpan…") : t("Reset password")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
