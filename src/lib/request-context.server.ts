/**
 * Per-request context (server only) carried with AsyncLocalStorage so deep helpers can record
 * who acted (activity_log.actor, v18) without threading a parameter through every call.
 * It is never used for authorization: data scoping is always passed explicitly.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type RequestActor = { username: string; role: "admin" | "member" };

const store = new AsyncLocalStorage<RequestActor>();

export function runAsActor<T>(actor: RequestActor, fn: () => T): T {
  return store.run(actor, fn);
}

/** Username of the user behind the current server fn call; null for bot/n8n/system work. */
export function currentActor(): string | null {
  try {
    return store.getStore()?.username ?? null;
  } catch {
    return null;
  }
}
