import "server-only";

/** Normalises a UK mobile to E.164 (+447...). Returns null if it isn't one. */
export function ukMobile(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");
  const n = digits.startsWith("+44") ? "0" + digits.slice(3)
    : digits.startsWith("44") ? "0" + digits.slice(2)
    : digits;
  return /^07\d{9}$/.test(n) ? "+44" + n.slice(1) : null;
}

/** Sends an SMS via Twilio. Skips quietly when Twilio isn't configured (testing). */
export async function sendSms(to: string, body: string) {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM: from } = process.env;
  if (!sid || !token || !from) {
    console.log(`[sms skipped] to ${to}: ${body}`);
    return;
  }
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  if (!res.ok) console.error("Twilio error", res.status, await res.text());
}
