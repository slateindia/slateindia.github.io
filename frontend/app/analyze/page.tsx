"use client";
import { useEffect, useState } from "react";
import WhyPanel from "@/components/WhyPanel";
import MapView from "@/components/MapView";
import DatePick from "@/components/DatePick";
import { Card, Disclaimer, KV, PageHead, Status, Tip, YesNo } from "@/components/ui";
import { fmt, get } from "@/lib/api";

export default function Analyze() {
  const [lat, setLat] = useState("10.00");
  const [lon, setLon] = useState("76.50");
  const [date, setDate] = useState("2018-08-16");
  const [model, setModel] = useState("pi_gbm");
  const [tier1, setTier1] = useState("frequentist_ed");
  const [r, setR] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = (o: any = {}) => {
    setBusy(true); setErr(null);
    get("/api/analyze", { lat, lon, date, model, tier1, ...o }).then(setR).catch((e) => { setErr(e.message); setR(null); }).finally(() => setBusy(false));
  };
  useEffect(() => {  // deep link: /analyze/?lat=..&lon=..&date=..
    const q = new URLSearchParams(window.location.search);
    if (q.get("lat") && q.get("lon")) {
      const o: any = { lat: q.get("lat"), lon: q.get("lon"), date: q.get("date") ?? date, model: q.get("model") ?? model, tier1: q.get("tier1") ?? tier1 };
      setLat(o.lat); setLon(o.lon); setDate(o.date); setModel(o.model); setTier1(o.tier1); run(o);
    }
  }, []);
  return (
    <div>
      <PageHead title="Analyze a location" sub="Pick a point on the map or enter coordinates, choose a date in the IMD archive and a model, then Analyze. Every value is computed from the archived data and the paper's calibrated models." />
      <div className="grid lg:grid-cols-[1fr,460px] gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-3 items-center bg-white border border-line rounded p-2 text-sm">
            <label>Lat <input className="field w-24" value={lat} onChange={(e) => setLat(e.target.value)} /></label>
            <label>Lon <input className="field w-24" value={lon} onChange={(e) => setLon(e.target.value)} /></label>
            <DatePick value={date} onChange={setDate} />
            <label>Tier 1 <select className="field" value={tier1} onChange={(e) => setTier1(e.target.value)}>
              <option value="frequentist_ed">Frequentist E-D</option><option value="macumba">MaCumBA-type</option><option value="sact">SACT</option></select></label>
            <label>Nowcast <select className="field" value={model} onChange={(e) => setModel(e.target.value)}>
              {["pi_gbm", "catboost", "xgboost", "lightgbm", "rf", "lr"].map((m) => <option key={m} value={m}>{m.replace("_", "-").toUpperCase()}</option>)}</select></label>
            <button className="btn" onClick={() => run()} disabled={busy}>ANALYZE</button>
          </div>
          <MapView marker={[+lat, +lon]} onClick={(a, b) => { setLat(a.toFixed(3)); setLon(b.toFixed(3)); }} className="h-[62vh]" />
          <Disclaimer />
          {r?.available && <WhyPanel why={r.why} />}
        </div>
        <div className="space-y-3">
          <Status loading={busy} error={err} />
          {r && !r.available && <Card><p className="text-sm">{r.message}</p></Card>}
          {r?.available && (
            <>
              <Card title="Location">
                <KV rows={[["State", r.location.state], ["District", "not available"], ["Coordinates", `${lat}, ${lon}`],
                  ["Rainfall cell (IMD 0.25°)", `#${r.location.rainfall_cell} (${r.location.rainfall_cell_centre.join(", ")})`]]} />
              </Card>
              <Card title="Susceptibility">
                {r.susceptibility.available ? <KV rows={[["PIBE class", r.susceptibility.pibe_class], ["Continuous score", fmt(r.susceptibility.scores.pibe?.score, 4)],
                  ["National percentile", fmt(r.susceptibility.pibe_percentile, 3)]]} /> : <p className="text-sm">{r.susceptibility.message}</p>}
              </Card>
              <Card title="Rainfall">
                <KV rows={[["Daily rainfall (mm)", fmt(r.rainfall.R0, 1)], ["Previous day (mm)", fmt(r.rainfall.R1, 1)], [<Tip term="E">Event rainfall E (mm)</Tip>, fmt(r.rainfall.E, 1)],
                  [<Tip term="D">Event duration D (days)</Tip>, fmt(r.rainfall.D, 0)], [<Tip term="A30">A30 (mm)</Tip>, fmt(r.rainfall.A30, 1)], [<Tip term="MAP">MAP (mm)</Tip>, fmt(r.rainfall.MAP, 0)],
                  [<Tip term="S">S</Tip>, fmt(r.rainfall.S, 3)]]} />
              </Card>
              <Card title="Threshold analysis (historical threshold exceedance)">
                <KV rows={["Frequentist E-D (T5)", "MaCumBA-type I-D", "SACT (event-conditional)"].map((k) => [k, <YesNo key={k} v={r.thresholds[k].exceeded} />])} />
              </Card>
              <Card title="ML nowcast">
                {r.nowcast.installed ? <KV rows={[[`${r.nowcast.model} model score`, fmt(r.nowcast.score, 4)], ["Above operating cut", <YesNo key="a" v={r.nowcast.above_operating_cut} />],
                  [<Tip term="POD5">Above 5 % budget cut</Tip>, <YesNo key="b" v={r.nowcast.above_5pct_budget_cut} />], ["Percentile among cells that day", fmt(r.nowcast.percentile_among_cells_today, 3)]]} />
                  : <p className="text-sm">Model artifact not installed.</p>}
              </Card>
              <Card title="Two-tier research result">
                <KV rows={[[`Tier 1 (${r.two_tier.tier1_method})`, <YesNo key="1" v={r.two_tier.tier1} />], ["Tier 2 (ML above research cut)", <YesNo key="2" v={r.two_tier.tier2} />],
                  ["High/Very high susceptibility", <YesNo key="3" v={r.two_tier.high_susceptibility} />]]} />
                <p className="text-sm mt-2 font-medium">Research priority / model-based alert: {r.two_tier.label}</p>
              </Card>
              <Card title="Interpretation"><ul className="text-sm list-disc pl-4 space-y-1">{r.interpretation.map((t: string) => <li key={t}>{t}</li>)}</ul></Card>
              {r.model_information && <Card title="Model information">
                <KV rows={[["Model", `${r.model_information.model_name} v${r.model_information.version}`], ["Training period", r.model_information.training_period],
                  ["Evaluation", r.model_information.evaluation_period], ["Resolution", r.model_information.spatial_resolution], ["Output", r.model_information.output]]} />
              </Card>}
              <Card title="Limitations"><ul className="text-sm list-disc pl-4 space-y-1">{r.limitations.filter(Boolean).map((t: string) => <li key={t}>{t}</li>)}</ul></Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
