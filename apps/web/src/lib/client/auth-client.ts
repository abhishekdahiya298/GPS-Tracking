"use client";
import { createAuthClient } from "better-auth/react";

/** Browser auth client. Same-origin only; holds no secrets. */
export const authClient = createAuthClient();
