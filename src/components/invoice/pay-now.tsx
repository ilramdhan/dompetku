import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CreditCard, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createGatewayPayment } from "@/lib/invoice-public.functions";
import { money } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

/*
 * "Bayar sekarang" on the public invoice page (v25, issue #97). Shown only when the server says
 * the gateway is available (v25 + Midtrans on + not demo + open invoice). On click the server
 * creates/reuses a Snap order for the remaining amount (computed server-side) and returns only the
 * Snap token, redirect URL, public client key and the fixed snap.js URL. snap.js is loaded from the
 * Midtrans domain only at that moment; if it fails (blocked, offline, test override) the browser
 * goes to redirect_url instead. After Snap closes or redirects back (`?gw=1`) we only say
 * "being processed" and reload the invoice: the status changes when the verified webhook arrives,
 * never because of a callback or query parameter.
 */

type SnapWindow = Window & {
  snap?: {
    pay: (
      token: string,
      cb: {
        onSuccess?: () => void;
        onPending?: () => void;
        onError?: () => void;
        onClose?: () => void;
      },
    ) => void;
  };
};

const SNAP_HOSTS = ["https://app.midtrans.com/", "https://app.sandbox.midtrans.com/"];

function loadSnap(src: string, clientKey: string): Promise<boolean> {
  if (!SNAP_HOSTS.some((h) => src.startsWith(h))) return Promise.resolve(false);
  const w = window as SnapWindow;
  if (w.snap) return Promise.resolve(true);
  return new Promise((resolve) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.setAttribute("data-client-key", clientKey);
    const timer = window.setTimeout(() => resolve(false), 10_000);
    el.onload = () => {
      window.clearTimeout(timer);
      resolve(!!(window as SnapWindow).snap);
    };
    el.onerror = () => {
      window.clearTimeout(timer);
      el.remove();
      resolve(false);
    };
    document.head.appendChild(el);
  });
}

function safeRedirect(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    window.location.assign(u.toString());
    return true;
  } catch {
    return false;
  }
}

export function PayNowButton({
  token,
  amount,
  currency,
  returned,
}: {
  token: string;
  amount: number;
  currency: string;
  /** Came back from Snap (`?gw=1`): untrusted, only shows the neutral "processing" note. */
  returned: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const start = useServerFn(createGatewayPayment);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(returned);

  useEffect(() => {
    if (returned) setProcessing(true);
  }, [returned]);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const r = await start({ data: { token } });
      const ok = r.snap_js && r.client_key ? await loadSnap(r.snap_js, r.client_key) : false;
      const snap = (window as SnapWindow).snap;
      if (ok && snap) {
        const done = () => {
          setProcessing(true);
          void router.invalidate();
        };
        snap.pay(r.token, {
          onSuccess: done,
          onPending: done,
          onClose: () => void router.invalidate(),
          onError: () => setError(t("Pembayaran online gagal dibuat, coba lagi.")),
        });
      } else if (!safeRedirect(r.redirect_url)) {
        setError(t("Pembayaran online gagal dibuat, coba lagi."));
      }
    } catch (e) {
      setError(t(e instanceof Error ? e.message : "Pembayaran online gagal dibuat, coba lagi."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="no-print mt-8 space-y-2" aria-labelledby="invoice-paynow">
      <h2 id="invoice-paynow" className="text-sm font-semibold">
        {t("Bayar online")}
      </h2>
      <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {t("Kartu, e-wallet, QRIS, atau virtual account lewat Midtrans.")}{" "}
          <span className="num font-semibold text-foreground">
            {money(amount, currency, { reveal: true })}
          </span>
        </p>
        <Button type="button" onClick={() => void pay()} disabled={busy} className="shrink-0">
          {busy ? (
            <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
          ) : (
            <CreditCard className="size-4" aria-hidden />
          )}
          {t("Bayar sekarang")}
        </Button>
      </div>
      {processing ? (
        <p
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary"
        >
          {t(
            "Pembayaran sedang diproses. Status invoice diperbarui otomatis setelah Midtrans mengonfirmasi.",
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={() => void router.invalidate()}
          >
            <RefreshCw className="size-3.5" aria-hidden /> {t("Muat ulang")}
          </Button>
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-expense">
          {error}
        </p>
      ) : null}
    </section>
  );
}
