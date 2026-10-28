import { getServerEnv } from "./env";
import { logger } from "./logger";

/**
 * Outbound SMS through Twilio's REST API (no SDK). Optional: when Twilio is not configured,
 * smsConfigured() is false and callers fall back to showing the link for the user to send.
 * The message text and phone number are never logged.
 */
export function smsConfigured(env = getServerEnv()): boolean {
  return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM);
}

export type SmsResult = { sent: true } | { sent: false; reason: "not_configured" | "rejected" | "unavailable"; message: string };

export async function sendSms(to: string, body: string, fetchImpl: typeof fetch = fetch): Promise<SmsResult> {
  const env = getServerEnv();
  if (!smsConfigured(env)) return { sent: false, reason: "not_configured", message: "SMS is not set up for this server." };
  const sid = env.TWILIO_ACCOUNT_SID!;
  const from = env.TWILIO_FROM!;
  const form = new URLSearchParams({ To: to, Body: body, ...(from.startsWith("MG") ? { MessagingServiceSid: from } : { From: from }) });
  try {
    const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: form,
      signal: AbortSignal.timeout(10_000)
    });
    if (res.ok) return { sent: true };
    let code: unknown = null;
    try {
      code = ((await res.json()) as { code?: unknown }).code ?? null;
    } catch {
      // ignore
    }
    logger.warn("sms.rejected", { status: res.status, twilioCode: code });
    // 21610: the recipient replied STOP. 21211/21614: not a valid mobile number.
    const message =
      code === 21610
        ? "This driver has opted out of text messages (replied STOP). Send them the link another way."
        : code === 21211 || code === 21614
          ? "That phone number cannot receive text messages."
          : "The text message could not be sent. Copy the link and send it yourself.";
    return { sent: false, reason: "rejected", message };
  } catch (err) {
    logger.error("sms.failed", {}, err);
    return { sent: false, reason: "unavailable", message: "The text message service did not answer. Copy the link and send it yourself." };
  }
}
