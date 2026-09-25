import type { ReactNode } from "react";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

export const metadata = {
  title: "RIO GPS Tracking",
  description: "Live fleet GPS tracking"
};

// Every page is rendered per request so Next can stamp the per-request CSP
// nonce (set in middleware.ts) onto its scripts; a statically prerendered page
// would carry no nonce and be blocked by the policy.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-canvas text-foreground antialiased">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster />
      </body>
    </html>
  );
}
