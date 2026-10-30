import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Ban,
  ChevronDown,
  ChevronUp,
  FileText,
  HandCoins,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  Undo2,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { PageHeader } from "@/components/app-shell";
import { Pagination } from "@/components/pagination";
import { RouteError } from "@/components/route-error";
import { PageSkeleton, PENDING_MS } from "@/components/skeletons";
import { SortButton, type SortDirection } from "@/components/sort-button";
import { Empty } from "@/components/crud-page";
import { EntityDialog } from "@/components/entity-dialog";
import { useConfirm } from "@/components/confirm-dialog";
import { WalletFilter } from "@/components/wallet-filter";
import { InvoiceSharePanel } from "@/components/invoice/invoice-share-panel";
import { ProofQueue } from "@/components/invoice/proof-queue";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import {
  errMsg,
  invalidateFor,
  invoiceQuery,
  invoicesQuery,
  paymentMethodsQuery,
  rowsQuery,
} from "@/lib/queries";
import type { PaymentMethodRow } from "@/lib/invoice-payments";
import {
  deleteInvoiceFn,
  deleteInvoicePaymentFn,
  invoiceActionFn,
  recordInvoicePaymentFn,
  saveInvoiceFn,
} from "@/lib/invoices.functions";
import {
  INVOICE_FILTERS,
  METHOD_LABEL,
  PAYMENT_METHODS,
  STATUS_LABEL,
  availableActions,
  canEditInvoice,
  canRecordPayment,
  emptyItemRow,
  invoiceTotal,
  itemsFromRows,
  lineTotal,
  validateInvoice,
  validateInvoiceSearch,
  type DisplayStatus,
  type InvoiceAction,
  type InvoiceFilter,
  type InvoiceSort,
  type ItemRow,
  type PaymentMethod,
} from "@/lib/invoices";
import { resolveReportAccount } from "@/lib/report-filter";
import { addDays, dateLabel, todayStr } from "@/lib/dates";
import { money } from "@/lib/format";
import { usePrivacy } from "@/lib/privacy";
import { useI18n } from "@/lib/i18n";
import { pageHead } from "@/lib/head";
import type { Account } from "@/lib/schemas";

/* eslint-disable @typescript-eslint/no-explicit-any */
const PAGE_SIZE = 20;

export const Route = createFileRoute("/_app/invoices")({
  head: () =>
    pageHead("Invoice", "Buat tagihan bernomor otomatis, catat pembayaran, dan pantau sisanya."),
  validateSearch: validateInvoiceSearch,
  loaderDeps: ({ search }) => ({ account: search.account, status: search.status }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(
      invoicesQuery({
        offset: 0,
        limit: PAGE_SIZE,
        sort: "issue_date",
        direction: "desc",
        ...(deps.account ? { account: deps.account } : {}),
        ...(deps.status ? { status: deps.status } : {}),
      }),
    ),
  errorComponent: RouteError,
  pendingComponent: PageSkeleton,
  pendingMs: PENDING_MS,
  component: InvoicesPage,
});

const STATUS_CLASS: Record<DisplayStatus, string> = {
  draft: "border-transparent bg-muted text-muted-foreground",
  unpaid: "border-transparent bg-secondary text-secondary-foreground",
  partial: "border-transparent bg-warning/15 text-warning",
  paid: "border-transparent bg-income/15 text-income",
  cancelled: "border-transparent bg-muted text-muted-foreground line-through",
  overdue: "border-transparent bg-expense/15 text-expense",
  verifying: "border-transparent bg-primary/15 text-primary",
};

function StatusBadge({ status }: { status: DisplayStatus }) {
  const { t } = useI18n();
  return <Badge className={STATUS_CLASS[status]}>{t(STATUS_LABEL[status])}</Badge>;
}

type FormState = {
  id: string | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  account_id: string;
  issue_date: string;
  due_date: string;
  notes: string;
  items: ItemRow[];
  /** v24: picked payment methods ([] = all active). */
  method_ids: string[];
};

const newForm = (accountId: string): FormState => {
  const issue = todayStr();
  return {
    id: null,
    customer_name: "",
    customer_email: "",
    customer_phone: "",
    account_id: accountId,
    issue_date: issue,
    due_date: addDays(issue, 14),
    notes: "",
    items: [emptyItemRow()],
    method_ids: [],
  };
};

function InvoicesPage() {
  usePrivacy();
  const { t, lang } = useI18n();
  const locale = lang === "en" ? "en-US" : "id-ID";
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const qc = useQueryClient();
  const ask = useConfirm();
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<InvoiceSort>("issue_date");
  const [direction, setDirection] = useState<SortDirection>("desc");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [payFor, setPayFor] = useState<any | null>(null);
  const accounts = ((useQuery(rowsQuery("accounts")).data ?? []) as Account[]).filter(
    (a) => a.currency === "IDR",
  );
  const account = resolveReportAccount(search.account, accounts);
  const status = search.status;
  const setSearch = (next: {
    account?: string | undefined;
    status?: InvoiceFilter | undefined;
  }) => {
    setOffset(0);
    const merged = { account, status, ...next };
    void navigate({
      search: {
        ...(merged.account ? { account: merged.account } : {}),
        ...(merged.status ? { status: merged.status } : {}),
      },
      replace: true,
    });
  };
  const { data } = useQuery({
    ...invoicesQuery({
      offset,
      limit: PAGE_SIZE,
      sort,
      direction,
      ...(account ? { account } : {}),
      ...(status ? { status } : {}),
      ...(query.trim() ? { search: query.trim() } : {}),
    }),
    placeholderData: (p) => p,
  });
  const act = useServerFn(invoiceActionFn);
  const del = useServerFn(deleteInvoiceFn);
  const delPay = useServerFn(deleteInvoicePaymentFn);

  if (!data) return null;
  if (!data.ready) {
    return (
      <>
        <PageHeader title={t("Invoice")} />
        <Empty text={t("Fitur invoice belum aktif: jalankan bagian v21 di supabase/schema.sql.")} />
      </>
    );
  }
  const items = data.items as any[];
  const summary = data.summary as {
    outstanding: number;
    open: number;
    overdue: number;
    overdueAmount: number;
  };
  const accName = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? "-";

  function sortBy(column: InvoiceSort) {
    setDirection((cur) =>
      sort === column ? (cur === "asc" ? "desc" : "asc") : column === "number" ? "asc" : "desc",
    );
    setSort(column);
    setOffset(0);
  }

  async function run(fn: () => Promise<unknown>, table: "invoices" | "invoice_payments") {
    try {
      await fn();
      await invalidateFor(qc, table);
      toast.success(t("Tersimpan"));
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  async function doAction(inv: any, action: InvoiceAction) {
    const q: Record<InvoiceAction, string> = {
      issue: "Terbitkan invoice ini? Nomor tetap dan pembayaran bisa dicatat.",
      cancel: "Batalkan invoice ini?",
      reopen: "Buka kembali sebagai draft?",
      unissue: "Kembalikan invoice ini ke draft?",
    };
    if (!(await ask.confirm(t(q[action]), { destructive: action === "cancel" }))) return;
    await run(() => act({ data: { id: inv.id, action } }), "invoices");
  }

  async function remove(inv: any) {
    const ok = await ask.confirm(`${t("Hapus ")}${inv.number}${t("?")}`, {
      description: t("Pembayaran dan transaksi pemasukannya ikut dihapus."),
      confirmLabel: t("Ya, hapus"),
      destructive: true,
    });
    if (!ok) return;
    await run(() => del({ data: { id: inv.id } }), "invoice_payments");
  }

  async function removePayment(p: any) {
    const ok = await ask.confirm(t("Hapus pembayaran ini?"), {
      description: t("Transaksi pemasukannya ikut dihapus."),
      confirmLabel: t("Ya, hapus"),
      destructive: true,
    });
    if (!ok) return;
    await run(() => delPay({ data: { id: p.id } }), "invoice_payments");
  }

  return (
    <>
      <PageHeader
        title={t("Invoice")}
        subtitle={`${t("Belum dibayar:")} ${money(summary.outstanding)} · ${summary.open} ${t("invoice")}`}
        actions={
          <Button onClick={() => setForm(newForm(account ?? accounts[0]?.id ?? ""))}>
            <Plus className="size-4" /> {t("Buat invoice")}
          </Button>
        }
      />
      <div className="mb-4 grid grid-cols-1 gap-3 min-[430px]:grid-cols-2">
        <Card className="min-w-0 p-4">
          <p className="text-xs text-muted-foreground">{t("Sisa tagihan terbuka")}</p>
          <p className="num break-words text-xl font-semibold">{money(summary.outstanding)}</p>
          <p className="text-xs text-muted-foreground">
            {summary.open} {t("invoice belum lunas")}
          </p>
        </Card>
        <Card className="min-w-0 p-4">
          <p className="text-xs text-muted-foreground">{t("Terlambat")}</p>
          <p
            className={`num break-words text-xl font-semibold ${summary.overdue ? "text-expense" : ""}`}
          >
            {money(summary.overdueAmount)}
          </p>
          <p className="text-xs text-muted-foreground">
            {summary.overdue} {t("lewat jatuh tempo")}
          </p>
        </Card>
      </div>
      <ProofQueue locale={locale} />
      <div className="no-print mb-3 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
        <WalletFilter
          value={account}
          accounts={accounts}
          onChange={(a) => setSearch({ account: a })}
        />
        <Select
          value={status ?? "all"}
          onValueChange={(v) =>
            setSearch({ status: v === "all" ? undefined : (v as InvoiceFilter) })
          }
        >
          <SelectTrigger className="h-9 w-full min-w-0 sm:w-48" aria-label={t("Filter status")}>
            <SelectValue placeholder={t("Semua status")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("Semua status")}</SelectItem>
            {INVOICE_FILTERS.map((s) => (
              <SelectItem key={s} value={s}>
                {t(STATUS_LABEL[s])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="h-9 w-full min-w-0 sm:w-56"
          placeholder={t("Cari nomor / pelanggan")}
          aria-label={t("Cari nomor / pelanggan")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOffset(0);
          }}
        />
      </div>
      <div className="no-print mb-2 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <span className="mr-1">{t("Urutkan")}:</span>
        <SortButton
          label={t("Tanggal terbit")}
          active={sort === "issue_date"}
          direction={direction}
          onClick={() => sortBy("issue_date")}
        />
        <SortButton
          label={t("Jatuh tempo")}
          active={sort === "due_date"}
          direction={direction}
          onClick={() => sortBy("due_date")}
        />
        <SortButton
          label={t("Total")}
          active={sort === "total"}
          direction={direction}
          onClick={() => sortBy("total")}
        />
        <SortButton
          label={t("Nomor")}
          active={sort === "number"}
          direction={direction}
          onClick={() => sortBy("number")}
        />
      </div>
      {items.length === 0 ? (
        <Empty
          text={
            status || account || query
              ? t("Tidak ada invoice yang cocok dengan filter.")
              : t("Belum ada invoice. Buat tagihan pertama untuk pelanggan Anda.")
          }
        />
      ) : (
        <div className="space-y-3">
          {items.map((inv) => (
            <Card key={inv.id} className="min-w-0 p-4 sm:p-5">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                <div className="min-w-0">
                  <p className="num truncate text-xs text-muted-foreground">{inv.number}</p>
                  <p className="truncate font-display text-lg font-semibold">{inv.customer_name}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <StatusBadge status={inv.display_status} />
                    <Badge variant="outline" className="max-w-full truncate">
                      {accName(inv.account_id)}
                    </Badge>
                  </div>
                </div>
                <div className="text-right">
                  <p className="num font-semibold">{money(inv.total)}</p>
                  {inv.status === "partial" || inv.status === "unpaid" ? (
                    <p className="num text-xs text-expense">
                      {t("Sisa")} {money(inv.remaining)}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <span className="truncate">
                  {t("Terbit")}: {dateLabel(inv.issue_date, locale)}
                </span>
                <span
                  className={`truncate text-right ${inv.display_status === "overdue" ? "font-semibold text-expense" : ""}`}
                >
                  {t("Jatuh tempo")}: {inv.due_date ? dateLabel(inv.due_date, locale) : "-"}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {canRecordPayment(inv.status) ? (
                  <Button size="sm" onClick={() => setPayFor(inv)}>
                    <HandCoins className="size-4" /> {t("Catat pembayaran")}
                  </Button>
                ) : null}
                {availableActions(inv).map((a) => (
                  <Button key={a} size="sm" variant="outline" onClick={() => doAction(inv, a)}>
                    {a === "issue" ? (
                      <Send className="size-4" />
                    ) : a === "cancel" ? (
                      <Ban className="size-4" />
                    ) : (
                      <RotateCcw className="size-4" />
                    )}
                    {t(ACTION_LABEL[a])}
                  </Button>
                ))}
                {canEditInvoice(inv.status) ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => openEdit(inv.id)}
                    aria-label={t("Ubah")}
                  >
                    <Pencil className="size-4" /> {t("Ubah")}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setOpen(open === inv.id ? null : inv.id)}
                  aria-expanded={open === inv.id}
                >
                  {open === inv.id ? (
                    <ChevronUp className="size-4" />
                  ) : (
                    <ChevronDown className="size-4" />
                  )}
                  {t("Rincian")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-expense"
                  onClick={() => remove(inv)}
                  aria-label={t("Hapus")}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              {open === inv.id ? (
                <InvoiceDetail id={inv.id} locale={locale} onDeletePayment={removePayment} />
              ) : null}
            </Card>
          ))}
        </div>
      )}
      <Pagination
        offset={offset}
        pageSize={PAGE_SIZE}
        total={Number(data.total ?? items.length)}
        visible={items.length}
        onChange={setOffset}
      />
      {form ? (
        <InvoiceForm
          form={form}
          accounts={accounts}
          onClose={() => setForm(null)}
          onSaved={async () => {
            setForm(null);
            await invalidateFor(qc, "invoices");
          }}
        />
      ) : null}
      <PaymentDialog
        invoice={payFor}
        onClose={() => setPayFor(null)}
        onSaved={() => invalidateFor(qc, "invoice_payments")}
      />
      {ask.element}
    </>
  );

  async function openEdit(id: string) {
    try {
      const d = (await qc.fetchQuery(invoiceQuery(id))) as any;
      setForm({
        id: d.id,
        customer_name: d.customer_name ?? "",
        customer_email: d.customer_email ?? "",
        customer_phone: d.customer_phone ?? "",
        account_id: d.account_id ?? "",
        issue_date: d.issue_date,
        due_date: d.due_date ?? "",
        notes: d.notes ?? "",
        items: d.items.length
          ? d.items.map((i: any) => ({
              description: i.description,
              qty: i.qty,
              unit_price: i.unit_price,
            }))
          : [emptyItemRow()],
        method_ids: Array.isArray(d.method_ids) ? d.method_ids : [],
      });
    } catch (e) {
      toast.error(errMsg(e));
    }
  }
}

const ACTION_LABEL: Record<InvoiceAction, string> = {
  issue: "Terbitkan",
  cancel: "Batalkan invoice",
  reopen: "Buka kembali",
  unissue: "Jadikan draft",
};

function InvoiceDetail({
  id,
  locale,
  onDeletePayment,
}: {
  id: string;
  locale: string;
  onDeletePayment: (p: any) => void;
}) {
  const { t } = useI18n();
  const { data, isLoading, error } = useQuery(invoiceQuery(id));
  if (isLoading) return <p className="mt-3 text-sm text-muted-foreground">{t("Memuat…")}</p>;
  if (error || !data) return <p className="mt-3 text-sm text-expense">{errMsg(error)}</p>;
  const d = data as any;
  return (
    <div className="mt-4 space-y-3 text-sm">
      {d.customer_email || d.customer_phone ? (
        <p className="break-words text-muted-foreground">
          {[d.customer_email, d.customer_phone].filter(Boolean).join(" · ")}
        </p>
      ) : null}
      <ul className="divide-y rounded-lg border">
        {d.items.map((i: any) => (
          <li key={i.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-3 py-2">
            <span className="min-w-0">
              <span className="block break-words">{i.description}</span>
              <span className="num text-xs text-muted-foreground">
                {i.qty} × {money(i.unit_price)}
              </span>
            </span>
            <span className="num shrink-0 font-medium">
              {money(lineTotal(i.qty, i.unit_price))}
            </span>
          </li>
        ))}
        <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-3 py-2 font-semibold">
          <span>{t("Total")}</span>
          <span className="num">{money(d.total)}</span>
        </li>
      </ul>
      {d.notes ? <p className="whitespace-pre-wrap break-words">{d.notes}</p> : null}
      <div>
        <p className="mb-1 font-medium">{t("Riwayat pembayaran")}</p>
        {d.payments.length ? (
          <ul className="divide-y rounded-lg border">
            {d.payments.map((p: any) => (
              <li
                key={p.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5"
              >
                <span className="min-w-0 truncate">
                  {dateLabel(p.paid_at, locale)} ·{" "}
                  {t(METHOD_LABEL[p.method as PaymentMethod] ?? p.method)}
                  {p.reference ? ` · ${p.reference}` : ""}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="num">{money(p.amount)}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-9 sm:size-7"
                    aria-label={t("Hapus pembayaran")}
                    onClick={() => onDeletePayment(p)}
                  >
                    <Undo2 className="size-3.5" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">{t("Belum ada pembayaran.")}</p>
        )}
      </div>
      <InvoiceSharePanel invoice={d} locale={locale} />
    </div>
  );
}

function InvoiceForm({
  form: initial,
  accounts,
  onClose,
  onSaved,
}: {
  form: FormState;
  accounts: Account[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const save = useServerFn(saveInvoiceFn);
  const [f, setF] = useState<FormState>(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => setF(initial), [initial]);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const setItem = (i: number, patch: Partial<ItemRow>) =>
    set(
      "items",
      f.items.map((r, j) => (j === i ? { ...r, ...patch } : r)),
    );
  const items = itemsFromRows(f.items);
  const total = invoiceTotal(items.filter((i) => Number.isFinite(i.qty * i.unit_price)));
  const pm = useQuery(paymentMethodsQuery()).data as
    { ready: boolean; methods: PaymentMethodRow[] } | undefined;
  const methodsReady = !!pm?.ready;
  const methods = (pm?.methods ?? []).filter((m) => m.active || f.method_ids.includes(m.id));
  const toggleMethod = (id: string, on: boolean) =>
    set(
      "method_ids",
      on ? [...new Set([...f.method_ids, id])] : f.method_ids.filter((x) => x !== id),
    );

  async function submit(e: FormEvent, issue: boolean) {
    e.preventDefault();
    const draft = {
      customer_name: f.customer_name,
      customer_email: f.customer_email || null,
      customer_phone: f.customer_phone || null,
      account_id: f.account_id || null,
      issue_date: f.issue_date,
      due_date: f.due_date || null,
      items,
    };
    const errors = validateInvoice(draft);
    if (errors.length) {
      toast.error(t("Gagal menyimpan"), { description: errors.map((x) => t(x)).join(" · ") });
      return;
    }
    setBusy(true);
    try {
      await save({
        data: {
          id: f.id,
          values: {
            ...draft,
            account_id: f.account_id,
            notes: f.notes || null,
            ...(f.id ? {} : { issue }),
            ...(methodsReady ? { method_ids: f.method_ids } : {}),
          } as never,
        },
      });
      toast.success(t("Tersimpan"));
      await onSaved();
    } catch (err) {
      toast.error(t("Gagal menyimpan"), { description: t(errMsg(err)) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-2xl grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b bg-background px-5 py-4 pr-12 sm:px-6">
          <DialogTitle className="flex items-center gap-2 font-display">
            <FileText className="size-5" aria-hidden />
            {f.id ? t("Ubah invoice") : t("Buat invoice")}
          </DialogTitle>
          <DialogDescription>
            {t("Nomor dibuat otomatis. Total dihitung dari item. Hanya IDR.")}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => submit(e, false)}
          className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]"
        >
          <div className="grid min-h-0 grid-cols-2 gap-4 overflow-y-auto overflow-x-hidden px-5 py-4 sm:px-6">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="inv-name">{t("Nama pelanggan")}</Label>
              <Input
                id="inv-name"
                maxLength={120}
                value={f.customer_name}
                onChange={(e) => set("customer_name", e.target.value)}
              />
            </div>
            <div className="col-span-2 space-y-1.5 sm:col-span-1">
              <Label htmlFor="inv-email">{t("Email (opsional)")}</Label>
              <Input
                id="inv-email"
                type="email"
                maxLength={200}
                value={f.customer_email}
                onChange={(e) => set("customer_email", e.target.value)}
              />
            </div>
            <div className="col-span-2 space-y-1.5 sm:col-span-1">
              <Label htmlFor="inv-phone">{t("Telepon (opsional)")}</Label>
              <Input
                id="inv-phone"
                type="tel"
                maxLength={30}
                value={f.customer_phone}
                onChange={(e) => set("customer_phone", e.target.value)}
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="inv-acc">{t("Dompet penerima")}</Label>
              <Select value={f.account_id} onValueChange={(v) => set("account_id", v)}>
                <SelectTrigger id="inv-acc">
                  <SelectValue placeholder={t("Pilih dompet penerima")} />
                </SelectTrigger>
                <SelectContent>
                  {accounts
                    .filter((a) => !a.archived || a.id === f.account_id)
                    .map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5 sm:col-span-1">
              <Label htmlFor="inv-issue">{t("Tanggal terbit")}</Label>
              <Input
                id="inv-issue"
                type="date"
                value={f.issue_date}
                onChange={(e) => set("issue_date", e.target.value)}
              />
            </div>
            <div className="col-span-2 space-y-1.5 sm:col-span-1">
              <Label htmlFor="inv-due">{t("Jatuh tempo (opsional)")}</Label>
              <Input
                id="inv-due"
                type="date"
                value={f.due_date}
                onChange={(e) => set("due_date", e.target.value)}
              />
            </div>
            <div className="col-span-2 space-y-2">
              <p className="text-sm font-medium">{t("Item")}</p>
              {f.items.map((r, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] gap-2 rounded-md border bg-muted/50 p-2 sm:grid-cols-[minmax(0,1fr)_4.5rem_8rem_auto]"
                >
                  <Input
                    className="col-span-3 min-w-0 sm:col-span-1"
                    aria-label={t("Deskripsi item")}
                    placeholder={t("Deskripsi item")}
                    maxLength={300}
                    value={r.description}
                    onChange={(e) => setItem(i, { description: e.target.value })}
                  />
                  <Input
                    className="num min-w-0"
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min={0}
                    aria-label={t("Qty")}
                    placeholder="1"
                    value={r.qty}
                    onChange={(e) => setItem(i, { qty: e.target.value })}
                  />
                  <Input
                    className="num min-w-0"
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min={0}
                    aria-label={t("Harga satuan")}
                    placeholder={t("Harga satuan")}
                    value={r.unit_price}
                    onChange={(e) => setItem(i, { unit_price: e.target.value })}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t("Hapus baris")}
                    disabled={f.items.length <= 1}
                    onClick={() =>
                      set(
                        "items",
                        f.items.filter((_, j) => j !== i),
                      )
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                  <p className="num col-span-3 text-right text-xs text-muted-foreground sm:col-span-4">
                    {money(lineTotal(r.qty || 0, r.unit_price || 0), "IDR", { reveal: true })}
                  </p>
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={f.items.length >= 100}
                  onClick={() => set("items", [...f.items, emptyItemRow()])}
                >
                  <Plus className="size-4" /> {t("Tambah baris")}
                </Button>
                <p className="num font-semibold">
                  {t("Total")}: {money(total, "IDR", { reveal: true })}
                </p>
              </div>
            </div>
            {methodsReady && methods.length ? (
              <fieldset className="col-span-2 space-y-2">
                <legend className="text-sm font-medium">{t("Metode pembayaran")}</legend>
                <p className="text-xs text-muted-foreground">
                  {t("Tidak dipilih = semua metode aktif tampil di halaman publik.")}
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {methods.map((m) => (
                    <label
                      key={m.id}
                      className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md border p-2 text-sm"
                    >
                      <Checkbox
                        checked={f.method_ids.includes(m.id)}
                        onCheckedChange={(v) => toggleMethod(m.id, v === true)}
                      />
                      <span className="min-w-0 truncate">{m.label}</span>
                      {!m.active ? (
                        <Badge variant="outline" className="ml-auto">
                          {t("Nonaktif")}
                        </Badge>
                      ) : null}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="inv-notes">{t("Catatan")}</Label>
              <Textarea
                id="inv-notes"
                maxLength={2000}
                value={f.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="flex-wrap gap-2 border-t bg-background px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-6">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("Batal")}
            </Button>
            <Button type="submit" variant={f.id ? "default" : "outline"} disabled={busy}>
              {busy ? t("Menyimpan…") : f.id ? t("Simpan") : t("Simpan draft")}
            </Button>
            {f.id ? null : (
              <Button type="button" disabled={busy} onClick={(e) => submit(e as never, true)}>
                <Send className="size-4" /> {t("Simpan & terbitkan")}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({
  invoice,
  onClose,
  onSaved,
}: {
  invoice: any | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const pay = useServerFn(recordInvoicePaymentFn);
  const initial = useMemo(
    () =>
      invoice
        ? {
            amount: invoice.remaining,
            paid_at: todayStr(),
            method: "transfer",
            reference: "",
            note: "",
          }
        : {},
    [invoice],
  );
  return (
    <EntityDialog
      open={!!invoice}
      onOpenChange={(o) => (!o ? onClose() : null)}
      title={t("Catat pembayaran")}
      description={
        invoice
          ? `${invoice.number} · ${t("Sisa")} ${money(invoice.remaining)} · ${t("Tercatat sebagai pemasukan kategori Invoice.")}`
          : undefined
      }
      initial={initial}
      fields={[
        { name: "amount", label: t("Jumlah"), type: "number", half: true },
        { name: "paid_at", label: t("Tanggal"), type: "date", half: true },
        {
          name: "method",
          label: t("Metode"),
          type: "select",
          half: true,
          options: PAYMENT_METHODS.map((m) => ({ value: m, label: t(METHOD_LABEL[m]) })),
        },
        { name: "reference", label: t("Referensi (opsional)"), type: "text", half: true },
        { name: "note", label: t("Catatan"), type: "textarea" },
      ]}
      onSubmit={async (v) => {
        const amount = Number(v["amount"]);
        if (!(amount > 0)) throw new Error(t("Jumlah harus lebih dari 0"));
        try {
          await pay({
            data: {
              id: invoice.id,
              values: {
                amount,
                paid_at: (v["paid_at"] as string) || null,
                method: ((v["method"] as string) || "transfer") as PaymentMethod,
                reference: (v["reference"] as string) || null,
                note: (v["note"] as string) || null,
              },
            },
          });
        } catch (e) {
          throw new Error(t(errMsg(e)));
        }
        await onSaved();
      }}
    />
  );
}
