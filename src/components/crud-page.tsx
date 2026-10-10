import { useState } from "react";
import { toast } from "@/lib/toast";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EntityDialog, type FieldDef } from "./entity-dialog";
import { useConfirm } from "./confirm-dialog";
import { errMsg, useCrud } from "@/lib/queries";
import { useI18n } from "@/lib/i18n";
import type { CrudTable } from "@/lib/schemas";

type Values = Record<string, unknown>;

/** Shared add/edit/delete state for simple CRUD pages. */
export function useCrudDialog(table: CrudTable, defaults: Values) {
  const { t } = useI18n();
  const crud = useCrud(table);
  const ask = useConfirm();
  const [state, setState] = useState<{ open: boolean; id: string | null; initial: Values }>({
    open: false,
    id: null,
    initial: defaults,
  });
  return {
    openNew: (extra?: Values) =>
      setState({ open: true, id: null, initial: { ...defaults, ...extra } }),
    openEdit: (row: Values & { id: string }) => setState({ open: true, id: row.id, initial: row }),
    remove: async (id: string, label = "data ini") => {
      if (
        !(await ask.confirm(`${t("Hapus ")}${label}${t("?")}`, {
          confirmLabel: t("Ya, hapus"),
          destructive: true,
        }))
      )
        return;
      try {
        await crud.remove(id);
        toast.success(t("Dihapus"));
      } catch (e) {
        toast.error(errMsg(e));
      }
    },

    dialog: (title: string, fields: FieldDef[] | ((v: Values) => FieldDef[])) => (
      <>
        <EntityDialog
          open={state.open}
          onOpenChange={(o) => setState((s) => ({ ...s, open: o }))}
          title={state.id ? `Ubah ${title}` : `Tambah ${title}`}
          fields={fields}
          initial={state.initial}
          onSubmit={(v) => crud.save(v, state.id)}
        />
        {ask.element}
      </>
    ),
  };
}

export function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex shrink-0">
      <Button size="icon" variant="ghost" aria-label={t("Ubah")} onClick={onEdit}>
        <Pencil className="size-4" />
      </Button>
      <Button size="icon" variant="ghost" aria-label={t("Hapus")} onClick={onDelete}>
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
      {text}
    </p>
  );
}
