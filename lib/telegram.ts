import "server-only";
import { barbers, gbp, SHOP } from "./config";
import { fmtDay, fmtTime } from "./slots";
import type { Booking } from "./supabase";

const api = (method: string, body: unknown) =>
  fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());

export function bookingText(b: Booking) {
  const lines = [
    `💈 NEW LATE BOOKING · ${fmtTime(b.slot_at)} (${fmtDay(b.slot_at)})`,
    `${b.name} · ${b.phone}`,
    `${b.service_name} · ${b.status === "new" ? `${gbp(b.total)} held, charged when you accept` : gbp(b.total)}`,
    `Open ${SHOP.name}`,
  ];
  if (b.status === "confirmed") lines.push(`\n✅ ${b.barber} is taking this · card charged`);
  if (b.status === "refunded") lines.push(`\n↩️ Nobody free, hold released`);
  if (b.status === "done") lines.push(`\n✔️ Done (${b.barber})`);
  if (b.status === "cancelled") lines.push(`\n🚫 Cancelled by customer · refunded ${gbp(b.refund_amount ?? 0)}`);
  return lines.join("\n");
}

const keyboard = (b: Booking) =>
  b.status === "new"
    ? {
        inline_keyboard: [
          barbers().map((name, i) => ({ text: `✂️ ${name}`, callback_data: `assign:${b.id}:${i}` })),
          [{ text: "Nobody free: release hold", callback_data: `refund:${b.id}` }],
        ],
      }
    : { inline_keyboard: [] };

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
export async function sendReminder(b: Booking, refundInMins: number): Promise<number | null> {
  if (!process.env.TELEGRAM_BOT_TOKEN) return null;
  if (!b.telegram_message_id) return sendBookingAlert(b);
  const res = await api("sendMessage", {
    chat_id: process.env.TELEGRAM_CHAT_ID,
    reply_to_message_id: b.telegram_message_id,
    text: `⏰ Still needs a barber: ${fmtTime(b.slot_at)} · ${b.service_name}. Tap your name above, or the customer's hold is released automatically in ${refundInMins} min.`,
  });
  if (!res?.ok) throw new Error(`Telegram reminder failed for booking ${b.id}: ${res?.description}`);
  return null;
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
