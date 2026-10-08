import { NextResponse } from "next/server";
import { freeSlots } from "@/lib/taken";

export const dynamic = "force-dynamic";

export async function GET() {
  const slots = await freeSlots();
  return NextResponse.json({ slots: slots.map((s) => s.toISOString()) });
}
