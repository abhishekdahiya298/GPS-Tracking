import * as SecureStore from "expo-secure-store";
import { API_BASE_URL } from "../config";
import { createAuthService } from "../auth/service";
import { createApiClient, type TokenStore } from "./client";

const TOKEN_KEY = "rio.session-token";

/** The session token lives in the phone's encrypted storage (Keychain / Keystore). */
export const tokenStore: TokenStore = {
  get: () => SecureStore.getItemAsync(TOKEN_KEY),
  set: (token) => SecureStore.setItemAsync(TOKEN_KEY, token),
  clear: () => SecureStore.deleteItemAsync(TOKEN_KEY)
};

const signedOutListeners = new Set<() => void>();
/** Lets the session screen logic react when the server ends the session. */
export function onSignedOut(listener: () => void): () => void {
  signedOutListeners.add(listener);
  return () => void signedOutListeners.delete(listener);
}

export const api = createApiClient({
  baseUrl: API_BASE_URL,
  tokens: tokenStore,
  onSignedOut: () => signedOutListeners.forEach((l) => l())
});

export const auth = createAuthService({ api, tokens: tokenStore, baseUrl: API_BASE_URL });

export * from "./client";
