import { NextResponse } from "next/server";
import { SERVICES } from "@/lib/config";
import { homeArea } from "@/lib/homeArea";
import { advanceBand } from "@/lib/pricing";
import { bookingNights, dayKey, fmtDay, londonParts, londonTime, nightOf } from "@/lib/slots";
import { freeSlots } from "@/lib/taken";

export const dynamic = "force-dynamic";

/**
 * Free slots for a service (?service=cut) grouped by evening, each with the booking fee it would cost if paid for now.
 * Home visits (&type=home&postcode=...) also block the drive there and back, and carry the travel charge.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const serviceId = params.get("service");
  if (!SERVICES.some((s) => s.id === serviceId)) return NextResponse.json({ error: "Choose a service." }, { status: 400 });
  const now = new Date();
  let travel = 0;
  let want: Parameters<typeof freeSlots>[1] = { serviceId: serviceId! };
  if (params.get("type") === "home") {
    const area = await homeArea(params.get("postcode") || "");
    if (!area.ok) return NextResponse.json({ error: area.error }, { status: area.status });
    travel = area.distanceStep;
    want = { serviceId: serviceId!, locationType: "home", driveMinutes: area.driveMinutes };
  }
  const slots = await freeSlots(now, want);
  const today = londonParts(now);
  const todayKey = dayKey(today);
  const tomorrowKey = dayKey(londonParts(londonTime(today.y, today.m, today.d + 1, 12, 0)));

  const nights = bookingNights(now)
    .map((day) => {
      const key = dayKey(day);
      const noon = londonTime(day.y, day.m, day.d, 12, 0);
      return {
        key,
        label: key === todayKey ? "Tonight" : key === tomorrowKey ? "Tomorrow" : fmtDay(noon),
        slots: slots
          .filter((s) => dayKey(nightOf(s)) === key)
          .map((s) => {
            const band = advanceBand(s, now);
            return { at: s.toISOString(), fee: band.fee, tierLabel: band.label, travel };
          }),
      };
    })
    // Just after midnight, last night is only worth showing if it still has slots.
    .filter((n) => n.slots.length || n.key >= todayKey);

  return NextResponse.json({ nights });
}
