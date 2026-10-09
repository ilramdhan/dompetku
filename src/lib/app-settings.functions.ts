import { createServerFn } from "@tanstack/react-start";
import { requireAdmin } from "./auth-middleware";
import { appSettingsInputSchema } from "./app-settings";

/** Public (no login): only non-sensitive branding fields for landing, login and <head>. */
export const getPublicBranding = createServerFn({ method: "GET" }).handler(async () => {
  const { getBranding } = await import("./app-settings.server");
  return getBranding();
});

export const getAppSettingsFull = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const { readAppSettings } = await import("./app-settings.server");
    return readAppSettings();
  });

export const saveAppSettingsFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: unknown) => appSettingsInputSchema.parse(d))
  .handler(async ({ data }) => {
    (await import("./demo.server")).assertNotDemo();
    const { saveAppSettings } = await import("./app-settings.server");
    return saveAppSettings(data);
  });
