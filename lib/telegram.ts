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
    `${b.service_name} · paid ${gbp(b.total)}`,
    `Open ${SHOP.name}`,
  ];
  if (b.status === "confirmed") lines.push(`\n✅ ${b.barber} is taking this`);
  if (b.status === "refunded") lines.push(`\n↩️ Refunded, nobody free`);
  if (b.status === "done") lines.push(`\n✔️ Done (${b.barber})`);
  return lines.join("\n");
}

const keyboard = (b: Booking) =>
  b.status === "new"
    ? {
        inline_keyboard: [
          barbers().map((name, i) => ({ text: `✂️ ${name}`, callback_data: `assign:${b.id}:${i}` })),
          [{ text: "Nobody free: refund", callback_data: `refund:${b.id}` }],
        ],
      }
    : { inline_keyboard: [] };

/** Sends the alert to the barbers' group. Returns the message id. */
export async function sendBookingAlert(b: Booking): Promise<number | null> {
  if (!process.env.TELEGRAM_BOT_TOKEN) return null;
  const res = await api("sendMessage", {
    chat_id: process.env.TELEGRAM_CHAT_ID,
    text: bookingText(b),
    reply_markup: keyboard(b),
  });
  return res?.result?.message_id ?? null;
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

export const answerCallback = (id: string, text: string) =>
  api("answerCallbackQuery", { callback_query_id: id, text });
