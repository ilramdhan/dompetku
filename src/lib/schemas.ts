import { z } from "zod";
import { parsePresets } from "./fees";
import { firstDue } from "./recurring";

export const CURRENCIES = ["IDR", "USD"] as const;
export const CRUD_TABLES = [
  "accounts",
  "categories",
  "debts",
  "subscriptions",
  "budgets",
  "goals",
  "gold_purchases",
  "recurring_transactions",
] as const;
export type CrudTable = (typeof CRUD_TABLES)[number];
export const DELETABLE_TABLES = [...CRUD_TABLES, "transactions", "debt_payments"] as const;

const emptyToNull = (v: unknown) => (v === "" || v === undefined ? null : v);
const optId = z.preprocess(emptyToNull, z.string().uuid().nullable());
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal YYYY-MM-DD");
const optDate = z.preprocess(emptyToNull, dateStr.nullable());
const optText = (max: number) => z.preprocess(emptyToNull, z.string().trim().max(max).nullable());
const money = z.coerce.number().finite().positive("Jumlah harus lebih dari 0");

export const accountSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(["bank", "ewallet", "cash", "credit_card", "investment", "other"]),
  currency: z.enum(CURRENCIES),
  initial_balance: z.coerce.number().finite().default(0),
  color: optText(20),
  archived: z.boolean().default(false),
  transfer_fees: z
    .preprocess(
      (v) => parsePresets(v),
      z.array(z.object({ label: z.string(), amount: z.number() })),
    )
    .default([]),
  topup_fees: z
    .preprocess(
      (v) => parsePresets(v),
      z.array(z.object({ label: z.string(), amount: z.number() })),
    )
    .default([]),
  monthly_fee: z.preprocess(emptyToNull, z.coerce.number().min(0).nullable()).default(null),
  monthly_fee_day: z
    .preprocess(emptyToNull, z.coerce.number().int().min(1).max(31).nullable())
    .default(null),
});
export const ACCOUNT_FEE_COLUMNS = [
  "transfer_fees",
  "topup_fees",
  "monthly_fee",
  "monthly_fee_day",
] as const;

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(["income", "expense"]),
  color: optText(20),
});

export const itemSchema = z.object({
  name: z.string().max(200),
  qty: z.coerce.number().nullable().optional(),
  price: z.coerce.number().nullable().optional(),
});

export const transactionSchema = z.object({
  kind: z.enum(["income", "expense", "transfer"]),
  amount: money,
  currency: z.enum(CURRENCIES).default("IDR"),
  account_id: optId,
  to_account_id: optId,
  category_id: optId,
  description: optText(500),
  merchant: optText(200),
  occurred_at: dateStr,
  source: z.enum(["web", "telegram", "whatsapp", "ocr", "n8n", "import"]).default("web"),
  items: z.array(itemSchema).max(200).nullable().default(null),
  notes: optText(1000),
  receipt_path: optText(500),
  /** v12: up to 5 photos; receipt_path is saved as the first one. */
  receipt_paths: z.array(z.string().min(1).max(500)).max(5).nullable().optional(),
  fee: z.preprocess(emptyToNull, z.coerce.number().min(0).nullable()).optional(),
  /** v19 Kantong of the source wallet; undefined = leave unchanged on edit. */
  pocket_id: optId.optional(),
});
export type TransactionInput = z.output<typeof transactionSchema>;

/** v19 Kantong (envelope) inside one wallet. The wallet is fixed at creation. */
export const pocketSchema = z.object({
  name: z.string().trim().min(1).max(60),
  allocated: z.coerce.number().finite().min(0).max(1e13),
  min_balance: z
    .preprocess(emptyToNull, z.coerce.number().finite().min(0).max(1e13).nullable())
    .default(null),
  period: z.enum(["monthly", "none"]).default("monthly"),
  icon: optText(40).default(null),
  color: optText(20).default(null),
  archived: z.boolean().default(false),
  sort_order: z.coerce.number().int().min(0).max(10_000).default(0),
});
export type PocketInput = z.output<typeof pocketSchema>;

export const debtSchema = z.object({
  name: z.string().trim().min(1).max(100),
  provider: optText(100),
  kind: z.enum(["paylater", "loan", "credit_card", "personal", "other"]),
  currency: z.enum(CURRENCIES),
  total_amount: money,
  installment_amount: money,
  total_installments: z.coerce.number().int().min(1).max(600),
  start_date: dateStr,
  due_day: z.coerce.number().int().min(1).max(31),
  interest_rate: z.preprocess(emptyToNull, z.coerce.number().min(0).max(1000).nullable()),
  account_id: optId,
  notes: optText(1000),
  status: z.enum(["active", "paid_off"]).default("active"),
});

export const subscriptionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  amount: money,
  currency: z.enum(CURRENCIES),
  cycle: z.enum(["monthly", "yearly"]),
  next_due: dateStr,
  account_id: optId,
  category_id: optId,
  active: z.boolean().default(true),
  tax_percent: z
    .preprocess(emptyToNull, z.coerce.number().min(0).max(100).nullable())
    .default(null),
  notes: optText(1000),
});

export const budgetSchema = z.object({
  category_id: z.string().uuid("Pilih kategori"),
  amount: money,
  alert_percent: z.coerce.number().int().min(1).max(100).default(80),
  /** v11: carry last month's remainder (or overspend) into this month. */
  rollover: z.boolean().default(false),
});

export const goalSchema = z.object({
  name: z.string().trim().min(1).max(100),
  target_amount: money,
  saved_amount: z.coerce.number().min(0).default(0),
  deadline: optDate,
  color: optText(20),
  account_id: optId.default(null),
});

export const goldSchema = z
  .object({
    kind: z.enum(["buy", "sell"]).default("buy"),
    occurred_at: dateStr,
    grams: z.coerce.number().finite().positive("Gram harus lebih dari 0").max(100000),
    price_per_gram: money,
    total: z.preprocess(emptyToNull, z.coerce.number().finite().positive().nullable()),
    place: optText(100),
    gold_type: optText(100),
    product_number: optText(120),
    account_id: optId.default(null),
    notes: optText(1000),
  })
  .transform((v) => ({ ...v, total: v.total ?? Math.round(v.grams * v.price_per_gram) }));
export type GoldInput = z.infer<typeof goldSchema>;

export const receivableSchema = z.object({
  name: z.string().trim().min(1).max(100),
  borrower: optText(100),
  amount: money,
  currency: z.enum(CURRENCIES).default("IDR"),
  lent_at: dateStr,
  due_date: optDate,
  account_id: optId,
  notes: optText(1000),
});
export type ReceivableInput = z.output<typeof receivableSchema>;

/** v10: recurring income/expense/transfer (salary, rent, routine transfers). */
export const recurringSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    kind: z.enum(["income", "expense", "transfer"]),
    amount: money,
    currency: z.enum(CURRENCIES).default("IDR"),
    account_id: optId.default(null),
    to_account_id: optId.default(null),
    category_id: optId.default(null),
    description: optText(500).default(null),
    merchant: optText(200).default(null),
    cycle: z.enum(["weekly", "monthly", "yearly"]).default("monthly"),
    interval: z
      .preprocess(emptyToNull, z.coerce.number().int().min(1).max(36).nullable())
      .default(1),
    day_of_month: z
      .preprocess(emptyToNull, z.coerce.number().int().min(1).max(31).nullable())
      .default(null),
    start_date: dateStr,
    next_due: optDate.default(null),
    end_date: optDate.default(null),
    auto_post: z.boolean().default(true),
    active: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "transfer" && (!v.account_id || !v.to_account_id))
      ctx.addIssue({
        code: "custom",
        path: ["to_account_id"],
        message: "Pilih akun asal & tujuan",
      });
    if (v.kind === "transfer" && v.account_id && v.account_id === v.to_account_id)
      ctx.addIssue({ code: "custom", path: ["to_account_id"], message: "Akun tujuan harus beda" });
    if (v.end_date && v.end_date < v.start_date)
      ctx.addIssue({ code: "custom", path: ["end_date"], message: "Tanggal akhir sebelum mulai" });
  })
  .transform((v) => ({
    ...v,
    interval: v.interval ?? 1,
    category_id: v.kind === "transfer" ? null : v.category_id,
    to_account_id: v.kind === "transfer" ? v.to_account_id : null,
    next_due: v.next_due ?? firstDue(v),
  }));
export type RecurringInput = z.output<typeof recurringSchema>;

export const tableSchemas: Record<CrudTable, z.ZodTypeAny> = {
  accounts: accountSchema,
  categories: categorySchema,
  debts: debtSchema,
  subscriptions: subscriptionSchema,
  budgets: budgetSchema,
  goals: goalSchema,
  gold_purchases: goldSchema,
  recurring_transactions: recurringSchema,
};

/** Payload from n8n / bots. Category & account are matched by name. */
export const externalTxSchema = z.object({
  kind: z.enum(["income", "expense", "transfer"]).default("expense"),
  amount: z.coerce.number().positive(),
  currency: z.enum(CURRENCIES).default("IDR"),
  category: z.string().max(60).nullable().optional(),
  account: z.string().max(80).nullable().optional(),
  to_account: z.string().max(80).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  merchant: z.string().max(200).nullable().optional(),
  date: dateStr.nullable().optional(),
  source: z.enum(["web", "telegram", "whatsapp", "ocr", "n8n"]).default("n8n"),
  items: z.array(itemSchema).max(200).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  raw: z.unknown().optional(),
  /** Idempotency key, e.g. "draft:<bot_drafts.id>". A repeated key returns the existing transaction. */
  external_id: z.string().max(120).nullable().optional(),
  receipt_path: z.string().max(500).nullable().optional(),
  /** v19: Kantong name in the source wallet (bot "#makan" tag); unknown names are ignored. */
  pocket: z.string().max(60).nullable().optional(),
});
export type ExternalTx = z.output<typeof externalTxSchema>;

export const draftSchema = z.object({
  kind: z.enum(["income", "expense"]).catch("expense"),
  amount: z.coerce.number().catch(0),
  currency: z.enum(CURRENCIES).catch("IDR"),
  merchant: z.string().nullable().catch(null),
  date: z.string().nullable().catch(null),
  category: z.string().nullable().catch(null),
  description: z.string().nullable().catch(null),
  account: z.string().nullable().optional().catch(null),
  items: z.array(itemSchema).max(200).catch([]),
});
export type Draft = z.output<typeof draftSchema>;

// Row types used in the UI
export type Account = z.output<typeof accountSchema> & { id: string; created_at: string };
export type Category = z.output<typeof categorySchema> & { id: string };
export type Debt = z.output<typeof debtSchema> & { id: string };
export type Subscription = z.output<typeof subscriptionSchema> & { id: string };
export type Budget = z.output<typeof budgetSchema> & { id: string };
export type GoldRow = z.output<typeof goldSchema> & { id: string };
export type Goal = z.output<typeof goalSchema> & { id: string };
export type Recurring = RecurringInput & { id: string; created_at: string };

export const importRowSchema = z.object({
  date: dateStr,
  kind: z.enum(["income", "expense"]),
  amount: z.number().finite().positive(),
  currency: z.enum(CURRENCIES),
  category: z.string().trim().max(60).nullable(),
  account: z.string().trim().max(80).nullable(),
  notes: z.string().max(1000).nullable(),
});
export type ImportRowInput = z.output<typeof importRowSchema>;
