import type { ZodError, ZodIssue } from "zod";

/** Field keys whose plain-English name isn't just the split camelCase. */
const LABELS: Record<string, string> = {
  vin: "VIN",
  licensePlate: "License plate",
  plateRegion: "Plate state / province",
  modelYear: "Year",
  odometerKm: "Odometer",
  lastServiceAt: "Last service date",
  lastServiceOdometerKm: "Odometer at last service",
  servicedAt: "Service date",
  intervalKm: "Distance interval",
  intervalDays: "Time interval",
  speedKph: "Speed limit",
  offlineMinutes: "Offline minutes",
  geofenceId: "Zone",
  vehicleId: "Vehicle",
  driverId: "Driver",
  deviceId: "Tracker",
  imei: "IMEI",
  iccid: "ICCID",
  msisdn: "Phone number",
  dueDate: "Due date",
  remindDays: "Reminder days",
  licenseExpiresAt: "Licence expiry",
  licenseNumber: "Licence number",
  sortOrder: "List order",
  unitNumber: "Unit number",
  fuelType: "Fuel",
};

function fieldName(path: (string | number)[]): string | null {
  const key = [...path]
    .reverse()
    .find((p): p is string => typeof p === "string");
  if (!key) return null;
  if (LABELS[key]) return LABELS[key];
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * One validation problem as a sentence a person can act on.
 * Messages we wrote ourselves (refine / custom) are already sentences and pass through unchanged;
 * zod's built-in wording ("String must contain at least 1 character(s)") becomes "Name is required."
 */
const ZOD_DEFAULT =
  /^(Required|Invalid( .*)?|Expected .*|(String|Number|Array|Date|BigInt) must .*|Too (small|big).*)$/i;

export function friendlyIssue(issue: ZodIssue): string {
  // A message the schema author wrote (e.g. .min(1, "Name is required")) is already right.
  if (issue.message && !ZOD_DEFAULT.test(issue.message)) return issue.message;
  const name = fieldName(issue.path);
  const subject = name ?? "This value";
  switch (issue.code) {
    case "custom":
      return issue.message;
    case "invalid_type":
      if (issue.received === "undefined" || issue.received === "null")
        return `${subject} is required.`;
      if (issue.expected === "integer")
        return `${subject} must be a whole number.`;
      return issue.expected === "number"
        ? `${subject} must be a number.`
        : `${subject} is not valid.`;
    case "too_small":
      if (issue.type === "string")
        return Number(issue.minimum) <= 1
          ? `${subject} is required.`
          : `${subject} needs at least ${issue.minimum} characters.`;
      if (issue.type === "number")
        return `${subject} must be ${issue.inclusive ? "at least" : "more than"} ${issue.minimum}.`;
      if (issue.type === "array")
        return Number(issue.minimum) <= 1
          ? `Choose at least one ${subject.toLowerCase()}.`
          : `Choose at least ${issue.minimum}.`;
      return issue.message;
    case "too_big":
      if (issue.type === "string")
        return `${subject} is too long (at most ${issue.maximum} characters).`;
      if (issue.type === "number")
        return `${subject} must be ${issue.inclusive ? "at most" : "less than"} ${issue.maximum}.`;
      if (issue.type === "array") return `Choose at most ${issue.maximum}.`;
      return issue.message;
    case "invalid_string":
      if (issue.validation === "email")
        return "Enter an email like name@company.com.";
      if (issue.validation === "url")
        return "Enter a full link starting with https://.";
      if (issue.validation === "uuid")
        return `${subject} is not valid. Reload the page and try again.`;
      return `${subject} is not in the right format.`;
    case "invalid_enum_value":
      return `Choose a ${subject.toLowerCase()} from the list.`;
    case "invalid_date":
      return `${subject} is not a real date.`;
    default:
      return issue.message && !/^(Invalid|Required)$/i.test(issue.message)
        ? issue.message
        : `${subject} is not valid.`;
  }
}

/** All problems, de-duplicated, as one message ("Name is required. VIN …"). */
export function friendlyZodMessage(error: ZodError): string {
  return [...new Set(error.issues.map(friendlyIssue))].join(" ");
}
