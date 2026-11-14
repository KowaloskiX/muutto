import type { Metadata, Viewport } from "next";
import { Instrument_Sans } from "next/font/google";
import "./globals.css";

// One humanist grotesk for everything, set at regular weight (400) with 500 for emphasis.
const sans = Instrument_Sans({ subsets: ["latin", "latin-ext"], weight: ["400", "500"], variable: "--font-ui" });

export const metadata: Metadata = {
  title: "Kilpailutus | Find a contractor you can trust",
  description: "An agent that finds local contractors in Finland, verifies every claim with sources, and drafts your quote requests.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1016" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={sans.variable}>
      <body>{children}</body>
    </html>
  );
}
