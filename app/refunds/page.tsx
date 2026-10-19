import type { Metadata } from "next";
import { CANCEL_CUTOFF_MINS, LATE_GRACE_MINS, OPERATOR } from "@/lib/config";

export const metadata: Metadata = { title: `Refund policy · ${OPERATOR.trading}` };

export default function Refunds() {
  return (
    <main className="wrap legal">
      <h2>Refund policy</h2>
      <p className="lead">Last updated 19 October 2026</p>
      <p>We only hold the money on your card when you book. It&apos;s charged when a barber accepts your booking.</p>

      <div className="sum">
        <div className="row"><span>No barber free</span><span>Not charged, hold released</span></div>
        <div className="row"><span>You cancel before a barber confirms</span><span>Not charged, hold released</span></div>
        <div className="row"><span>You cancel after confirmation, {CANCEL_CUTOFF_MINS}+ min before</span><span>Service price back, booking fee kept</span></div>
        <div className="row"><span>You cancel within {CANCEL_CUTOFF_MINS} min</span><span>No refund</span></div>
        <div className="row"><span>You arrive over {LATE_GRACE_MINS} min late and the barber has left</span><span>No refund</span></div>
        <div className="row"><span>We cancel after confirming</span><span>Full refund</span></div>
      </div>

      <div className="h3">Why the booking fee is kept</div>
      <p>
        Once a barber confirms, they keep the evening free and travel to open the shop for you. The booking fee covers that,
        so it isn&apos;t refunded if you cancel after confirmation.
      </p>

      <div className="h3">How to cancel</div>
      <p>
        Use the link in your booking text or on your booking page. It shows exactly what you&apos;ll get back before you
        confirm.
      </p>

      <div className="h3">When the money arrives</div>
      <p>
        Refunds go back to the card you paid with, straight away from our side. Banks usually take 5–10 working days to
        show them. A released hold was never charged; your bank usually removes it from your statement within a few days.
      </p>

      <div className="h3">Questions</div>
      <p>
        Email <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a> with your booking time and the mobile number you
        booked with.
      </p>
    </main>
  );
}
