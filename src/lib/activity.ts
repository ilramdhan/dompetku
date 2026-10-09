/** Human-readable labels for activity_log actions (client-safe, unit-tested). Labels are Indonesian i18n keys. */
const ENTITY: Record<string, string> = {
  transaction: "Transaksi",
  transactions: "Transaksi",
  accounts: "Akun",
  categories: "Kategori",
  debts: "Hutang",
  subscriptions: "Langganan",
  budgets: "Budget",
  goals: "Target",
  gold_purchases: "Emas",
  receivables: "Piutang",
  recurring_transactions: "Transaksi Berulang",
};

const VERB: Record<string, string> = {
  create: "ditambahkan",
  update: "diubah",
  delete: "dihapus",
};

const SPECIAL: Record<string, string> = {
  "debt.pay": "Cicilan dibayar",
  "debt_payment.delete": "Pembayaran cicilan dibatalkan",
  "subscription.pay": "Langganan ditandai sudah bayar",
  "receivable.pay": "Pembayaran piutang diterima",
  "receivable.settle": "Piutang ditandai lunas",
  "receivable.reopen": "Piutang dibuka kembali",
  "receivable_payment.delete": "Pembayaran piutang dibatalkan",
  "goal.funds": "Dana target diperbarui",
  import: "Impor CSV",
  "backup.export": "Cadangan diunduh",
  "backup.restore": "Cadangan dipulihkan",
  "auth.login": "Login berhasil",
  "auth.login_failed": "Login gagal",
  "auth.logout": "Logout",
  "bot.command": "Perintah bot",
  "account.reconcile": "Akun direkonsiliasi",
  "transaction.split": "Transaksi split ditambahkan",
  "recurring.post": "Transaksi berulang dicatat",
  "recurring.pause": "Transaksi berulang dijeda",
  "recurring.resume": "Transaksi berulang dilanjutkan",
  "app_settings.update": "Pengaturan aplikasi diubah",
  "integration.update": "Pengaturan integrasi diubah",
  "integration.delete": "Pengaturan integrasi dihapus (kembali ke env)",
  "integration.webhook_set": "Webhook Telegram dipasang",
  "integration.webhook_delete": "Webhook Telegram dilepas",
  "profile.update": "Profil diubah",
  "auth.password_change": "Password diganti",
  "auth.password_reset_login": "Login dengan APP_PASSWORD_RESET",
  "user.create": "Anggota ditambahkan",
  "user.update": "Anggota diubah",
  "user.delete": "Anggota dihapus",
  "user.password_reset": "Password anggota direset",
  "permission.update": "Akses dompet diubah",
};

export function activityLabel(action: string, t: (s: string) => string = (s) => s): string {
  if (SPECIAL[action]) return t(SPECIAL[action]!);
  const [entity, verb] = action.split(".");
  if (entity && verb && ENTITY[entity] && VERB[verb])
    return `${t(ENTITY[entity]!)} ${t(VERB[verb]!)}`;
  return action;
}

/** Short detail suffix: name/description and formatted amount when present. */
export function activityDetail(detail: unknown, fmt: (n: number, c: string) => string): string {
  if (!detail || typeof detail !== "object") return "";
  const d = detail as Record<string, unknown>;
  const parts: string[] = [];
  const name = d["name"] ?? d["description"] ?? d["text"];
  if (typeof name === "string" && name) parts.push(name);
  const amt = Number(d["amount"]);
  if (Number.isFinite(amt) && amt > 0 && d["amount"] != null)
    parts.push(fmt(amt, typeof d["currency"] === "string" ? (d["currency"] as string) : "IDR"));
  if (typeof d["from"] === "string" && typeof d["to"] === "string")
    parts.push(`${d["from"]} → ${d["to"]}`);
  if (typeof d["imported"] === "number") parts.push(`${d["imported"]} baris`);
  if (typeof d["restored"] === "number") parts.push(`${d["restored"]} baris`);
  if (typeof d["rows"] === "number") parts.push(`${d["rows"]} baris`);
  return parts.join(" · ");
}
