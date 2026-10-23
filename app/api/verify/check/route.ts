import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { homeVisitsEnabled } from "@/lib/config";
import { ukMobile } from "@/lib/sms";
import { checkCode, getCustomer, homeAllowed } from "@/lib/verify";
import { makeToken, VERIFIED_COOKIE, VERIFIED_MINS } from "@/lib/verifyToken";

/**
 * Checks the code. If it's right, the browser gets a signed cookie proving the number for 30 minutes, and we say
 * whether that number can book home visits (anyone who isn't blocked).
 */
export async function POST(req: Request) {
  if (!homeVisitsEnabled()) return NextResponse.json({ error: "Home visits aren't open yet." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const phone = ukMobile(String(body.phone || ""));
  const code = String(body.code || "").replace(/\D/g, "");
  if (!phone || code.length !== 6) return NextResponse.json({ error: "Enter the 6-digit code from the text." }, { status: 400 });
  if (!(await checkCode(phone, code))) {
    return NextResponse.json({ error: "That code isn't right, or it has expired. Check the text or send a new one." }, { status: 400 });
  }

  cookies().set(VERIFIED_COOKIE, makeToken(phone, process.env.VERIFY_TOKEN_SECRET!), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: VERIFIED_MINS * 60,
  });
  const customer = await getCustomer(phone);
  return NextResponse.json({
    phone,
    allowed: homeAllowed(customer),
    name: customer?.name ?? "",
    lastBarber: customer?.last_barber ?? null,
  });
}
