"use client";
import { useEffect, useState } from "react";
import MapView, { Legend } from "@/components/MapView";
import DatePick from "@/components/DatePick";
import { Card, Disclaimer, KV, PageHead, Status } from "@/components/ui";
import { fmt, get } from "@/lib/api";

const MODELS = [["pi_gbm", "PI-GBM"], ["catboost", "CatBoost"], ["xgboost", "XGBoost"], ["lightgbm", "LightGBM"], ["rf", "RF"], ["lr", "LR"]];

export default function Nowcast() {
  const [date, setDate] = useState("2018-08-16");
  const [model, setModel] = useState("pi_gbm");
  const [mode, setMode] = useState("budget");
  const [d, setD] = useState<any>(null);
  const [meta, setMeta] = useState<any>(null);
  const [sel, setSel] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setBusy(true); setErr(null);
    get("/api/nowcast/map", { date, model, mode }).then(setD).catch((e) => { setErr(e.message); setD(null); }).finally(() => setBusy(false));
    get(`/api/model-metadata/${model}`).then(setMeta).catch(() => setMeta(null));
  }, [date, model, mode]);
  const color = ["case", ["==", ["get", "alert"], true], "#2f2a6b",
    ["interpolate", ["linear"], ["get", "score"], 0, "#f1f2f7", 0.05, "#d5d7ea", 0.2, "#a9acd3", 0.5, "#6f73ae"]];
  return (
    <div>
      <PageHead title="ML nowcast" sub="Daily model scores for every IMD 0.25° cell in the study domain, computed from the archived IMD rainfall with the paper's calibrated models. Scores come from models trained on undersampled data, so they are model scores, not calibrated probabilities." />
      <div className="grid lg:grid-cols-[1fr,400px] gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-3 items-center bg-white border border-line rounded p-2 text-sm">
            <DatePick value={date} onChange={setDate} />
            <label>Model <select className="field" value={model} onChange={(e) => setModel(e.target.value)}>{MODELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label>Alert rule <select className="field" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="budget">5 % alert budget (default)</option><option value="operating">TSS-optimal operating cut</option></select></label>
          </div>
          <div className="relative">
            <MapView geo={d?.geojson ? { data: d.geojson, color, opacity: 0.8 } : null} onClick={(a, b, p) => p && setSel({ ...p, _lat: a, _lon: b })} />
            <div className="absolute bottom-8 right-2 bg-white/90 border border-line rounded p-2">
              <Legend title={`${d?.model ?? ""} model score`} items={[["#f1f2f7", "0"], ["#a9acd3", "0.2"], ["#6f73ae", "≥ 0.5"], ["#2f2a6b", "at or above alert cut"]]} />
            </div>
          </div>
          <Disclaimer />
        </div>
        <div className="space-y-3">
          <Status loading={busy} error={err} />
          {d && !d.installed && <Card><p className="text-sm">{d.message}</p></Card>}
          {d?.installed && (
            <Card title={`${d.model}, ${d.date}`}>
              <KV rows={[["Alert cut", fmt(d.cut, 4)], ["Cells", d.n_cells], ["Cells at or above cut", d.n_alerted], ["Share of cells alerted", `${fmt(100 * d.alerted_share, 1)} %`],
                ["Score min / median", `${fmt(d.score_stats.min, 4)} / ${fmt(d.score_stats.median, 4)}`], ["Score 95th pct / max", `${fmt(d.score_stats.p95, 4)} / ${fmt(d.score_stats.max, 4)}`]]} />
              <p className="text-xs text-muted mt-2">{d.cut_definition}. The 5 % alert budget selects about the top 5 % of calibration scores; it is not a 5 % probability. {d.note}</p>
            </Card>
          )}
          {sel && <Card title="Selected cell"><a className="text-xs text-accent underline block mb-2" href={`../analyze/?lat=${sel._lat.toFixed(3)}&lon=${sel._lon.toFixed(3)}&date=${date}&model=${model}`}>Why does this cell have this result? →</a><KV rows={[["State", sel.state], ["Model score", fmt(sel.score, 4)], ["At or above cut", sel.alert ? "yes" : "no"], ["Daily rainfall (mm)", fmt(sel.R0, 1)]]} /></Card>}
          {meta && (
            <Card title="How this result was generated">
              <KV rows={[["Model", `${meta.model_name} v${meta.version}`], ["Members", meta.members.join(", ")], ["Training", meta.training_period], ["Evaluation", meta.evaluation_period],
                ["Susceptibility input", meta.susceptibility_input], ["Predictors", `${meta.predictors.length}`], ["Operating cut", `${fmt(meta.operating_cut, 4)} (calibration-derived)`],
                ["Reproduces paper test scores", `max |diff| ${meta.reproduction_check.max_abs_diff_vs_paper_test_scores.toExponential(1)}`]]} />
              <p className="text-xs text-muted mt-2">Predictors: {meta.predictors.join(", ")}.</p>
              <p className="text-xs text-muted mt-1">Point estimates among the boosting models are similar, and their differences fall within the reported uncertainty.</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
