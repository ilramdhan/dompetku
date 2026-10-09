/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed DB fake */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let rows: any[] = [];
let failWith: { message: string; code?: string } | null = null;
const upserts: any[] = [];
vi.mock("../lib/db.server", () => ({
  db: () => ({
    from: (table: string) => {
      const api: any = {
        select: () => api,
        insert: () => api,
        eq: () => api,
        delete: () => api,
        upsert: (v: any) => (upserts.push({ table, v }), api),
        then: (res: (v: any) => void) =>
          res(
            table === "integration_settings"
              ? failWith
                ? { data: null, error: failWith }
                : { data: rows, error: null }
              : { data: null, error: null },
          ),
      };
      return api;
    },
  }),
}));

import { encryptSecret } from "@/lib/secret-box.server";
import {
  clearIntegrationsCache,
  getIntegration,
  readIntegrations,
  saveIntegration,
} from "@/lib/integrations.server";

const ENV = ["SESSION_SECRET", "AI_API_KEY", "BOT_TEXT_AI", "N8N_API_KEY"] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
beforeEach(() => {
  rows = [];
  failWith = null;
  upserts.length = 0;
  process.env["SESSION_SECRET"] = "s".repeat(40);
  clearIntegrationsCache();
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("integrations.server", () => {
  it("uses env when the v16 table is missing (no behaviour change)", async () => {
    failWith = { message: "Could not find the table", code: "PGRST205" };
    process.env["BOT_TEXT_AI"] = "never";
    expect(await getIntegration("BOT_TEXT_AI")).toBe("never");
    expect((await readIntegrations()).ready).toBe(false);
  });

  it("prefers a decryptable DB secret and never returns its plaintext in the status", async () => {
    process.env["AI_API_KEY"] = "env-key-000000000";
    rows = [
      {
        key: "AI_API_KEY",
        value: encryptSecret("db-key-1234567890wxyz", "AI_API_KEY"),
        is_secret: true,
        updated_at: "2026-10-01T00:00:00Z",
      },
    ];
    expect(await getIntegration("AI_API_KEY")).toBe("db-key-1234567890wxyz");
    const st = await readIntegrations();
    const item = st.items.find((i) => i.key === "AI_API_KEY")!;
    expect(item).toMatchObject({ source: "db", value: null, hint: "••••wxyz", problem: null });
    expect(JSON.stringify(st)).not.toContain("db-key-1234567890wxyz");
  });

  it("falls back to env and flags the row when a secret cannot be decrypted", async () => {
    process.env["AI_API_KEY"] = "env-key-000000000";
    rows = [
      {
        key: "AI_API_KEY",
        value: encryptSecret("db-key", "AI_API_KEY"),
        is_secret: true,
        updated_at: "x",
      },
    ];
    process.env["SESSION_SECRET"] = "r".repeat(40); // rotated
    clearIntegrationsCache();
    expect(await getIntegration("AI_API_KEY")).toBe("env-key-000000000");
    const item = (await readIntegrations()).items.find((i) => i.key === "AI_API_KEY")!;
    expect(item).toMatchObject({ source: "env", problem: "decrypt", stored: true });
  });

  it("stores secrets encrypted and validates before writing", async () => {
    await expect(saveIntegration("N8N_API_KEY", "short")).rejects.toThrow();
    expect(upserts).toHaveLength(0);
    await saveIntegration("N8N_API_KEY", "n".repeat(30));
    const w = upserts.find((u) => u.table === "integration_settings")!.v;
    expect(w).toMatchObject({ key: "N8N_API_KEY", is_secret: true });
    expect(w.value.startsWith("v1:")).toBe(true);
    expect(w.value).not.toContain("nnnn");
  });

  it("checkApiKey stays fail-closed and accepts a DB key", async () => {
    delete process.env["N8N_API_KEY"];
    const { checkApiKey } = await import("@/lib/api-key.server");
    const req = (k: string) =>
      new Request("https://x/api/public/n8n/summary", { headers: { "x-api-key": k } });
    expect((await checkApiKey(req("anything")))?.status).toBe(503);
    rows = [
      {
        key: "N8N_API_KEY",
        value: encryptSecret("k".repeat(30), "N8N_API_KEY"),
        is_secret: true,
        updated_at: "x",
      },
    ];
    clearIntegrationsCache();
    expect(await checkApiKey(req("k".repeat(30)))).toBeNull();
    expect((await checkApiKey(req("wrong")))?.status).toBe(401);
  });
});
