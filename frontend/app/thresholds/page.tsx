"use client";
import { useEffect, useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend as RLegend, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import MapView from "@/components/MapView";
import DatePick from "@/components/DatePick";
import { Card, Disclaimer, KV, PageHead, Status, Table, Tip, YesNo } from "@/components/ui";
import { fmt, get, post } from "@/lib/api";

const LINE = ["#9aa3b2", "#7b8494", "#5e6778", "#b7bfcc", "#c9cfd8", "#3b4a8c", "#1b7a6e", "#8c3b6e"];

export default function Thresholds() {
  const [pt, setPt] = useState<[number, number]>([30.45, 79.1]);
  const [date, setDate] = useState("2013-06-17");
  const [ev, setEv] = useState<any>(null);
  const [rain, setRain] = useState<any>(null);
  const [curves, setCurves] = useState<any>(null);
  const [cmp, setCmp] = useState<any>(null);
  const [params, setParams] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [what, setWhat] = useState({ E: 150, D: 3, A30: 100, MAP: 2000, S: 0.5 });
  const [whatR, setWhatR] = useState<any>(null);

  useEffect(() => { get("/api/comparison").then(setCmp).catch(() => null); get("/api/model-metadata/sact").then(setParams).catch(() => null); }, []);
  useEffect(() => {
    setBusy(true); setErr(null);
    Promise.all([get("/api/threshold/evaluate", { lat: pt[0], lon: pt[1], date }), get("/api/rainfall", { lat: pt[0], lon: pt[1], date, days: 90 })])
      .then(([e, r]) => { setEv(e); setRain(r); if (e.available) get("/api/threshold/curves", { A30: e.inputs.A30, MAP: e.inputs.MAP, S: e.inputs.S }).then(setCurves); })
      .catch((e) => { setErr(e.message); setEv(null); setRain(null); }).finally(() => setBusy(false));
  }, [pt[0], pt[1], date]);

  const curveRows = useMemo(() => curves ? curves.curves.D.map((d: number, i: number) => Object.fromEntries([["D", d], ...Object.keys(curves.curves).filter((k) => k !== "D").map((k) => [k, curves.curves[k][i]])])) : [], [curves]);
  const names = curves ? Object.keys(curves.curves).filter((k) => k !== "D") : [];
  const rainRows = rain?.available ? rain.series.date.map((d: string, i: number) => ({ date: d.slice(5), rain: rain.series.rain[i], E: rain.series.E[i] })) : [];

  return (
    <div className="space-y-4">
      <PageHead title="Rainfall threshold explorer" sub="Click a rainfall cell and choose a date. Rainfall events use the paper's definition (wet day ≥ 1 mm, event ends after 2 dry days). Crossing a threshold is a historical threshold exceedance: rainfall conditions associated with past landslide occurrence, not a statement that a landslide will occur." />
      <div className="grid lg:grid-cols-[1fr,440px] gap-4">
        <div className="space-y-2">
          <div className="bg-white border border-line rounded p-2 flex gap-3 items-center"><DatePick value={date} onChange={setDate} /><span className="text-sm text-muted">Point {pt[0].toFixed(2)}, {pt[1].toFixed(2)}</span></div>
          <MapView marker={pt} onClick={(a, b) => setPt([a, b])} className="h-[42vh]" />
          <Card title="Daily rainfall and event rainfall E (last 90 days)">
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={rainRows}><CartesianGrid stroke="#eee" /><XAxis dataKey="date" fontSize={10} interval={14} /><YAxis yAxisId="r" fontSize={10} label={{ value: "mm/day", angle: -90, fontSize: 10, position: "insideLeft" }} />
                <YAxis yAxisId="e" orientation="right" fontSize={10} label={{ value: "E (mm)", angle: 90, fontSize: 10, position: "insideRight" }} />
                <Tooltip /><Bar yAxisId="r" dataKey="rain" fill="#6baed6" name="Daily rainfall" /><Line yAxisId="e" dataKey="E" stroke="#3b4a8c" dot={false} name="Event rainfall E" /></ComposedChart>
            </ResponsiveContainer>
          </Card>
          <Card title="Event rainfall-duration (E-D) space">
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={curveRows}><CartesianGrid stroke="#eee" />
                <XAxis dataKey="D" type="number" scale="log" domain={[1, 60]} ticks={[1, 2, 5, 10, 20, 60]} fontSize={10} label={{ value: "Duration D (days)", position: "insideBottom", offset: -2, fontSize: 10 }} />
                <YAxis type="number" scale="log" domain={[1, 20000]} allowDataOverflow ticks={[1, 10, 100, 1000, 10000]} fontSize={10} label={{ value: "Event rainfall E (mm)", angle: -90, position: "insideLeft", fontSize: 10 }} />
                <Tooltip formatter={(v: any) => fmt(v, 0)} /><RLegend wrapperStyle={{ fontSize: 10 }} />
                {names.map((n, i) => <Line key={n} dataKey={n} dot={false} stroke={LINE[i % LINE.length]} strokeWidth={n.startsWith("SACT") || n.startsWith("Freq") || n.startsWith("MaC") ? 2 : 1} strokeDasharray={i < 5 ? "4 3" : undefined} />)}
                {ev?.available && ev.inputs.D > 0 && <ReferenceDot x={Math.min(ev.inputs.D, 60)} y={Math.max(ev.inputs.E, 1)} r={6} fill="#111" stroke="#fff" />}
              </LineChart>
            </ResponsiveContainer>
            <p className="text-xs text-muted">{curves?.note} Dashed: published thresholds. SACT curve drawn for this cell's A30, MAP and S. Black dot: the selected cell-day{ev?.available && ev.inputs.D === 0 ? " (no ongoing event, so no point is plotted)" : ""}.</p>
          </Card>
        </div>
        <div className="space-y-3">
          <Status loading={busy} error={err} />
          {ev && !ev.available && <Card><p className="text-sm">{ev.message}</p></Card>}
          {ev?.available && (
            <>
              <Card title={`Cell #${ev.cell} (${ev.state}), ${ev.date}`}>
                <KV rows={[["Daily rainfall (mm)", fmt(ev.inputs.R0, 1)], ["Previous day (mm)", fmt(ev.inputs.R1, 1)], [<Tip term="E">Event rainfall E (mm)</Tip>, fmt(ev.inputs.E, 1)],
                  [<Tip term="D">Duration D (days)</Tip>, fmt(ev.inputs.D, 0)], [<Tip term="A30">A30 (mm)</Tip>, fmt(ev.inputs.A30, 1)], [<Tip term="MAP">MAP (mm)</Tip>, fmt(ev.inputs.MAP, 0)],
                  [<Tip term="S">S</Tip>, fmt(ev.inputs.S, 3)], ["Rainfall event status", ev.in_event ? "ongoing event" : "no ongoing event"]]} />
                {ev.note && <p className="text-xs text-muted mt-2">{ev.note}</p>}
              </Card>
              <Card title="Historical threshold exceedance">
                <table className="text-xs w-full"><thead><tr className="text-left"><th>Method</th><th>Exceeded</th><th className="text-right">Threshold E (mm)</th><th className="text-right">Margin (mm)</th></tr></thead>
                  <tbody>{Object.entries(ev.results).map(([k, v]: any) => <tr key={k} className="odd:bg-paper"><td>{k}</td><td><YesNo v={v.exceeded} /></td><td className="text-right font-mono">{fmt(v.threshold_E_mm, 0)}</td><td className="text-right font-mono">{fmt(v.margin_mm, 0)}</td></tr>)}</tbody></table>
                <p className="text-xs text-muted mt-2">SACT probability given an ongoing event: {fmt(ev.results["SACT (event-conditional)"].probability_given_event, 5)} (p* = {fmt(ev.results["SACT (event-conditional)"].p_star, 5)}). MaCumBA-type uses its own event definition (G = 1). {ev.interpretation}</p>
              </Card>
            </>
          )}
          {params && (
            <Card title="SACT: event-conditional threshold">
              <p className="text-sm font-mono">E*/E₀ = α (D/D₀)^β_D (1 + A₃₀/A₀)^γ_A (MAP/M₀)^δ_M exp(ε_S S)</p>
              <p className="text-xs text-muted mt-1">E₀ = {params.E0_mm} mm, D₀ = {params.D0_days} day, A₀ = {params.A0_mm} mm, M₀ = {params.M0_mm} mm; α = exp({fmt(params.ln_alpha, 3)}) from the calibrated model at p* = {fmt(params.p_star, 5)}.</p>
              <Table rows={["beta_D", "gamma_A", "delta_MAP", "eps_S"].map((k) => ({ parameter: k, value: params[k], "95 % interval": `${fmt(params.exponent_ci[k][0], 2)} to ${fmt(params.exponent_ci[k][1], 2)}` }))} />
              <p className="text-xs mt-2">{params.note}</p>
            </Card>
          )}
          <Card title="What-if evaluation (manual inputs)">
            <div className="grid grid-cols-5 gap-1 text-xs">{(["E", "D", "A30", "MAP", "S"] as const).map((k) => <label key={k}><Tip term={k} /><input className="field w-full" type="number" value={what[k]} step={k === "S" ? 0.05 : 1} onChange={(e) => setWhat({ ...what, [k]: +e.target.value })} /></label>)}</div>
            <button className="btn mt-2" onClick={() => post("/api/threshold/evaluate", what).then(setWhatR).catch((e) => setWhatR({ error: e.message }))}>Evaluate</button>
            {whatR?.error && <p className="text-xs text-[#8a2b2b] mt-1">{whatR.error}</p>}
            {whatR?.results && <KV rows={Object.entries(whatR.results).map(([k, v]: any) => [k, <YesNo key={k} v={v.exceeded} />])} />}
          </Card>
          {cmp?.event_only && (
            <Card title="Event-only performance (2013-2025 test period)">
              <Table rows={cmp.event_only.rows.map((r: string[]) => Object.fromEntries(cmp.event_only.header.map((h: string, i: number) => [h, r[i]])))} />
              <p className="text-xs text-muted mt-2">Test-period research results, not real-time validation. {cmp.event_only.footnote} Much of the thresholds' all-day skill comes from separating rainfall events from dry days.</p>
            </Card>
          )}
          <Disclaimer />
        </div>
      </div>
    </div>
  );
}
