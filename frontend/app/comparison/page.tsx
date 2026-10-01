"use client";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ErrorBar, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, PageHead, Status, Table } from "@/components/ui";
import { get } from "@/lib/api";

function CIChart({ rows, name, value, lo, hi, domain }: { rows: any[]; name: string; value: string; lo: string; hi: string; domain: [number, number] }) {
  const data = rows.filter((r) => r[value] !== null && r[value] !== undefined).map((r) => ({ name: r[name], v: r[value], e: [r[value] - (r[lo] ?? r[value]), (r[hi] ?? r[value]) - r[value]] }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 26)}>
      <BarChart data={data} layout="vertical" margin={{ left: 120 }}>
        <CartesianGrid stroke="#eee" /><XAxis type="number" domain={domain} fontSize={10} /><YAxis type="category" dataKey="name" fontSize={10} width={180} />
        <Tooltip /><Bar dataKey="v" fill="#a9acd3" name="Point estimate"><ErrorBar dataKey="e" width={4} strokeWidth={1.5} stroke="#2f2a6b" /></Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function Comparison() {
  const [c, setC] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { get("/api/comparison").then(setC).catch((e) => setErr(e.message)); }, []);
  if (!c) return <Status loading={!err} error={err} />;
  const ci = Object.fromEntries(c.T_threshold_ci.filter((r: any) => r.block === "cell").map((r: any) => [r.method, r]));
  const thr = c.T_threshold_skill.map((r: any) => ({ ...r, ...Object.fromEntries(Object.entries(ci[r.method] ?? {}).filter(([k]) => k !== "method")) }));
  const tk = Object.fromEntries(c.T_topk.map((r: any) => [r.model, r]));
  const susc = c.T_susc_cv.map((r: any) => ({ ...r, ...(tk[r.model] ?? {}) }));
  const ev = c.event_only;
  return (
    <div className="space-y-4">
      <PageHead title="Model comparison" sub="Point estimates with 95 % intervals from block bootstrap. Point estimates among the boosting models are similar and their differences fall within the reported uncertainty, so no model is ranked as definitively superior." />
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Susceptibility: AUC (spatial-block cross-validation, 95 % interval)"><CIChart rows={susc} name="model" value="AUC" lo="AUC_lo" hi="AUC_hi" domain={[0.7, 1]} /></Card>
        <Card title="Susceptibility: AP (95 % interval)"><CIChart rows={susc} name="model" value="AP" lo="AP_lo" hi="AP_hi" domain={[0, 0.8]} /></Card>
        <Card title="Rainfall triggering: TSS on the 2013-2025 holdout (cell-block 95 % interval)"><CIChart rows={thr} name="method" value="TSS" lo="TSS_lo" hi="TSS_hi" domain={[0, 0.7]} /></Card>
        <Card title="Rainfall triggering: POD at the 5 % alert budget (95 % interval)"><CIChart rows={thr} name="method" value="POD5" lo="POD5_lo" hi="POD5_hi" domain={[0, 0.6]} /></Card>
      </div>
      <Card title="Susceptibility metrics"><Table rows={susc} cols={["model", "AUC", "AUC_lo", "AUC_hi", "AP", "AP_lo", "AP_hi", "precision_top1", "recall_top5", "flat_top10"]} /></Card>
      <Card title="Susceptibility AUC against catalogue and mapped positives"><Table rows={c.T_susc_by_source} /></Card>
      <Card title="Rainfall triggering and ML nowcast metrics (2013-2025, dominated by 2013-2016 events)"><Table rows={thr} cols={["method", "TSS", "TSS_lo", "TSS_hi", "POD", "POFD", "alert_rate", "AUC", "AUC_lo", "AUC_hi", "POD5", "POD5_lo", "POD5_hi"]} /></Card>
      {ev && <Card title="All cell-days versus rainfall-event cell-days only"><Table rows={ev.rows.map((r: string[]) => Object.fromEntries(ev.header.map((h: string, i: number) => [h, r[i]])))} /><p className="text-xs text-muted mt-2">{ev.footnote}</p></Card>}
    </div>
  );
}
