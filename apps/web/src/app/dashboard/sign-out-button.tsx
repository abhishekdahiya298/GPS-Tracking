"use client";
import { authClient } from "@/lib/client/auth-client";

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={async () => {
        await authClient.signOut();
        window.location.assign("/login");
      }}
    >
      Sign out
    </button>
  );
}
