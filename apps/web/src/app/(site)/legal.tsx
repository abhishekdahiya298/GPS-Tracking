import Link from "next/link";
import type { ReactNode } from "react";
import { SITE } from "@/lib/site";

/** Shared frame for the privacy policy and terms: readable measure, clear headings. */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 sm:py-16 [&_h2]:mb-2 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:mb-1.5 [&_p]:my-3 [&_p]:leading-7 [&_ul]:my-3 [&_ul]:pl-5 [&_ul]:leading-7">
      <h1 className="m-0 text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">Last updated {SITE.legalUpdated}</p>
      {children}
    </article>
  );
}

/** How to reach us: the mailbox when one is configured, otherwise the contact form. */
export function ContactLine() {
  return SITE.contactEmail ? <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> : <Link href="/get-pricing">our contact form</Link>;
}
