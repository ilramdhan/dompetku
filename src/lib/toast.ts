/**
 * App-wide `toast` facade (same call shape as sonner's `toast.*` methods we use).
 *
 * sonner (~32 KB min) is not part of the entry chunk: the root renders a lazy `<Toaster>`
 * shortly after hydration, and this facade loads sonner on the first toast. Sonner's
 * `<Toaster>` only shows toasts published after it subscribed, so calls made before it is
 * mounted are queued here and replayed once `markToasterReady()` runs. Ids are assigned
 * here, so `toast.loading()` → `toast.success(…, { id })` keeps working while queued.
 */
import type { ReactNode } from "react";
import type { ExternalToast } from "sonner";

type Kind = "success" | "error" | "info" | "warning" | "loading" | "message";
type ToastId = string | number;
type Api = { [K in Kind]: (m: ReactNode, d?: ExternalToast) => ToastId } & {
  dismiss: (id?: ToastId) => ToastId;
};

/** Queue + replay core, separated from the real sonner import so it is unit-testable. */
export function createToastQueue(load: () => Promise<Api>) {
  let api: Api | null = null;
  let ready = false;
  let loading: Promise<void> | null = null;
  let counter = 0;
  const pending: ((a: Api) => void)[] = [];
  const listeners = new Set<() => void>();

  function flush() {
    if (!api || !ready) return;
    for (const run of pending.splice(0)) run(api);
  }

  function ensureLoaded() {
    loading ??= load().then(
      (a) => {
        api = a;
        flush();
      },
      () => {
        loading = null; // offline/chunk error: allow a retry on the next toast
      },
    );
    return loading;
  }

  function run(fn: (a: Api) => void) {
    if (api && ready) return fn(api);
    pending.push(fn);
    listeners.forEach((l) => l());
    void ensureLoaded();
  }

  const show =
    (kind: Kind) =>
    (message: ReactNode, data?: ExternalToast): ToastId => {
      const id = data?.id ?? `dk-${++counter}`;
      run((a) => a[kind](message, { ...data, id }));
      return id;
    };

  const toast = {
    success: show("success"),
    error: show("error"),
    info: show("info"),
    warning: show("warning"),
    loading: show("loading"),
    message: show("message"),
    dismiss: (id?: ToastId) => {
      run((a) => a.dismiss(id));
      return id ?? "";
    },
  };

  return {
    toast,
    /** Called by the mounted `<Toaster>` once it subscribed: replays queued toasts. */
    markToasterReady() {
      ready = true;
      void ensureLoaded().then(flush);
    },
    /** Notifies the root when a toast is waiting so it can mount the Toaster right away. */
    onRequest(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    hasPending: () => pending.length > 0,
  };
}

const queue = createToastQueue(() => import("sonner").then((m) => m.toast));

export const toast = queue.toast;
export const markToasterReady = queue.markToasterReady;
export const onToastRequest = queue.onRequest;
export const hasPendingToasts = queue.hasPending;
