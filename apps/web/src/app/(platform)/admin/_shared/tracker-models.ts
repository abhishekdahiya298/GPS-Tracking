import { productName } from "@/lib/device-name";

/** Our products, stored by hardware model code; the menu shows product names only. */
export const TRACKER_MODELS = [
  { value: "FTM880", label: "RIO GPS 880" },
  { value: "FTM164", label: "RIO GPS 164" },
  { value: "NT28E", label: "RIO GPS 28" }
];
/** The model menu value for a stored model ("RIO GPS 164" and "FTM164" are the same product). */
export function modelValue(model: string | null | undefined): string {
  const m = /(\d{2,3})/.exec(model ?? "");
  const hit = m && TRACKER_MODELS.find((x) => x.value.replace(/\D/g, "") === m[1]);
  return hit ? hit.value : (model ?? "FTM880");
}
export const modelOptions = (current?: string | null) => {
  const v = modelValue(current);
  return TRACKER_MODELS.some((m) => m.value === v) ? TRACKER_MODELS : [...TRACKER_MODELS, { value: v, label: productName(v) }];
};

