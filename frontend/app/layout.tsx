import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = {
  title: "SLATE: Slope Landslide Analytics and Triggering Explorer",
  description: "Interactive research platform for landslide susceptibility and rainfall-triggering analysis.",
  authors: [{ name: "Kishan Tiwari" }],
};

const NAV: [string, string][] = [
  ["/", "Dashboard"], ["/analyze", "Analyze a location"], ["/susceptibility", "Susceptibility"], ["/thresholds", "Rainfall thresholds"],
  ["/nowcast", "ML nowcast"], ["/two-tier", "Two-tier map"], ["/events", "Historical events"], ["/comparison", "Model comparison"],
  ["/leakage", "Leakage audit"], ["/sensitivity", "Sensitivity"], ["/explainer", "PIBE explainer"], ["/methods", "Methods"],
  ["/data", "Data & downloads"], ["/about", "About"],
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-paper text-ink min-h-screen">
        <nav className="bg-white border-b border-line sticky top-0 z-20">
          <div className="max-w-[1500px] mx-auto px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link href="/" className="font-semibold text-accent mr-2" title="Slope Landslide Analytics and Triggering Explorer">SLATE</Link>
            {NAV.slice(1).map(([h, l]) => <Link key={h} href={h} className="text-sm text-muted hover:text-ink">{l}</Link>)}
          </div>
        </nav>
        <main className="max-w-[1500px] mx-auto px-4 py-5">{children}</main>
        <footer className="max-w-[1500px] mx-auto px-4 py-6 text-xs text-muted border-t border-line">
          Research model output. Not an official landslide warning. © 2026 Kishan Tiwari · <Link href="/admin">Admin (development)</Link>
        </footer>
      </body>
    </html>
  );
}
