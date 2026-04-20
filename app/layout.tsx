import type { Metadata } from "next";
import { Courier_Prime } from "next/font/google";
import "./globals.css";

const courierPrime = Courier_Prime({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  variable: "--font-courier",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Treatment Studio",
  description: "AI-powered music video treatment generator",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={courierPrime.variable}>
      <body className="bg-black text-zinc-100 antialiased">{children}</body>
    </html>
  );
}
