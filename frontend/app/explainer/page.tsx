"use client";
import { useEffect, useState } from "react";
import { Card, PageHead, Table } from "@/components/ui";
import { get } from "@/lib/api";

const STEPS = ["Landslide inventory (9,642 raw records, 13 sources)", "Data harmonisation (9,608 records, 1995-2025)", "Spatial block validation (1° blocks, 5 folds)",
  "GBM ensemble (XGBoost, LightGBM, CatBoost) = V0", "Process-informed features (TRIGRS P(FS<1), AHP index) = V1", "Source weighting = V2",
  "Monotonic constraints = V3", "Reporting-covariate adjustment (population, built-up fixed at national medians) = V4", "PIBE"];

export default function Explainer() {
  const [lad, setLad] = useState<any[]>([]);
  const [bias, setBias] = useState<any[]>([]);
  useEffect(() => { get("/api/tables/T_pibe_ladder").then(setLad).catch(() => null); get("/api/tables/T_bias_sensitivity").then(setBias).catch(() => null); }, []);
  return (
    <div className="space-y-4">
      <PageHead title="PIBE: process-informed, observation-bias-adjusted ensemble" sub="PIBE reduces the influence of heterogeneous reporting effort on the susceptibility ranking. It does not remove bias, and it is deliberately not the highest-scoring model against catalogue labels." />
      <div className="grid lg:grid-cols-[360px,1fr] gap-4">
        <Card title="Pipeline">
          <ol className="space-y-1">{STEPS.map((s, i) => <li key={s} className="text-sm"><div className="border border-line rounded px-2 py-1 bg-paper">{s}</div>{i < STEPS.length - 1 && <div className="text-center text-muted">↓</div>}</li>)}</ol>
        </Card>
        <div className="space-y-4">
          <Card title="What an inventory records">
            <p className="text-sm font-mono">observed inventory = physical susceptibility + triggering + reporting effort</p>
            <p className="text-sm mt-2">Catalogue landslides are reported where people and roads are. Population and built-up fraction are therefore used during training as descriptors of reporting effort and fixed at national medians for prediction. Built-up land is also a genuine conditioning factor through road cuts and construction, so the adjustment cannot separate reporting from anthropogenic predisposition exactly.</p>
          </Card>
          <Card title="Component ladder: spatial cross-validation and leave-one-region-out transfer"><Table rows={lad} cols={["variant", "AUC", "AP", "flat_top10", "LORO_NW Himalaya", "LORO_NE India", "LORO_Western Ghats", "LORO_mean"]} /></Card>
          <Card title="Reporting-covariate sensitivity"><Table rows={bias} cols={["variant", "AUC", "AP", "AUC_catalogue", "AUC_mapped", "flat_top10", "builtup_top10", "spearman_with_PIBE"]} />
            <p className="text-xs text-muted mt-2">High Spearman correlations among the adjusted variants show that the national ranking does not depend on which reporting covariate is fixed.</p></Card>
        </div>
      </div>
    </div>
  );
}
