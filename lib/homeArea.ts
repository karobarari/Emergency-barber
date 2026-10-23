import "server-only";
import { homeVisitsEnabled } from "./config";
import { quote } from "./pricing";
import { driveFromShop } from "./routing";
import { reportError } from "./telegram";
import { getCustomer, homeAllowed, verifiedPhone } from "./verify";

export type HomeArea =
  | { ok: true; phone: string; postcode: string; lat: number; lng: number; driveMinutes: number; driveMiles: number; distanceStep: number }
  | { ok: false; status: number; error: string; outOfArea?: boolean };

/**
 * Everything a home booking needs before it can be priced, checked on the server: home visits are on, the browser
 * verified the phone, that number isn't blocked, and the postcode is real and within 13 miles.
 */
export async function homeArea(postcodeInput: string): Promise<HomeArea> {
  if (!homeVisitsEnabled()) return { ok: false, status: 404, error: "Home visits aren't open yet." };
  const phone = await verifiedPhone();
  if (!phone) return { ok: false, status: 401, error: "Your number needs checking again. Go back and enter your mobile." };
  if (!homeAllowed(await getCustomer(phone))) {
    return { ok: false, status: 403, error: "We can't book a home visit for this number. You can still book at the shop." };
  }
  let drive;
  try {
    drive = await driveFromShop(postcodeInput);
  } catch (e) {
    await reportError(`Drive time lookup failed for ${postcodeInput}`, e);
    return { ok: false, status: 502, error: "Couldn't work out the drive just now. Try again in a moment." };
  }
  if (!drive) return { ok: false, status: 400, error: "We couldn't find that postcode. Check it and try again." };
  // Any service and time give the same travel step and area answer.
  const q = quote({ serviceId: "cut", locationType: "home", slotAt: new Date(), now: new Date(), driveMinutes: drive.minutes, driveMiles: drive.miles });
  if (q.outOfArea) return { ok: false, status: 400, outOfArea: true, error: "That's outside our area for home visits. You can still book at the shop." };
  return {
    ok: true, phone, postcode: drive.postcode, lat: drive.lat, lng: drive.lng,
    driveMinutes: drive.minutes, driveMiles: drive.miles, distanceStep: q.distanceStep,
  };
}
