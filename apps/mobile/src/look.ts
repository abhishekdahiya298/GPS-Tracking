/** Lets the Account screen ask for another look; the app's root listens and makes the change with a short fade. */
import type { ThemeChoice } from "./theme";

type Listener = (choice: ThemeChoice) => void;
const listeners = new Set<Listener>();

export function onLookRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function requestLook(choice: ThemeChoice): void {
  listeners.forEach((l) => l(choice));
}
