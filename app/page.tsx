import { barbers, HOME_RULES, homeVisitsEnabled, mapsUrl, PRICING, RULES, SERVICES, SHOP, SLOTS } from "@/lib/config";
import BookingFlow from "./components/BookingFlow";

export default async function Home(props: { searchParams: Promise<{ cancelled?: string }> }) {
  const searchParams = await props.searchParams;
  return (
    <main className="wrap">
      {searchParams.cancelled && (
        <div className="banner">Request cancelled. Nothing was held on your card and the slot has been released.</div>
      )}
      <BookingFlow
        services={SERVICES.map((s) => ({ ...s }))}
        fees={PRICING.advanceFees.map(({ minHoursAhead, fee }) => ({ minHoursAhead, fee }))}
        advanceDays={SLOTS.advanceDays}
        shop={SHOP.name}
        address={SHOP.address}
        maps={mapsUrl()}
        rules={RULES}
        homeRules={HOME_RULES}
        homeEnabled={homeVisitsEnabled()}
        barbers={barbers()}
      />
    </main>
  );
}
