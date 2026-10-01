"use client";
import { useEffect, useState } from "react";
import { Card, PageHead, Status } from "@/components/ui";
import { fmt, get } from "@/lib/api";

export default function Leakage() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { get("/api/tables/T_leakage_audit").then(setRows).catch((e) => setErr(e.message)); }, []);
  if (!rows) return <Status loading={!err} error={err} />;
  const arrow = (a: number, b: number) => (b < a - 0.005 ? "↓" : b > a + 0.005 ? "↑" : "→");
  return (
    <div className="space-y-4">
      <PageHead title="Leakage audit" sub="The same SACT and PI-GBM models driven by two susceptibility products: an all-period PIBE that had seen the 2013-2016 catalogue and the 2018 and 2023 inventories, and the frozen pre-2013 PIBE trained only on landslide records dated 2012 or earlier." />
      <div className="grid md:grid-cols-2 gap-4">
        {[["SACT", "SACT_fullperiod_S", "SACT_frozen_S"], ["PI-GBM", "PIGBM_fullperiod_S", "PIGBM_frozen_S"]].map(([m, a, b]) => (
          <Card key={m} title={`${m}: all-period S → frozen pre-2013 S`}>
            <table className="w-full text-sm">
              <tbody>{rows.map((r) => (
                <tr key={r.quantity} className="odd:bg-paper"><td className="py-1">{r.quantity}</td>
                  <td className="text-right font-mono">{fmt(r[a])}</td><td className="text-center text-lg">{arrow(r[a], r[b])}</td><td className="font-mono">{fmt(r[b])}</td>
                  <td className="w-40"><div className="h-2 bg-line rounded relative"><div className="absolute h-2 bg-[#c3c6e0] rounded" style={{ width: `${100 * Math.max(0, r[a])}%` }} /><div className="absolute h-2 bg-accent rounded" style={{ width: `${100 * Math.max(0, r[b])}%` }} /></div></td></tr>))}</tbody>
            </table>
          </Card>
        ))}
      </div>
      <Card title="Interpretation">
        <ul className="text-sm list-disc pl-4 space-y-1">
          <li>Spatial out-of-fold prediction alone did not prevent later landslide information from entering the susceptibility covariate.</li>
          <li>With the all-period S, SACT appeared markedly better, especially in the Kerala 2018 hindcast; with the frozen S the apparent benefit disappeared, showing that it was associated with later landslide information entering S.</li>
          <li>PI-GBM changed little, so its detection advantage does not depend on the leaky covariate.</li>
          <li>Label leakage controlled ≠ full historical hindcast: several predictor layers (for example WorldCover 2021 and WorldPop 2020) are current rather than reconstructed to 2012.</li>
        </ul>
      </Card>
    </div>
  );
}
