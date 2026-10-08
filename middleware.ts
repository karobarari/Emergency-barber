import { NextRequest, NextResponse } from "next/server";

// Password-protects the dispatch page. Any username, password = ADMIN_PASSWORD.
export function middleware(req: NextRequest) {
  const pass = process.env.ADMIN_PASSWORD;
  const auth = req.headers.get("authorization") || "";
  const [scheme, encoded] = auth.split(" ");
  if (pass && scheme === "Basic" && encoded) {
    const given = atob(encoded).split(":").slice(1).join(":");
    if (given === pass) return NextResponse.next();
  }
  return new NextResponse("Login required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Dispatch"' },
  });
}

export const config = { matcher: ["/admin/:path*"] };
