import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { SITE } from "@/lib/site";

/** Frame for the public pages: a quiet header, the page, and a footer with the legal links. */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow-pop">
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 text-base font-semibold text-foreground no-underline">
            <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-white">
              R
            </span>
            {SITE.product}
          </Link>
          <nav aria-label="Main" className="ml-auto flex items-center gap-1 sm:gap-2">
            <Link href="/#features" className="hidden rounded-md px-3 py-2 text-sm font-medium text-muted-foreground no-underline hover:text-foreground sm:inline-block">
              Features
            </Link>
            <Link href="/#how" className="hidden rounded-md px-3 py-2 text-sm font-medium text-muted-foreground no-underline hover:text-foreground sm:inline-block">
              How it works
            </Link>
            <Link href="/login" className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground no-underline hover:text-foreground">
              Sign in
            </Link>
            <Button asChild size="sm">
              <Link href="/get-pricing">Get pricing</Link>
            </Button>
          </nav>
        </div>
      </header>
      <main id="content" className="flex-1">
        {children}
      </main>
      <footer className="border-t border-border bg-canvas">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted-foreground sm:px-6">
          <span>
            © {new Date().getFullYear()} {SITE.company}
          </span>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2 sm:ml-auto">
            <Link href="/get-pricing" className="text-muted-foreground no-underline hover:text-foreground hover:underline">
              Get pricing
            </Link>
            <Link href="/login" className="text-muted-foreground no-underline hover:text-foreground hover:underline">
              Customer sign in
            </Link>
            <Link href="/privacy" className="text-muted-foreground no-underline hover:text-foreground hover:underline">
              Privacy
            </Link>
            <Link href="/terms" className="text-muted-foreground no-underline hover:text-foreground hover:underline">
              Terms
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
