"use client";
import { useEffect, useState } from "react";
import MapView, { Legend } from "@/components/MapView";
import DatePick from "@/components/DatePick";
import { Card, Disclaimer, KV, PageHead, Status, YesNo } from "@/components/ui";
import { CAT_COLORS, fmt, get } from "@/lib/api";

export default function TwoTier() {
  const [date, setDate] = useState("2023-07-10");
  const [tier1, setTier1] = useState("frequentist_ed");
  const [model, setModel] = useState("pi_gbm");
  const [d, setD] = useState<any>(null);
  const [sel, setSel] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setBusy(true); setErr(null);
    get("/api/twotier/map", { date, tier1, model }).then(setD).catch((e) => { setErr(e.message); setD(null); }).finally(() => setBusy(false));
  }, [date, tier1, model]);
  const color = ["match", ["get", "category"], 1, CAT_COLORS[1], 2, CAT_COLORS[2], 3, CAT_COLORS[3], 4, CAT_COLORS[4], "#fff"];
  return (
    <div className="space-y-3">
      <PageHead title="Two-tier research priority map" sub="Tier 1 identifies rainfall conditions associated with historical landslide occurrence. Tier 2 provides additional spatial discrimination using machine learning. This two-tier configuration has not been prospectively validated as an operational warning system." />
      <Disclaimer strong />
      <div className="grid lg:grid-cols-[1fr,400px] gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-3 items-center bg-white border border-line rounded p-2 text-sm">
            <DatePick value={date} onChange={setDate} />
            <label>Tier 1 <select className="field" value={tier1} onChange={(e) => setTier1(e.target.value)}>
              <option value="frequentist_ed">Frequentist E-D</option><option value="macumba">MaCumBA-type</option><option value="sact">SACT</option></select></label>
            <label>Tier 2 <select className="field" value={model} onChange={(e) => setModel(e.target.value)}>
              {["pi_gbm", "catboost", "xgboost", "lightgbm", "rf", "lr"].map((m) => <option key={m} value={m}>{m.replace("_", "-").toUpperCase()}</option>)}</select></label>
          </div>
          <div className="relative">
            <MapView geo={d?.geojson ? { data: d.geojson, color, opacity: 0.85 } : null} onClick={(a, b, p) => p && setSel({ ...p, _lat: a, _lon: b })} />
            <div className="absolute bottom-8 right-2 bg-white/90 border border-line rounded p-2 max-w-[260px]">
              <Legend title="Research priority / model-based alert" items={Object.entries(d?.categories ?? {}).map(([k, l]) => [CAT_COLORS[+k], `${k}. ${l}`])} />
            </div>
          </div>
        </div>
        <div className="space-y-3">
          <Status loading={busy} error={err} />
          {d && (
            <>
              <Card title="Category logic">
                <KV rows={[["Tier 1", d.logic.tier1], ["Tier 2", d.logic.tier2], ["Susceptibility", d.logic.susceptibility]]} />
                {!d.ml_installed && <p className="text-sm mt-2">Tier 2 model artifact not installed; categories 3 and 4 cannot be assigned.</p>}
              </Card>
              <Card title={`Cells per category, ${d.date}`}><KV rows={Object.entries(d.counts).map(([k, v]) => [`${k}. ${d.categories[k]}`, String(v)])} />
                {d.note && <p className="text-xs text-muted mt-2">{d.note}</p>}</Card>
            </>
          )}
          {sel && (
            <Card title={`Selected cell (${sel.state})`}>
              <a className="text-xs text-accent underline block mb-2" href={`../analyze/?lat=${sel._lat.toFixed(3)}&lon=${sel._lon.toFixed(3)}&date=${date}&tier1=${tier1}&model=${model}`}>Why does this cell have this result? →</a>
              <KV rows={[["Category", `${sel.category}. ${d?.categories[sel.category]}`], ["Tier 1 exceeded", <YesNo key="1" v={sel.tier1} />], ["Tier 2 above cut", <YesNo key="2" v={sel.tier2} />],
                ["High/Very high susceptibility", <YesNo key="3" v={sel.high_susceptibility} />], ["ML model score", fmt(sel.ml_score, 4)], ["Daily rainfall (mm)", fmt(sel.R0, 1)],
                ["Event E (mm) / D (days)", `${fmt(sel.E, 0)} / ${fmt(sel.D, 0)}`]]} />
            </Card>
          )}
          <p className="text-xs text-muted">Neutral colours are used on purpose: categories express higher or lower model-based priority, not danger or safety.</p>
        </div>
      </div>
    </div>
  );
}
