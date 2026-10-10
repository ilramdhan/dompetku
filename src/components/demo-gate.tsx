import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsDemo } from "@/components/demo";
import { DEMO_DISABLED } from "@/lib/demo";
import { useI18n } from "@/lib/i18n";

/**
 * Wraps a control that is unavailable in demo mode. Off demo it renders `children` unchanged;
 * in demo it renders `fallback` (typically the same control, disabled) with an explanatory tooltip.
 * Lives apart from components/demo.tsx so landing/login (which only need `useIsDemo`) do not
 * pull Radix Tooltip + floating-ui into their bundle.
 */
export function DemoGate({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const { t } = useI18n();
  if (!useIsDemo()) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex cursor-not-allowed">
          {fallback}
        </span>
      </TooltipTrigger>
      <TooltipContent>{t(DEMO_DISABLED)}</TooltipContent>
    </Tooltip>
  );
}
