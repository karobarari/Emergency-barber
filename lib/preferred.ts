import { DISPATCH, type PriceTier } from "./config";

/** The parts of a booking the preferred-barber rules look at. */
type Request = {
  preferred_barber: string | null;
  allow_fallback: boolean;
  exclusive_until: string | null; // cleared once the window is over, so the alert opens to everyone
};

/**
 * When the preferred barber's exclusive window ends: 7 min after the hold for last-minute bookings, an hour for ones
 * made ahead. It counts towards the normal re-ping and release times, so it never runs past the release.
 */
export function exclusiveUntil(paidAt: Date, tier: PriceTier, releaseAt: Date): Date {
  const { exclusiveMins } = tier === "standard" ? DISPATCH.soon : DISPATCH.ahead;
  return new Date(Math.min(paidAt.getTime() + exclusiveMins * 60e3, releaseAt.getTime()));
}

/** Whether the requested barber still has the booking to themselves. */
export const isExclusive = (b: Request, now = Date.now()) =>
  !!b.preferred_barber && !!b.exclusive_until && now < new Date(b.exclusive_until).getTime();

/**
 * Whether `barber` may accept. A customer who asked for one barber only never gets anyone else.
 * Otherwise anyone can, except during the requested barber's window.
 */
export function mayAccept(b: Request, barber: string, now = Date.now()) {
  if (!b.preferred_barber || barber === b.preferred_barber) return true;
  if (!b.allow_fallback) return false;
  return !isExclusive(b, now);
}

/** Only the requested barber's button shows while it's theirs, or always if the customer wants nobody else. */
export const onlyPreferredButton = (b: Request) =>
  !!b.preferred_barber && (!b.allow_fallback || !!b.exclusive_until);

/** What happens when the requested barber can't, or their window runs out: open to everyone, or release the hold. */
export const whenPreferredCant = (b: Request): "open" | "release" => (b.allow_fallback ? "open" : "release");
