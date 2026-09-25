"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";

/**
 * Table state lives in the URL (?page=&search=&sort=&direction=&state=): the
 * server page re-renders with the new params, links are shareable and the
 * back button works. Changing anything but the page resets to page 1.
 */
export function useListParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const set = useCallback(
    (patch: Record<string, string | number | null>) => {
      const next = new URLSearchParams(params?.toString() ?? "");
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, String(v));
      }
      if (!("page" in patch)) next.delete("page");
      const qs = next.toString();
      startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [params, pathname, router]
  );
  const refresh = useCallback(() => startTransition(() => router.refresh()), [router]);
  return { set, refresh, pending };
}
