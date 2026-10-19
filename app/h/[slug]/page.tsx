import type { Metadata } from "next";
import { notFound } from "next/navigation";
import BookingFlow from "@/app/components/BookingFlow";
import { barbers, HOME_RULES, mapsUrl, PRICING, RULES, SERVICES, SHOP, SLOTS } from "@/lib/config";
import { getHotel, hotelTravel } from "@/lib/hotels";

export const dynamic = "force-dynamic";
// Partner links are shared privately with each hotel, so keep them out of search results.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** A hotel's partner link: the concierge books a cut in a guest's room (SPEC-v2 §7.2). */
export default async function HotelBooking({ params }: { params: { slug: string } }) {
  const hotel = await getHotel(params.slug);
  if (!hotel) notFound();
  return (
    <main className="wrap">
      <BookingFlow
        services={SERVICES.map((s) => ({ ...s }))}
        fees={PRICING.advanceFees.map(({ minHoursAhead, fee }) => ({ minHoursAhead, fee }))}
        advanceDays={SLOTS.advanceDays}
        shop={SHOP.name}
        address={SHOP.address}
        maps={mapsUrl()}
        rules={RULES}
        homeRules={HOME_RULES}
        homeEnabled={false}
        barbers={barbers()}
        hotel={{ slug: hotel.slug, name: hotel.name, travel: hotelTravel(hotel), driveMinutes: hotel.drive_minutes! }}
      />
    </main>
  );
}
