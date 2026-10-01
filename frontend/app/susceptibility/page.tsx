"use client";
import { useEffect, useState } from "react";
import MapView, { Legend } from "@/components/MapView";
import { Card, Disclaimer, Drawer, KV, PageHead, Status } from "@/components/ui";
import { SusceptibilityWhy } from "@/components/WhyPanel";
import { fmt, get, suscPng, SUSC_COLORS } from "@/lib/api";

const PRED_LABELS: Record<string, string> = {
  elev_mean: "Mean elevation (m)", relief: "Relief (m)", slope_mean: "Mean slope (°)", slope_max: "Maximum slope (°)", map_mm: "MAP (mm)",
  rl25_3d: "25-yr 3-day rainfall (mm)", sand: "Sand (%)", clay: "Clay (%)", lc_tree: "Tree cover (fraction)", lc_crop: "Cropland (fraction)",
  lc_built: "Built-up (fraction)", lc_bare: "Bare (fraction)", dist_fault_km: "Distance to active fault (km)", eq_density: "Epicentre density (weighted)",
  population: "Population (persons)", age_ma: "Mean stratigraphic age (Ma)",
};

export default function Susceptibility() {
  const [L, setL] = useState<any>(null);
  const [model, setModel] = useState("pibe");
  const [mode, setMode] = useState("class");
  const [opacity, setOpacity] = useState(0.85);
  const [cell, setCell] = useState<any>(null);
  const [pt, setPt] = useState<[number, number] | null>(null);
  const [shap, setShap] = useState<any>(null);
  const [why, setWhy] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { get("/api/susceptibility/layers").then(setL).catch((e) => setErr(e.message)); get("/api/susceptibility/shap").then(setShap).catch(() => null); }, []);
  const layer = L?.layers.find((l: any) => l.id === model);
  const bounds: [number, number, number, number] | null = L ? [L.west, L.north - L.nrows * L.res, L.west + L.ncols * L.res, L.north] : null;
  const click = (lat: number, lon: number) => { setPt([lat, lon]); get("/api/susceptibility/cell", { lat, lon }).then(setCell).catch((e) => setErr(e.message)); get("/api/why/susceptibility", { lat, lon }).then(setWhy).catch(() => setWhy(null)); };

  return (
    <div>
      <PageHead title="National landslide susceptibility" sub="0.05° grid (about 5.5 km). PIBE, the process-informed, observation-bias-adjusted ensemble, is the default. Other layers are spatial cross-validation out-of-fold scores for the modelled cells. Susceptibility is a relative ranking, not a probability." />
      <Status error={err} />
      <div className="grid lg:grid-cols-[1fr,400px] gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-3 items-center text-sm bg-white border border-line rounded p-2">
            <label>Model <select className="field" value={model} onChange={(e) => setModel(e.target.value)}>
              {L?.layers.map((l: any) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select></label>
            <label>Display <select className="field" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="class">Area-share classes (60/20/10/5/5 %)</option><option value="score">Continuous percentile rank</option>
            </select></label>
            <label>Opacity <input type="range" min={0.2} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(+e.target.value)} /></label>
            <span className="text-muted">Resolution 0.05°</span>
          </div>
          <div className="relative">
            <MapView image={bounds ? { url: suscPng(model, mode), bounds, opacity } : null} marker={pt} onClick={click} />
            <div className="absolute bottom-8 right-2 bg-white/90 border border-line rounded p-2">
              {mode === "class"
                ? <Legend title={model === "pibe" ? "PIBE class (area share)" : "Class of this layer's ranking"} items={(L?.classes ?? []).map((c: string, i: number) => [SUSC_COLORS[i], `${c} (${L.class_area_share[i]} %)`])} />
                : <Legend title="Percentile rank of score" items={[[SUSC_COLORS[0], "0 (lowest)"], [SUSC_COLORS[2], "0.5"], [SUSC_COLORS[4], "1 (highest)"]]} />}
            </div>
          </div>
          {layer && <p className="text-xs text-muted">Layer: {layer.label}. {layer.kind}. {layer.n_cells.toLocaleString()} cells.{layer.cv_metrics && ` Spatial cross-validation AUC ${fmt(layer.cv_metrics.AUC)} (95 % interval ${fmt(layer.cv_metrics.AUC_lo)}-${fmt(layer.cv_metrics.AUC_hi)}), AP ${fmt(layer.cv_metrics.AP)}.`} Spatial uncertainty surface not available for this model artifact.</p>}
          <Disclaimer />
        </div>
        <div className="space-y-3">
          {!cell && <Card><p className="text-sm text-muted">Click a location on the map to see the cell's scores and predictors.</p></Card>}
          {cell && !cell.available && <Card><p className="text-sm">{cell.message}</p></Card>}
          {cell?.available && (
            <>
              <Card title="Location">
                <KV rows={[["State", cell.state || "n/a"], ["District", "not available (no district layer supplied)"], ["Cell centre", `${fmt(cell.lat, 3)}, ${fmt(cell.lon, 3)}`],
                  ["PIBE class", cell.pibe_class], ["PIBE national percentile", fmt(cell.pibe_percentile, 3)],
                  ["Flat terrain (max slope < 10°)", cell.flat_terrain ? "yes" : "no"], ["Recorded landslide cell", cell.recorded_positive ? `yes (${cell.record_source})` : "no record"],
                  ["Lithology", cell.lithology ?? "n/a"]]} />
              </Card>
              <Card title="Scores in this cell">
                <KV rows={Object.values(cell.scores).map((s: any) => [s.label, `${fmt(s.score, 4)} (pct ${fmt(s.percentile, 2)})`])} />
              </Card>
              <Card title="Predictors">
                <KV rows={Object.entries(cell.predictors).map(([k, v]) => [PRED_LABELS[k] ?? k, fmt(v as number, k.startsWith("lc_") ? 3 : 1)])} />
              </Card>
              <Card title="Why does this cell have this result?"><SusceptibilityWhy w={why} cls={cell.pibe_class} pct={cell.pibe_percentile} />
                <p className="text-xs font-semibold mt-2">Important: feature contributions describe model behaviour and should not be interpreted as proof of physical causation.</p>
                <a className="text-xs text-accent underline" href={`../analyze/?lat=${cell.lat}&lon=${cell.lon}`}>Full decomposition with rainfall, thresholds and ML →</a></Card>
            </>
          )}
          <Drawer label="Global predictor importance (SHAP)">
            <p className="text-xs text-muted mb-2">{shap?.model}: mean |SHAP|. {shap?.note} Population and built-up fraction are reporting covariates and are fixed at national medians for mapping.</p>
            <KV rows={(shap?.features ?? []).slice(0, 15).map((f: any) => [f.feature, fmt(f.mean_abs_shap, 3)])} />
          </Drawer>
        </div>
      </div>
    </div>
  );
}
