import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { getMapsSettings } from "@/lib/maps-settings";
import { THEME_COOKIE, readTheme } from "@/lib/theme";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

export const metadata = {
  title: "RIO GPS",
  description: "Live fleet GPS tracking"
};

// Every page is rendered per request so Next can stamp the per-request CSP
// nonce (set in middleware.ts) onto its scripts; a statically prerendered page
// would carry no nonce and be blocked by the policy.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = readTheme((await cookies()).get(THEME_COOKIE)?.value);
  const maps = await getMapsSettings();
  return (
    <html lang="en" data-theme={theme === "system" ? undefined : theme}>
      <body className="bg-canvas text-foreground antialiased" data-map-icons={`${maps.iconStyle}-${maps.iconColor}`}>
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster />
      </body>
    </html>
  );
}
