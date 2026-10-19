import { CANCEL_CUTOFF_MINS, NO_SHOW_AFTER_MINS, SAFETY_CHECK_MINS, SERVICES } from "./config";
import type { LocationType } from "./pricing";

/** The parts of a booking these rules look at. */
type Visit = {
  location_type: LocationType;
  status: string;
  slot_at: string;
  total: number;
  service_price: number;
  service_id: string;
  arrived_at?: string | null;
  left_at?: string | null;
};

export const isMobile = (b: Pick<Visit, "location_type">) => b.location_type !== "shop";

/**
 * What a customer gets back if they cancel now, in pence, or null if they can't cancel.
 * Shop (§10.1): everything before a barber accepts; the service price 30+ min before; nothing after that.
 * Home and hotel (§10.2): everything before a barber accepts; the service price until the barber sets off
 * (booking fee and travel kept); nothing once they're on the way.
 */
export function cancelQuote(b: Visit, now = Date.now()): number | null {
  const minsLeft = (new Date(b.slot_at).getTime() - now) / 60e3;
  if (minsLeft <= 0) return null;
  if (b.status === "new") return b.total;
  if (isMobile(b)) {
    if (b.status === "confirmed") return b.service_price;
    if (b.status === "on_the_way") return 0;
    return null;
  }
  if (b.status === "confirmed") return minsLeft >= CANCEL_CUTOFF_MINS ? b.service_price : 0;
  return null;
}

/**
 * When the barber can mark a no-show. Shop: once the customer is past the lateness grace. Home and hotel: 15 min after
 * the barber arrived (they call twice first). Null until a mobile barber has arrived.
 */
export function noShowFrom(b: Visit): Date | null {
  if (!isMobile(b)) return new Date(new Date(b.slot_at).getTime() + NO_SHOW_AFTER_MINS * 60e3);
  return b.arrived_at ? new Date(new Date(b.arrived_at).getTime() + NO_SHOW_AFTER_MINS * 60e3) : null;
}

export type VisitAction = "on_the_way" | "arrived" | "done" | "noshow" | "left";

/**
 * The buttons a barber gets after accepting (§9). Shop: Done or No-show. Home and hotel: On my way → Arrived →
 * Done or No-show → Left safely.
 */
export function nextActions(b: Visit): VisitAction[] {
  if (!isMobile(b)) return b.status === "confirmed" ? ["done", "noshow"] : [];
  if (b.status === "confirmed") return ["on_the_way"];
  if (b.status === "on_the_way") return ["arrived"];
  if (b.status === "arrived") return ["done", "noshow"];
  if ((b.status === "done" || b.status === "no_show") && !b.left_at) return ["left"];
  return [];
}

/** When Karo is alerted if a mobile barber hasn't tapped "Left safely": 30 min after the cut should have finished. */
export function safetyCheckAt(b: Visit): Date | null {
  if (!isMobile(b) || !b.arrived_at) return null;
  const mins = SERVICES.find((s) => s.id === b.service_id)?.mins ?? 75;
  return new Date(new Date(b.arrived_at).getTime() + (mins + SAFETY_CHECK_MINS) * 60e3);
}
