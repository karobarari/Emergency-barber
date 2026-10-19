import { describe, expect, it } from "vitest";
import { cancelQuote, nextActions, noShowFrom, safetyCheckAt } from "./visit";

const slot = "2026-10-19T20:00:00.000Z";
const minsBefore = (m: number) => new Date(slot).getTime() - m * 60e3;
const booking = (o: Partial<Parameters<typeof cancelQuote>[0]> = {}) => ({
  location_type: "shop" as const,
  status: "confirmed",
  slot_at: slot,
  total: 8100,
  service_price: 2600,
  service_id: "cut",
  arrived_at: null,
  left_at: null,
  ...o,
});
const home = (o: Partial<Parameters<typeof cancelQuote>[0]> = {}) => booking({ location_type: "home", ...o });

describe("cancelling at the shop (§10.1)", () => {
  it("everything back before a barber accepts", () => {
    expect(cancelQuote(booking({ status: "new" }), minsBefore(10))).toBe(8100);
  });
  it("service price back 30+ min before, nothing after", () => {
    expect(cancelQuote(booking(), minsBefore(30))).toBe(2600);
    expect(cancelQuote(booking(), minsBefore(29))).toBe(0);
  });
  it("can't cancel once the slot has started", () => {
    expect(cancelQuote(booking(), minsBefore(0))).toBeNull();
  });
});

describe("cancelling a home visit (§10.2)", () => {
  it("everything back before a barber accepts", () => {
    expect(cancelQuote(home({ status: "new" }), minsBefore(10))).toBe(8100);
  });
  it("service price back until the barber sets off, even close to the slot", () => {
    expect(cancelQuote(home(), minsBefore(5))).toBe(2600);
  });
  it("nothing back once they're on the way", () => {
    expect(cancelQuote(home({ status: "on_the_way" }), minsBefore(20))).toBe(0);
  });
  it("can't cancel once they've arrived", () => {
    expect(cancelQuote(home({ status: "arrived" }), minsBefore(1))).toBeNull();
  });
});

describe("no-show timing (§10.3)", () => {
  it("shop: 15 min after the slot", () => {
    expect(noShowFrom(booking())).toEqual(new Date("2026-10-19T20:15:00Z"));
  });
  it("home: 15 min after the barber arrived, not before they have", () => {
    expect(noShowFrom(home({ status: "on_the_way" }))).toBeNull();
    expect(noShowFrom(home({ status: "arrived", arrived_at: "2026-10-19T19:58:00Z" }))).toEqual(new Date("2026-10-19T20:13:00Z"));
  });
});

describe("buttons after Accept (§9)", () => {
  it("shop: Done or No-show", () => {
    expect(nextActions(booking())).toEqual(["done", "noshow"]);
    expect(nextActions(booking({ status: "done" }))).toEqual([]);
  });
  it("home: On my way → Arrived → Done or No-show → Left safely", () => {
    expect(nextActions(home())).toEqual(["on_the_way"]);
    expect(nextActions(home({ status: "on_the_way" }))).toEqual(["arrived"]);
    expect(nextActions(home({ status: "arrived" }))).toEqual(["done", "noshow"]);
    expect(nextActions(home({ status: "done" }))).toEqual(["left"]);
    expect(nextActions(home({ status: "no_show" }))).toEqual(["left"]);
    expect(nextActions(home({ status: "done", left_at: "2026-10-19T21:00:00Z" }))).toEqual([]);
  });
});

describe("safety check-out (§9.1)", () => {
  it("alerts 30 min after the cut should have finished", () => {
    // Skin fade is 40 min: arrived 20:00, so due at 21:10.
    expect(safetyCheckAt(home({ status: "done", arrived_at: "2026-10-19T20:00:00Z" }))).toEqual(new Date("2026-10-19T21:10:00Z"));
  });
  it("not for shop bookings or before arrival", () => {
    expect(safetyCheckAt(booking({ arrived_at: "2026-10-19T20:00:00Z" }))).toBeNull();
    expect(safetyCheckAt(home())).toBeNull();
  });
});
