export const SHOP = {
  name: "FadeMasters Hale",
  address: "313 Hale Rd, Hale Barns, Altrincham WA15 8SS",
  timeZone: "Europe/London",
  // Where drive times for home visits are measured from (postcodes.io for WA15 8SS).
  lat: 53.369415,
  lng: -2.31366,
};

/**
 * Home visits need the signed "phone given" cookie and drive times (OpenRouteService). Until both are set,
 * "At my place" shows as coming soon.
 */
export const homeVisitsEnabled = () => !!(process.env.VERIFY_TOKEN_SECRET && process.env.ROUTING_API_KEY);

/** Texting a code to prove the number (Twilio Verify). Without it, the customer's number is taken as typed. */
export const phoneCheckEnabled = () => !!process.env.TWILIO_VERIFY_SERVICE_SID;

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
 * A requested barber gets the first `exclusiveMins` to themselves (see lib/preferred.ts).
 */
export const DISPATCH = {
  soon: { remindMins: 10, releaseMins: 20, exclusiveMins: 7 },
  ahead: { remindMins: 120, releaseMins: 12 * 60, releaseBeforeSlotMins: 120, exclusiveMins: 60 },
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

/**
 * Which barber tapped a Telegram button. BARBER_TELEGRAM_IDS lists each barber's Telegram user id in the same order
 * as BARBER_NAMES. Until it's set, taps aren't checked (`checked: false`) and anyone in the group can tap any button.
 */
export function tapper(telegramUserId: unknown): { checked: false } | { checked: true; name: string | null } {
  const ids = (process.env.BARBER_TELEGRAM_IDS || "").split(",").map((s) => s.trim());
  if (!ids.some(Boolean)) return { checked: false };
  const i = ids.indexOf(String(telegramUserId));
  return { checked: true, name: i >= 0 ? barbers()[i] ?? null : null };
}

export const gbp = (pence: number) => `£${(pence / 100).toFixed(2)}`;

/** The booking rules from the one-pager, shown at payment, on the status page and in texts. */
export const RULES = [
  "You're only charged once a barber accepts. Cancel free until then.",
  `Once confirmed, cancel ${CANCEL_CUTOFF_MINS}+ min before and we refund the service; the booking fee is kept.`,
  `Within ${CANCEL_CUTOFF_MINS} min of your slot, nothing is refunded.`,
  `Running late? Up to ${LATE_GRACE_MINS} min is fine. After that the barber may leave and nothing is refunded.`,
];

/** The rules for home visits (SPEC-v2 §10.2, §10.3). */
export const HOME_RULES = [
  "You're only charged once a barber accepts. Cancel free until then.",
  "Once confirmed, cancel before your barber sets off and we refund the service; the booking fee and travel are kept.",
  "Once your barber is on the way, nothing is refunded.",
  `When your barber arrives we text you and call twice. If you're not there ${NO_SHOW_AFTER_MINS} min after they arrive, it's a no-show and nothing is refunded.`,
];

export const rulesFor = (locationType: string) => (locationType === "shop" ? RULES : HOME_RULES);

/** If a barber on a home visit hasn't tapped "Left safely" this long after the cut should have finished, Karo is alerted. */
export const SAFETY_CHECK_MINS = 30;

export const mapsUrl = () =>
  "https://www.google.com/maps/search/?api=1&query=" +
  encodeURIComponent(`FadeMasters ${SHOP.address}`);
