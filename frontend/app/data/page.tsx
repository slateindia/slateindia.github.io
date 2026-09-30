"use client";
import { useEffect, useState } from "react";
import { Card, KV, PageHead, Status } from "@/components/ui";
import { downloadUrl, get } from "@/lib/api";

export default function Data() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { get("/api/download").then(setD).catch((e) => setErr(e.message)); }, []);
  return (
    <div className="space-y-4">
      <PageHead title="Data & downloads" sub="Files of the archived data deposit (harmonised inventory, susceptibility grids as GeoTIFF, predictions, validation tables, figures). Only files that exist are listed." />
      <Status loading={!d && !err} error={err} />
      {d && !d.available && <Card><p className="text-sm">The data deposit is not installed on this server.</p></Card>}
      {d?.available && (
        <>
          <Card title="Metadata"><KV rows={Object.entries(d.metadata).map(([k, v]) => [k.replace(/_/g, " "), String(v)])} /></Card>
          <Card title="Files">
            {d.zenodo && <p className="text-xs text-muted mb-2">Full deposit, including code and the large cell-day tables: <a className="text-accent underline" href={d.zenodo}>{d.zenodo}</a></p>}
            <table className="text-xs w-full"><tbody>{d.files.map((f: any) => (
              <tr key={f.path} className="odd:bg-paper"><td className="py-1">{f.hosted === false ? <span>{f.path} <span className="text-muted">(Zenodo only)</span></span> : <a className="text-accent underline" href={downloadUrl(f.path)}>{f.path}</a>}</td><td className="text-right font-mono">{(f.bytes / 1e6).toFixed(2)} MB</td></tr>))}</tbody></table>
          </Card>
        </>
      )}
    </div>
  );
}
