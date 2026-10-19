import { describe, expect, it } from "vitest";
import { availableSlots, bookingNights, dayKey, fmtWhen, nightOf } from "./slots";

const iso = (d: Date) => d.toISOString();

describe("availableSlots", () => {
  it("covers tonight plus the next 6 evenings, 19:00 to midnight every 15 min", () => {
    const now = new Date("2026-10-19T10:00:00Z"); // Mon 11:00 BST
    const slots = availableSlots(now);
    expect(slots).toHaveLength(7 * 21);
    expect(iso(slots[0])).toBe("2026-10-19T18:00:00.000Z"); // Mon 19:00 BST
    expect(iso(slots[20])).toBe("2026-10-19T23:00:00.000Z"); // Tue 00:00 BST
    expect(iso(slots[slots.length - 1])).toBe("2026-10-26T00:00:00.000Z"); // Mon 26 Oct 00:00 GMT
  });

  it("keeps London times across the switch from BST to GMT", () => {
    const slots = availableSlots(new Date("2026-10-19T10:00:00Z")).map(iso);
    expect(slots).toContain("2026-10-24T18:00:00.000Z"); // Sat 19:00 BST
    expect(slots).toContain("2026-10-25T19:00:00.000Z"); // Sun 19:00 GMT
    expect(slots).not.toContain("2026-10-25T18:00:00.000Z");
  });

  it("needs at least an hour's notice", () => {
    const slots = availableSlots(new Date("2026-10-19T19:05:00Z")); // Mon 20:05 BST
    expect(iso(slots[0])).toBe("2026-10-19T20:15:00.000Z"); // 21:15 BST
  });

  it("skips taken slots", () => {
    const taken = [new Date("2026-10-20T18:00:00Z")];
    expect(availableSlots(new Date("2026-10-19T10:00:00Z"), taken).map(iso)).not.toContain(iso(taken[0]));
  });

  it("after midnight, still offers 6 more evenings", () => {
    const now = new Date("2026-10-20T00:30:00Z"); // Tue 01:30 BST
    const nights = bookingNights(now).map(dayKey);
    expect(nights[0]).toBe("2026-10-19"); // last night, already over
    expect(nights[nights.length - 1]).toBe("2026-10-26");
    expect(iso(availableSlots(now)[0])).toBe("2026-10-20T18:00:00.000Z"); // Tue 19:00 BST
  });
});

describe("nightOf", () => {
  it("counts the early hours as the previous evening", () => {
    expect(dayKey(nightOf(new Date("2026-10-19T23:00:00Z")))).toBe("2026-10-19"); // Tue 00:00 BST
    expect(dayKey(nightOf(new Date("2026-10-19T18:00:00Z")))).toBe("2026-10-19");
  });
});

describe("fmtWhen", () => {
  const now = new Date("2026-10-19T10:00:00Z");
  it("says tonight, tomorrow or the date", () => {
    expect(fmtWhen(new Date("2026-10-19T20:00:00Z"), now)).toBe("21:00 tonight");
    expect(fmtWhen(new Date("2026-10-19T12:00:00Z"), now)).toBe("13:00 today");
    expect(fmtWhen(new Date("2026-10-20T18:30:00Z"), now)).toBe("19:30 tomorrow");
    expect(fmtWhen(new Date("2026-10-21T18:00:00Z"), now)).toBe("19:00 Wed 21 Oct");
  });
});
