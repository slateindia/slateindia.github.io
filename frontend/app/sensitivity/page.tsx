"use client";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend as RLegend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, PageHead, Status, Table } from "@/components/ui";
import { get } from "@/lib/api";

export default function Sensitivity() {
  const [c, setC] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { get("/api/comparison").then(setC).catch((e) => setErr(e.message)); }, []);
  if (!c) return <Status loading={!err} error={err} />;
  const groups: Record<string, any[]> = {};
  for (const r of c.T_sact_sensitivity) (groups[r.factor] ??= []).push({ ...r, label: String(r.value) });
  groups["Component ablation"] = c.T_sact_ablation.map((r: any) => ({ ...r, label: r[Object.keys(r)[0]], alert_rate: r.alert }));
  const chart = (rows: any[]) => (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={rows}><CartesianGrid stroke="#eee" /><XAxis dataKey="label" fontSize={10} /><YAxis fontSize={10} domain={[0, 1]} /><Tooltip /><RLegend wrapperStyle={{ fontSize: 10 }} />
        <Bar dataKey="TSS" fill="#7b7fb8" /><Bar dataKey="AUC" fill="#c3c6e0" /><Bar dataKey="POD5" name="POD at 5 % budget" fill="#2f2a6b" /></BarChart>
    </ResponsiveContainer>
  );
  return (
    <div className="space-y-4">
      <PageHead title="Sensitivity and uncertainty" sub="SACT sensitivity on the 2013-2025 holdout, PIBE reporting-covariate sensitivity and background-buffer sensitivity, all from the paper's outputs." />
      <div className="grid lg:grid-cols-2 gap-4">
        {Object.entries(groups).map(([k, rows]) => <Card key={k} title={`SACT: ${k}`}>{chart(rows)}</Card>)}
      </div>
      {c.sact_coefficients && <Card title={c.sact_coefficients.caption}><Table rows={c.sact_coefficients.rows.map((r: string[]) => Object.fromEntries(c.sact_coefficients.header.map((h: string, i: number) => [h, r[i]])))} /><p className="text-xs text-muted mt-2">{c.sact_coefficients.footnote}</p></Card>}
      <Card title="PIBE reporting-covariate sensitivity"><Table rows={c.T_bias_sensitivity} /></Card>
      <Card title="Background-buffer sensitivity (absolute AP depends on the buffer; model ranking is stable)"><Table rows={c.T_buffer_sensitivity} /></Card>
    </div>
  );
}
