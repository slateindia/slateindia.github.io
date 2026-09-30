"use client";
import { useEffect, useState } from "react";
import { Card, KV, PageHead, Status, Table } from "@/components/ui";
import { fmt, get, post } from "@/lib/api";

export default function Admin() {
  const [h, setH] = useState<any>(null);
  const [m, setM] = useState<any>(null);
  const [test, setTest] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { get("/api/health").then(setH).catch((e) => setErr(e.message)); get("/api/models").then(setM).catch(() => null); }, []);
  const testPrediction = () =>
    post("/api/nowcast/predict", { lat: 30.45, lon: 79.1, date: "2013-06-17", model: "pi_gbm" })
      .then((r) => setTest(r.installed ? `PI-GBM score ${fmt(r.score, 4)} at 30.45, 79.1 on 2013-06-17 (above operating cut: ${r.above_operating_cut})` : r.message))
      .catch((e) => setTest(e.message));
  return (
    <div className="space-y-4">
      <PageHead title="Admin (development only)" sub="Read-only view of installed artifacts. No filesystem controls are exposed." />
      <Status loading={!h && !err} error={err} />
      {h && (
        <>
          <Card title="Versions and providers"><KV rows={[["Application", h.manifest.application_version], ["Data", h.manifest.data_version], ["Models", h.manifest.model_version], ["Built", h.manifest.built],
            ["Rainfall provider", h.rainfall_provider], ["Rainfall coverage", h.rainfall_range?.join(" to ")], ["Live provider", `${h.live_provider.name}`]]} /></Card>
          <Card title="Artifacts"><Table rows={Object.entries(h.artifacts).map(([k, v]: any) => ({ artifact: k, installed: v.installed ? "yes" : "NOT INSTALLED", path: v.path, modified: v.modified ?? "" }))} /></Card>
        </>
      )}
      {m && <Card title="Nowcast models"><Table rows={m.nowcast.map((x: any) => ({ model: x.model_name, version: x.version ?? "", training: x.training_period ?? "", cut: x.operating_cut ?? "", "reproduction max |diff|": x.reproduction_check?.max_abs_diff_vs_paper_test_scores ?? "", status: x.status ?? "installed" }))} digits={5} /></Card>}
      <Card title="Checks">
        <button className="btn" onClick={testPrediction}>Test prediction</button>
        <p className="text-sm mt-2">{test}</p>
        <p className="text-xs text-muted mt-2">Full validation: run <code>pytest</code> in backend/ (regression against the paper's saved outputs) and <code>python scripts/build_artifacts.py</code> to rebuild and re-verify the models.</p>
      </Card>
    </div>
  );
}
