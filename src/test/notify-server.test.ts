/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed in-memory DB fake */
import { beforeEach, describe, expect, it, vi } from "vitest";

/* Minimal in-memory PostgREST-like fake (select/insert/upsert/delete with eq/in/gte/lt/lte). */
type Row = any;
const tables: Record<string, Row[]> = {};
const missing = new Set<string>();
function q(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "insert" | "upsert" | "delete" | "update" = "select";
  let payload: any = null;
  let single = false;
  const api: any = {
    select: () => api,
    order: () => api,
    limit: () => api,
    range: () => api,
    insert: (v: any) => ((op = "insert"), (payload = v), api),
    upsert: (v: any) => ((op = "upsert"), (payload = v), api),
    update: (v: any) => ((op = "update"), (payload = v), api),
    delete: () => ((op = "delete"), api),
    eq: (k: string, v: any) => (filters.push((r) => String(r[k]) === String(v)), api),
    neq: (k: string, v: any) => (filters.push((r) => r[k] !== v), api),
    in: (k: string, v: any[]) => (filters.push((r) => v.includes(r[k])), api),
    gte: (k: string, v: any) => (filters.push((r) => r[k] >= v), api),
    lt: (k: string, v: any) => (filters.push((r) => r[k] < v), api),
    lte: (k: string, v: any) => (filters.push((r) => r[k] <= v), api),
    not: () => api,
    like: () => api,
    ilike: () => api,
    maybeSingle: () => ((single = true), api),
    single: () => ((single = true), api),
    then: (res: (v: any) => void) => res(run()),
  };
  function run() {
    if (missing.has(table))
      return { data: null, error: { code: "PGRST205", message: "Could not find the table" } };
    const t = (tables[table] ??= []);
    if (op === "insert" || op === "upsert") {
      const rows = Array.isArray(payload) ? payload : [payload];
      for (const r of rows) {
        const i = op === "upsert" ? t.findIndex((x) => x.user_id === r.user_id) : -1;
        if (i >= 0) t[i] = { ...t[i], ...r };
        else t.push({ ...r });
      }
      return { data: rows, error: null };
    }
    const hit = t.filter((r) => filters.every((f) => f(r)));
    if (op === "delete") tables[table] = t.filter((r) => !hit.includes(r));
    if (op === "update") hit.forEach((r) => Object.assign(r, payload));
    const rows = hit.map((r) => ({
      ...r,
      category: tables["categories"]?.find((c) => c.id === r.category_id) ?? null,
    }));
    return { data: single ? (rows[0] ?? null) : rows, error: null };
  }
  return api;
}
vi.mock("../lib/db.server", () => ({
  db: () => ({
    from: q,
    rpc: async () => ({ data: null, error: { code: "PGRST202", message: "x" } }),
  }),
}));
vi.mock("../lib/app-settings.server", () => ({
  cachedAppSettings: () => ({ timezone: "Asia/Jakarta" }),
  getAppSettings: async () => ({ timezone: "Asia/Jakarta" }),
}));

import { buildNotifications, saveNotifySettings } from "../lib/notify.server";
import { clearIntegrationsCache } from "../lib/integrations.server";
import { reportText } from "../lib/bot.server";
import { computeReminders, remindersText, today } from "../lib/finance.server";

const DINI = "11111111-1111-4111-8111-111111111111";
const TOKO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BCA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  missing.clear();
  missing.add("integration_settings");
  clearIntegrationsCache();
  process.env["APP_USERNAME"] = "owner";
  process.env["TELEGRAM_ADMIN_CHAT_ID"] = "111";
  const d = today();
  tables["categories"] = [{ id: "c1", name: "Belanja", kind: "expense" }];
  tables["accounts"] = [
    { id: TOKO, name: "Toko Sembako", archived: false, currency: "IDR", type: "cash" },
    { id: BCA, name: "BCA", archived: false, currency: "IDR", type: "bank" },
  ];
  tables["account_balances"] = [
    { id: TOKO, name: "Toko Sembako", archived: false, currency: "IDR", balance: 500000 },
    { id: BCA, name: "BCA", archived: false, currency: "IDR", balance: 9000000 },
  ];
  tables["transactions"] = [
    {
      id: "t1",
      kind: "expense",
      amount_idr: 20000,
      occurred_at: d,
      account_id: TOKO,
      category_id: "c1",
      description: "Gula",
    },
    {
      id: "t2",
      kind: "expense",
      amount_idr: 700000,
      occurred_at: d,
      account_id: BCA,
      category_id: "c1",
      description: "Rahasia",
    },
  ];
  tables["subscriptions"] = [
    {
      id: "s1",
      name: "Listrik toko",
      amount: 100000,
      currency: "IDR",
      cycle: "monthly",
      next_due: d,
      active: true,
      account_id: TOKO,
    },
    {
      id: "s2",
      name: "Netflix",
      amount: 50000,
      currency: "IDR",
      cycle: "monthly",
      next_due: d,
      active: true,
      account_id: BCA,
    },
  ];
  tables["app_users"] = [
    { id: DINI, username: "dini", display_name: "Dini", role: "member", is_active: true },
  ];
  tables["account_permissions"] = [{ user_id: DINI, account_id: TOKO, level: "view" }];
  tables["notify_recipients"] = [
    { user_id: DINI, chat_id: "-100555", enabled: true, send_report: true, send_reminders: true },
  ];
  tables["notify_recipient_wallets"] = [];
});

describe("buildNotifications (v22)", () => {
  it("owner gets the exact global report; the member only their wallets", async () => {
    const r = await buildNotifications({
      kind: "report",
      period: "today",
      days: 3,
      skipEmpty: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [owner, dini] = r.messages;
    expect(owner).toMatchObject({ chat_id: "111", recipient: "owner", wallets: null });
    expect(owner!.text).toBe(await reportText("today"));
    expect(owner!.text).toContain("Rahasia");
    expect(dini).toMatchObject({ chat_id: "-100555", recipient: "dini", wallets: 1 });
    expect(dini!.text).toContain("👛 Dompet: Toko Sembako");
    expect(dini!.text).toContain("Gula");
    expect(dini!.text).not.toContain("Rahasia");
    expect(dini!.text).not.toMatch(/700\.000/);
  });

  it("reminders are scoped per member and skip empty lists", async () => {
    const r = await buildNotifications({ kind: "reminders", period: "", days: 3, skipEmpty: true });
    if (!r.ok) throw new Error(r.error);
    const [owner, dini] = r.messages;
    expect(owner!.text).toBe(remindersText(await computeReminders(3)));
    expect(owner!.count).toBe(2);
    expect(dini!.text).toContain("Listrik toko");
    expect(dini!.text).not.toContain("Netflix");
    tables["subscriptions"] = tables["subscriptions"]!.filter((s) => s.id === "s2");
    const r2 = await buildNotifications({
      kind: "reminders",
      period: "",
      days: 3,
      skipEmpty: true,
    });
    if (!r2.ok) throw new Error(r2.error);
    expect(r2.messages.map((m) => m.recipient)).toEqual(["owner"]);
  });

  it("revoked access removes the member; a checklist outside access is ignored", async () => {
    tables["notify_recipient_wallets"] = [{ user_id: DINI, account_id: BCA }];
    const r = await buildNotifications({
      kind: "report",
      period: "today",
      days: 3,
      skipEmpty: true,
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.messages.map((m) => m.recipient)).toEqual(["owner"]);
  });

  it("works before v22 (owner only) and without an admin chat id", async () => {
    missing.add("notify_recipients");
    const r = await buildNotifications({
      kind: "report",
      period: "today",
      days: 3,
      skipEmpty: true,
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.messages.map((m) => m.recipient)).toEqual(["owner"]);
    missing.delete("notify_recipients");
    delete process.env["TELEGRAM_ADMIN_CHAT_ID"];
    clearIntegrationsCache();
    const r2 = await buildNotifications({
      kind: "report",
      period: "today",
      days: 3,
      skipEmpty: true,
    });
    if (!r2.ok) throw new Error(r2.error);
    expect(r2.messages.map((m) => m.recipient)).toEqual(["dini"]);
  });

  it("rejects an unknown period", async () => {
    const r = await buildNotifications({ kind: "report", period: "zzz", days: 3, skipEmpty: true });
    expect(r.ok).toBe(false);
  });
});

describe("saveNotifySettings (v22)", () => {
  const base = {
    user_id: DINI,
    chat_id: "42",
    enabled: true,
    send_report: true,
    send_reminders: false,
  };
  it("stores the chat id and a checklist within the member's access", async () => {
    await saveNotifySettings({ ...base, wallets: [TOKO] });
    expect(tables["notify_recipients"]![0]).toMatchObject({ chat_id: "42", send_reminders: false });
    expect(tables["notify_recipient_wallets"]).toEqual([{ user_id: DINI, account_id: TOKO }]);
  });
  it("refuses wallets outside access and the owner", async () => {
    await expect(saveNotifySettings({ ...base, wallets: [BCA] })).rejects.toThrow(/luar akses/);
    tables["app_users"]!.push({
      id: "22222222-2222-4222-8222-222222222222",
      username: "owner",
      role: "admin",
      is_active: true,
    });
    await expect(
      saveNotifySettings({ ...base, user_id: "22222222-2222-4222-8222-222222222222", wallets: [] }),
    ).rejects.toThrow(/TELEGRAM_ADMIN_CHAT_ID/);
  });
});
