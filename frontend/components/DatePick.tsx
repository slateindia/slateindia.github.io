"use client";
import { useEffect, useState } from "react";
import { get } from "@/lib/api";

/** Date input limited to the archived IMD record; never substitutes another date. */
export default function DatePick({ value, onChange }: { value: string; onChange: (d: string) => void }) {
  const [range, setRange] = useState<[string, string] | null>(null);
  useEffect(() => { get("/api/health").then((h) => setRange(h.rainfall_range)).catch(() => null); }, []);
  return (
    <label className="text-sm">Date{" "}
      <input type="date" className="field" value={value} min={range?.[0]} max={range?.[1]} onChange={(e) => onChange(e.target.value)} />
      {range && <span className="text-xs text-muted ml-2">IMD archive {range[0]} to {range[1]}</span>}
    </label>
  );
}
