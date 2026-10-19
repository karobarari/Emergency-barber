import { DISPATCH, type PriceTier } from "./config";

const mins = (n: number) => n * 60e3;

/** Bookings made under 6h ahead are dispatched on the short clock; the rest give the barbers longer. */
const isAhead = (tier: PriceTier) => tier !== "standard";

/** When to re-ping the barbers' group about a booking nobody has taken. */
export function remindAt(paidAt: Date, tier: PriceTier): Date {
  const plan = isAhead(tier) ? DISPATCH.ahead : DISPATCH.soon;
  return new Date(paidAt.getTime() + mins(plan.remindMins));
}

/**
 * When to release the card hold if nobody has taken the booking. Worked out once when the hold is placed and stored
 * as `release_at`. Bookings made ahead are settled 12h after payment, or 2h before the slot if that's sooner.
 */
export function releaseAt(paidAt: Date, slotAt: Date, tier: PriceTier): Date {
  const soon = paidAt.getTime() + mins(DISPATCH.soon.releaseMins);
  if (!isAhead(tier)) return new Date(soon);
  const { releaseMins, releaseBeforeSlotMins } = DISPATCH.ahead;
  const ahead = Math.min(paidAt.getTime() + mins(releaseMins), slotAt.getTime() - mins(releaseBeforeSlotMins));
  // Never give the barbers less time than a last-minute booking gets.
  return new Date(Math.max(ahead, soon));
}
