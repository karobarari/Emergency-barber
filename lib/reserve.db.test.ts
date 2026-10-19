/**
 * Tests reserve_booking() against a real Postgres, since a race between two checkouts can't be faked.
 * Skipped unless TEST_DATABASE_URL is set, e.g. postgres://postgres:<password>@localhost:5432/postgres
 * Never point it at the live Supabase database: it builds a throwaway schema, but it does run DDL.
 */
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { blockFor } from "./capacity";
import type { LocationType } from "./pricing";

const url = process.env.TEST_DATABASE_URL;
const schema = `eb_test_${Date.now()}`;
const sql = (file: string) => readFileSync(new URL(`../supabase/${file}`, import.meta.url), "utf8");

describe.skipIf(!url)("reserve_booking (Postgres)", () => {
  let pool: Pool;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: url });
    await admin.query(`create schema ${schema}`);
    await admin.end();
    // Every connection works inside the throwaway schema, including the function's own queries.
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public`, max: 12 });
    await pool.query(sql("schema.sql"));
    await pool.query(sql("2026-10-19-capacity.sql"));
    await pool.query(sql("2026-10-19-customers.sql"));
    await pool.query(sql("2026-10-19-preferred-barber.sql"));
    await pool.query(sql("2026-10-19-home-visits.sql"));
  });

  afterAll(async () => {
    await pool?.query(`drop schema ${schema} cascade`);
    await pool?.end();
  });

  let n = 0;
  // Each test uses its own evening so they don't see each other's bookings.
  const reserve = (day: string, hhmm: string, opts: { serviceId?: string; locationType?: LocationType; driveMinutes?: number } = {}) => {
    const { serviceId = "cut", locationType = "shop", driveMinutes = 15 } = opts;
    const slotAt = new Date(`2026-11-${day}T${hhmm}:00Z`);
    const block = blockFor({ locationType, slotAt, serviceId, driveMinutes });
    const row = {
      name: `Test ${++n}`, phone: "+447700900123",
      service_id: serviceId, service_name: serviceId, slot_at: slotAt.toISOString(),
      location_type: locationType, block_start: block.start.toISOString(), block_end: block.end.toISOString(),
      service_price: 2600, advance_fee: 2500, price_tier: "12h", total: 5100, status: "pending",
      allow_fallback: true, // not null, and reserve_booking() leaves anything missing as null
    };
    return pool.query("select * from reserve_booking($1, 3, 1)", [JSON.stringify(row)]).then((r) => r.rows[0]);
  };
  const outcomes = (results: PromiseSettledResult<unknown>[]) => ({
    ok: results.filter((r) => r.status === "fulfilled").length,
    full: results.filter((r) => r.status === "rejected" && (r.reason as { code?: string }).code === "EBFUL").length,
  });

  it("inserts a booking with an id and the blocks it was given", async () => {
    const b = await reserve("01", "19:00", { serviceId: "premium" });
    expect(b.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(b.block_end).toISOString()).toBe("2026-11-01T20:15:00.000Z");
    expect(b.location_type).toBe("shop");
  });

  it("refuses a shop booking inside a premium cut, and takes the next free one", async () => {
    await reserve("02", "19:00", { serviceId: "premium" });
    await expect(reserve("02", "20:00")).rejects.toMatchObject({ code: "EBFUL" });
    await expect(reserve("02", "20:15")).resolves.toBeTruthy();
  });

  it("keeps a barber for the shop: two visits, then only shop bookings", async () => {
    await reserve("03", "20:00", { locationType: "home" });
    await reserve("03", "20:00", { locationType: "hotel" });
    await expect(reserve("03", "20:00", { locationType: "home" })).rejects.toMatchObject({ code: "EBFUL" });
    await expect(reserve("03", "20:00")).resolves.toBeTruthy();
  });

  it("frees the place when a booking expires or is done", async () => {
    const b = await reserve("04", "19:00");
    await pool.query("update bookings set status = 'expired' where id = $1", [b.id]);
    const c = await reserve("04", "19:00");
    await pool.query("update bookings set status = 'done' where id = $1", [c.id]);
    await expect(reserve("04", "19:00")).resolves.toBeTruthy();
  });

  it("gives the last chair to exactly one of ten customers checking out at once", async () => {
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => reserve("05", "21:00")));
    expect(outcomes(results)).toEqual({ ok: 1, full: 9 });
  });

  it("gives the last two visit places to exactly two of ten customers checking out at once", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => reserve("06", "21:00", { locationType: "home" })),
    );
    expect(outcomes(results)).toEqual({ ok: 2, full: 8 });
  });

  it("counts shop visits per customer and unlocks home visits", async () => {
    const visit = (barber: string) =>
      pool.query("select * from record_shop_visit($1, $2, $3)", ["+447700900999", "Sam", barber]).then((r) => r.rows[0]);
    expect(await visit("Joe")).toMatchObject({ completed_shop_visits: 1, last_barber: "Joe", home_allowed: true, blocked: false });
    await pool.query("update customers set blocked = true, notes = 'rude' where phone = '+447700900999'");
    // A later visit counts, but doesn't undo a block or wipe notes.
    expect(await visit("Oscar")).toMatchObject({ completed_shop_visits: 2, last_barber: "Oscar", blocked: true, notes: "rude" });
  });

  it("allows the no-show status, which frees the place", async () => {
    const b = await reserve("07", "19:00");
    await pool.query("update bookings set status = 'no_show' where id = $1", [b.id]);
    await expect(reserve("07", "19:00")).resolves.toBeTruthy();
  });

  it("refuses a booking without blocks", async () => {
    await expect(
      pool.query("select reserve_booking($1, 3, 1)", [JSON.stringify({ location_type: "shop", status: "pending" })]),
    ).rejects.toMatchObject({ code: "22023" });
  });
});
