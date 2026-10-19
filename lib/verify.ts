import "server-only";
import { cookies } from "next/headers";
import { db, type Customer } from "./supabase";
import { readToken, VERIFIED_COOKIE } from "./verifyToken";

/** Twilio Verify, which texts a 6-digit code to prove the customer has the phone they're booking with. */
async function verifyApi(path: string, params: Record<string, string>) {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_VERIFY_SERVICE_SID: service } = process.env;
  const res = await fetch(`https://verify.twilio.com/v2/Services/${service}/${path}`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

export const sendCode = (phone: string) => verifyApi("Verifications", { To: phone, Channel: "sms" });

/** True if the code is right. Twilio allows a handful of tries per code. */
export async function checkCode(phone: string, code: string) {
  const r = await verifyApi("VerificationCheck", { To: phone, Code: code });
  return r.ok && r.body.status === "approved";
}

/** The phone number this browser has verified in the last 30 minutes, if any. Never trust a number from the request body. */
export const verifiedPhone = () => readToken(cookies().get(VERIFIED_COOKIE)?.value, process.env.VERIFY_TOKEN_SECRET || "");

export async function getCustomer(phone: string) {
  const { data, error } = await db().from("customers").select("*").eq("phone", phone).maybeSingle();
  if (error) throw new Error(`Customer lookup failed: ${error.message}`);
  return data as Customer | null;
}

/** Home visits unlock after a finished shop cut; blocked overrides that (SPEC-v2 §6). */
export const homeAllowed = (c: Customer | null) => !!c && c.home_allowed && !c.blocked;
