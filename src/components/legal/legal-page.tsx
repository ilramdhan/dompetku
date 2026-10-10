import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { LandingShell } from "@/components/landing/landing-shell";
import { useI18n } from "@/lib/i18n";
import { langSearch } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { formatLegalDate, LEGAL_UPDATED, type LegalSection } from "./legal-content";

/** Readable, responsive layout for the public /privacy and /terms pages. */
export function LegalPage({
  authenticated,
  title,
  intro,
  sections,
}: {
  authenticated: boolean;
  title: string;
  intro: string;
  sections: LegalSection[];
}) {
  const { t, lang } = useI18n();
  return (
    <LandingShell authenticated={authenticated} onLanding={false}>
      {() => (
        <article
          aria-labelledby="legal-title"
          className="mx-auto w-full max-w-3xl px-4 pt-8 pb-20 sm:px-6 sm:pt-12 lg:pt-16"
        >
          <Link
            to="/"
            search={langSearch(lang)}
            className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            {t("Kembali ke beranda")}
          </Link>
          <h1
            id="legal-title"
            className="mt-6 font-display text-3xl font-extrabold text-balance sm:text-4xl"
          >
            {t(title)}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {t("Terakhir diperbarui")}:{" "}
            <time dateTime={LEGAL_UPDATED}>{formatLegalDate(LEGAL_UPDATED, lang)}</time>
          </p>
          <p className="mt-6 text-base leading-relaxed text-pretty text-foreground/90 sm:text-lg">
            {t(intro)}
          </p>
          <nav
            aria-label={t("Daftar isi")}
            className="mt-8 rounded-2xl border bg-card/60 p-5 text-sm"
          >
            <h2 className="font-sans text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              {t("Daftar isi")}
            </h2>
            <ol className="mt-3 grid list-decimal gap-1.5 pl-5 sm:grid-cols-2">
              {sections.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {t(s.title)}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <div className="mt-10 space-y-10">
            {sections.map((s, i) => (
              <section key={s.id} aria-labelledby={s.id}>
                <h2 id={s.id} className="font-display text-xl font-bold text-balance sm:text-2xl">
                  <span className="text-muted-foreground">{i + 1}. </span>
                  {t(s.title)}
                </h2>
                {s.body?.map((p) => (
                  <p
                    key={p}
                    className="mt-3 text-base leading-relaxed text-pretty text-muted-foreground"
                  >
                    {t(p)}
                  </p>
                ))}
                {s.items ? (
                  <ul
                    className={cn(
                      "mt-3 list-disc space-y-2 pl-5 text-base leading-relaxed text-muted-foreground marker:text-primary",
                    )}
                  >
                    {s.items.map((it) => (
                      <li key={it} className="text-pretty">
                        {t(it)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>
        </article>
      )}
    </LandingShell>
  );
}
