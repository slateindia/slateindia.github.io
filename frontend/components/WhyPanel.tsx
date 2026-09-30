"use client";
import { Card, YesNo } from "@/components/ui";
import { fmt } from "@/lib/api";

function Bars({ rows, max }: { rows: { label: string; contribution: number; value?: number }[]; max: number }) {
  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[170px,1fr,56px] items-center gap-2 text-xs">
          <span className="truncate" title={r.label}>{r.label}{r.value !== undefined && <span className="text-muted"> ({fmt(r.value, 2)})</span>}</span>
          <div className="relative h-3 bg-paper rounded">
            <div className="absolute top-0 h-3 left-1/2 w-px bg-line" />
            <div className="absolute top-0 h-3 rounded" style={{ background: r.contribution >= 0 ? "#2f2a6b" : "#a9acd3",
              left: r.contribution >= 0 ? "50%" : `${50 - (50 * Math.abs(r.contribution)) / max}%`, width: `${(50 * Math.abs(r.contribution)) / max}%` }} />
          </div>
          <span className="font-mono text-right">{r.contribution >= 0 ? "+" : ""}{fmt(r.contribution, 2)}</span>
        </div>
      ))}
    </div>
  );
}

/** Susceptibility part only (used on the susceptibility page). */
export function SusceptibilityWhy({ w, cls, pct }: { w: any; cls?: string; pct?: number }) {
  if (!w?.available) return <p className="text-sm text-muted">Feature contributions are not available for this cell.</p>;
  const all = [...w.raising, ...w.lowering];
  const max = Math.max(...all.map((f: any) => Math.abs(f.contribution)), ...w.groups.map((g: any) => Math.abs(g.contribution)), 1e-9);
  return (
    <div className="space-y-3">
      {cls && <p className="text-sm"><b>{cls}</b> PIBE susceptibility{pct !== undefined && ` (national percentile ${fmt(pct, 3)})`}.</p>}
      <div><div className="text-xs font-semibold mb-1">Features raising the score</div><Bars rows={w.raising} max={max} /></div>
      {w.lowering.length > 0 && <div><div className="text-xs font-semibold mb-1">Features lowering the score</div><Bars rows={w.lowering} max={max} /></div>}
      <div><div className="text-xs font-semibold mb-1">By predictor group</div><Bars rows={w.groups.map((g: any) => ({ label: g.group, contribution: g.contribution }))} max={max} /></div>
      <p className="text-xs text-muted">Contributions in log-odds relative to the model's base value ({fmt(w.base_log_odds, 2)}); values of the features in brackets. Reporting covariates are held at the national median for every cell, so their contribution reflects how the median differs from the model's average input, not local reporting. {w.method}</p>
    </div>
  );
}

export default function WhyPanel({ why }: { why: any }) {
  if (!why) return null;
  const s = why.threshold.sact, t = why.threshold.tier1;
  return (
    <Card title="Why does this cell have this result?" className="border-accent/50">
      <div className="space-y-4 text-sm">
        <section><h4 className="font-semibold text-accent">Susceptibility</h4>
          <SusceptibilityWhy w={why.susceptibility.contributions} cls={why.susceptibility.pibe_class} pct={why.susceptibility.pibe_percentile} /></section>
        <section><h4 className="font-semibold text-accent">Rainfall</h4><p>{why.rainfall}</p></section>
        <section><h4 className="font-semibold text-accent">Threshold</h4>
          <table className="text-xs w-full"><tbody>
            {[["SACT (event-conditional)", s], [t.method, t]].filter(([n], i) => i === 0 || n !== "SACT (event-conditional)").map(([n, r]: any) => (
              <tr key={n}><td className="pr-2">{n}</td><td className="font-mono">threshold {r.threshold_E_mm != null ? `${fmt(r.threshold_E_mm, 1)} mm` : "n/a (no event)"}</td>
                <td className="font-mono">observed {fmt(r.observed_E_mm, 1)} mm</td><td>status <YesNo v={r.exceeded} /></td></tr>))}
          </tbody></table>
          <p className="text-xs text-muted mt-1">SACT probability given an ongoing event {fmt(s.probability_given_event, 5)} (p* = {fmt(s.p_star, 5)}). Threshold exceedance is historical: it does not mean a landslide will occur.</p></section>
        <section><h4 className="font-semibold text-accent">ML</h4>
          <p>{why.ml.model} score = <span className="font-mono">{fmt(why.ml.score, 4)}</span>; percentile among all cells that day = <span className="font-mono">{fmt(why.ml.percentile_among_cells_today, 3)}</span>; above its operating cut: <YesNo v={why.ml.above_operating_cut} />.</p>
          <p className="text-xs text-muted">{why.ml.output}.</p></section>
        <section><h4 className="font-semibold text-accent">Historical context</h4><p>{why.history.text}</p>
          {why.history.scope && <p className="text-xs text-muted">Scope: {why.history.scope}.</p>}</section>
        <p className="text-xs font-semibold border-t border-line pt-2">{why.caveat}</p>
      </div>
    </Card>
  );
}
