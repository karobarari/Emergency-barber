import "server-only";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export type Status = "pending" | "new" | "confirmed" | "done" | "refunded" | "expired" | "cancelled";

export type Booking = {
  id: string;
  created_at: string;
  name: string;
  phone: string;
  service_id: string;
  service_name: string;
  slot_at: string;
  service_price: number;
  late_fee: number;
  total: number;
  status: Status;
  barber: string | null;
  stripe_session_id: string | null;
  payment_intent: string | null;
  telegram_message_id: number | null;
  refund_amount: number | null; // pence, set when the customer cancels
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
