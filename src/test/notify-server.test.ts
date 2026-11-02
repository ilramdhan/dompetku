/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed in-memory DB fake */
import { beforeEach, describe, expect, it, vi } from "vitest";

/* Minimal in-memory PostgREST-like fake (select/insert/upsert/delete with eq/in/gte/lt/lte). */
type Row = any;
const tables: Record<string, Row[]> = {};
const missing = new Set<string>();
/** `${table}.${op}` → error returned once per call (simulated write failures). */
const failing = new Set<string>();
function q(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "insert" | "upsert" | "delete" | "update" = "select";
  let payload: any = null;
  let single = false;
  let conflict = "user_id";
  let ignoreDup = false;
  const api: any = {
    select: () => api,
    order: () => api,
    limit: () => api,
    range: () => api,
    insert: (v: any) => ((op = "insert"), (payload = v), api),
    upsert: (v: any, o?: any) => (
      (op = "upsert"),
      (payload = v),
      (conflict = o?.onConflict ?? "user_id"),
      (ignoreDup = !!o?.ignoreDuplicates),
      api
    ),
    update: (v: any) => ((op = "update"), (payload = v), api),
    delete: () => ((op = "delete"), api),
    eq: (k: string, v: any) => (filters.push((r) => String(r[k]) === String(v)), api),
    neq: (k: string, v: any) => (filters.push((r) => r[k] !== v), api),
    in: (k: string, v: any[]) => (filters.push((r) => v.includes(r[k])), api),
    gte: (k: string, v: any) => (filters.push((r) => r[k] >= v), api),
    lt: (k: string, v: any) => (filters.push((r) => r[k] < v), api),
    lte: (k: string, v: any) => (filters.push((r) => r[k] <= v), api),
    not: (k: string, o: string, v: string) => {
      if (o === "in") {
        const ids = v.replace(/^\(|\)$/g, "").split(",");
        filters.push((r) => !ids.includes(r[k]));
      }
      return api;
    },
    like: () => api,
    ilike: () => api,
    maybeSingle: () => ((single = true), api),
    single: () => ((single = true), api),
    then: (res: (v: any) => void) => res(run()),
  };
  function run() {
    if (missing.has(table))
      return { data: null, error: { code: "PGRST205", message: "Could not find the table" } };
    if (failing.has(`${table}.${op}`))
      return { data: null, error: { code: "23503", message: `${op} failed` } };
    const t = (tables[table] ??= []);
    if (op === "insert" || op === "upsert") {
      const rows = Array.isArray(payload) ? payload : [payload];
      const keys = conflict.split(",");
      for (const r of rows) {
        const i = op === "upsert" ? t.findIndex((x) => keys.every((k) => x[k] === r[k])) : -1;
        if (i >= 0) {
          if (!ignoreDup) t[i] = { ...t[i], ...r };
        } else t.push({ ...r });
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

import {
  buildNotifications,
  getMyNotify,
  listNotifySettings,
  saveMyNotify,
  saveNotifySettings,
} from "../lib/notify.server";
import { chatAllowed } from "../lib/bot.server";
import { clearIntegrationsCache } from "../lib/integrations.server";
import { reportText } from "../lib/bot.server";
import { computeReminders, remindersText, today } from "../lib/finance.server";

const DINI = "11111111-1111-4111-8111-111111111111";
const TOKO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BCA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  missing.clear();
  failing.clear();
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

describe("member self-service (#122)", () => {
  const mine = { chat_id: "777", send_report: true, send_reminders: false, wallets: [TOKO] };
  it("reads only the member's own row and viewable wallets", async () => {
    const r = await getMyNotify(DINI);
    expect(r).toMatchObject({ ready: true, chat_id: "-100555", wallets: [] });
    expect(r.options).toEqual([{ id: TOKO, name: "Toko Sembako" }]);
  });
  it("saves the own row, keeps the admin's enabled flag, never touches the bot allow-list", async () => {
    process.env["BOT_ALLOWED_CHAT_IDS"] = "111";
    clearIntegrationsCache();
    tables["notify_recipients"]![0].enabled = true;
    await saveMyNotify(DINI, mine);
    expect(tables["notify_recipients"]).toHaveLength(1);
    expect(tables["notify_recipients"]![0]).toMatchObject({
      user_id: DINI,
      chat_id: "777",
      enabled: true,
      send_reminders: false,
    });
    expect(tables["notify_recipient_wallets"]).toEqual([{ user_id: DINI, account_id: TOKO }]);
    expect(await chatAllowed("777")).toBe(false);
    expect(await chatAllowed("111")).toBe(true);
    expect(tables["integration_settings"] ?? []).toEqual([]);
    delete process.env["BOT_ALLOWED_CHAT_IDS"];
    clearIntegrationsCache();
  });
  it("refuses wallets outside access, the owner, and before v22", async () => {
    await expect(saveMyNotify(DINI, { ...mine, wallets: [BCA] })).rejects.toThrow(/luar akses/);
    tables["app_users"]!.push({
      id: "22222222-2222-4222-8222-222222222222",
      username: "owner",
      role: "admin",
      is_active: true,
    });
    await expect(saveMyNotify("22222222-2222-4222-8222-222222222222", mine)).rejects.toThrow(
      /TELEGRAM_ADMIN_CHAT_ID/,
    );
    missing.add("notify_recipients");
    await expect(saveMyNotify(DINI, mine)).rejects.toThrow(/v22/);
    expect((await getMyNotify(DINI)).ready).toBe(false);
  });
  it("empty chat id stops notifications, but never lifts an admin mute", async () => {
    await saveMyNotify(DINI, { ...mine, chat_id: "" });
    expect(tables["notify_recipients"]).toEqual([]);
    tables["notify_recipients"] = [
      { user_id: DINI, chat_id: "5", enabled: false, send_report: true, send_reminders: true },
    ];
    await saveMyNotify(DINI, { ...mine, chat_id: "" });
    expect(tables["notify_recipients"]).toHaveLength(1);
    await saveMyNotify(DINI, mine);
    expect(tables["notify_recipients"]![0]).toMatchObject({ chat_id: "777", enabled: false });
  });
});

describe("security review fixes (#122)", () => {
  const mine = { chat_id: "777", send_report: true, send_reminders: false, wallets: [TOKO] };
  const both = () => {
    tables["account_permissions"]!.push({ user_id: DINI, account_id: BCA, level: "view" });
  };
  const logged = (action: string) =>
    (tables["activity_log"] ?? []).filter((r: any) => r.action === action);

  it("L2: a failed checklist insert disables the row instead of widening to all wallets", async () => {
    both();
    tables["notify_recipient_wallets"] = [{ user_id: DINI, account_id: BCA }];
    failing.add("notify_recipient_wallets.upsert");
    await expect(saveMyNotify(DINI, mine)).rejects.toThrow(/dinonaktifkan/);
    expect(tables["notify_recipients"]![0]).toMatchObject({ enabled: false });
    // The old subset is untouched (nothing deleted before the insert succeeded).
    expect(tables["notify_recipient_wallets"]).toEqual([{ user_id: DINI, account_id: BCA }]);
    const r = await buildNotifications({
      kind: "report",
      period: "today",
      days: 3,
      skipEmpty: true,
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.messages.map((m) => m.recipient)).toEqual(["owner"]);
  });

  it("L2: same for the admin save; the row is deleted when it cannot be disabled", async () => {
    failing.add("notify_recipient_wallets.upsert");
    failing.add("notify_recipients.update");
    await expect(
      saveNotifySettings({
        user_id: DINI,
        chat_id: "42",
        enabled: true,
        send_report: true,
        send_reminders: true,
        wallets: [TOKO],
      }),
    ).rejects.toThrow(/dinonaktifkan/);
    expect(tables["notify_recipients"]).toEqual([]);
  });

  it("L2: a subset rewrite keeps the overlap and drops the rest", async () => {
    both();
    tables["notify_recipient_wallets"] = [
      { user_id: DINI, account_id: TOKO },
      { user_id: DINI, account_id: BCA },
    ];
    await saveMyNotify(DINI, mine);
    expect(tables["notify_recipient_wallets"]).toEqual([{ user_id: DINI, account_id: TOKO }]);
    await saveMyNotify(DINI, { ...mine, wallets: [] });
    expect(tables["notify_recipient_wallets"]).toEqual([]);
    expect(tables["notify_recipients"]![0].enabled).toBe(true);
  });

  it("L3: unchanged saves write nothing and log nothing", async () => {
    await saveMyNotify(DINI, mine);
    expect(logged("notify.self_update")).toHaveLength(1);
    const at = tables["notify_recipients"]![0].updated_at;
    failing.add("notify_recipients.upsert");
    await saveMyNotify(DINI, { ...mine, wallets: [TOKO, TOKO] });
    expect(logged("notify.self_update")).toHaveLength(1);
    expect(tables["notify_recipients"]![0].updated_at).toBe(at);
    failing.clear();
    await saveMyNotify(DINI, { ...mine, send_report: false });
    expect(logged("notify.self_update")).toHaveLength(2);
  });

  it("L3: a delete is logged only when a row was removed", async () => {
    await saveMyNotify(DINI, { ...mine, chat_id: "" });
    expect(logged("notify.self_delete")).toHaveLength(1);
    await saveMyNotify(DINI, { ...mine, chat_id: "" });
    await saveMyNotify(DINI, { ...mine, chat_id: "" });
    expect(logged("notify.self_delete")).toHaveLength(1);
  });

  it("L1: the self-update log carries a masked chat id and the admin list shows set_by", async () => {
    await saveMyNotify(DINI, { ...mine, chat_id: "-1001234567" });
    const [row] = logged("notify.self_update");
    expect(row.detail).toMatchObject({ user_id: DINI, chat: "-•••4567" });
    expect(JSON.stringify(row.detail)).not.toContain("1001234567");
    const list = await listNotifySettings({ setBy: true });
    expect(list.items[0]).toMatchObject({ user_id: DINI, set_by: "member" });
    expect((await listNotifySettings()).items[0]!.set_by).toBeNull();
  });
});
