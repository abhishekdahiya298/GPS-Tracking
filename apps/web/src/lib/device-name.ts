/**
 * A device's name, unless it only repeats the model and IMEI ("FTM164 (868038076566455)"):
 * those show as the model, with the IMEI tail on the line below like every other tracker.
 */
export function deviceName(name: string | null, model: string | null): string | null {
  void model;
  return name && !/^\S+\s*\(\d{8,}\)$/.test(name.trim()) ? name : null;
}
