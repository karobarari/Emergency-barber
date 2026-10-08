import type { Metadata, Viewport } from "next";
import { SHOP } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  title: `Late Night Cuts · ${SHOP.name}`,
  description: `Book an out-of-hours haircut at ${SHOP.name} with an hour's notice.`,
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=DM+Sans:wght@400;500;700&family=JetBrains+Mono:wght@500&display=swap"
        />
      </head>
      <body>
        <header>
          <div className="head">
            <div className="brand">
              <div className="pole" aria-hidden="true" />
              <div>
                <h1>Emergency Barber</h1>
                <small>{SHOP.name} · in the chair within the hour</small>
              </div>
            </div>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
