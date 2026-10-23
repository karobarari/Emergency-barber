import { NextResponse } from "next/server";
import { homeVisitsEnabled, phoneCheckEnabled } from "@/lib/config";
import { ukMobile } from "@/lib/sms";
import { reportError } from "@/lib/telegram";
import { sendCode } from "@/lib/verify";

/** Texts a 6-digit code to the customer's mobile, so home visits can only be booked by whoever has the phone. */
export async function POST(req: Request) {
  if (!homeVisitsEnabled() || !phoneCheckEnabled()) return NextResponse.json({ error: "Home visits aren't open yet." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const phone = ukMobile(String(body.phone || ""));
  if (!phone) return NextResponse.json({ error: "Enter a UK mobile number, like 07700 900123." }, { status: 400 });
  const r = await sendCode(phone);
  // Twilio refuses with 429 when a number asks for too many codes.
  if (r.status === 429) return NextResponse.json({ error: "Too many codes requested. Wait a few minutes and try again." }, { status: 429 });
  if (!r.ok) {
    await reportError(`Verify code to ${phone} failed (Twilio ${r.status})`, r.body?.message ?? r.body);
    return NextResponse.json({ error: "Couldn't send the code. Check the number and try again." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
