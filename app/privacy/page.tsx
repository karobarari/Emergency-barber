import type { Metadata } from "next";
import { OPERATOR } from "@/lib/config";

export const metadata: Metadata = { title: `Privacy notice · ${OPERATOR.trading}` };

export default function Privacy() {
  const mail = <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>;
  return (
    <main className="wrap legal">
      <h2>Privacy notice</h2>
      <p className="lead">Last updated 19 October 2026</p>

      <div className="h3">Who is responsible for your data</div>
      <p>
        {OPERATOR.name}, a sole trader trading as {OPERATOR.trading}, is the data controller. Contact: {mail}.
      </p>

      <div className="h3">What we collect</div>
      <ul className="rules">
        <li>Your name and UK mobile number.</li>
        <li>Your booking: service, time, price, status, which barber took it, any refund, and when you agreed to the booking rules.</li>
        <li>For home visits: the address and postcode you give us, and the drive time from the shop.</li>
        <li>For hotel bookings: the guest&apos;s name and room number, and the name and mobile of the concierge who booked.</li>
        <li>How many cuts you&apos;ve had at the shop and which barber you saw last, so we know when home visits are open to you.</li>
        <li>Stripe collects your card details and email address for the payment and receipt. We never see your full card number.</li>
      </ul>

      <div className="h3">Why we use it</div>
      <ul className="rules">
        <li>To take your booking, send it to a barber, text you updates and handle refunds. The legal basis is performing our contract with you.</li>
        <li>To keep financial records, as tax law requires. The legal basis is legal obligation.</li>
      </ul>
      <p>We don&apos;t send marketing and we don&apos;t sell your data.</p>

      <div className="h3">Who we share it with</div>
      <ul className="rules">
        <li>Our barbers, through a private Telegram group, so one of them can take your booking.</li>
        <li>Stripe, to take payments, send receipts and pay refunds.</li>
        <li>Twilio, to send you texts and the code that checks your number for home visits.</li>
        <li>postcodes.io and OpenRouteService, which get your postcode only (never your name or number) to work out the drive from the shop.</li>
        <li>Supabase, which hosts our booking database, and Vercel, which hosts this website.</li>
      </ul>
      <p>
        Some of these companies process data outside the UK, including in the US. Where they do, they use safeguards
        approved under UK data protection law.
      </p>

      <div className="h3">How long we keep it</div>
      <p>
        We keep booking and payment records for {OPERATOR.retentionYears} years after your booking, because tax law requires
        financial records to be kept that long. Then we delete them.
      </p>

      <div className="h3">Your rights</div>
      <p>
        You can ask for a copy of your data, ask us to correct it, or ask us to delete it. We delete anything we
        aren&apos;t legally required to keep. You can also object to how we use it. Email {mail} and we&apos;ll reply
        within one month.
      </p>
      <p>
        If you&apos;re unhappy with how we handle your data, you can complain to the Information Commissioner&apos;s Office
        at <a href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noopener">ico.org.uk</a>.
      </p>

      <div className="h3">Cookies</div>
      <p>
        This website doesn&apos;t use tracking or advertising cookies. When you check your number for a home visit, we set
        one cookie that remembers it for 30 minutes, so you don&apos;t need a new code at every step. Stripe&apos;s payment
        page sets its own cookies to prevent fraud.
      </p>
    </main>
  );
}
