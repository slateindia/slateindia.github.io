"use client";
import { Fragment, ReactNode, useEffect, useState } from "react";
import { dataUrl } from "@/lib/engine";

const base = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** Inline Markdown subset used by docs/USER_MANUAL.md: **bold**, *italic*, `code`, x^y, links. */
function md(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|(?<![\w*])\*[^*]+\*(?!\w)|https?:\/\/[^\s)]+|[\wα-ω*]\^[^\s()]+)/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(<b key={k++}>{t.slice(2, -2)}</b>);
    else if (t.startsWith("`")) out.push(<code key={k++} className="bg-paper px-1 rounded text-[0.85em]">{t.slice(1, -1)}</code>);
    else if (t.startsWith("http")) out.push(<a key={k++} className="text-accent underline" href={t}>{t}</a>);
    else if (t.includes("^")) { const [a, b] = t.split("^"); out.push(<Fragment key={k++}>{a}<sup>{b}</sup></Fragment>); }
    else out.push(<i key={k++}>{t.slice(1, -1)}</i>);
    last = m.index + t.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export default function Manual() {
  const [m, setM] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fetch(dataUrl("manual.json")).then((r) => r.json()).then(setM).catch((e) => setErr(String(e))); }, []);
  if (err) return <p className="text-sm">{err}</p>;
  if (!m) return <p className="text-sm text-muted">Loading the manual…</p>;
  const heads = m.blocks.filter((b: any) => b.t === "h2" || b.t === "h3");
  return (
    <div className="grid lg:grid-cols-[260px,1fr] gap-6">
      <aside className="lg:sticky lg:top-16 self-start bg-white border border-line rounded p-3 text-sm max-h-[80vh] overflow-auto">
        <a href={`${base}/SLATE_User_Manual.pdf`} download className="btn block text-center mb-3">Download PDF</a>
        <div className="font-semibold mb-1">Contents</div>
        {heads.map((h: any) => <a key={h.id} href={`#${h.id}`} className={`block py-0.5 hover:text-accent ${h.t === "h3" ? "pl-3 text-muted text-xs" : "font-medium"}`}>{h.text}</a>)}
      </aside>
      <article className="bg-white border border-line rounded p-6 max-w-4xl leading-relaxed">
        <img src={`${base}/brand/slate-logo-1200.png`} alt="SLATE logo" className="w-full max-w-[420px] mx-auto mb-4" />
        <h1 className="text-2xl font-semibold text-center mb-6">{m.title}</h1>
        {m.blocks.map((b: any, i: number) => {
          switch (b.t) {
            case "h2": return <h2 key={i} id={b.id} className="text-xl font-semibold text-accent mt-8 mb-3 scroll-mt-20">{b.text}</h2>;
            case "h3": return <h3 key={i} id={b.id} className="text-base font-semibold mt-5 mb-2 scroll-mt-20">{b.text}</h3>;
            case "p": return <p key={i} className="text-sm mb-3">{md(b.text)}</p>;
            case "ul": return <ul key={i} className="text-sm list-disc pl-6 mb-3 space-y-1">{b.items.map((x: string, j: number) => <li key={j}>{md(x)}</li>)}</ul>;
            case "ol": return <ol key={i} className="text-sm list-decimal pl-6 mb-3 space-y-1">{b.items.map((x: string, j: number) => <li key={j}>{md(x)}</li>)}</ol>;
            case "note": return <div key={i} className="text-sm border-l-4 border-accent bg-accent/5 text-accent px-3 py-2 rounded mb-3">{md(b.text)}</div>;
            case "eq": return <div key={i} className="text-sm italic text-center border border-line rounded py-3 px-2 mb-3 overflow-x-auto">{md(b.text)}</div>;
            case "table": return (
              <div key={i} className="overflow-x-auto mb-4"><table className="text-xs w-full border-collapse">
                <thead><tr>{b.header.map((h: string) => <th key={h} className="bg-accent text-white text-left px-2 py-1.5">{md(h)}</th>)}</tr></thead>
                <tbody>{b.rows.map((r: string[], j: number) => <tr key={j} className="odd:bg-paper">{r.map((c, q) => <td key={q} className="px-2 py-1.5 align-top border-b border-line">{md(c)}</td>)}</tr>)}</tbody>
              </table></div>);
          }
          return null;
        })}
      </article>
    </div>
  );
}
