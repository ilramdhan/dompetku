import { describe, expect, it, vi } from "vitest";
import { createToastQueue } from "@/lib/toast";

function fakeApi() {
  const calls: [string, unknown, unknown][] = [];
  const mk = (k: string) => (m: unknown, d?: { id?: string | number }) => {
    calls.push([k, m, d]);
    return d?.id ?? "x";
  };
  return {
    calls,
    api: {
      success: mk("success"),
      error: mk("error"),
      info: mk("info"),
      warning: mk("warning"),
      loading: mk("loading"),
      message: mk("message"),
      dismiss: (id?: string | number) => {
        calls.push(["dismiss", id, undefined]);
        return id ?? "";
      },
    },
  };
}

describe("createToastQueue", () => {
  it("queues toasts until the Toaster is ready, then replays them in order", async () => {
    const { api, calls } = fakeApi();
    const q = createToastQueue(() => Promise.resolve(api));
    const id = q.toast.loading("Membaca nota…");
    q.toast.success("Nota terbaca", { id });
    await Promise.resolve();
    expect(calls).toEqual([]);
    expect(q.hasPending()).toBe(true);
    q.markToasterReady();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0]).toEqual(["loading", "Membaca nota…", { id }]);
    expect(calls[1]).toEqual(["success", "Nota terbaca", { id }]);
    expect(q.hasPending()).toBe(false);
  });

  it("calls sonner directly once loaded and ready", async () => {
    const { api, calls } = fakeApi();
    const q = createToastQueue(() => Promise.resolve(api));
    q.markToasterReady();
    await vi.waitFor(() => expect(q.hasPending()).toBe(false));
    await Promise.resolve();
    q.toast.error("Gagal", { description: "x" });
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe("error");
  });

  it("notifies listeners when a toast is requested before mount", () => {
    const q = createToastQueue(() => new Promise(() => {}));
    const fn = vi.fn();
    q.onRequest(fn);
    q.toast.info("Halo");
    expect(fn).toHaveBeenCalledOnce();
  });
});
