import "server-only";
import { ACTIVE_STATUSES, blockFor, hasRoom, type Block } from "./capacity";
import type { LocationType } from "./pricing";
import { availableSlots } from "./slots";
import { db } from "./supabase";

type Want = { serviceId: string; locationType?: LocationType; driveMinutes?: number };

/**
 * Slots with room for this booking right now, given the ones already paid for or being paid for. Read-only:
 * reserve_booking() makes the final check at checkout.
 */
export async function freeSlots(now: Date, { serviceId, locationType = "shop", driveMinutes }: Want) {
  const window = availableSlots(now);
  if (!window.length) return [];
  const blockAt = (slotAt: Date) => blockFor({ locationType, slotAt, serviceId, driveMinutes });
  const { data, error } = await db()
    .from("bookings")
    .select("location_type, block_start, block_end")
    .in("status", ACTIVE_STATUSES)
    .lt("block_start", blockAt(window[window.length - 1]).end.toISOString())
    .gt("block_end", blockAt(window[0]).start.toISOString());
  if (error) throw new Error(`Free slots query failed: ${error.message}`);
  const active: Block[] = (data || []).map((r) => ({
    locationType: r.location_type,
    start: new Date(r.block_start),
    end: new Date(r.block_end),
  }));
  return window.filter((slot) => hasRoom(blockAt(slot), active));
}
