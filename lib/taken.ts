import "server-only";
import { availableSlots } from "./slots";
import { db } from "./supabase";

/** Free slots right now, after removing ones already paid for or being paid for. */
export async function freeSlots(now = new Date()) {
  const window = availableSlots(now);
  if (!window.length) return [];
  const { data } = await db()
    .from("bookings")
    .select("slot_at")
    .in("status", ["pending", "new", "confirmed"])
    .gte("slot_at", window[0].toISOString())
    .lte("slot_at", window[window.length - 1].toISOString());
  return availableSlots(now, (data || []).map((r) => new Date(r.slot_at)));
}
