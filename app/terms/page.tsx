import type { Metadata } from "next";
import { DISPATCH, gbp, HOME_RULES, OPERATOR, PRICING, RULES, SHOP, SLOTS } from "@/lib/config";

export const metadata: Metadata = { title: `Terms · ${OPERATOR.trading}` };

export default function Terms() {
  return (
    <main className="wrap legal">
      <h2>Terms of booking</h2>
      <p className="lead">Last updated 19 October 2026</p>

      <div className="h3">Who we are</div>
      <p>
        {OPERATOR.trading} is run by {OPERATOR.name}, a sole trader, from {SHOP.name}, {SHOP.address}. Contact us
        at <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a> or by replying to any of our texts.
      </p>

      <div className="h3">The service</div>
      <p>
        We open {SHOP.name} out of hours for a haircut. You can book from {SLOTS.noticeMins / 60} hour to{" "}
        {SLOTS.advanceDays} days ahead, and the latest slot is midnight. Every booking includes a booking fee, because a
        barber opens the shop specially for you. It depends on how far ahead you book, measured from when you pay:{" "}
        {PRICING.advanceFees.map((f) => `${gbp(f.fee)} ${f.minHoursAhead ? `${f.minHoursAhead} hours or more ahead` : "with less notice"}`).join(", ")}.
        The price you see when you pay is the price you pay.
      </p>

      <div className="h3">Home visits</div>
      <p>
        Once you&apos;ve had a cut at {SHOP.name}, a barber can come to your home or office instead, within{" "}
        {PRICING.maxDriveMiles} miles of the shop. We check your mobile number with a text code first. Home visits add a
        travel charge based on the drive from the shop:{" "}
        {PRICING.distanceSteps.map((s, i) => {
          const from = i ? PRICING.distanceSteps[i - 1].maxDriveMinutes : 0;
          const range = s.maxDriveMinutes === Infinity ? `over ${from} min` : i ? `${from}–${s.maxDriveMinutes} min` : `up to ${s.maxDriveMinutes} min`;
          return `${range} ${s.step ? gbp(s.step) : "free"}`;
        }).join(", ")}
        . Please make sure the barber can get in and has somewhere to work. We text you when they set off and when they arrive.
      </p>

      <div className="h3">Paying</div>
      <p>
        When you send a request we place a hold for the full price on your card. We only take the money when a barber
        accepts your booking, and we text you who is opening up. Payments are handled by Stripe; we never see or store
        your card details.
      </p>

      <div className="h3">If no barber is free</div>
      <p>
        If no barber can take your booking, we cancel it and release the hold, so you aren&apos;t charged. For bookings made
        less than 6 hours ahead we tell you within {DISPATCH.soon.releaseMins} minutes. For bookings made further ahead we
        tell you within {DISPATCH.ahead.releaseMins / 60} hours, and always at least {DISPATCH.ahead.releaseBeforeSlotMins / 60}{" "}
        hours before your slot. Your booking page shows the exact time.
      </p>

      <div className="h3">Cancelling and lateness</div>
      <p>At the shop:</p>
      <ul className="rules">{RULES.map((r) => <li key={r}>{r}</li>)}</ul>
      <p>Home visits:</p>
      <ul className="rules">{HOME_RULES.map((r) => <li key={r}>{r}</li>)}</ul>
      <p>
        Cancel from the link in your booking text or on your booking page. See the <a href="/refunds">refund policy</a> for
        how refunds are paid.
      </p>

      <div className="h3">If we cancel</div>
      <p>If we have to cancel after a barber has confirmed, you get everything back, including the booking fee.</p>

      <div className="h3">Your rights</div>
      <p>
        Nothing in these terms affects your statutory rights. These terms are governed by the law of England and Wales.
        How we handle your details is set out in our <a href="/privacy">privacy notice</a>.
      </p>
    </main>
  );
}
