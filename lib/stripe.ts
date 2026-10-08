import "server-only";
import Stripe from "stripe";

let client: Stripe | null = null;

export function stripe() {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("Set STRIPE_SECRET_KEY");
    client = new Stripe(key);
  }
  return client;
}
