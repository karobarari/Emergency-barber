import { describe, expect, it } from "vitest";
import { releaseAt, remindAt } from "./dispatch";

const paid = new Date("2026-10-19T12:00:00Z");
const later = (mins: number) => new Date(paid.getTime() + mins * 60e3);

describe("dispatch timing", () => {
  it("under 6h ahead: re-ping after 10 min, release after 20 min", () => {
    expect(remindAt(paid, "standard")).toEqual(later(10));
    expect(releaseAt(paid, later(90), "standard")).toEqual(later(20));
  });

  it("6h+ ahead: re-ping after 2 hours", () => {
    expect(remindAt(paid, "6h")).toEqual(later(120));
    expect(remindAt(paid, "12h")).toEqual(later(120));
  });

  it("days ahead: release 12 hours after payment", () => {
    expect(releaseAt(paid, later(3 * 24 * 60), "12h")).toEqual(later(12 * 60));
  });

  it("slot sooner than 14h away: release 2 hours before the slot", () => {
    expect(releaseAt(paid, later(13 * 60), "12h")).toEqual(later(11 * 60));
    expect(releaseAt(paid, later(6 * 60), "6h")).toEqual(later(4 * 60));
  });

  it("never releases sooner than a last-minute booking would", () => {
    expect(releaseAt(paid, later(2 * 60 + 5), "6h")).toEqual(later(20));
  });
});
