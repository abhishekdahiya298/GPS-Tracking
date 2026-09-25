"use client";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  return (
    <Button
      variant="secondary"
      onClick={async () => {
        // Loaded on demand: keeps the auth client out of every page's initial bundle.
            const { authClient } = await import("@/lib/client/auth-client");
            await authClient.signOut();
        window.location.assign("/login");
      }}
    >
      Sign out
    </Button>
  );
}
