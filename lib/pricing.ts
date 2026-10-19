import { PRICING, SERVICES, type PriceTier } from "./config";

export type LocationType = "shop" | "home" | "hotel";

export type QuoteInput = {
  serviceId: string;
  locationType: LocationType;
  slotAt: Date;
  /** When the customer pays. The booking fee is locked in from this moment. */
  now: Date;
  /** Drive from the shop to the customer. Needed for home and hotel visits. */
  driveMinutes?: number;
  driveMiles?: number;
  hotel?: { distanceStepOverride: number | null };
};

export type Quote = {
  servicePrice: number;
  advanceFee: number;
  distanceStep: number;
  total: number;
  tier: PriceTier;
  tierLabel: string;
  outOfArea: boolean;
};

/** The booking fee band for a slot. Exactly 6h or 12h ahead counts as the cheaper band. */
export function advanceBand(slotAt: Date, now: Date) {
  const hoursAhead = (slotAt.getTime() - now.getTime()) / 3600e3;
  const bands = PRICING.advanceFees;
  return bands.find((b) => hoursAhead >= b.minHoursAhead) ?? bands[bands.length - 1];
}

/** The price of a booking, in pence. Used by both the slot list and checkout, so they always agree. */
export function quote({ serviceId, locationType, slotAt, now, driveMinutes, driveMiles, hotel }: QuoteInput): Quote {
  const service = SERVICES.find((s) => s.id === serviceId);
  if (!service) throw new Error(`Unknown service ${serviceId}`);
  const band = advanceBand(slotAt, now);

  let distanceStep = 0;
  let outOfArea = false;
  if (locationType !== "shop") {
    // Always measured from the shop, so the price doesn't depend on which barber accepts.
    if (driveMinutes === undefined || driveMiles === undefined) {
      throw new Error(`Drive time and distance are needed to price a ${locationType} visit`);
    }
    outOfArea = driveMiles > PRICING.maxDriveMiles;
    const override = hotel?.distanceStepOverride;
    distanceStep = override ?? PRICING.distanceSteps.find((s) => driveMinutes <= s.maxDriveMinutes)!.step;
  }

  return {
    servicePrice: service.price,
    advanceFee: band.fee,
    distanceStep,
    total: service.price + band.fee + distanceStep,
    tier: band.tier,
    tierLabel: band.label,
    outOfArea,
  };
}
