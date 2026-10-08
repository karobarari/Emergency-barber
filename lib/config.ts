export const SHOP = {
  name: "FadeMasters Hale",
  address: "313 Hale Rd, Hale Barns, Altrincham WA15 8SS",
  timeZone: "Europe/London",
};

export const LATE_FEE = 50_00; // pence

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

export const mapsUrl = () =>
  "https://www.google.com/maps/search/?api=1&query=" +
  encodeURIComponent(`FadeMasters ${SHOP.address}`);
