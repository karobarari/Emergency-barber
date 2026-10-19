import "server-only";
import { barbers, gbp, SHOP } from "./config";
import { onlyPreferredButton } from "./preferred";
import { fmtDay, fmtTime } from "./slots";
import type { Booking } from "./supabase";
import { isMobile, nextActions, noShowFrom, type VisitAction } from "./visit";

const api = (method: string, body: unknown) =>
  fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());

/** Where the cut happens: open the shop, or drive to the customer (leaving the shop in time to arrive at the slot). */
function whereLines(b: Booking) {
  if (!isMobile(b)) return [`Open ${SHOP.name}`];
  const leave = new Date(new Date(b.slot_at).getTime() - (b.drive_minutes ?? 0) * 60e3);
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${b.address}, ${b.postcode}`)}`;
  return [
    `🏠 ${b.address}, ${b.postcode}`,
    `🚗 ${b.drive_minutes} min / ${b.drive_miles} mi from the shop · leave by ${fmtTime(leave)}`,
    maps,
  ];
}

export function bookingText(b: Booking) {
  const lines = [
    `${isMobile(b) ? "🏠 HOME VISIT" : "💈 NEW LATE BOOKING"} · ${fmtTime(b.slot_at)} (${fmtDay(b.slot_at)})`,
    ...(b.preferred_barber ? [`🙋 Requested: ${b.preferred_barber}${b.allow_fallback ? "" : " only"}`] : []),
    `${b.name} · ${b.phone}`,
    `${b.service_name} · ${b.status === "new" ? `${gbp(b.total)} held, charged when you accept` : gbp(b.total)}` +
      (b.distance_step ? ` (incl. ${gbp(b.distance_step)} travel)` : ""),
    ...whereLines(b),
  ];
  if (b.status === "new" && b.preferred_barber && b.exclusive_until && b.allow_fallback) {
    lines.push(`🔒 ${b.preferred_barber} has until ${fmtTime(b.exclusive_until)}, then it opens to everyone`);
  }
  // Alerts stay in the group for days, so say the day rather than "tonight".
  if (b.status === "new" && b.release_at) {
    lines.push(`⏳ Take it by ${fmtTime(b.release_at)} (${fmtDay(b.release_at)}) or the customer's hold is released`);
  }
  const instead = b.preferred_barber && b.barber && b.barber !== b.preferred_barber ? ` (instead of ${b.preferred_barber})` : "";
  if (b.status === "confirmed") lines.push(`\n✅ ${b.barber} is taking this${instead} · card charged`);
  if (b.status === "on_the_way") lines.push(`\n🚗 ${b.barber} is on the way · arriving ${fmtTime(b.eta_at!)}`);
  if (b.status === "arrived") lines.push(`\n📍 ${b.barber} arrived ${fmtTime(b.arrived_at!)}`);
  if (b.status === "refunded") {
    lines.push(b.preferred_barber && !b.allow_fallback ? `\n↩️ ${b.preferred_barber} couldn't, hold released` : `\n↩️ Nobody free, hold released`);
  }
  if (b.status === "done") lines.push(`\n✔️ Done (${b.barber})`);
  if (b.status === "no_show") lines.push(`\n👻 No-show (${b.barber}) · charge kept`);
  if (isMobile(b) && (b.status === "done" || b.status === "no_show")) {
    lines.push(b.left_at ? `🏁 Left safely ${fmtTime(b.left_at)}` : `Tap Left safely once you're out`);
  }
  if (b.status === "cancelled") lines.push(`\n🚫 Cancelled by customer · refunded ${gbp(b.refund_amount ?? 0)}`);
  return lines.join("\n");
}

function newKeyboard(b: Booking) {
  const preferred = b.preferred_barber ? barbers().indexOf(b.preferred_barber) : -1;
  // A renamed barber has no button any more, so fall back to showing everyone.
  if (preferred >= 0 && onlyPreferredButton(b)) {
    const name = b.preferred_barber;
    return {
      inline_keyboard: [
        [{ text: `✂️ ${name}`, callback_data: `assign:${b.id}:${preferred}` }],
        [{ text: b.allow_fallback ? `${name} can't: open to everyone` : `${name} can't: release hold`, callback_data: `cant:${b.id}` }],
      ],
    };
  }
  return {
    inline_keyboard: [
      barbers().map((name, i) => ({ text: `✂️ ${name}`, callback_data: `assign:${b.id}:${i}` })),
      [{ text: "Nobody free: release hold", callback_data: `refund:${b.id}` }],
    ],
  };
}

/** After Accept: Done / No-show for the shop; On my way → Arrived → Done / No-show → Left safely for visits (§9). */
function afterKeyboard(b: Booking) {
  const button = (a: VisitAction) => {
    if (a === "on_the_way") return { text: "🚗 On my way", callback_data: `way:${b.id}` };
    if (a === "arrived") return { text: "📍 Arrived", callback_data: `arrived:${b.id}` };
    if (a === "done") return { text: "✔️ Done", callback_data: `done:${b.id}` };
    if (a === "left") return { text: "🏁 Left safely", callback_data: `left:${b.id}` };
    // Always shown; the server refuses it until it's allowed.
    const from = noShowFrom(b);
    return { text: `👻 No-show${from ? ` (from ${fmtTime(from)})` : ""}`, callback_data: `noshow:${b.id}` };
  };
  const actions = nextActions(b);
  return { inline_keyboard: actions.length ? [actions.map(button)] : [] };
}

const keyboard = (b: Booking) => (b.status === "new" ? newKeyboard(b) : afterKeyboard(b));

/** Sends the alert to the barbers' group. Returns the message id. */
export async function sendBookingAlert(b: Booking): Promise<number | null> {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.warn(`TELEGRAM_BOT_TOKEN not set, skipping alert for booking ${b.id}`);
    return null;
  }
  const res = await api("sendMessage", {
    chat_id: process.env.TELEGRAM_CHAT_ID,
    text: bookingText(b),
    reply_markup: keyboard(b),
  });
  // Telegram reports errors (bad chat id, bot removed from group) in the body, not as a thrown error.
  if (!res?.ok) throw new Error(`Telegram sendMessage failed (chat ${process.env.TELEGRAM_CHAT_ID}): ${res?.description}`);
  return res.result.message_id;
}

/** Rewrites the alert so everyone in the group sees who took the job. */
export async function updateBookingAlert(b: Booking) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !b.telegram_message_id) return;
  await api("editMessageText", {
    chat_id: process.env.TELEGRAM_CHAT_ID,
    message_id: b.telegram_message_id,
    text: bookingText(b),
    reply_markup: keyboard(b),
  });
}

/**
 * Nudges the group about a booking nobody has taken. Replies to the original alert so the buttons are one tap away;
 * if that alert never went out, sends a fresh one and returns its id.
 */
export async function sendReminder(b: Booking, releaseAt: Date, now = new Date()): Promise<number | null> {
  if (!process.env.TELEGRAM_BOT_TOKEN) return null;
  if (!b.telegram_message_id) return sendBookingAlert(b);
  const minsLeft = Math.ceil((releaseAt.getTime() - now.getTime()) / 60e3);
  const when = minsLeft <= 60 ? `in ${minsLeft} min` : `at ${fmtTime(releaseAt)} (${fmtDay(releaseAt)})`;
  const res = await api("sendMessage", {
    chat_id: process.env.TELEGRAM_CHAT_ID,
    reply_to_message_id: b.telegram_message_id,
    text: `⏰ Still needs a barber: ${fmtTime(b.slot_at)} (${fmtDay(b.slot_at)}) · ${b.service_name}. Tap your name above, or the customer's hold is released automatically ${when}.`,
  });
  if (!res?.ok) throw new Error(`Telegram reminder failed for booking ${b.id}: ${res?.description}`);
  return null;
}

/** Tells the group a requested booking is now anyone's, replying to the alert that now has everyone's buttons. */
export async function sendOpenedNotice(b: Booking, why: "cant" | "timeout") {
  if (!process.env.TELEGRAM_BOT_TOKEN) return;
  const res = await api("sendMessage", {
    chat_id: process.env.TELEGRAM_CHAT_ID,
    ...(b.telegram_message_id ? { reply_to_message_id: b.telegram_message_id } : {}),
    text: `🔓 ${b.preferred_barber} ${why === "cant" ? "can't take" : "didn't take"} the ${fmtTime(b.slot_at)} (${fmtDay(b.slot_at)}). It's open to everyone now: tap your name above.`,
  });
  if (!res?.ok) throw new Error(`Telegram open notice failed for booking ${b.id}: ${res?.description}`);
}

/** Tells Karo privately that a barber on a visit hasn't checked out, with everything needed to follow up (§9.1). */
export async function sendSafetyAlert(b: Booking) {
  const chat = process.env.TELEGRAM_ALERT_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
  if (!process.env.TELEGRAM_BOT_TOKEN || !chat) return;
  const res = await api("sendMessage", {
    chat_id: chat,
    text:
      `🚨 ${b.barber} hasn't tapped Left safely\n` +
      `Arrived ${fmtTime(b.arrived_at!)} (${fmtDay(b.arrived_at!)}) for a ${b.service_name}\n` +
      `${b.address}, ${b.postcode}\nCustomer: ${b.name} · ${b.phone}\nCall ${b.barber} to check they're OK.`,
  });
  if (!res?.ok) throw new Error(`Telegram safety alert failed for booking ${b.id}: ${res?.description}`);
}

/** Asks the assigned barber to close off a cut that should have finished, replying to the alert so the buttons are one tap away. */
export async function sendDoneNudge(b: Booking) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return;
  const res = await api("sendMessage", {
    chat_id: process.env.TELEGRAM_CHAT_ID,
    ...(b.telegram_message_id ? { reply_to_message_id: b.telegram_message_id } : {}),
    text: `🧾 ${b.barber}, is ${b.name}'s ${fmtTime(b.slot_at)} cut (${fmtDay(b.slot_at)}) finished? Tap Done above, or No-show if they never came.`,
  });
  if (!res?.ok) throw new Error(`Telegram Done nudge failed for booking ${b.id}: ${res?.description}`);
}

export const answerCallback = (id: string, text: string) =>
  api("answerCallbackQuery", { callback_query_id: id, text });

/**
 * Logs an error and posts it to Telegram so nothing fails silently. Goes to TELEGRAM_ALERT_CHAT_ID if set
 * (e.g. a private chat with Karo), otherwise the barbers' group. Never throws.
 */
export async function reportError(where: string, e: unknown) {
  console.error(where, e);
  const chat = process.env.TELEGRAM_ALERT_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
  if (!process.env.TELEGRAM_BOT_TOKEN || !chat) return;
  // Supabase errors are plain objects with a message, not Error instances.
  const msg = e instanceof Error ? e.message : (e as { message?: unknown })?.message;
  const detail = String(msg ?? e).slice(0, 500);
  try {
    await api("sendMessage", { chat_id: chat, text: `⚠️ ${where}\n${detail}` });
  } catch (sendErr) {
    console.error("Couldn't post error alert to Telegram", sendErr);
  }
}
