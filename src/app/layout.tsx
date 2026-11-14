import type { Metadata } from "next";
import { EB_Garamond, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
const garamond = EB_Garamond({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-eb-garamond" });

export const metadata: Metadata = {
  title: "Kilpailutus | Find a contractor you can trust",
  description: "An agent that finds local contractors in Finland, verifies every claim with sources, and drafts your quote requests.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${garamond.variable}`}>
      <body>{children}</body>
    </html>
  );
}
