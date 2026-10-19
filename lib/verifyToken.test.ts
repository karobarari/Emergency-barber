import { describe, expect, it } from "vitest";
import { makeToken, readToken } from "./verifyToken";

const secret = "test-secret";
const now = Date.UTC(2026, 9, 19, 19, 0);

describe("verified phone token", () => {
  it("reads back the phone it was made for", () => {
    expect(readToken(makeToken("+447700900123", secret, now), secret, now + 60e3)).toBe("+447700900123");
  });

  it("expires after 30 minutes", () => {
    expect(readToken(makeToken("+447700900123", secret, now), secret, now + 31 * 60e3)).toBeNull();
  });

  it("refuses a token with the phone swapped", () => {
    const [, exp, mac] = makeToken("+447700900123", secret, now).split(".");
    expect(readToken(`+447700900999.${exp}.${mac}`, secret, now)).toBeNull();
  });

  it("refuses a token signed with another secret, or a missing one", () => {
    expect(readToken(makeToken("+447700900123", "other", now), secret, now)).toBeNull();
    expect(readToken(undefined, secret, now)).toBeNull();
    expect(readToken(makeToken("+447700900123", secret, now), "", now)).toBeNull();
  });
});
