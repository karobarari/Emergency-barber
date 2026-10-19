import "server-only";
import { quote } from "./pricing";
import { db, type Hotel } from "./supabase";

/** An active partner hotel by its link slug, or null. Hotels without a drive time can't be booked yet. */
export async function getHotel(slug: string): Promise<Hotel | null> {
  if (!/^[a-z0-9-]{1,60}$/.test(slug)) return null;
  const { data, error } = await db().from("hotels").select("*").eq("slug", slug).eq("active", true).maybeSingle();
  if (error) throw new Error(`Hotel lookup failed: ${error.message}`);
  const h = data as Hotel | null;
  return h && h.drive_minutes != null && h.drive_miles != null ? { ...h, drive_miles: Number(h.drive_miles) } : null;
}

/** What pricing and capacity need from a hotel: the drive from the shop and any fixed travel charge. */
export const hotelTrip = (h: Hotel) => ({
  driveMinutes: h.drive_minutes!,
  driveMiles: Number(h.drive_miles),
  hotel: { distanceStepOverride: h.distance_step_override },
});

/** The travel charge for this hotel. The same for every service and time. */
export const hotelTravel = (h: Hotel) =>
  quote({ serviceId: "cut", locationType: "hotel", slotAt: new Date(), now: new Date(), ...hotelTrip(h) }).distanceStep;
