import { LATE_FEE, mapsUrl, RULES, SERVICES, SHOP } from "@/lib/config";
import BookingFlow from "./components/BookingFlow";

export default function Home({ searchParams }: { searchParams: { cancelled?: string } }) {
  return (
    <main className="wrap">
      {searchParams.cancelled && (
        <div className="banner">Request cancelled. Nothing was held on your card and the slot has been released.</div>
      )}
      <BookingFlow
        services={SERVICES.map((s) => ({ ...s }))}
        lateFee={LATE_FEE}
        shop={SHOP.name}
        address={SHOP.address}
        maps={mapsUrl()}
        rules={RULES}
      />
    </main>
  );
}
