import { lazy, Suspense, useEffect, useState } from "react";
import { hasPendingToasts, onToastRequest } from "@/lib/toast";

const Toaster = lazy(() => import("@/components/ui/sonner").then((m) => ({ default: m.Toaster })));

/**
 * Mounts sonner's Toaster outside the entry chunk: when the browser is idle after hydration,
 * or right away when a toast is requested first (lib/toast queues it until then).
 */
export function LazyToaster() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (hasPendingToasts()) {
      setShow(true);
      return;
    }
    const off = onToastRequest(() => setShow(true));
    const ric = typeof window.requestIdleCallback === "function";
    const handle = ric
      ? window.requestIdleCallback(() => setShow(true), { timeout: 4000 })
      : window.setTimeout(() => setShow(true), 1500);
    return () => {
      off();
      if (ric) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, []);
  if (!show) return null;
  return (
    <Suspense fallback={null}>
      <Toaster richColors position="top-center" />
    </Suspense>
  );
}
