import { NextResponse } from "next/server";
import { advanceBand } from "@/lib/pricing";
import { bookingNights, dayKey, fmtDay, londonParts, londonTime, nightOf } from "@/lib/slots";
import { freeSlots } from "@/lib/taken";

export const dynamic = "force-dynamic";

/** Free slots grouped by evening, each with the booking fee it would cost if paid for now. */
export async function GET() {
  const now = new Date();
  const slots = await freeSlots(now);
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
            return { at: s.toISOString(), fee: band.fee, tierLabel: band.label };
          }),
      };
    })
    // Just after midnight, last night is only worth showing if it still has slots.
    .filter((n) => n.slots.length || n.key >= todayKey);

  return NextResponse.json({ nights });
}
