import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Self-hosted (npm packages `geist` and `@fontsource-variable/doto`): builds never depend on a font CDN.
const geist = localFont({ src: "../../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2", variable: "--font-geist", weight: "100 900", display: "swap" });
const geistMono = localFont({ src: "../../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2", variable: "--font-geist-mono", weight: "100 900", display: "swap" });
const doto = localFont({ src: "../../node_modules/@fontsource-variable/doto/files/doto-latin-wght-normal.woff2", variable: "--font-doto", weight: "100 900", display: "swap" });

export const metadata: Metadata = {
  title: "bell — an opening auction for onchain stocks",
  description:
    "Tokenized stocks on Base trade all weekend, but the prices they track jump at scheduled reopens. bell measures that jump and auctions it back to liquidity providers.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geist.variable} ${geistMono.variable} ${doto.variable}`}>{children}</body>
    </html>
  );
}
