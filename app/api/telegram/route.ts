import { NextResponse } from "next/server";
import { arrived, assign, complete, getBooking, leftSafely, noShow, onTheWay, preferredCant, refund } from "@/lib/bookings";
import { barbers, tapper } from "@/lib/config";
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
  // Once BARBER_TELEGRAM_IDS is set, barbers can only tap their own buttons.
  const who = tapper(cq.from?.id);
  const notYou = async (barber: string | null) => {
    if (!who.checked || who.name === barber) return false;
    await answerCallback(cq.id, barber ? `Only ${barber} can tap this` : "Not your booking");
    return true;
  };

  if (action === "assign") {
    const name = barbers()[Number(idx)];
    if (await notYou(name ?? null)) return NextResponse.json({ ok: true });
    try {
      const b = name ? await assign(id, name) : null;
      await answerCallback(
        cq.id,
        b === "not_allowed" ? "The customer asked for another barber. Wait until it opens to everyone."
          : b ? `Assigned to ${name}. Card charged, customer texted.`
          : "Already taken or released",
      );
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
  } else if (action === "cant") {
    try {
      const current = await getBooking(id);
      if (current && (await notYou(current.preferred_barber))) return NextResponse.json({ ok: true });
      const b = await preferredCant(id);
      await answerCallback(
        cq.id,
        !b ? "Already handled" : b.status === "refunded" ? "Hold released. Customer texted." : "Open to everyone now.",
      );
    } catch (e) {
      await reportError(`"Can't" from Telegram failed for booking ${id}`, e);
      await answerCallback(cq.id, "Something went wrong. Try again in a moment.");
    }
  } else if (["done", "noshow", "way", "arrived", "left"].includes(action) && who.checked) {
    // Only the barber who took the job closes it off.
    const current = await getBooking(id).catch(() => null);
    if (current && (await notYou(current.barber))) return NextResponse.json({ ok: true });
  }

  if (action === "done") {
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
          : r.from ? `Too early. No-show can be marked from ${fmtTime(r.from)}.`
          : "Already closed off",
      );
    } catch (e) {
      await reportError(`Marking booking ${id} a no-show from Telegram failed`, e);
      await answerCallback(cq.id, "Couldn't mark the no-show. Try again in a moment.");
    }
  } else if (action === "way" || action === "arrived" || action === "left") {
    const step = { way: onTheWay, arrived, left: leftSafely }[action];
    const said = { way: "Customer texted your arrival time. Drive safe.", arrived: "Customer texted that you're here.", left: "Thanks, glad you're out safely." }[action];
    try {
      const b = await step(id);
      await answerCallback(cq.id, b ? said : "Already done");
    } catch (e) {
      await reportError(`"${action}" from Telegram failed for booking ${id}`, e);
      await answerCallback(cq.id, "Something went wrong. Try again in a moment.");
    }
  }
  return NextResponse.json({ ok: true });
}
