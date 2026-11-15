import type { Metadata, Viewport } from "next";
import { Instrument_Sans } from "next/font/google";
import "./globals.css";

// One humanist grotesk for everything, set at regular weight (400) with 500 for emphasis.
const sans = Instrument_Sans({ subsets: ["latin", "latin-ext"], weight: ["400", "500"], variable: "--font-ui" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")),
  title: { default: "Muutto | Got the job. Now, where to live?", template: "%s" },
  description: "Tell Muutto where you will work. It finds the best place for you to rent or buy in the Helsinki region: areas ranked by your real commute and daily life, live listings, landlord research and applications you approve. Every fact cited.",
  applicationName: "Muutto",
  openGraph: { type: "website", siteName: "Muutto", title: "Muutto | Got the job. Now, where to live?", description: "Areas ranked by your commute, live listings, every fact cited. Helsinki region." },
  twitter: { card: "summary_large_image", title: "Muutto | Got the job. Now, where to live?", description: "Areas ranked by your commute, live listings, every fact cited. Helsinki region." },
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
