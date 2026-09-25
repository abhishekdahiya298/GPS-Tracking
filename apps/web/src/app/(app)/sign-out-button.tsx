"use client";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/client/auth-client";

export function SignOutButton() {
  return (
    <Button
      variant="secondary"
      onClick={async () => {
        await authClient.signOut();
        window.location.assign("/login");
      }}
    >
      Sign out
    </Button>
  );
}
