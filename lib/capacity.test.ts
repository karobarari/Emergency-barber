import { describe, expect, it } from "vitest";
import { blockFor, hasRoom, type Block } from "./capacity";
import type { LocationType } from "./pricing";

const limits = { barberCount: 3, shopChairs: 1 };
const at = (hhmm: string) => new Date(`2026-10-20T${hhmm}:00Z`);
const shop = (hhmm: string, serviceId = "cut") => blockFor({ locationType: "shop", slotAt: at(hhmm), serviceId });
const visit = (hhmm: string, driveMinutes = 15, locationType: LocationType = "home") =>
  blockFor({ locationType, slotAt: at(hhmm), serviceId: "cut", driveMinutes });

describe("blockFor", () => {
  it("blocks the shop for the length of the service", () => {
    expect(shop("19:00", "premium")).toMatchObject({ start: at("19:00"), end: at("20:15") });
  });
  it("adds the drive there and back for visits", () => {
    expect(visit("20:00", 20)).toMatchObject({ start: at("19:40"), end: at("21:00") });
  });
});

describe("hasRoom: overlapping services", () => {
  const premium = [shop("19:00", "premium")]; // 19:00–20:15

  it("blocks every slot a premium cut overlaps", () => {
    for (const t of ["19:00", "19:15", "19:30", "19:45", "20:00"]) expect(hasRoom(shop(t), premium, limits)).toBe(false);
  });
  it("frees the chair the moment the cut ends", () => {
    expect(hasRoom(shop("20:15"), premium, limits)).toBe(true);
  });
  it("blocks a premium cut that would run into a later booking", () => {
    expect(hasRoom(shop("18:15", "premium"), [shop("19:15")], limits)).toBe(false);
    expect(hasRoom(shop("17:45", "premium"), [shop("19:00")], limits)).toBe(true);
  });
  it("allows two overlapping cuts when there are two chairs", () => {
    expect(hasRoom(shop("19:15"), premium, { ...limits, shopChairs: 2 })).toBe(true);
  });
  it("ignores bookings at other times", () => {
    expect(hasRoom(shop("21:00"), [shop("19:00"), shop("22:00")], limits)).toBe(true);
  });
});

describe("hasRoom: shop priority", () => {
  it("allows two visits at once with three barbers", () => {
    expect(hasRoom(visit("20:00"), [], limits)).toBe(true);
    expect(hasRoom(visit("20:00"), [visit("20:00")], limits)).toBe(true);
  });
  it("refuses a third visit, to keep a barber for the shop", () => {
    expect(hasRoom(visit("20:00"), [visit("20:00"), visit("20:15", 10, "hotel")], limits)).toBe(false);
  });
  it("still takes a shop booking while two barbers are out", () => {
    expect(hasRoom(shop("20:00"), [visit("20:00"), visit("20:00")], limits)).toBe(true);
  });
  it("refuses a visit when one barber is out and one is in the shop", () => {
    expect(hasRoom(visit("20:00"), [visit("20:00"), shop("20:00")], limits)).toBe(false);
  });
  it("refuses a shop booking when every barber is busy", () => {
    const busy: Block[] = [visit("20:00"), visit("20:00"), shop("20:00")];
    expect(hasRoom(shop("20:00"), busy, { ...limits, shopChairs: 2 })).toBe(false);
  });
  it("counts the drive: a visit blocks the barber before the slot", () => {
    // Leaves at 19:45 for a 20:00 visit, so only one barber is left by then.
    expect(hasRoom(visit("19:15", 5), [visit("20:00"), shop("19:30")], limits)).toBe(false);
  });
});
