import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "./auth-middleware";
import { pocketSchema } from "./schemas";

/* eslint-disable @typescript-eslint/no-explicit-any */
const month = z.string().regex(/^\d{4}-\d{2}$/);
const id = z.string().uuid();

/** Wallet page "Kantong" card: needs view on the wallet. */
export const getAccountPockets = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ id, month }).parse(d))
  .handler(async ({ data, context }) => {
    (await import("./rbac.server")).assertWalletView(context, data.id);
    const { accountPockets } = await import("./pockets.server");
    return (await accountPockets(data.id, data.month)) as any;
  });

/** Pocket names of every wallet the caller may see (form select, list badge, filter). */
export const getPocketOptions = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { accountScope } = await import("./rbac.server");
    const { pocketOptions } = await import("./pockets.server");
    return pocketOptions(accountScope(context));
  });

/** Dashboard widget: pockets at/below their threshold in the caller's wallets. */
export const getPocketWarnings = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ month }).parse(d))
  .handler(async ({ data, context }) => {
    const { accountScope } = await import("./rbac.server");
    const { pocketWarnings } = await import("./pockets.server");
    return (await pocketWarnings(accountScope(context), data.month)) as any[];
  });

/** Create (account_id required) or edit a pocket: needs manage on its wallet. */
export const savePocketFn = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: id.nullable().optional(), account_id: id, values: pocketSchema }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const rbac = await import("./rbac.server");
    const ps = await import("./pockets.server");
    let accountId = data.account_id;
    if (data.id) {
      const prev = await ps.loadPocket(data.id);
      rbac.assertWalletView(context, prev?.account_id ?? data.account_id);
      if (!prev) throw new Error("Kantong tidak ditemukan");
      accountId = prev.account_id;
    } else {
      rbac.assertWalletView(context, accountId);
      await (await import("./demo.server")).assertDemoCapacity("pockets");
    }
    rbac.assertWalletManage(context, accountId);
    return (await ps.savePocket(data.id ?? null, data.values, accountId)) as any;
  });

/** Deletes a pocket (its transactions stay, without pocket): needs manage on its wallet. */
export const deletePocketFn = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ id }).parse(d))
  .handler(async ({ data, context }) => {
    const rbac = await import("./rbac.server");
    const ps = await import("./pockets.server");
    const p = await ps.loadPocket(data.id);
    if (!p) throw new Error("Kantong tidak ditemukan");
    rbac.assertWalletView(context, p.account_id);
    rbac.assertWalletManage(context, p.account_id);
    return ps.deletePocket(p);
  });
