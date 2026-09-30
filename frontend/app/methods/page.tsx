"use client";
import { useEffect, useState } from "react";
import { Card, PageHead } from "@/components/ui";
import { get } from "@/lib/api";

export default function Methods() {
  const [n, setN] = useState<any>(null);
  useEffect(() => { get("/api/comparison").then((c) => setN(c.numbers)).catch(() => null); }, []);
  const S: [string, string][] = [
    ["1. Inventory", `${n?.n_records_raw ?? "…"} raw records from 13 sources were harmonised to ${n?.n_records_clean ?? "…"} records (${n?.year_min ?? ""}-${n?.year_max ?? ""}). The susceptibility subset keeps rainfall-type failures located within 5 km; the threshold subset keeps rainfall-triggered failures with an exact date and location within 25 km.`],
    ["2. Predictor data", "36 open predictors at 0.05°: terrain (Copernicus GLO-90), rainfall climatology (IMD 1991-2025), soil (SoilGrids 2.0), land cover (WorldCover 2021), tectonics (GEM faults, USGS ComCat), lithology (Generalized Geology of the World), and WorldPop 2020 as a reporting covariate only."],
    ["3. Susceptibility modelling", `AHP, FR, Monte Carlo TRIGRS, LR, RF, XGBoost, LightGBM and CatBoost with identical predictors, five 1° spatial-block folds and fixed hyperparameters. Cells without a record are unlabelled background (positive-unlabelled framing); recorded-positive fraction ${n?.prev_pct ?? "…"} %.`],
    ["4. PIBE", "GBM ensemble plus process-based features, source weights, monotone constraints and a reporting-covariate adjustment. See the PIBE explainer."],
    ["5. Temporal label-leakage control", `S is PIBE retrained only on landslide records dated 2012 or earlier (${n?.pre_pos ?? "…"} cells), predicted spatially out-of-fold and frozen. Predictor layers are not historically reconstructed, so "label leakage controlled" ≠ "full historical hindcast". S shares 2007-2012 labels with the calibration period by design.`],
    ["6. Rainfall event definition", "Each IMD 0.25° cell-day: an event starts on a wet day (≥ 1 mm) and ends after G = 2 consecutive dry days. E is event rainfall to date, D the days since the event start, A30 the rainfall in the 30 days before the event start."],
    ["7. Threshold modelling", "Published I-D thresholds applied unchanged; frequentist E-D at 5 % exceedance; MaCumBA-type I-D with optimised gap (G = 1); daily TRIGRS; SACT, an event-conditional logistic threshold on E, D, A30, MAP and S, whose S coefficient is not distinguishable from zero."],
    ["8. ML nowcasting", "LR, RF, XGBoost, LightGBM and CatBoost on 22 daily predictors; PI-GBM averages the three GBMs with the daily TRIGRS FS added. Negatives undersampled 20:1 in training; operating cuts from year-grouped inner out-of-fold predictions."],
    ["9. Validation", `Calibration 2007-2012; temporal holdout 2013-2025 (${n?.n_test_days ?? "…"} cell-days, ${n?.n_test_pos ?? "…"} landslide days). Cell-block bootstrap intervals; event-only scoring as a check.`],
    ["10. Event hindcasts", "Kerala 2018 and Himachal Pradesh 2023, with inventories never used in calibration or in S. Single-event demonstrations."],
    ["11. Limitations", "The main dated catalogue (NASA GLC) ends in 2016; locations uncertain by up to 25 km; background contains unreported landslides; daily 0.25° rainfall misses sub-daily bursts; TRIGRS parameters assumed; each hindcast is a single event."],
  ];
  return (
    <div className="space-y-4">
      <PageHead title="Methods" sub="Summary of the methodology of the source paper. All definitions in this application follow it exactly." />
      <Card title="Timeline">
        <div className="relative h-20 text-xs">
          {(() => { const x = (y: number) => `${((y - 2005) / 22) * 100}%`; return (<>
            <div className="absolute top-8 left-0 right-0 h-1 bg-line" />
            <div className="absolute top-6 h-5 bg-[#a9acd3] rounded" style={{ left: x(2007), width: `calc(${x(2013)} - ${x(2007)})` }} /><div className="absolute top-0" style={{ left: x(2007) }}>Calibration 2007-2012</div>
            <div className="absolute top-6 h-5 bg-[#2f2a6b] rounded" style={{ left: x(2013), width: `calc(${x(2017)} - ${x(2013)})` }} /><div className="absolute top-0" style={{ left: x(2013) }}>Test 2013-2016 (376 of 377 landslide days)</div>
            <div className="absolute top-6 h-5 bg-[#e7e9ee] border border-line rounded" style={{ left: x(2017), width: `calc(${x(2026)} - ${x(2017)})` }} /><div className="absolute top-12 mt-2" style={{ left: x(2017) }}>2017-2025: 1 landslide day (main dated catalogue, NASA GLC, ends 2016)</div>
          </>); })()}
        </div>
      </Card>
      <div className="grid md:grid-cols-2 gap-4">{S.map(([t, b]) => <Card key={t} title={t}><p className="text-sm">{b}</p></Card>)}</div>
    </div>
  );
}
