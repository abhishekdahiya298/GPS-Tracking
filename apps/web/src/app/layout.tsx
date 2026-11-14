import { cookies } from "next/headers";
import type { ReactNode } from "react";
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
  return (
    <html lang="en" data-theme={theme === "system" ? undefined : theme}>
      <body className="bg-canvas text-foreground antialiased">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster />
      </body>
    </html>
  );
}
