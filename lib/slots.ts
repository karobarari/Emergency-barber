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

type Day = { y: number; m: number; d: number };

/** A calendar date `n` days after `day` (rolls over months and years). */
function addDays({ y, m, d }: Day, n: number): Day {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export const dayKey = ({ y, m, d }: Day) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** The evening a time belongs to. The early hours (before 06:00) count as the previous evening. */
export const nightOf = (t: Date): Day => londonParts(new Date(t.getTime() - 6 * 3600e3));

/**
 * The evenings a customer can book: today plus SLOTS.advanceDays. Just after midnight this also includes last night,
 * in case LAST_SLOT runs past midnight.
 */
export function bookingNights(now: Date): Day[] {
  const first = nightOf(now);
  const last = dayKey(addDays(londonParts(now), SLOTS.advanceDays));
  const out: Day[] = [];
  for (let day = first; dayKey(day) <= last; day = addDays(day, 1)) out.push(day);
  return out;
}

/** Opening time and last slot for one evening: from OPEN_FROM up to LAST_SLOT (00:00 = midnight). */
function nightWindow(day: Day) {
  const [oh, om] = hm(SLOTS.openFrom);
  const [lh, lm] = hm(SLOTS.lastSlot);
  // A last slot at or before the opening time means "after midnight".
  const endDay = lh * 60 + lm > oh * 60 + om ? day : addDays(day, 1);
  return {
    start: londonTime(day.y, day.m, day.d, oh, om),
    end: londonTime(endDay.y, endDay.m, endDay.d, lh, lm),
  };
}

/**
 * Every slot across the evenings customers can book, at least SLOTS.noticeMins from now. Doesn't know about other
 * bookings: lib/taken.ts removes the ones without room.
 */
export function availableSlots(now: Date): Date[] {
  const step = SLOTS.stepMins * 60e3;
  const earliest = Math.ceil((now.getTime() + SLOTS.noticeMins * 60e3) / step) * step;
  const out: Date[] = [];
  for (const night of bookingNights(now)) {
    const { start, end } = nightWindow(night);
    for (let t = Math.max(start.getTime(), earliest); t <= end.getTime(); t += step) out.push(new Date(t));
  }
  return out;
}

export const fmtTime = (d: Date | string) =>
  new Date(d).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

export const fmtDay = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });

/** "21:00 tonight", "19:30 tomorrow" or "20:15 Wed 21 Oct", relative to `now`. For texts and pages, not Telegram alerts. */
export function fmtWhen(d: Date | string, now = new Date()) {
  const t = new Date(d);
  const day = dayKey(londonParts(t));
  const today = londonParts(now);
  if (day === dayKey(today)) return `${fmtTime(t)} ${londonParts(t).h >= 17 ? "tonight" : "today"}`;
  if (day === dayKey(addDays(today, 1))) return `${fmtTime(t)} tomorrow`;
  return `${fmtTime(t)} ${fmtDay(t)}`;
}
