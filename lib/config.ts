export const SHOP = {
  name: "FadeMasters Hale",
  address: "313 Hale Rd, Hale Barns, Altrincham WA15 8SS",
  timeZone: "Europe/London",
};

/** Who runs the service, for the terms and privacy notice. */
export const OPERATOR = {
  name: "Karo Barari",
  trading: "Emergency Barber",
  email: "karobarari@gmail.com",
  retentionYears: 6, // HMRC wants financial records kept for 6 years
};

/**
 * Prices in pence (see lib/pricing.ts). The booking fee depends on how far ahead the customer books, travel on the drive
 * time from the shop (home and hotel visits only). Both are locked into the card hold at checkout.
 */
export const PRICING = {
  advanceFees: [
    { minHoursAhead: 12, fee: 25_00, tier: "12h", label: "booked 12h+ ahead" },
    { minHoursAhead: 6, fee: 35_00, tier: "6h", label: "booked 6h+ ahead" },
    { minHoursAhead: 0, fee: 50_00, tier: "standard", label: "booked under 6h ahead" },
  ],
  distanceSteps: [
    { maxDriveMinutes: 5, step: 0 },
    { maxDriveMinutes: 15, step: 5_00 },
    { maxDriveMinutes: 25, step: 10_00 },
    { maxDriveMinutes: Infinity, step: 15_00 },
  ],
  maxDriveMiles: 13,
} as const;

export type PriceTier = (typeof PRICING.advanceFees)[number]["tier"];

export const CANCEL_CUTOFF_MINS = 30;
/**
 * Unclaimed bookings: re-ping the barbers' group after `remindMins`, then release the card hold automatically
 * (see lib/dispatch.ts). Bookings made 6h+ ahead give the barbers longer, but are always settled 2h before the slot.
 */
export const DISPATCH = {
  soon: { remindMins: 10, releaseMins: 20 },
  ahead: { remindMins: 120, releaseMins: 12 * 60, releaseBeforeSlotMins: 120 },
};
/** Customers get a reminder text with directions this long before their slot. */
export const SLOT_REMINDER_MINS = 30;
export const LATE_GRACE_MINS = 15;
/** A barber can mark a no-show once the customer is this late (the lateness grace). */
export const NO_SHOW_AFTER_MINS = LATE_GRACE_MINS;
/** If a confirmed booking still isn't marked done this long after it should have finished, the barber gets a nudge. */
export const DONE_NUDGE_MINS = 30;

export const SERVICES = [
  { id: "cut", name: "Skin fade / haircut", mins: 40, price: 26_00 },
  { id: "cutbeard", name: "Haircut + beard", mins: 55, price: 39_00 },
  { id: "premium", name: "Premium package", mins: 75, price: 65_00 },
] as const;

export type ServiceId = (typeof SERVICES)[number]["id"];

/**
 * How many bookings can run at once (see lib/capacity.ts). Home and hotel visits always leave one barber free,
 * so the shop gets priority.
 */
export const CAPACITY = {
  barberCount: Number(process.env.BARBER_COUNT || 3),
  shopChairs: Number(process.env.SHOP_CHAIRS || 1),
};

export const SLOTS = {
  noticeMins: 60,
  stepMins: 15,
  openFrom: process.env.OPEN_FROM || "19:00",
  lastSlot: process.env.LAST_SLOT || "00:00",
  // Today plus this many days. Stripe card holds expire after 7 days, so never more than 6.
  advanceDays: Math.min(6, Number(process.env.ADVANCE_DAYS || 6)),
};

export const barbers = () =>
  (process.env.BARBER_NAMES || "Karo,Barber 2,Barber 3")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const gbp = (pence: number) => `£${(pence / 100).toFixed(2)}`;

/** The booking rules from the one-pager, shown at payment, on the status page and in texts. */
export const RULES = [
  "You're only charged once a barber accepts. Cancel free until then.",
  `Once confirmed, cancel ${CANCEL_CUTOFF_MINS}+ min before and we refund the service; the booking fee is kept.`,
  `Within ${CANCEL_CUTOFF_MINS} min of your slot, nothing is refunded.`,
  `Running late? Up to ${LATE_GRACE_MINS} min is fine. After that the barber may leave and nothing is refunded.`,
];

export const mapsUrl = () =>
  "https://www.google.com/maps/search/?api=1&query=" +
  encodeURIComponent(`FadeMasters ${SHOP.address}`);
