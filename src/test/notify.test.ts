import { describe, expect, it } from "vitest";
import {
  chatIdProblem,
  inNotifyScope,
  isNotifyKind,
  normalizeChatId,
  myNotifySchema,
  maskChatId,
  notifyRecipientSchema,
  notifySetByMap,
  sameSelfNotify,
  planSelfNotify,
  selfNotifyUserId,
  notifyScope,
  planRecipients,
  withWalletLine,
  type NotifyMember,
} from "@/lib/notify";
import { RESTORE_TABLES } from "@/lib/backup";
import { activityLabel } from "@/lib/activity";
import { validateIntegration } from "@/lib/integrations";

const U1 = "11111111-1111-4111-8111-111111111111";
const W1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const W2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const member = (over: Partial<NotifyMember> = {}): NotifyMember => ({
  user_id: U1,
  username: "dini",
  display_name: null,
  role: "member",
  is_active: true,
  chat_id: "555",
  enabled: true,
  send_report: true,
  send_reminders: true,
  wallets: [],
  grants: { [W1]: "view", [W2]: "manage" },
  ...over,
});

describe("chat ids (v22 notifications)", () => {
  it("accepts private and group ids, refuses anything else", () => {
    expect(normalizeChatId(" 123456789 ")).toBe("123456789");
    expect(normalizeChatId("-1001234567890")).toBe("-1001234567890");
    expect(normalizeChatId(42)).toBe("42");
    for (const bad of ["", "abc", "12 34", "+123", "0", "-0", "1".repeat(21), "1e5", null, {}])
      expect(normalizeChatId(bad as never)).toBeNull();
  });
  it("gives i18n problems", () => {
    expect(chatIdProblem("")).toBe("Chat ID wajib diisi");
    expect(chatIdProblem("@user")).toMatch(/angka/);
    expect(chatIdProblem("-100123")).toBeNull();
  });
  it("validates the admin chat id integration key", () => {
    expect(validateIntegration("TELEGRAM_ADMIN_CHAT_ID", " -100123 ")).toEqual({
      ok: true,
      value: "-100123",
    });
    expect(validateIntegration("TELEGRAM_ADMIN_CHAT_ID", "abc").ok).toBe(false);
    expect(validateIntegration("TELEGRAM_ADMIN_CHAT_ID", "0").ok).toBe(false);
  });
  it("parses the admin form input", () => {
    const ok = notifyRecipientSchema.parse({
      user_id: U1,
      chat_id: " -42 ",
      enabled: true,
      send_report: true,
      send_reminders: false,
      wallets: [W1],
    });
    expect(ok.chat_id).toBe("-42");
    expect(() => notifyRecipientSchema.parse({ ...ok, chat_id: "x" })).toThrow();
    expect(() => notifyRecipientSchema.parse({ ...ok, wallets: ["nope"] })).toThrow();
  });
  it("knows the notification kinds", () => {
    expect(isNotifyKind("report")).toBe(true);
    expect(isNotifyKind("reminders")).toBe(true);
    expect(isNotifyKind("backup")).toBe(false);
  });
});

describe("notification scope", () => {
  it("is the viewable wallets, narrowed by the checklist; revoked access wins", () => {
    const g = { [W1]: "view", [W2]: "manage" } as const;
    expect(notifyScope(g, [])).toEqual([W1, W2]);
    expect(notifyScope(g, null)).toEqual([W1, W2]);
    expect(notifyScope(g, [W2])).toEqual([W2]);
    expect(notifyScope({ [W1]: "view" }, [W2])).toEqual([]);
    expect(notifyScope({}, [])).toEqual([]);
  });
  it("matches items by any linked wallet", () => {
    expect(inNotifyScope(null, null)).toBe(true);
    expect(inNotifyScope([W1], null)).toBe(false);
    expect(inNotifyScope([W1], W2, W1)).toBe(true);
    expect(inNotifyScope([W1], W2)).toBe(false);
  });
  it("adds the wallet line under the title", () => {
    expect(withWalletLine("📊 Laporan\n\nx", ["Toko", "BCA"])).toBe(
      "📊 Laporan\n👛 Dompet: Toko, BCA\n\nx",
    );
    expect(withWalletLine("only", ["A"])).toBe("only\n👛 Dompet: A");
    expect(withWalletLine("t", [])).toBe("t");
  });
});

describe("planRecipients", () => {
  it("owner first with the global scope, then enabled members with their scope", () => {
    const plan = planRecipients({
      adminChatId: "111",
      kind: "report",
      members: [member({ wallets: [W1] })],
    });
    expect(plan).toEqual([
      { chat_id: "111", user_id: null, username: null, scope: null },
      { chat_id: "555", user_id: U1, username: "dini", scope: [W1] },
    ]);
  });
  it("skips disabled, inactive, opted-out, wallet-less and owner-chat members", () => {
    const kinds = (m: NotifyMember, kind: "report" | "reminders" = "report") =>
      planRecipients({ adminChatId: "111", kind, members: [m] }).length;
    expect(kinds(member({ enabled: false }))).toBe(1);
    expect(kinds(member({ is_active: false }))).toBe(1);
    expect(kinds(member({ role: "admin" }))).toBe(1);
    expect(kinds(member({ send_report: false }))).toBe(1);
    expect(kinds(member({ send_report: false }), "reminders")).toBe(2);
    expect(kinds(member({ send_reminders: false }), "reminders")).toBe(1);
    expect(kinds(member({ grants: {} }))).toBe(1);
    expect(kinds(member({ chat_id: "111" }))).toBe(1);
    expect(kinds(member({ chat_id: "bad" }))).toBe(1);
  });
  it("works without an admin chat id and dedupes identical chat+scope", () => {
    const plan = planRecipients({
      adminChatId: undefined,
      kind: "reminders",
      members: [member(), member({ user_id: "u2", username: "budi" })],
    });
    expect(plan).toHaveLength(1);
    expect(plan[0]!.scope).toEqual([W1, W2]);
  });
});

describe("v22 backup + activity", () => {
  it("restores notify tables after their parents", () => {
    const i = (t: string) => (RESTORE_TABLES as readonly string[]).indexOf(t);
    expect(i("app_users")).toBeLessThan(i("notify_recipients"));
    expect(i("accounts")).toBeLessThan(i("notify_recipient_wallets"));
    expect(i("notify_recipients")).toBeLessThan(i("notify_recipient_wallets"));
  });
  it("labels notification activity", () => {
    expect(activityLabel("notify.update")).toBe("Notifikasi anggota diubah");
    expect(activityLabel("notify.delete")).toBe("Notifikasi anggota dihapus");
  });
});

describe("member self-service notifications (#122)", () => {
  const base = { send_report: true, send_reminders: false, wallets: [] as string[] };
  it("validates the chat id; empty = stop", () => {
    expect(myNotifySchema.parse({ ...base, chat_id: " 42 " }).chat_id).toBe("42");
    expect(myNotifySchema.parse({ ...base, chat_id: "  " }).chat_id).toBe("");
    expect(myNotifySchema.parse({ ...base, chat_id: "-100123" }).chat_id).toBe("-100123");
    expect(() => myNotifySchema.parse({ ...base, chat_id: "abc" })).toThrow();
    expect(() => myNotifySchema.parse({ ...base, chat_id: "0" })).toThrow();
    // No user id / enabled flag can be smuggled in: zod strips unknown keys.
    const parsed = myNotifySchema.parse({ ...base, chat_id: "1", user_id: U1, enabled: true });
    expect(parsed).not.toHaveProperty("user_id");
    expect(parsed).not.toHaveProperty("enabled");
  });
  it("plans delete / save / refuse wallets outside the fresh grants", () => {
    const grants = { [W1]: "view" as const };
    expect(planSelfNotify({ ...base, chat_id: "" }, grants)).toEqual({ action: "delete" });
    expect(planSelfNotify({ ...base, chat_id: "" }, grants, { muted: true })).toEqual({
      action: "keep",
    });
    expect(planSelfNotify({ ...base, chat_id: "5", wallets: [W1, W1] }, grants)).toEqual({
      action: "save",
      wallets: [W1],
    });
    expect(planSelfNotify({ ...base, chat_id: "5", wallets: [W2] }, grants)).toMatchObject({
      action: "error",
    });
  });
  it("acts only on the session's own member id", () => {
    expect(selfNotifyUserId([W1], U1)).toBe(U1);
    expect(selfNotifyUserId([], U1)).toBe(U1);
    expect(() => selfNotifyUserId(null, U1)).toThrow(/TELEGRAM_ADMIN_CHAT_ID/);
    expect(() => selfNotifyUserId([W1], null)).toThrow();
  });
  it("labels the self-service activity", () => {
    expect(activityLabel("notify.self_update")).not.toBe("notify.self_update");
    expect(activityLabel("notify.self_delete")).not.toBe("notify.self_delete");
  });
});

describe("security review helpers (#122)", () => {
  it("maskChatId keeps the sign and the last 4 digits", () => {
    expect(maskChatId("-1001234567")).toBe("-•••4567");
    expect(maskChatId(" 987654321 ")).toBe("•••4321");
    expect(maskChatId("42")).toBe("•••2");
    expect(maskChatId("abc")).toBe("");
    expect(maskChatId(null)).toBe("");
  });

  it("notifySetByMap takes the newest saver per member (user_id, then username)", () => {
    const users = [
      { user_id: "u1", username: "dini" },
      { user_id: "u2", username: "budi" },
    ];
    const map = notifySetByMap(
      [
        { action: "notify.self_update", detail: { name: "dini", user_id: "u1" } },
        { action: "notify.update", detail: { name: "dini", user_id: "u1" } },
        { action: "notify.update", detail: { name: "BUDI" } },
        { action: "notify.self_update", detail: { name: "budi" } },
        { action: "notify.delete", detail: { name: "x" } },
        { action: "notify.self_update", detail: null },
      ],
      users,
    );
    expect(map).toEqual({ u1: "member", u2: "admin" });
    expect(notifySetByMap([], users)).toEqual({});
  });

  it("sameSelfNotify compares chat id, toggles and the wallet set", () => {
    const cur = { chat_id: "7", send_report: true, send_reminders: false, wallets: ["b", "a"] };
    expect(sameSelfNotify(cur, { ...cur, wallets: ["a", "b", "a"] })).toBe(true);
    expect(sameSelfNotify(cur, { ...cur, chat_id: "8" })).toBe(false);
    expect(sameSelfNotify(cur, { ...cur, send_report: false })).toBe(false);
    expect(sameSelfNotify(cur, { ...cur, wallets: ["a"] })).toBe(false);
    expect(sameSelfNotify(null, cur)).toBe(false);
  });
});
