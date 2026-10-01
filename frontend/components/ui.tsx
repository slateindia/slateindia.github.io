"use client";
import { ReactNode, useState } from "react";
import { fmt } from "@/lib/api";

export const GLOSSARY: Record<string, string> = {
  A30: "Accumulated rainfall during the 30 days before the start of the ongoing rainfall event.",
  MAP: "Mean annual precipitation (IMD 1991-2025 climatology).",
  S: "Frozen pre-2013 susceptibility percentile used for the label-leakage-controlled triggering analysis (90th percentile of 0.05° scores in the IMD cell).",
  E: "Rainfall accumulated from the start of the ongoing rainfall event to the selected day.",
  D: "Duration of the ongoing rainfall event in days (0 when no event is ongoing). An event starts on a wet day (≥ 1 mm) and ends after 2 dry days.",
  TSS: "True skill statistic = probability of detection − probability of false detection.",
  POD5: "Probability of detection when about 5 % of calibration cell-days are on alert (the 5 % alert budget). Not a 5 % probability.",
  AUC: "Area under the ROC curve.",
  AP: "Average precision; its no-skill value equals the recorded-positive fraction.",
};

export function Tip({ term, children }: { term: string; children?: ReactNode }) {
  return (
    <span className="underline decoration-dotted cursor-help" title={GLOSSARY[term] ?? term}>
      {children ?? term}
    </span>
  );
}

export function Disclaimer({ strong = false }: { strong?: boolean }) {
  return strong ? (
    <div className="border border-accent/40 bg-accent/5 text-accent text-sm px-3 py-2 rounded">
      Experimental research framework - not an official warning. Research model output. Not an official landslide warning.
    </div>
  ) : (
    <p className="text-xs text-muted">Research model output. Not an official landslide warning.</p>
  );
}

export function Card({ title, children, className = "" }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`bg-white border border-line rounded p-4 ${className}`}>
      {title && <h3 className="text-sm font-semibold mb-2 text-ink">{title}</h3>}
      {children}
    </section>
  );
}

export function KV({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="font-mono text-right">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Generic table from records; numeric cells formatted to `digits`. */
export function Table({ rows, cols, digits = 3, labels = {} }: { rows: any[]; cols?: string[]; digits?: number; labels?: Record<string, string> }) {
  if (!rows?.length) return <p className="text-sm text-muted">No data.</p>;
  const c = cols ?? Object.keys(rows[0]);
  return (
    <div className="overflow-x-auto">
      <table className="text-xs w-full border-collapse">
        <thead>
          <tr>{c.map((k) => <th key={k} className="text-left font-semibold border-b border-line px-2 py-1 whitespace-nowrap">{labels[k] ?? k}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="odd:bg-paper">
              {c.map((k) => <td key={k} className={`px-2 py-1 whitespace-nowrap ${typeof r[k] === "number" ? "font-mono text-right" : ""}`}>{typeof r[k] === "number" ? fmt(r[k], digits) : String(r[k] ?? "")}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PageHead({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <header className="mb-4">
      <h1 className="text-xl font-semibold text-ink">{title}</h1>
      {sub && <p className="text-sm text-muted mt-1 max-w-4xl">{sub}</p>}
    </header>
  );
}

export function Status({ loading, error }: { loading?: boolean; error?: string | null }) {
  if (error) return <p className="text-sm text-[#8a2b2b]">{error}</p>;
  if (loading) return <p className="text-sm text-muted">Computing from the archived data…</p>;
  return null;
}

export function Drawer({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-line rounded bg-white">
      <button onClick={() => setOpen(!open)} className="w-full text-left text-sm px-3 py-2 font-medium">{open ? "▾" : "▸"} {label}</button>
      {open && <div className="px-3 pb-3 text-sm">{children}</div>}
    </div>
  );
}

export function YesNo({ v }: { v: boolean | null | undefined }) {
  if (v === null || v === undefined) return <span className="text-muted">n/a</span>;
  return <span className={v ? "font-semibold text-accent" : "text-muted"}>{v ? "YES" : "NO"}</span>;
}
