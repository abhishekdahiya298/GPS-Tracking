import { getServerEnv } from "./env";
import { logger } from "./logger";

/**
 * Transactional email via Resend's REST API (no SDK dependency).
 * - Never logs message bodies, links or tokens; only the template and the
 *   recipient's domain.
 * - A test transport can be installed with setEmailTransportForTests().
 */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Template name for logs/metrics only. */
  template: string;
}

type Transport = (msg: EmailMessage) => Promise<void>;
let testTransport: Transport | null = null;

export function setEmailTransportForTests(t: Transport | null) {
  testTransport = t;
}

export function isEmailEnabled(): boolean {
  return Boolean(testTransport) || Boolean(getServerEnv().RESEND_API_KEY);
}

export class EmailNotConfiguredError extends Error {}

export async function sendEmail(msg: EmailMessage): Promise<void> {
  const domain = msg.to.split("@")[1] ?? "?";
  if (testTransport) return testTransport(msg);
  const env = getServerEnv();
  if (!env.RESEND_API_KEY) throw new EmailNotConfiguredError("Email is not configured");

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10_000);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
      signal: ac.signal
    });
    if (!res.ok) {
      // Resend error bodies contain no secrets; keep only the status and error name.
      const body = (await res.json().catch(() => null)) as { name?: string } | null;
      logger.error("email.send_failed", { template: msg.template, toDomain: domain, status: res.status, errorName: body?.name ?? null });
      throw new Error(`Email provider returned ${res.status}`);
    }
    logger.info("email.sent", { template: msg.template, toDomain: domain });
  } catch (err) {
    if (!(err instanceof Error && err.message.startsWith("Email provider"))) {
      logger.error("email.send_failed", { template: msg.template, toDomain: domain }, err);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(title: string, bodyHtml: string) {
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1b1f24">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:10px;padding:28px" cellpadding="0" cellspacing="0"><tr><td>
<p style="margin:0 0 4px;font-weight:600;color:#3056d3">RIO GPS</p>
<h1 style="font-size:20px;margin:0 0 16px">${esc(title)}</h1>
${bodyHtml}
<p style="margin:24px 0 0;font-size:12px;color:#6b7280">If you didn't expect this email, you can ignore it.</p>
</td></tr></table></td></tr></table></body></html>`;
}

function button(url: string, label: string) {
  return `<p style="margin:20px 0"><a href="${esc(url)}" style="display:inline-block;background:#3056d3;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600">${esc(label)}</a></p>
<p style="font-size:12px;color:#6b7280;word-break:break-all">Or paste this link into your browser:<br>${esc(url)}</p>`;
}

export function passwordResetEmail(to: string, name: string, url: string, expiresMinutes: number): EmailMessage {
  return {
    to,
    template: "password_reset",
    subject: "Reset your RIO GPS password",
    html: layout(
      "Reset your password",
      `<p>Hi ${esc(name || "there")},</p><p>Someone asked to reset the password for your RIO GPS account. The link works once and expires in ${expiresMinutes} minutes.</p>${button(url, "Choose a new password")}`
    ),
    text: `Hi ${name || "there"},\n\nReset your RIO GPS password (link works once, expires in ${expiresMinutes} minutes):\n${url}\n\nIf you didn't ask for this, ignore this email.`
  };
}

export function inviteEmail(to: string, name: string, orgName: string, url: string, expiresHours: number): EmailMessage {
  return {
    to,
    template: "invite",
    subject: `You've been invited to ${orgName} on RIO GPS`,
    html: layout(
      `Join ${orgName} on RIO GPS`,
      `<p>Hi ${esc(name || "there")},</p><p>You've been given access to <strong>${esc(orgName)}</strong> on RIO GPS. Set your password to sign in. The link expires in ${expiresHours} hours.</p>${button(url, "Set your password")}`
    ),
    text: `Hi ${name || "there"},\n\nYou've been given access to ${orgName} on RIO GPS. Set your password (link expires in ${expiresHours} hours):\n${url}`
  };
}

export function accessGrantedEmail(to: string, name: string, orgName: string, loginUrl: string): EmailMessage {
  return {
    to,
    template: "access_granted",
    subject: `You now have access to ${orgName} on RIO GPS`,
    html: layout(`Access to ${orgName}`, `<p>Hi ${esc(name || "there")},</p><p>You've been added to <strong>${esc(orgName)}</strong>. Sign in with your existing RIO GPS account.</p>${button(loginUrl, "Sign in")}`),
    text: `Hi ${name || "there"},\n\nYou've been added to ${orgName} on RIO GPS. Sign in with your existing account: ${loginUrl}`
  };
}

const ALERT_LABEL: Record<string, string> = {
  geofence_enter: "entered a zone",
  geofence_exit: "left a zone",
  speeding: "is speeding",
  ignition_on: "ignition turned on",
  ignition_off: "ignition turned off",
  device_offline: "device went offline"
};

export function alertEmail(
  to: string,
  name: string,
  ev: { type: string; ruleName: string; vehicleName: string | null; occurredAt: string; latitude: number | null; longitude: number | null; details: Record<string, unknown> | null },
  alertsUrl: string
): EmailMessage {
  const who = ev.vehicleName ?? "A device";
  const what = ALERT_LABEL[ev.type] ?? ev.type;
  const extra: string[] = [];
  if (ev.details?.geofence) extra.push(`Zone: ${String(ev.details.geofence)}`);
  if (typeof ev.details?.speedKph === "number") extra.push(`Speed: ${ev.details.speedKph} km/h (limit ${String(ev.details.limitKph)})`);
  const when = new Date(ev.occurredAt).toUTCString();
  const map = ev.latitude !== null && ev.longitude !== null ? `https://www.openstreetmap.org/?mlat=${ev.latitude}&mlon=${ev.longitude}#map=16/${ev.latitude}/${ev.longitude}` : null;
  return {
    to,
    template: `alert_${ev.type}`,
    subject: `RIO GPS alert: ${who} ${what}`,
    html: layout(
      `${who} ${what}`,
      `<p>Hi ${esc(name || "there")},</p><p>Rule <strong>${esc(ev.ruleName)}</strong> fired at ${esc(when)}.</p>${extra.map((e) => `<p>${esc(e)}</p>`).join("")}${map ? `<p><a href="${esc(map)}">View location</a></p>` : ""}${button(alertsUrl, "Open alerts")}`
    ),
    text: `${who} ${what}\nRule: ${ev.ruleName}\nTime: ${when}\n${extra.join("\n")}${map ? `\nLocation: ${map}` : ""}\n\n${alertsUrl}`
  };
}
