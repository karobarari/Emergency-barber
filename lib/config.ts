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

export const LATE_FEE = 50_00; // pence
export const CANCEL_CUTOFF_MINS = 30;
/** Unclaimed bookings: re-ping the barbers' group after this long, then refund automatically. */
export const NO_BARBER = { remindMins: 10, refundMins: 20 };
/** Customers get a reminder text with directions this long before their slot. */
export const SLOT_REMINDER_MINS = 30;
export const LATE_GRACE_MINS = 15;

export const SERVICES = [
  { id: "cut", name: "Skin fade / haircut", mins: 40, price: 26_00 },
  { id: "cutbeard", name: "Haircut + beard", mins: 55, price: 39_00 },
  { id: "premium", name: "Premium package", mins: 75, price: 65_00 },
] as const;

export type ServiceId = (typeof SERVICES)[number]["id"];

export const SLOTS = {
  noticeMins: 60,
  stepMins: 15,
  openFrom: process.env.OPEN_FROM || "19:00",
  lastSlot: process.env.LAST_SLOT || "00:00",
};

export const barbers = () =>
  (process.env.BARBER_NAMES || "Karo,Barber 2,Barber 3")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const gbp = (pence: number) => `£${(pence / 100).toFixed(2)}`;

/** The booking rules from the one-pager, shown at payment, on the status page and in texts. */
export const RULES = [
  "Cancel for a full refund until a barber confirms.",
  `Once confirmed, cancel ${CANCEL_CUTOFF_MINS}+ min before and we refund the service; the ${gbp(LATE_FEE)} late fee is kept.`,
  `Within ${CANCEL_CUTOFF_MINS} min of your slot, nothing is refunded.`,
  `Running late? Up to ${LATE_GRACE_MINS} min is fine. After that the barber may leave and nothing is refunded.`,
];

export const mapsUrl = () =>
  "https://www.google.com/maps/search/?api=1&query=" +
  encodeURIComponent(`FadeMasters ${SHOP.address}`);
