import { describe, expect, it } from "vitest";
import { exclusiveUntil, isExclusive, mayAccept, onlyPreferredButton, whenPreferredCant } from "./preferred";

const paid = new Date("2026-10-19T19:00:00Z");
const later = (mins: number) => new Date(paid.getTime() + mins * 60e3);
const booking = (o: Partial<{ preferred_barber: string | null; allow_fallback: boolean; exclusive_until: string | null }> = {}) => ({
  preferred_barber: "Joe",
  allow_fallback: true,
  exclusive_until: later(7).toISOString(),
  ...o,
});
const inWindow = later(3).getTime();
const afterWindow = later(8).getTime();

describe("exclusive window", () => {
  it("7 min for last-minute bookings, an hour for ones made ahead", () => {
    expect(exclusiveUntil(paid, "standard", later(20))).toEqual(later(7));
    expect(exclusiveUntil(paid, "6h", later(4 * 60))).toEqual(later(60));
    expect(exclusiveUntil(paid, "12h", later(12 * 60))).toEqual(later(60));
  });

  it("never runs past the release", () => {
    expect(exclusiveUntil(paid, "12h", later(30))).toEqual(later(30));
  });

  it("is only exclusive while the window is open", () => {
    expect(isExclusive(booking(), inWindow)).toBe(true);
    expect(isExclusive(booking(), afterWindow)).toBe(false);
    expect(isExclusive(booking({ exclusive_until: null }), inWindow)).toBe(false);
    expect(isExclusive(booking({ preferred_barber: null }), inWindow)).toBe(false);
  });
});

describe("who may accept", () => {
  it("the preferred barber can accept in the window", () => {
    expect(mayAccept(booking(), "Joe", inWindow)).toBe(true);
  });

  it("another barber's tap is ignored in the window", () => {
    expect(mayAccept(booking(), "Oscar", inWindow)).toBe(false);
  });

  it("with fallback, anyone can once the window is over", () => {
    expect(mayAccept(booking(), "Oscar", afterWindow)).toBe(true);
    // "Joe can't" clears the window straight away.
    expect(mayAccept(booking({ exclusive_until: null }), "Oscar", inWindow)).toBe(true);
  });

  it("without fallback, nobody else ever can", () => {
    const only = booking({ allow_fallback: false });
    expect(mayAccept(only, "Oscar", inWindow)).toBe(false);
    expect(mayAccept(only, "Oscar", afterWindow)).toBe(false);
    expect(mayAccept(only, "Joe", afterWindow)).toBe(true);
  });

  it("no preference: anyone, as before", () => {
    const any = booking({ preferred_barber: null, exclusive_until: null });
    expect(mayAccept(any, "Oscar", inWindow)).toBe(true);
    expect(onlyPreferredButton(any)).toBe(false);
  });
});

describe("when the preferred barber can't, or the window runs out", () => {
  it("with fallback: opens to everyone", () => {
    expect(whenPreferredCant(booking())).toBe("open");
    expect(onlyPreferredButton(booking())).toBe(true);
    expect(onlyPreferredButton(booking({ exclusive_until: null }))).toBe(false);
  });

  it("without fallback: releases the hold, and only their button ever shows", () => {
    const only = booking({ allow_fallback: false });
    expect(whenPreferredCant(only)).toBe("release");
    expect(onlyPreferredButton(only)).toBe(true);
  });
});
