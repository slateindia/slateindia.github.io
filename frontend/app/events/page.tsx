"use client";
import { useEffect, useMemo, useState } from "react";
import MapView, { Legend } from "@/components/MapView";
import { Card, Disclaimer, PageHead, Status, Table } from "@/components/ui";
import { get, RAIN_STOPS } from "@/lib/api";

const VARS: Record<string, { label: string; color: any; legend: [string, string][] }> = {
  rain: { label: "Daily rainfall (mm)", color: ["interpolate", ["linear"], ["get", "v"], ...RAIN_STOPS.flat()], legend: RAIN_STOPS.map(([v, c]) => [c, `${v} mm`]) },
  pigbm: { label: "PI-GBM model score", color: ["interpolate", ["linear"], ["get", "v"], 0, "#f1f2f7", 0.2, "#a9acd3", 0.6, "#2f2a6b"], legend: [["#f1f2f7", "0"], ["#a9acd3", "0.2"], ["#2f2a6b", "0.6"]] },
  sact: { label: "SACT probability given event", color: ["interpolate", ["linear"], ["get", "v"], 0, "#f1f2f7", 0.002, "#a9acd3", 0.008, "#2f2a6b"], legend: [["#f1f2f7", "0"], ["#a9acd3", "0.002"], ["#2f2a6b", "≥ 0.008"]] },
  freq: { label: "Frequentist E-D exceeded", color: ["match", ["get", "v"], 1, "#2f2a6b", "#e7e9ee"], legend: [["#2f2a6b", "exceeded"], ["#e7e9ee", "not exceeded"]] },
};

export default function Events() {
  const [list, setList] = useState<any[]>([]);
  const [id, setId] = useState("kerala_2018");
  const [ev, setEv] = useState<any>(null);
  const [day, setDay] = useState(0);
  const [v, setV] = useState("rain");
  const [play, setPlay] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { get("/api/events").then(setList).catch((e) => setErr(e.message)); }, []);
  useEffect(() => {
    setEv(null);
    get(`/api/events/${id}`).then((e) => { setEv(e); const first = Object.values<any>(e.daily)[0]; setDay(Math.max(0, first.date.indexOf(e.wettest_days[0]))); }).catch((e) => setErr(e.message));
  }, [id]);
  const dates: string[] = ev ? Object.values<any>(ev.daily)[0].date : [];
  useEffect(() => {
    if (!play || !dates.length) return;
    const t = setInterval(() => setDay((d) => (d + 1) % dates.length), 700);
    return () => clearInterval(t);
  }, [play, dates.length]);
  const geo = useMemo(() => {
    if (!ev) return null;
    const key = { rain: "rain", pigbm: "pigbm", sact: "sact", freq: "freq" }[v]!;
    return {
      type: "FeatureCollection",
      features: Object.entries<any>(ev.daily).map(([c, s]) => {
        const [la, lo] = ev.cell_coords[c];
        return { type: "Feature", properties: { v: s[key][day] }, geometry: { type: "Polygon", coordinates: [[[lo - .125, la - .125], [lo + .125, la - .125], [lo + .125, la + .125], [lo - .125, la + .125], [lo - .125, la - .125]]] } };
      }),
    };
  }, [ev, day, v]);
  const fitB = useMemo<[[number, number], [number, number]] | null>(() => {
    if (!ev) return null;
    const c = Object.values<number[]>(ev.cell_coords);
    return [[Math.min(...c.map((x) => x[1])) - 0.3, Math.min(...c.map((x) => x[0])) - 0.3], [Math.max(...c.map((x) => x[1])) + 0.3, Math.max(...c.map((x) => x[0])) + 0.3]];
  }, [ev]);
  const budget = ev?.metrics.filter((m: any) => m.method.includes("budget")) ?? [];
  return (
    <div className="space-y-3">
      <PageHead title="Historical event hindcasts" sub="Daily hindcasts computed with the frozen pre-2013 susceptibility and models calibrated on 2007-2012. Neither event inventory was used in calibration. Each is a single-event hindcast: an event-level demonstration, not an estimate of general skill." />
      <Status error={err} />
      <div className="flex flex-wrap gap-2">{list.map((e) => <button key={e.id} onClick={() => setId(e.id)} className={`text-sm px-3 py-1 rounded border ${id === e.id ? "bg-accent text-white border-accent" : "bg-white border-line"}`}>{e.name}</button>)}</div>
      {ev && (
        <div className="grid lg:grid-cols-[1fr,440px] gap-4">
          <div className="space-y-2">
            <div className="bg-white border border-line rounded p-2 text-sm flex flex-wrap items-center gap-3">
              <label>Layer <select className="field" value={v} onChange={(e) => setV(e.target.value)}>{Object.entries(VARS).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}</select></label>
              <button className="btn" onClick={() => setPlay(!play)}>{play ? "Pause" : "Play"}</button>
              <input type="range" min={0} max={dates.length - 1} value={day} onChange={(e) => setDay(+e.target.value)} className="w-64" />
              <span className="font-mono">{dates[day]}</span>
              <span className="text-muted">Three wettest days:</span>
              {ev.wettest_days.map((w: string) => <button key={w} className="underline" onClick={() => setDay(dates.indexOf(w))}>{w}</button>)}
            </div>
            <div className="relative">
              <MapView geo={geo ? { data: geo, color: VARS[v].color, opacity: 0.85, outline: true } : null} points={ev.landslides} fit={fitB} />
              <div className="absolute bottom-8 right-2 bg-white/90 border border-line rounded p-2"><Legend title={VARS[v].label} items={[...VARS[v].legend, ["#111", "mapped landslide"]]} /></div>
            </div>
            <Disclaimer />
          </div>
          <div className="space-y-3">
            <Card title={ev.name}>
              <p className="text-sm">{ev.period[0]} to {ev.period[1]} · {ev.n_cells} IMD cells, {ev.n_landslide_cells} with mapped landslides · {ev.n_landslides.toLocaleString()} mapped landslides (inventory doi:{ev.inventory_doi}).</p>
              <p className="text-xs text-muted mt-2">{ev.caveat}</p>
            </Card>
            <Card title="Event metrics at the 5 % alert budget">
              <Table rows={budget.map((m: any) => ({ method: m.method.replace(", 5 % budget", ""), "AUC of alert days": m.AUC_alert_days, "alert days, landslide cells": m.mean_alert_days_ls, "alert days, other cells": m.mean_alert_days_nols }))} />
              <p className="text-xs text-muted mt-2">AUC of per-cell alert-day counts separating cells with and without mapped landslides. These values describe one event each and are not combined into a general success rate.</p>
            </Card>
            <Card title="All operating points"><Table rows={ev.metrics.map((m: any) => ({ method: m.method, AUC: m.AUC_alert_days, "peak alerted, landslide cells": m.peak_alerted_ls, "peak alerted, other cells": m.peak_alerted_nols }))} /></Card>
          </div>
        </div>
      )}
    </div>
  );
}
