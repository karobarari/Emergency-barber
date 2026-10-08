import { SHOP, SLOTS } from "./config";

const TZ = SHOP.timeZone;

/** Wall-clock parts of a date in London time. */
export function londonParts(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute };
}

/** The UTC instant for a London wall-clock time (handles BST/GMT). */
export function londonTime(y: number, m: number, d: number, h: number, min: number) {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const p = londonParts(new Date(guess));
  const offset = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - guess;
  return new Date(guess - offset);
}

const hm = (s: string) => s.split(":").map(Number) as [number, number];

/**
 * Bookable slots for tonight's out-of-hours window: from OPEN_FROM up to LAST_SLOT
 * (00:00 = midnight), at least SLOTS.noticeMins from now, minus taken slots.
 */
export function availableSlots(now: Date, taken: Date[] = []): Date[] {
  // Treat the early hours (before 06:00) as belonging to the previous evening.
  const ref = londonParts(new Date(now.getTime() - 6 * 3600e3));
  const [oh, om] = hm(SLOTS.openFrom);
  const [lh, lm] = hm(SLOTS.lastSlot);
  const start = londonTime(ref.y, ref.m, ref.d, oh, om);
  // A last slot at or before the opening time means "after midnight".
  const lastSameDay = lh * 60 + lm > oh * 60 + om;
  const endDay = new Date(Date.UTC(ref.y, ref.m - 1, ref.d + (lastSameDay ? 0 : 1)));
  const end = londonTime(endDay.getUTCFullYear(), endDay.getUTCMonth() + 1, endDay.getUTCDate(), lh, lm);

  const step = SLOTS.stepMins * 60e3;
  const earliest = Math.ceil((now.getTime() + SLOTS.noticeMins * 60e3) / step) * step;
  const takenSet = new Set(taken.map((t) => t.getTime()));
  const out: Date[] = [];
  for (let t = Math.max(start.getTime(), earliest); t <= end.getTime(); t += step) {
    if (!takenSet.has(t)) out.push(new Date(t));
  }
  return out;
}

export const fmtTime = (d: Date | string) =>
  new Date(d).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

export const fmtDay = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
