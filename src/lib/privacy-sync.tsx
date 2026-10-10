import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { markPrivacyLive, readStoredPrivacy, setPrivate, togglePrivate } from "./privacy";

/** Runs `fn` once the main thread is idle (React has finished hydrating ready boundaries). */
function whenIdle(fn: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(fn, { timeout: 2000 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 200);
  return () => clearTimeout(id);
}

/**
 * Mounted once at the root: after hydration loads the stored privacy preference
 * into the store (re-rendering every amount in place, no remount), lifts the
 * pre-hydration blur and wires the Shift+H shortcut.
 *
 * money()/compact() read the store directly, so it must not flip while a lazy route
 * boundary is still hydrating the (unmasked) SSR HTML, or React throws #418. Wait for
 * the current routes' component chunks, then for an idle main thread; `<main>` stays
 * blurred by CSS until markPrivacyLive(), so real numbers never show meanwhile.
 */
export function PrivacySync() {
  const router = useRouter();
  useEffect(() => {
    let cancelIdle: (() => void) | undefined;
    let active = true;
    const apply = () => {
      if (!active) return;
      setPrivate(readStoredPrivacy(), false);
      markPrivacyLive();
    };
    const chunks = router.state.matches.map((m) => {
      const route = router.routesById[m.routeId as keyof typeof router.routesById];
      return route ? router.loadRouteChunk(route) : undefined;
    });
    void Promise.allSettled(chunks).then(() => {
      if (active) cancelIdle = whenIdle(apply);
    });

    function onKey(e: KeyboardEvent) {
      if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.key.toLowerCase() !== "h") return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      togglePrivate();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      active = false;
      cancelIdle?.();
      window.removeEventListener("keydown", onKey);
    };
    // Initial hydration only; the router instance is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
