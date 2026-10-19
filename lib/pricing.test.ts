import { describe, expect, it } from "vitest";
import { quote, type LocationType } from "./pricing";

const now = new Date("2026-10-19T12:00:00Z");
const hoursAhead = (h: number) => new Date(now.getTime() + h * 3600e3);
const pounds = (p: number) => p / 100;

// The skin fade grid from docs/SPEC-v2.md §2.2. Columns: shop, then home by drive time from Hale.
const columns: { name: string; locationType: LocationType; driveMinutes?: number }[] = [
  { name: "shop", locationType: "shop" },
  { name: "home, up to 5 min", locationType: "home", driveMinutes: 5 },
  { name: "home, 5–15 min", locationType: "home", driveMinutes: 15 },
  { name: "home, 15–25 min", locationType: "home", driveMinutes: 25 },
  { name: "home, 25 min+", locationType: "home", driveMinutes: 26 },
];
const rows = [
  { name: "12+ h", hours: 12, totals: [51, 51, 56, 61, 66] },
  { name: "6–12 h", hours: 6, totals: [61, 61, 66, 71, 76] },
  { name: "under 6 h", hours: 5.99, totals: [76, 76, 81, 86, 91] },
];

describe("quote: skin fade price grid", () => {
  for (const row of rows) {
    columns.forEach((col, i) => {
      it(`${row.name}, ${col.name} = £${row.totals[i]}`, () => {
        const q = quote({
          serviceId: "cut",
          locationType: col.locationType,
          slotAt: hoursAhead(row.hours),
          now,
          driveMinutes: col.driveMinutes,
          driveMiles: col.driveMinutes === undefined ? undefined : 5,
        });
        expect(pounds(q.total)).toBe(row.totals[i]);
        expect(q.total).toBe(q.servicePrice + q.advanceFee + q.distanceStep);
      });
    });
  }
});

describe("quote: booking fee tier boundaries", () => {
  const at = (ms: number) => quote({ serviceId: "cut", locationType: "shop", slotAt: new Date(now.getTime() + ms), now });
  const h = 3600e3;

  it("exactly 12h ahead is the 12h tier", () => {
    expect(at(12 * h)).toMatchObject({ tier: "12h", advanceFee: 25_00 });
  });
  it("a millisecond under 12h is the 6h tier", () => {
    expect(at(12 * h - 1)).toMatchObject({ tier: "6h", advanceFee: 35_00 });
  });
  it("exactly 6h ahead is the 6h tier", () => {
    expect(at(6 * h)).toMatchObject({ tier: "6h", advanceFee: 35_00 });
  });
  it("a millisecond under 6h is the standard tier", () => {
    expect(at(6 * h - 1)).toMatchObject({ tier: "standard", advanceFee: 50_00 });
  });
  it("6 days ahead is the 12h tier", () => {
    expect(at(6 * 24 * h)).toMatchObject({ tier: "12h", advanceFee: 25_00 });
  });
  it("labels the tier for the review step", () => {
    expect(at(12 * h).tierLabel).toBe("booked 12h+ ahead");
  });
});

describe("quote: services, travel and service area", () => {
  it("prices every service with the advance fee", () => {
    const slotAt = hoursAhead(1);
    expect(quote({ serviceId: "cutbeard", locationType: "shop", slotAt, now }).total).toBe(89_00);
    expect(quote({ serviceId: "premium", locationType: "shop", slotAt, now }).total).toBe(115_00);
  });

  it("never adds travel to a shop booking", () => {
    const q = quote({ serviceId: "cut", locationType: "shop", slotAt: hoursAhead(1), now, driveMinutes: 40, driveMiles: 30 });
    expect(q).toMatchObject({ distanceStep: 0, outOfArea: false });
  });

  it("charges the next step just over a boundary", () => {
    const q = quote({ serviceId: "cut", locationType: "home", slotAt: hoursAhead(1), now, driveMinutes: 5.5, driveMiles: 3 });
    expect(q.distanceStep).toBe(5_00);
  });

  it("allows 13 miles and refuses anything further", () => {
    const base = { serviceId: "cut", locationType: "home" as const, slotAt: hoursAhead(1), now, driveMinutes: 24 };
    expect(quote({ ...base, driveMiles: 13 }).outOfArea).toBe(false);
    expect(quote({ ...base, driveMiles: 13.1 }).outOfArea).toBe(true);
  });

  it("uses a hotel's fixed travel step instead of drive time", () => {
    const q = quote({
      serviceId: "cut", locationType: "hotel", slotAt: hoursAhead(12), now,
      driveMinutes: 20, driveMiles: 8, hotel: { distanceStepOverride: 0 },
    });
    expect(q).toMatchObject({ distanceStep: 0, total: 51_00 });
  });

  it("uses drive time for a hotel without an override", () => {
    const q = quote({
      serviceId: "cut", locationType: "hotel", slotAt: hoursAhead(12), now,
      driveMinutes: 20, driveMiles: 8, hotel: { distanceStepOverride: null },
    });
    expect(q.distanceStep).toBe(10_00);
  });

  it("refuses to price a home visit without a drive time", () => {
    expect(() => quote({ serviceId: "cut", locationType: "home", slotAt: hoursAhead(1), now })).toThrow();
  });

  it("refuses an unknown service", () => {
    expect(() => quote({ serviceId: "nope", locationType: "shop", slotAt: hoursAhead(1), now })).toThrow();
  });
});
