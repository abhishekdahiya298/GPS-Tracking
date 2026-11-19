/**
 * A device's name, unless it only repeats the model and IMEI ("FTM164 (868038076566455)"):
 * those show as the model, with the IMEI tail on the line below like every other tracker.
 */
export function deviceName(name: string | null, model: string | null): string | null {
  void model;
  return name && !/^\S+\s*\(\d{8,}\)$/.test(name.trim()) ? name : null;
}

/** Hardware model codes as they come from the maker ("FTM880", "FMC130"…). */
const MODEL_CODE = /^(FTM|FMC|FMB|FMM|FMT|FMP|TAT|TFT|TMT)(\d{2,4})\b/i;

/**
 * The RIO GPS product name for a tracker model. Customers never see the maker's codes: "FTM880"
 * is "RIO GPS 880", "FTM164" is "RIO GPS 164"; anything unknown is "RIO GPS tracker".
 */
export function productName(model: string | null | undefined): string {
  const m = model?.trim() ?? "";
  if (/^rio\b/i.test(m)) return m;
  const code = MODEL_CODE.exec(m);
  return code ? `RIO GPS ${code[2]}` : "RIO GPS tracker";
}

/** True when a name is only a model code (the default name a tracker gets when it is added). */
export function isModelCodeName(name: string | null | undefined): boolean {
  return !!name && MODEL_CODE.test(name.trim()) && name.trim().replace(MODEL_CODE, "").trim().replace(/^\(\d{8,}\)$/, "") === "";
}

/**
 * What a customer sees as a device's name: the name someone gave it, or else the product name.
 * Auto names that are only a model code (and IMEI) read as the product name; a model code at the
 * start of a real name is replaced too ("FTM164 cab unit" → "RIO GPS 164 cab unit").
 */
export function deviceDisplayName(name: string | null | undefined, model: string | null | undefined): string {
  const own = deviceName(name ?? null, model ?? null);
  if (!own || isModelCodeName(own)) return productName(model ?? name);
  return own.trim().replace(MODEL_CODE, (_m, _p, n: string) => `RIO GPS ${n}`);
}
