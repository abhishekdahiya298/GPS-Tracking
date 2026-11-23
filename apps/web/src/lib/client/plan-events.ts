/**
 * When the server refuses something because of the plan (a limit is reached, or the feature
 * isn't in the plan), the API helper raises an event that opens the upgrade dialog. The same
 * message is then not repeated as an error toast.
 */
export type PlanRefusal = { code: "LIMIT_REACHED"; message: string; limit: string; used: number; max: number } | { code: "FEATURE_LOCKED"; message: string; feature: string };

const EVENT = "rio:plan-refusal";
const recent = new Map<string, number>();

export function announcePlanRefusal(r: PlanRefusal) {
  if (typeof window === "undefined") return;
  recent.set(r.message, Date.now());
  window.dispatchEvent(new CustomEvent<PlanRefusal>(EVENT, { detail: r }));
}

export function onPlanRefusal(fn: (r: PlanRefusal) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<PlanRefusal>).detail);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

/** True for a few seconds after the dialog showed this message. */
export function isPlanMessageShown(message: string): boolean {
  const at = recent.get(message);
  return at !== undefined && Date.now() - at < 5000 && listeners() > 0;
}

let count = 0;
const listeners = () => count;
export function planDialogMounted(): () => void {
  count++;
  return () => {
    count--;
  };
}
