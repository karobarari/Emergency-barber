import { createHmac, timingSafeEqual } from "node:crypto";

/** How long a verified phone number stays verified in the browser. */
export const VERIFIED_MINS = 30;
export const VERIFIED_COOKIE = "eb_verified";

const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest("base64url");

/** A short-lived token proving this browser verified `phone` with a text code. */
export function makeToken(phone: string, secret: string, now = Date.now()) {
  const payload = `${phone}.${now + VERIFIED_MINS * 60e3}`;
  return `${payload}.${sign(payload, secret)}`;
}

/** The verified phone number, or null if the token is missing, tampered with or expired. */
export function readToken(token: string | undefined, secret: string, now = Date.now()): string | null {
  if (!token || !secret) return null;
  const [phone, exp, mac] = token.split(".");
  if (!phone || !exp || !mac) return null;
  const expected = Buffer.from(sign(`${phone}.${exp}`, secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return now < Number(exp) ? phone : null;
}
