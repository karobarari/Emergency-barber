import "server-only";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { PriceTier } from "./config";
import type { LocationType } from "./pricing";

export type Status =
  | "pending" | "new" | "confirmed" | "on_the_way" | "arrived" | "done" | "no_show" | "refunded" | "expired" | "cancelled";

/** Remembered by phone once a shop cut is done (supabase/2026-10-19-customers.sql). */
export type Customer = {
  phone: string;
  name: string | null;
  completed_shop_visits: number;
  last_barber: string | null;
  home_allowed: boolean;
  blocked: boolean; // overrides home_allowed
  notes: string | null; // private, admin only
  created_at: string;
  updated_at: string;
};

export type Booking = {
  id: string;
  created_at: string;
  name: string;
  phone: string;
  service_id: string;
  service_name: string;
  slot_at: string;
  location_type: LocationType;
  block_start: string; // when the barber is first busy
  block_end: string; // when they're free again
  service_price: number;
  advance_fee: number; // booking fee, by how far ahead it was booked
  price_tier: PriceTier;
  total: number;
  status: Status;
  barber: string | null;
  stripe_session_id: string | null;
  payment_intent: string | null;
  telegram_message_id: number | null;
  refund_amount: number | null; // pence, set when the customer cancels
  terms_accepted_at: string | null; // when they ticked the rules box at payment
  paid_at: string | null; // when the card hold was placed; starts the no-barber clock
  release_at: string | null; // when the hold is released if no barber has taken it
  reminded_at: string | null;
  slot_reminded_at: string | null;
  done_nudged_at: string | null; // when the barber was asked to tap Done
};

let client: SupabaseClient | null = null;

export function db() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    client = createClient(url, key, {
      auth: { persistSession: false },
      // Next 14 caches server fetches by default, which froze the status page, admin board and free slots.
      global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
    });
  }
  return client;
}
