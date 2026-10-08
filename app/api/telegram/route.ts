import { NextResponse } from "next/server";
import { assign, refund } from "@/lib/bookings";
import { barbers } from "@/lib/config";
import { answerCallback } from "@/lib/telegram";

// Telegram calls this when someone taps a button on a booking alert.
export async function POST(req: Request) {
  if (req.headers.get("x-telegram-bot-api-secret-token") !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return new NextResponse("forbidden", { status: 403 });
  }
  const update = await req.json();
  const cq = update.callback_query;
  if (!cq?.data) return NextResponse.json({ ok: true });

  // Only accept taps from the barbers' group.
  if (String(cq.message?.chat?.id) !== String(process.env.TELEGRAM_CHAT_ID)) {
    await answerCallback(cq.id, "Not allowed here");
    return NextResponse.json({ ok: true });
  }

  const [action, id, idx] = String(cq.data).split(":");
  if (action === "assign") {
    const name = barbers()[Number(idx)];
    const b = name ? await assign(id, name) : null;
    await answerCallback(cq.id, b ? `Assigned to ${name}. Customer texted.` : "Already taken or refunded");
  } else if (action === "refund") {
    try {
      const b = await refund(id);
      await answerCallback(cq.id, b ? "Refunded. Customer texted." : "Already handled");
    } catch (e) {
      console.error(`Refund failed for booking ${id}`, e);
      await answerCallback(cq.id, "Refund failed. Try again or refund it in Stripe.");
    }
  }
  return NextResponse.json({ ok: true });
}
