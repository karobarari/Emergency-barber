import { NextResponse } from "next/server";
import { assign, complete, noShow, refund } from "@/lib/bookings";
import { barbers, LATE_GRACE_MINS } from "@/lib/config";
import { fmtTime } from "@/lib/slots";
import { answerCallback, reportError } from "@/lib/telegram";

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
    try {
      const b = name ? await assign(id, name) : null;
      await answerCallback(cq.id, b ? `Assigned to ${name}. Card charged, customer texted.` : "Already taken or released");
    } catch (e) {
      await reportError(`Charging the card failed when ${name} took booking ${id}`, e);
      await answerCallback(cq.id, "Couldn't charge the customer's card. Don't open up yet. Try again in a moment.");
    }
  } else if (action === "refund") {
    try {
      const b = await refund(id);
      await answerCallback(cq.id, b ? "Hold released. Customer texted." : "Already handled");
    } catch (e) {
      await reportError(`Releasing the hold from Telegram failed for booking ${id}`, e);
      await answerCallback(cq.id, "Couldn't release the hold. Try again or cancel the payment in Stripe.");
    }
  } else if (action === "done") {
    try {
      const b = await complete(id);
      await answerCallback(cq.id, b ? "Marked done. Thanks!" : "Already closed off");
    } catch (e) {
      await reportError(`Marking booking ${id} done from Telegram failed`, e);
      await answerCallback(cq.id, "Couldn't mark it done. Try again in a moment.");
    }
  } else if (action === "noshow") {
    try {
      const r = await noShow(id);
      await answerCallback(
        cq.id,
        r.ok ? "Marked as a no-show. Charge kept, customer texted."
          : r.from ? `Too early. No-show can be marked from ${fmtTime(r.from)}, once they're ${LATE_GRACE_MINS} min late.`
          : "Already closed off",
      );
    } catch (e) {
      await reportError(`Marking booking ${id} a no-show from Telegram failed`, e);
      await answerCallback(cq.id, "Couldn't mark the no-show. Try again in a moment.");
    }
  }
  return NextResponse.json({ ok: true });
}
