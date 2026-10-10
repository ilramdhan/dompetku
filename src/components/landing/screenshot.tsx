import { useEffect, useRef, useState, type ReactNode } from "react";
import { screenshotSrc, screenshotSrcSet, type ScreenshotName } from "@/lib/landing";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Variant = "desktop" | "mobile";
const SIZE: Record<Variant, { w: number; h: number }> = {
  desktop: { w: 1440, h: 900 },
  mobile: { w: 390, h: 844 },
};

/**
 * Elegant stand-in shown until real screenshots exist in public/screenshots
 * (or when one fails to load). Pure decoration: hidden from assistive tech.
 */
export function ScreenshotPlaceholder({ variant = "desktop" }: { variant?: Variant }) {
  const { w, h } = SIZE[variant];
  if (variant === "mobile")
    return (
      <div
        aria-hidden="true"
        className="landing-shimmer flex w-full flex-col gap-[3%] overflow-hidden bg-muted/60 p-[7%]"
        style={{ aspectRatio: `${w} / ${h}` }}
      >
        <div className="h-[2%] w-1/2 shrink-0 rounded-full bg-foreground/10" />
        <div className="h-[14%] shrink-0 rounded-xl bg-sidebar" />
        <div className="grid h-[10%] shrink-0 grid-cols-2 gap-[6%]">
          <div className="rounded-lg bg-card" />
          <div className="rounded-lg bg-card" />
        </div>
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="flex h-[8%] shrink-0 items-center gap-[6%] rounded-lg bg-card px-[6%]"
          >
            <div className="aspect-square h-1/2 rounded-full bg-primary/20" />
            <div className="h-2 flex-1 rounded-full bg-foreground/10" />
            <div className="h-2 w-8 rounded-full bg-foreground/15" />
          </div>
        ))}
      </div>
    );
  return (
    <div
      aria-hidden="true"
      className="landing-shimmer flex w-full bg-muted/60"
      style={{ aspectRatio: `${w} / ${h}` }}
    >
      <div className="hidden w-[18%] flex-col gap-2 bg-sidebar p-[2.5%] sm:flex">
        <div className="mb-2 h-2.5 w-2/3 rounded-full bg-sidebar-primary/80" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-2 rounded-full bg-sidebar-foreground/15" />
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-[3%] p-[3%]">
        <div className="h-[6%] w-1/3 rounded-full bg-foreground/10" />
        <div className="grid h-[18%] grid-cols-3 gap-[3%]">
          <div className="rounded-lg bg-sidebar" />
          <div className="rounded-lg bg-card" />
          <div className="rounded-lg bg-card" />
        </div>
        <div className="grid flex-1 grid-cols-5 gap-[3%]">
          <div className="col-span-3 flex items-end gap-[4%] rounded-lg bg-card p-[4%]">
            {[45, 70, 55, 85, 60, 95].map((v, i) => (
              <div
                key={i}
                className={cn("flex-1 rounded-sm", i % 2 ? "bg-chart-2/70" : "bg-chart-1/70")}
                style={{ height: `${v}%` }}
              />
            ))}
          </div>
          <div className="col-span-2 flex flex-col gap-[8%] rounded-lg bg-card p-[5%]">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-2 rounded-full bg-foreground/10" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** One <img> that swaps itself for the placeholder when the file is missing. */
function ShotImg({
  name,
  dark,
  sizes,
  alt,
  variant,
  priority = false,
  className,
}: {
  name: ScreenshotName;
  dark: boolean;
  sizes: string;
  alt: string;
  variant: Variant;
  priority?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  // SSR HTML can finish (and fail) loading before hydration attaches onError.
  useEffect(() => {
    const el = ref.current;
    if (el && el.complete && el.naturalWidth === 0) setFailed(true);
  }, []);
  const { w, h } = SIZE[variant];
  if (failed)
    return (
      <div className={className} role="img" aria-label={alt}>
        <ScreenshotPlaceholder variant={variant} />
      </div>
    );
  return (
    <picture>
      <source
        type="image/avif"
        srcSet={screenshotSrcSet(name, dark, variant, "avif")}
        sizes={sizes}
      />
      <source
        type="image/webp"
        srcSet={screenshotSrcSet(name, dark, variant, "webp")}
        sizes={sizes}
      />
      <img
        ref={ref}
        src={screenshotSrc(name, dark)}
        alt={alt}
        width={w}
        height={h}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={priority ? "high" : "auto"}
        onError={() => setFailed(true)}
        className={cn("block h-auto w-full bg-muted", className)}
      />
    </picture>
  );
}

/**
 * Light + dark screenshot pair: the theme is a `.dark` class on <html>, so both images are
 * rendered and CSS shows the matching one. A hidden `loading="lazy"` image is never fetched,
 * but a hidden eager one is, so only the light (default) variant gets eager + fetchpriority
 * high; the dark one is always lazy (it loads as soon as it becomes visible in dark mode).
 * Each is a `<picture>` (AVIF/WebP, responsive srcset) falling back to the original PNG.
 */
export function Screenshot({
  name,
  alt,
  variant = "desktop",
  priority = false,
  sizes,
}: {
  name: ScreenshotName;
  alt: string;
  variant?: Variant;
  priority?: boolean;
  sizes?: string;
}) {
  const s = sizes ?? (variant === "mobile" ? "224px" : "(min-width: 1024px) 640px, 100vw");
  return (
    <>
      <ShotImg
        name={name}
        dark={false}
        sizes={s}
        alt={alt}
        variant={variant}
        priority={priority}
        className="dark:hidden"
      />
      <ShotImg
        name={name}
        dark
        sizes={s}
        alt={alt}
        variant={variant}
        priority={false}
        className="hidden dark:block"
      />
    </>
  );
}

/** Minimal browser chrome around a desktop screenshot. */
export function BrowserFrame({ children, className }: { children: ReactNode; className?: string }) {
  const { t } = useI18n();
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border bg-card shadow-[0_30px_80px_-30px_color-mix(in_oklch,var(--color-ink)_45%,transparent)]",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 border-b bg-muted/70 px-3 py-2" aria-hidden="true">
        <span className="size-2.5 rounded-full bg-expense/70" />
        <span className="size-2.5 rounded-full bg-warning/80" />
        <span className="size-2.5 rounded-full bg-income/70" />
        <span className="ml-3 hidden h-4 max-w-56 flex-1 truncate rounded-md bg-background/80 px-2 text-[10px] leading-4 text-muted-foreground sm:block">
          {t("aplikasi-anda.vercel.app")}
        </span>
      </div>
      {children}
    </div>
  );
}

/** Rounded phone bezel around a mobile screenshot. */
export function PhoneFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[2rem] border-[6px] border-ink bg-ink shadow-[0_30px_60px_-25px_color-mix(in_oklch,var(--color-ink)_60%,transparent)] dark:border-sidebar dark:bg-sidebar",
        className,
      )}
    >
      <div className="overflow-hidden rounded-[1.55rem]">{children}</div>
    </div>
  );
}
