"use client";
import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Browser auth client. Same-origin only; holds no secrets. */
export const authClient = createAuthClient({ plugins: [twoFactorClient()] });
