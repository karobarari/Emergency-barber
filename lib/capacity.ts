import { CAPACITY, SERVICES } from "./config";
import type { LocationType } from "./pricing";

/** Statuses that keep a barber (and for the shop, the chair) busy. */
export const ACTIVE_STATUSES = ["pending", "new", "confirmed", "on_the_way", "arrived"];

/** The time a booking keeps a barber busy. */
export type Block = { locationType: LocationType; start: Date; end: Date };

/**
 * Shop bookings block the chair for the length of the service. Home and hotel visits also block the drive there
 * and back, measured from the shop.
 */
export function blockFor({ locationType, slotAt, serviceId, driveMinutes = 0 }: {
  locationType: LocationType;
  slotAt: Date;
  serviceId: string;
  driveMinutes?: number;
}): Block {
  const service = SERVICES.find((s) => s.id === serviceId);
  if (!service) throw new Error(`Unknown service ${serviceId}`);
  const travel = locationType === "shop" ? 0 : driveMinutes * 60e3;
  return {
    locationType,
    start: new Date(slotAt.getTime() - travel),
    end: new Date(slotAt.getTime() + service.mins * 60e3 + travel),
  };
}

/**
 * Whether a new booking fits around the active ones. Must match reserve_booking() in supabase/2026-10-19-capacity.sql,
 * which makes the final decision at checkout.
 * - Shop: a chair is free and a barber is free.
 * - Home or hotel: at least two barbers are free, so one is always left for the shop.
 */
export function hasRoom(candidate: Block, active: Block[], limits = CAPACITY): boolean {
  const overlapping = active.filter((b) => b.start.getTime() < candidate.end.getTime() && b.end.getTime() > candidate.start.getTime());
  if (candidate.locationType === "shop") {
    const inShop = overlapping.filter((b) => b.locationType === "shop").length;
    return inShop < limits.shopChairs && overlapping.length < limits.barberCount;
  }
  return overlapping.length <= limits.barberCount - 2;
}
