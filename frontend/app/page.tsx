"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import MapView, { Legend } from "@/components/MapView";
import { Card, Disclaimer } from "@/components/ui";
import { get, suscPng, SUSC_COLORS } from "@/lib/api";

const CARDS: [string, string, string][] = [
  ["/susceptibility", "Susceptibility", "Where are landslides more likely to occur?"],
  ["/thresholds", "Rainfall triggering", "Are rainfall conditions associated with historical landslide triggering?"],
  ["/nowcast", "ML nowcast", "Which areas receive elevated model-based priority?"],
  ["/events", "Historical events", "Explore major rainfall-triggered landslide events."],
];

export default function Home() {
  const [L, setL] = useState<any>(null);
  const [n, setN] = useState<any>(null);
  useEffect(() => {
    get("/api/susceptibility/layers").then(setL).catch(() => null);
    get("/api/comparison").then((c) => setN(c.numbers)).catch(() => null);
  }, []);
  const bounds: [number, number, number, number] | null = L ? [L.west, L.north - L.nrows * L.res, L.west + L.ncols * L.res, L.north] : null;
  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center gap-4">
        <img src={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/brand/slate-logo-1200.png`} alt="SLATE: Slope Landslide Analytics and Triggering Explorer" className="w-full max-w-[360px] h-auto" />
        <div>
        <h1 className="text-2xl font-semibold">SLATE <span className="font-normal text-muted">· Slope Landslide Analytics and Triggering Explorer</span></h1>
        <p className="text-muted">Interactive susceptibility, rainfall-triggering thresholds and machine-learning nowcasts. An interactive research platform for landslide susceptibility and rainfall-triggering analysis.</p>
        </div>
      </div>
      <Disclaimer strong />
      <div className="grid lg:grid-cols-[1fr,380px] gap-4">
        <div className="relative">
          <MapView image={bounds ? { url: suscPng("pibe", "class"), bounds } : null} className="h-[68vh]" />
          <div className="absolute bottom-8 right-2 bg-white/90 border border-line rounded p-2">
            <Legend title="PIBE susceptibility (area share)" items={(L?.classes ?? []).map((c: string, i: number) => [SUSC_COLORS[i], `${c} (${L.class_area_share[i]} %)`])} />
          </div>
        </div>
        <div className="space-y-3">
          {CARDS.map(([h, t, q]) => (
            <Link key={h} href={h} className="block bg-white border border-line rounded p-3 hover:border-accent">
              <div className="font-semibold text-accent">{t}</div>
              <div className="text-sm text-muted">{q}</div>
            </Link>
          ))}
          <Link href="/analyze" className="block bg-accent text-white rounded p-3 text-sm font-medium">Analyze a location →</Link>
          {n && (
            <Card title="Study at a glance (from the paper's outputs)">
              <ul className="text-sm space-y-1 text-muted">
                <li>{n.n_records_clean} harmonised landslide records ({n.year_min}-{n.year_max}); {n.n_pos_cells} recorded-positive 0.05° cells.</li>
                <li>Tree ensembles: AUC about {n.auc_v0} under spatial-block cross-validation; PIBE AUC {n.auc_pibe}.</li>
                <li>About {n.pop_exposed_total} million people live in High and Very high PIBE classes.</li>
                <li>Threshold calibration 2007-2012; temporal holdout 2013-2025 ({n.n_test_1316} of {n.n_test_pos} landslide days in 2013-2016).</li>
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
