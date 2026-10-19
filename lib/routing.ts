import "server-only";
import { SHOP } from "./config";
import { db } from "./supabase";

export type LatLng = { lat: number; lng: number };
export type Drive = { minutes: number; miles: number };
export type Place = LatLng & { postcode: string };

const CACHE_DAYS = 30;

/** "wa158ss" → "WA15 8SS". The last three characters are always the inward code. */
export const formatPostcode = (input: string) => {
  const clean = input.replace(/\s+/g, "").toUpperCase();
  return `${clean.slice(0, -3)} ${clean.slice(-3)}`;
};

/** Checks a UK postcode with postcodes.io (free, no key) and returns it tidied up, with coordinates. Null if it doesn't exist. */
export async function lookupPostcode(input: string): Promise<Place | null> {
  const clean = input.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(clean)) return null;
  const res = await fetch(`https://api.postcodes.io/postcodes/${clean}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`postcodes.io ${res.status}`);
  const { result } = await res.json();
  return { postcode: result.postcode, lat: result.latitude, lng: result.longitude };
}

/** Driving time and distance between two points, from OpenRouteService (ROUTING_API_KEY). */
export async function driveBetween(from: LatLng, to: LatLng): Promise<Drive> {
  const res = await fetch("https://api.openrouteservice.org/v2/directions/driving-car", {
    method: "POST",
    headers: { Authorization: process.env.ROUTING_API_KEY || "", "Content-Type": "application/json" },
    body: JSON.stringify({ coordinates: [[from.lng, from.lat], [to.lng, to.lat]] }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`OpenRouteService ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const summary = (await res.json()).routes?.[0]?.summary;
  if (!summary) throw new Error("OpenRouteService returned no route");
  // Rounded up, so a 5.5-minute drive prices as over 5 minutes.
  return { minutes: Math.ceil((summary.duration ?? 0) / 60), miles: Math.round(((summary.distance ?? 0) / 1609.344) * 10) / 10 };
}

/**
 * The drive from the shop to a postcode, which sets the travel price and the service area. Always from the shop,
 * so the price doesn't depend on which barber accepts. Cached per postcode for 30 days.
 */
export async function driveFromShop(postcodeInput: string): Promise<(Place & Drive) | null> {
  const clean = postcodeInput.replace(/\s+/g, "").toUpperCase();
  const fresh = new Date(Date.now() - CACHE_DAYS * 864e5).toISOString();
  const { data: cached } = await db()
    .from("drive_cache")
    .select("*")
    .eq("postcode", clean)
    .gt("fetched_at", fresh)
    .maybeSingle();
  if (cached) return { ...cached, postcode: formatPostcode(clean), miles: Number(cached.miles) };

  const place = await lookupPostcode(clean);
  if (!place) return null;
  const drive = await driveBetween(SHOP, place);
  await db()
    .from("drive_cache")
    .upsert({ postcode: clean, lat: place.lat, lng: place.lng, ...drive, fetched_at: new Date().toISOString() });
  return { ...place, postcode: formatPostcode(clean), ...drive };
}
