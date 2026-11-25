/** Driver app endpoints are called by the phone app (no cookies, no browser origin): never cached. */
export const NO_STORE = { "Cache-Control": "no-store" };
