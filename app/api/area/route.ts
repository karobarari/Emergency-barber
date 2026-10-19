import { NextResponse } from "next/server";
import { homeArea } from "@/lib/homeArea";

export const dynamic = "force-dynamic";

/** Checks a postcode for a home visit (?postcode=WA15 8SS): in the area, and what travel costs. */
export async function GET(req: Request) {
  const a = await homeArea(new URL(req.url).searchParams.get("postcode") || "");
  if (!a.ok) return NextResponse.json({ error: a.error, outOfArea: a.outOfArea ?? false }, { status: a.status });
  return NextResponse.json({ postcode: a.postcode, driveMinutes: a.driveMinutes, driveMiles: a.driveMiles, distanceStep: a.distanceStep });
}
