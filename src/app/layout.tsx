import type { Metadata, Viewport } from "next";
import { Instrument_Sans, IBM_Plex_Mono } from "next/font/google";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";
import "./globals.css";

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // Child pages set just their own name ("Ledger", "Sign in"); the template
  // turns it into "Ledger · Spendlens". Pages without one get the default.
  title: {
    default: "Spendlens: agent spend oversight",
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: "Spendlens: agent spend oversight",
    description: SITE_DESCRIPTION,
    url: "/",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Spendlens: agent spend oversight",
    description: SITE_DESCRIPTION,
  },
};

// The public site and the auth pages are always the light paper theme and the
// dashboard is always the dark one (it sets its own `viewport`), so the browser
// chrome follows the page, not the OS colour scheme. A media-query pair here
// painted a dark address bar over a light page for everyone on a dark OS.
export const viewport: Viewport = {
  themeColor: "#f6f5f1",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${instrumentSans.variable} ${plexMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
