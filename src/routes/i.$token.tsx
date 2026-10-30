import { createFileRoute, notFound, useRouter, useRouterState } from "@tanstack/react-router";
import { Languages, Printer } from "lucide-react";
import { AppLogo, useBranding } from "@/components/app-logo";
import { InvoicePaymentInstructions } from "@/components/invoice/payment-instructions";
import { Button } from "@/components/ui/button";
import { getPublicInvoice } from "@/lib/invoice-public.functions";
import type { PublicInvoiceView } from "@/lib/invoice-share";
import { STATUS_LABEL, type DisplayStatus } from "@/lib/invoices";
import { dateLabel } from "@/lib/dates";
import { money } from "@/lib/format";
import { FONT_MONO, fontPreloads } from "@/lib/fonts";
import { pageHead } from "@/lib/head";
import { translate, useI18n } from "@/lib/i18n";
import { DEFAULT_LANG, langHref, otherLang, parseLang, validateLangSearch } from "@/lib/lang";
import { cn } from "@/lib/utils";

/*
 * Public invoice page (issue #93): `/i/<token>`, no login. The loader asks the public server fn,
 * which hashes the token and returns the `toPublicInvoice()` whitelist or null; null → the
 * router's ordinary 404, identical for unknown, revoked, expired, draft and cancelled invoices.
 * Never indexed (root `noindex, nofollow` + X-Robots-Tag), never cached by shared caches, and the
 * token does not leak through the Referer header. Amounts are never masked here: privacy mode is
 * the admin's screen preference, this page is the customer's document (like exports).
 */
export const Route = createFileRoute("/i/$token")({
  validateSearch: validateLangSearch,
  loader: async ({ params }) => {
    const invoice = await getPublicInvoice({ data: { token: params.token } });
    if (!invoice) throw notFound();
    return invoice;
  },
  headers: () => ({
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
  }),
  head: ({ loaderData, match }) => {
    const lang = parseLang(match.search.lang) ?? DEFAULT_LANG;
    const head = pageHead(
      loaderData
        ? `${translate("Invoice", lang)} ${loaderData.number}`
        : translate("Invoice", lang),
      translate("Tagihan untuk pelanggan, bisa dicetak atau disimpan sebagai PDF.", lang),
    );
    return { ...head, links: [...fontPreloads(FONT_MONO), ...head.links] };
  },
  component: PublicInvoicePage,
});

const STATUS_CLASS: Record<DisplayStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  unpaid: "bg-secondary text-secondary-foreground",
  partial: "bg-warning/15 text-warning",
  paid: "bg-income/15 text-income",
  cancelled: "bg-muted text-muted-foreground",
  overdue: "bg-expense/15 text-expense",
  verifying: "bg-primary/15 text-primary",
};

/** Customer document: never masked by the viewer's privacy mode. */
const amount = (v: number, cur: string) => money(v, cur, { reveal: true });

function PublicInvoicePage() {
  const inv = Route.useLoaderData() as PublicInvoiceView;
  const { token } = Route.useParams();
  const { t, lang } = useI18n();
  const b = useBranding();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const locale = lang === "en" ? "en-US" : "id-ID";
  const cur = inv.currency;
  const open = inv.remaining > 0 && inv.status !== "paid";

  function switchLang() {
    void router.navigate({ href: langHref(pathname, otherLang(lang)), replace: true });
  }

  return (
    <main className="invoice-page min-h-screen bg-background px-4 py-6 text-foreground sm:py-10">
      <div className="no-print mx-auto mb-4 flex max-w-3xl items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <AppLogo className="size-7" />
          <span className="truncate font-display font-semibold">{b.app_name}</span>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" size="sm" onClick={switchLang} aria-label={t("Ganti bahasa")}>
            <Languages className="size-4" aria-hidden />
            {lang === "en" ? "ID" : "EN"}
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden />
            {t("Cetak / simpan PDF")}
          </Button>
        </div>
      </div>

      <article
        aria-labelledby="invoice-title"
        className="invoice-doc mx-auto max-w-3xl rounded-xl border bg-card p-5 text-card-foreground shadow-sm sm:p-10"
      >
        <header className="flex flex-col-reverse gap-4 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <AppLogo className="size-10" />
            <p className="min-w-0 break-words font-display text-lg font-semibold">{b.app_name}</p>
          </div>
          <div className="min-w-0 sm:text-right">
            <h1
              id="invoice-title"
              className="font-display text-2xl font-extrabold tracking-tight uppercase"
            >
              {t("Invoice")}
            </h1>
            <p className="num break-all text-sm text-muted-foreground">{inv.number}</p>
            <span
              className={cn(
                "invoice-status mt-2 inline-block rounded-md px-2.5 py-0.5 text-xs font-semibold",
                STATUS_CLASS[inv.status],
              )}
            >
              {t(STATUS_LABEL[inv.status])}
            </span>
          </div>
        </header>

        <dl className="grid grid-cols-1 gap-4 py-6 text-sm sm:grid-cols-3">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground uppercase">{t("Ditagihkan kepada")}</dt>
            <dd className="mt-1 break-words font-semibold">{inv.customer_name}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground uppercase">{t("Tanggal terbit")}</dt>
            <dd className="mt-1">{dateLabel(inv.issue_date, locale)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground uppercase">{t("Jatuh tempo")}</dt>
            <dd className={cn("mt-1", inv.status === "overdue" && "font-semibold text-expense")}>
              {inv.due_date ? dateLabel(inv.due_date, locale) : "-"}
            </dd>
          </div>
        </dl>

        <table className="w-full table-fixed text-sm">
          <caption className="sr-only">{t("Item")}</caption>
          <thead className="border-b text-xs text-muted-foreground uppercase">
            <tr>
              <th scope="col" className="py-2 text-left font-medium">
                {t("Deskripsi")}
              </th>
              <th scope="col" className="hidden w-16 py-2 text-right font-medium sm:table-cell">
                {t("Qty")}
              </th>
              <th scope="col" className="hidden w-36 py-2 text-right font-medium sm:table-cell">
                {t("Harga satuan")}
              </th>
              <th scope="col" className="w-32 py-2 text-right font-medium sm:w-36">
                {t("Jumlah")}
              </th>
            </tr>
          </thead>
          <tbody>
            {inv.items.map((i, idx) => (
              <tr key={idx} className="border-b align-top">
                <td className="py-2 pr-3 break-words">
                  {i.description}
                  <span className="num block text-xs text-muted-foreground sm:hidden">
                    {i.qty} × {amount(i.unit_price, cur)}
                  </span>
                </td>
                <td className="num hidden py-2 text-right sm:table-cell">{i.qty}</td>
                <td className="num hidden py-2 text-right sm:table-cell">
                  {amount(i.unit_price, cur)}
                </td>
                <td className="num py-2 text-right font-medium">{amount(i.amount, cur)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex justify-end">
          <dl className="w-full max-w-xs space-y-1.5 text-sm">
            <div className="flex justify-between gap-4 font-semibold">
              <dt>{t("Total")}</dt>
              <dd className="num">{amount(inv.total, cur)}</dd>
            </div>
            <div className="flex justify-between gap-4 text-muted-foreground">
              <dt>{t("Sudah dibayar")}</dt>
              <dd className="num">{amount(inv.paid, cur)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t pt-2 text-base font-bold">
              <dt>{t("Sisa tagihan")}</dt>
              <dd className={cn("num", open && "text-expense")}>{amount(inv.remaining, cur)}</dd>
            </div>
          </dl>
        </div>

        {open ? <InvoicePaymentInstructions invoice={inv} token={token} /> : null}

        {inv.payments.length ? (
          <section className="mt-8" aria-labelledby="invoice-payments">
            <h2 id="invoice-payments" className="mb-2 text-sm font-semibold">
              {t("Riwayat pembayaran")}
            </h2>
            <ul className="divide-y rounded-lg border text-sm">
              {inv.payments.map((p, idx) => (
                <li key={idx} className="flex justify-between gap-4 px-3 py-2">
                  <span>{dateLabel(p.paid_at, locale)}</span>
                  <span className="num">{amount(p.amount, cur)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <footer className="mt-10 border-t pt-4 text-center text-xs text-muted-foreground">
          {t("Invoice ini dibuat dengan")} {b.app_name}.
        </footer>
      </article>
    </main>
  );
}
