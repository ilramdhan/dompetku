/** Pure builder for reminder emails (shared by n8n endpoint and direct send). */
import { diffDays } from "./dates";

export type EmailReminder = {
  type: string;
  title: string;
  amount: number;
  currency: string;
  due_date: string;
  days_left: number;
  overdue: boolean;
};

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const fmt = (n: number, c: string) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: c,
    maximumFractionDigits: c === "USD" ? 2 : 0,
  }).format(n);

function when(r: EmailReminder): string {
  if (r.type === "budget") return "Peringatan budget";
  if (r.overdue) return `Terlambat ${-r.days_left} hari`;
  if (r.days_left === 0) return "Hari ini";
  return `${r.days_left} hari lagi (${r.due_date})`;
}

export function buildReminderEmail(list: EmailReminder[]) {
  const overdue = list.filter((r) => r.overdue).length;
  const subject = list.length
    ? `🔔 Dompetku: ${list.length} pengingat${overdue ? ` (${overdue} terlambat)` : ""}`
    : "🎉 Dompetku: tidak ada tagihan dalam waktu dekat";
  const text = list.length
    ? `Pengingat Keuangan\n\n${list.map((r) => `• ${r.title}: ${fmt(r.amount, r.currency)} — ${when(r)}`).join("\n")}`
    : "Tidak ada tagihan dalam waktu dekat.";
  const rows = list
    .map(
      (r) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #e6e1d3">${esc(r.title)}</td><td style="padding:8px 12px;border-bottom:1px solid #e6e1d3;font-family:monospace;text-align:right">${esc(fmt(r.amount, r.currency))}</td><td style="padding:8px 12px;border-bottom:1px solid #e6e1d3;color:${r.overdue ? "#b5452b" : "#4d5f57"}">${esc(when(r))}</td></tr>`,
    )
    .join("");
  const html = `<div style="font-family:Arial,sans-serif;background:#f7f3ea;padding:24px;color:#1f3029"><div style="max-width:600px;margin:auto;background:#fdfbf6;border-radius:14px;padding:24px"><h2 style="margin:0 0 4px">Dompetku<span style="color:#e3b23c">.</span></h2><p style="margin:0 0 16px;color:#4d5f57">Pengingat keuangan Anda</p>${list.length ? `<table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>` : "<p>🎉 Tidak ada tagihan dalam waktu dekat.</p>"}</div></div>`;
  return { subject, text, html };
}

/* ---------------- Invoice emails (issue #95) ---------------- */
export const INVOICE_EMAIL_KINDS = ["invoice", "payment", "reminder_due", "overdue"] as const;
export type InvoiceEmailKind = (typeof INVOICE_EMAIL_KINDS)[number];
export type EmailLang = "id" | "en";

/** Text-only payment instruction (bank account or QRIS label); never the QRIS image. */
export type InvoiceEmailMethod = {
  kind: string;
  label: string;
  bank_name?: string | null;
  account_number?: string | null;
  account_holder?: string | null;
};

export type InvoiceEmailInput = {
  kind: InvoiceEmailKind;
  lang?: EmailLang;
  /** Seller/app name shown in the header and subject (default "Dompetku"). */
  brand?: string | null;
  number: string;
  customer_name: string;
  currency?: string | null;
  due_date: string | null;
  total: number;
  paid: number;
  remaining: number;
  /** YYYY-MM-DD in the app zone: drives "N days late / left". */
  today: string;
  /** Absolute public link (`/i/<token>`) or null (payment/reminder mails carry none). */
  link?: string | null;
  methods?: readonly InvoiceEmailMethod[];
  /** `payment` only: amount of the payment just received. */
  payment_amount?: number | null;
};

const TEXTS = {
  id: {
    hello: "Halo",
    invoice: "Invoice",
    total: "Total",
    paid: "Sudah dibayar",
    remaining: "Sisa tagihan",
    due: "Jatuh tempo",
    none: "-",
    link: "Lihat invoice online",
    linkText: "Lihat invoice online",
    pay: "Cara pembayaran",
    bank: "Transfer bank",
    qris: "QRIS",
    qrisLink: "kode QRIS ada di halaman invoice",
    qrisAsk: "minta kode QRIS ke penjual",
    holder: "a.n.",
    reply: "Setelah membayar, mohon konfirmasi ke penjual.",
    thanks: "Terima kasih.",
    today: "hari ini",
    inDays: (n: number) => `${n} hari lagi`,
    late: (n: number) => `terlambat ${n} hari`,
    intro: {
      invoice: (b: string) => `${b} mengirimkan invoice berikut untuk Anda.`,
      payment: (b: string) => `Pembayaran Anda telah kami terima. Terima kasih! (${b})`,
      reminder_due: (b: string) => `Pengingat dari ${b}: invoice berikut segera jatuh tempo.`,
      overdue: (b: string) => `Pengingat dari ${b}: invoice berikut sudah melewati jatuh tempo.`,
    },
    paidFull: "Invoice ini sudah lunas.",
    received: "Pembayaran diterima",
    subject: {
      invoice: (n: string, b: string) => `🧾 Invoice ${n} dari ${b}`,
      payment: (n: string) => `✅ Pembayaran invoice ${n} diterima`,
      paidFull: (n: string) => `✅ Invoice ${n} lunas`,
      reminder_due: (n: string, w: string) => `🔔 Invoice ${n} jatuh tempo ${w}`,
      overdue: (n: string, d: number) => `⚠️ Invoice ${n} terlambat ${d} hari`,
    },
  },
  en: {
    hello: "Hello",
    invoice: "Invoice",
    total: "Total",
    paid: "Paid",
    remaining: "Amount due",
    due: "Due date",
    none: "-",
    link: "View invoice online",
    linkText: "View invoice online",
    pay: "How to pay",
    bank: "Bank transfer",
    qris: "QRIS",
    qrisLink: "the QRIS code is on the invoice page",
    qrisAsk: "ask the seller for the QRIS code",
    holder: "a/n",
    reply: "After paying, please confirm with the seller.",
    thanks: "Thank you.",
    today: "today",
    inDays: (n: number) => `in ${n} days`,
    late: (n: number) => `${n} days late`,
    intro: {
      invoice: (b: string) => `${b} sent you the invoice below.`,
      payment: (b: string) => `We received your payment. Thank you! (${b})`,
      reminder_due: (b: string) => `Reminder from ${b}: the invoice below is due soon.`,
      overdue: (b: string) => `Reminder from ${b}: the invoice below is past its due date.`,
    },
    paidFull: "This invoice is fully paid.",
    received: "Payment received",
    subject: {
      invoice: (n: string, b: string) => `🧾 Invoice ${n} from ${b}`,
      payment: (n: string) => `✅ Payment for invoice ${n} received`,
      paidFull: (n: string) => `✅ Invoice ${n} paid`,
      reminder_due: (n: string, w: string) => `🔔 Invoice ${n} due ${w}`,
      overdue: (n: string, d: number) => `⚠️ Invoice ${n} is ${d} days late`,
    },
  },
} as const;

/** Strips line breaks/control chars so customer input can never inject headers into a subject. */
const oneLine = (s: string) =>
  Array.from(s, (c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? " " : c))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
/** Only absolute http(s) links are put in the mail (anything else is dropped). */
const safeLink = (u: string | null | undefined) => (u && /^https?:\/\/\S+$/i.test(u) ? u : null);

/**
 * Pure builder for customer invoice emails (send / payment confirmation / due soon / overdue).
 * Same `{ subject, text, html }` shape as buildReminderEmail. Amounts are never privacy-masked
 * (the mail goes to the customer); every customer/admin string is HTML-escaped.
 */
export function buildInvoiceEmail(i: InvoiceEmailInput) {
  const L = TEXTS[i.lang === "en" ? "en" : "id"];
  const brand = oneLine(i.brand || "Dompetku") || "Dompetku";
  const cur = i.currency || "IDR";
  const num = oneLine(i.number);
  const name = oneLine(i.customer_name);
  const days = i.due_date ? diffDays(i.today, i.due_date.slice(0, 10)) : null;
  const late = days !== null && days < 0 ? -days : 0;
  const whenText =
    days === null ? "" : days < 0 ? L.late(-days) : days === 0 ? L.today : L.inDays(days);
  const fullyPaid = i.kind === "payment" && i.remaining <= 0.005;
  const subject =
    i.kind === "invoice"
      ? L.subject.invoice(num, brand)
      : i.kind === "payment"
        ? fullyPaid
          ? L.subject.paidFull(num)
          : L.subject.payment(num)
        : i.kind === "reminder_due"
          ? L.subject.reminder_due(num, whenText || L.today)
          : L.subject.overdue(num, late || 1);

  const open = i.remaining > 0.005;
  const link = safeLink(i.link);
  const rows: [string, string][] = [
    [L.invoice, num],
    [L.total, fmt(i.total, cur)],
  ];
  if (i.kind === "payment" && i.payment_amount && i.payment_amount > 0)
    rows.push([L.received, fmt(i.payment_amount, cur)]);
  if (i.paid > 0.005) rows.push([L.paid, fmt(i.paid, cur)]);
  rows.push([L.remaining, fmt(Math.max(0, i.remaining), cur)]);
  if (i.due_date)
    rows.push([L.due, `${i.due_date.slice(0, 10)}${whenText && open ? ` (${whenText})` : ""}`]);

  const showMethods = open && i.kind !== "payment";
  const methods = showMethods ? (i.methods ?? []) : [];
  const methodLine = (m: InvoiceEmailMethod) => {
    if (m.kind === "qris")
      return `${L.qris}: ${oneLine(m.label)} (${link ? L.qrisLink : L.qrisAsk})`;
    const parts = [oneLine(m.bank_name || m.label), oneLine(m.account_number || "")].filter(
      Boolean,
    );
    const holder = m.account_holder ? ` ${L.holder} ${oneLine(m.account_holder)}` : "";
    return `${L.bank}: ${parts.join(" ")}${holder}`;
  };

  const intro = L.intro[i.kind](brand);
  const tail = fullyPaid ? L.paidFull : open ? L.reply : "";
  const text = [
    `${L.hello} ${name},`,
    "",
    intro,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(methods.length ? ["", `${L.pay}:`, ...methods.map((m) => `• ${methodLine(m)}`)] : []),
    ...(link ? ["", `${L.linkText}: ${link}`] : []),
    ...(tail ? ["", tail] : []),
    "",
    L.thanks,
  ].join("\n");

  const td = "padding:8px 12px;border-bottom:1px solid #e6e1d3";
  const rowsHtml = rows
    .map(
      ([k, v], idx) =>
        `<tr><td style="${td};color:#4d5f57">${esc(k)}</td><td style="${td};font-family:monospace;text-align:right${idx === rows.length - 1 || k === L.remaining ? ";font-weight:bold" : ""}">${esc(v)}</td></tr>`,
    )
    .join("");
  const accent = i.kind === "overdue" ? "#b5452b" : "#1f3029";
  const methodsHtml = methods.length
    ? `<h3 style="margin:20px 0 6px;font-size:15px">${esc(L.pay)}</h3><ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.6">${methods.map((m) => `<li>${esc(methodLine(m))}</li>`).join("")}</ul>`
    : "";
  const linkHtml = link
    ? `<p style="margin:20px 0 0"><a href="${esc(link)}" style="display:inline-block;background:#1f3029;color:#fdfbf6;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold">${esc(L.link)}</a></p><p style="margin:8px 0 0;font-size:12px;color:#4d5f57;word-break:break-all">${esc(link)}</p>`
    : "";
  const html = `<div style="font-family:Arial,sans-serif;background:#f7f3ea;padding:24px;color:#1f3029"><div style="max-width:600px;margin:auto;background:#fdfbf6;border-radius:14px;padding:24px"><h2 style="margin:0 0 4px">${esc(brand)}<span style="color:#e3b23c">.</span></h2><p style="margin:0 0 4px">${esc(L.hello)} ${esc(name)},</p><p style="margin:0 0 16px;color:${accent}">${esc(intro)}</p><table style="width:100%;border-collapse:collapse;font-size:14px">${rowsHtml}</table>${methodsHtml}${linkHtml}${tail ? `<p style="margin:20px 0 0;font-size:14px">${esc(tail)}</p>` : ""}<p style="margin:16px 0 0;font-size:14px">${esc(L.thanks)}</p></div></div>`;
  return { subject, text, html };
}
