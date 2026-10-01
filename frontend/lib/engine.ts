/**
 * In-browser scientific engine (static deployment). Author: Kishan Tiwari.
 * A line-by-line port of backend/app/science.py and backend/app/main.py: same event definition, thresholds, SACT,
 * TRIGRS factor of safety and ML inference, computed from the exported data in /data. Verified against the Python
 * backend by scripts/verify_static.mjs. Research model output. Not an official landslide warning.
 */
export const DISCLAIMER = "Research model output. Not an official landslide warning.";
export const ML: Record<string, string> = { lr: "LR", rf: "RF", xgboost: "XGBoost", lightgbm: "LightGBM", catboost: "CatBoost", pi_gbm: "PI-GBM" };
const TIER1: Record<string, string> = { frequentist_ed: "Frequentist E-D (T5)", macumba: "MaCumBA-type I-D", sact: "SACT (event-conditional)" };
const CATS: Record<number, string> = { 1: "No rainfall threshold exceedance", 2: "Threshold exceeded, ML score below research cut",
  3: "Threshold exceeded and ML score above research cut", 4: "Threshold exceeded, ML score above cut, and High/Very high susceptibility" };
const WET = 1.0;

// ------------------------------------------------------------------ data access (fetch in the browser, fs in Node tests)
export type Loader = { json: (rel: string) => Promise<any>; bin: (rel: string, gz?: boolean) => Promise<ArrayBuffer> };
const base = (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_BASE_PATH) || "";
export const dataUrl = (rel: string) => `${base}/data/${rel}`;
let loader: Loader = {
  json: async (rel) => { const r = await fetch(dataUrl(rel)); if (!r.ok) throw new Error(`Missing data file ${rel}`); return r.json(); },
  bin: async (rel, gz) => {
    const r = await fetch(dataUrl(rel));
    if (!r.ok) throw new Error(`Missing data file ${rel}`);
    if (!gz) return r.arrayBuffer();
    return new Response(r.body!.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  },
};
export function setLoader(l: Loader) { loader = l; }
const memo = new Map<string, Promise<any>>();
const once = <T,>(k: string, f: () => Promise<T>): Promise<T> => { if (!memo.has(k)) memo.set(k, f().catch((e) => { memo.delete(k); throw e; })); return memo.get(k)!; };
const J = (rel: string) => once("j:" + rel, () => loader.json(rel));

class HttpError extends Error { constructor(public status: number, m: string) { super(m); } }

// ------------------------------------------------------------------ rainfall archive
type RainIndex = { start: string; end: string; ncell: number; months: [string, number, number][] };
const rainIndex = () => J("rain/index.json") as Promise<RainIndex>;
const DAY = 86400000;
function dayIndex(ix: RainIndex, date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const t = Math.round((Date.parse(date + "T00:00:00Z") - Date.parse(ix.start + "T00:00:00Z")) / DAY);
  const n = ix.months[ix.months.length - 1][1] + ix.months[ix.months.length - 1][2];
  return t >= 0 && t < n ? t : null;
}
const isoDay = (ix: RainIndex, t: number) => new Date(Date.parse(ix.start + "T00:00:00Z") + t * DAY).toISOString().slice(0, 10);
function monthOf(ix: RainIndex, t: number) { let lo = 0, hi = ix.months.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ix.months[m][1] <= t) lo = m; else hi = m - 1; } return lo; }
const monthRain = (name: string) => once("r:" + name, async () => new Float32Array(await loader.bin(`rain/${name}.bin.gz`, true)));
const monthState = (name: string) => once("s:" + name, async () => new Uint16Array(await loader.bin(`rain/${name}.state.bin`)));

/** Rain rows for days t0..t1 (inclusive): row(t) returns Float32Array over all IMD cells. */
async function rainRows(ix: RainIndex, t0: number, t1: number) {
  const m0 = monthOf(ix, Math.max(t0, 0)), m1 = monthOf(ix, t1);
  const arr: Float32Array[] = await Promise.all(ix.months.slice(m0, m1 + 1).map(([n]) => monthRain(n)));
  const nc = ix.ncell;
  return (t: number) => { const m = monthOf(ix, t) - m0; const k = t - ix.months[m + m0][1]; return arr[m].subarray(k * nc, (k + 1) * nc); };
}

// ------------------------------------------------------------------ static inputs
type Cells = { cell: number[]; lat: number[]; lon: number[]; state: string[]; map_mm: number[]; rl25_1d: number[]; rl25_3d: number[]; slope_rep: number[];
  sand: number[]; clay: number[]; S: number[]; pibe_p90: (number | null)[]; Ks: number[]; Zbeta: number[]; fsA: number[]; c: number[]; tphi: number[]; den: number[]; kernel: number[][] };
const cellsP = () => J("static/cells.json") as Promise<Cells>;
const params = () => J("api/threshold_params.json");

// ------------------------------------------------------------------ daily features for every domain cell (science.features)
export type Day = Record<string, Float64Array> & { cellIdx: Int32Array };
async function dayFeatures(date: string): Promise<{ t: number; f: Record<string, Float64Array>; C: Cells }> {
  const ix = await rainIndex();
  const t = dayIndex(ix, date);
  if (t === null) throw new HttpError(404, `Rainfall data not available for ${date}; the archive covers ${ix.start} to ${ix.end}. No substitute date is used.`);
  const C = await cellsP();
  const n = C.cell.length, nc = ix.ncell;
  // event state from the stored state at the start of the month, then the same update rules as running_event
  const mi = monthOf(ix, t), [mname, k0] = ix.months[mi];
  const st = await monthState(mname);
  const rowsM = await rainRows(ix, k0, t);
  const D = { 2: new Float64Array(n), 1: new Float64Array(n) } as Record<number, Float64Array>;
  for (const [gi, gap] of [[0, 2], [1, 1]] as const) {
    for (let j = 0; j < n; j++) {
      const c = C.cell[j];
      let d = st[(gi * 3) * nc + c], dry = st[(gi * 3 + 1) * nc + c], active = st[(gi * 3 + 2) * nc + c] === 1;
      for (let k = k0; k <= t; k++) {
        const w = rowsM(k)[c] >= WET;
        if (w && !active) d = 0;
        if (w) active = true;
        dry = w ? 0 : active ? dry + 1 : dry;
        if (!w && dry >= gap) active = false;
        if (active) d += 1;
      }
      D[gap][j] = active ? d : 0;
    }
  }
  let first = t - 59;
  for (let j = 0; j < n; j++) first = Math.min(first, t - Math.max(D[2][j], 1) + 1 - 60, t - Math.max(D[1][j], 1) + 1);
  const R = await rainRows(ix, Math.max(first, 0), t);
  const f: Record<string, Float64Array> = {};
  const mk = (k: string) => (f[k] = new Float64Array(n));
  ["R0", "R1", "A3", "A7", "A15", "A30", "A60", "maxR3", "E", "D", "ant15", "ant30", "ant60", "FS", "E_G1", "D_G1", "doy_s", "doy_c",
    "map_mm", "rl25_1d", "rl25_3d", "slope_rep", "sand", "clay", "S", "E_rl3", "R0_rl1"].forEach(mk);
  const doy = Math.round((Date.parse(date + "T00:00:00Z") - Date.parse(date.slice(0, 4) + "-01-01T00:00:00Z")) / DAY) + 1;
  const sum = (c: number, a: number, b: number) => { let s = 0; for (let k = Math.max(a, 0); k <= b; k++) s += R(k)[c]; return s; };
  for (let j = 0; j < n; j++) {
    const c = C.cell[j];
    const r = (k: number) => (k >= 0 ? R(k)[c] : 0);
    f.R0[j] = r(t); f.R1[j] = t > 0 ? r(t - 1) : 0;
    for (const w of [3, 7, 15, 30, 60]) f["A" + w][j] = sum(c, t - w + 1, t);
    f.maxR3[j] = Math.max(r(t), t >= 1 ? r(t - 1) : -Infinity, t >= 2 ? r(t - 2) : -Infinity);
    for (const [gap, Ek, Dk] of [[2, "E", "D"], [1, "E_G1", "D_G1"]] as const) {
      const d = D[gap][j];
      f[Dk][j] = d;
      let e = 0; if (d > 0) for (let k = t - d + 1; k <= t; k++) e += r(k);
      f[Ek][j] = e;
    }
    const start = t - Math.max(f.D[j], 1) + 1;
    for (const w of [15, 30, 60]) f["ant" + w][j] = sum(c, start - w, start - 1);
    // TRIGRS FS: psi = sum_j I[t-j] g[j] (30-day memory), capped at Z*beta
    let psi = 0; const g = C.kernel[j], Ks = C.Ks[j];
    for (let q = 0; q < 30 && t - q >= 0; q++) psi += (Math.min(r(t - q) / 1000.0 / 86400.0, Ks) / Ks) * g[q];
    psi = Math.min(psi, C.Zbeta[j]);
    f.FS[j] = C.fsA[j] + (C.c[j] - psi * 9.81 * C.tphi[j]) / C.den[j];
    f.doy_s[j] = Math.sin((2 * Math.PI * doy) / 365.25); f.doy_c[j] = Math.cos((2 * Math.PI * doy) / 365.25);
    for (const k of ["map_mm", "rl25_1d", "rl25_3d", "slope_rep", "sand", "clay", "S"] as const) f[k][j] = (C as any)[k][j] ?? NaN;
    f.E_rl3[j] = f.E[j] / f.rl25_3d[j]; f.R0_rl1[j] = f.R0[j] / f.rl25_1d[j];
  }
  return { t, f, C };
}

// ------------------------------------------------------------------ thresholds (science.py)
const pubMargin = (E: number, D: number, a: number, b: number) => { if (D <= 0) return -Infinity; const Dh = 24 * Math.max(D, 1); return Math.log(Math.max(E / Dh, 1e-6) / (a * Dh ** b)); };
const freqMargin = (E: number, D: number, p: any) => (D > 0 ? Math.log(Math.max(E, 1e-6) / (p.alpha * Math.max(D, 1) ** p.beta)) : -Infinity);
const macMargin = (E1: number, D1: number, p: any) => (D1 > 0 ? Math.log10(Math.max(E1 / Math.max(D1, 1), 1e-6)) - Math.log10(p.alpha) - p.beta * Math.log10(Math.max(D1, 1)) : -Infinity);
function sactProb(E: number, D: number, A: number, M: number, S: number, p: any) {
  if (D <= 0) return 0;
  const x = p.b0 + p.bE * Math.log(Math.max(E, 0.1)) + p.bD * Math.log(Math.max(D, 1)) + p.bA * Math.log1p(A / p.A0_mm) + p.bMAP * Math.log(M / p.M0_mm) + p.bS * S;
  return 1 / (1 + Math.exp(-x));
}
const sactE = (D: number, A: number, M: number, S: number, p: any) =>
  p.E0_mm * Math.exp(p.ln_alpha) * Math.max(D, 1) ** p.beta_D * (1 + A / p.A0_mm) ** p.gamma_A * (M / p.M0_mm) ** p.delta_MAP * Math.exp(p.eps_S * S);

// ------------------------------------------------------------------ ML inference (exported estimators)
const f32 = Math.fround;
export function predictEstimator(e: any, x: number[]): number {
  if (!e._f32) {  // XGBoost and CatBoost store split values and leaves as float32: compare in float32 exactly as they do
    if (e.type === "xgb") for (const tr of e.trees) tr.t = Float32Array.from(tr.t);
    if (e.type === "catboost") for (const tr of e.trees) tr.b = Float32Array.from(tr.b);
    e._f32 = true;
  }
  switch (e.type) {
    case "xgb": {
      let m = 0;
      for (const tr of e.trees) { let i = 0; while (tr.l[i] !== -1) i = f32(x[tr.f[i]]) < tr.t[i] ? tr.l[i] : tr.r[i]; m = f32(m + tr.t[i]); }
      const bm = f32(Math.log(e.base_score / (1 - e.base_score)));
      return f32(1 / (1 + Math.exp(-f32(m + bm))));
    }
    case "lgbm": {
      let s = 0;
      for (const tr of e.trees) { let i = 0; while (tr.l[i] !== -1) i = x[tr.f[i]] <= tr.t[i] ? tr.l[i] : tr.r[i]; s += tr.v[i]; }
      return 1 / (1 + Math.exp(-s));
    }
    case "catboost": {
      let s = 0;
      for (const tr of e.trees) { let idx = 0; for (let k = 0; k < tr.f.length; k++) if (f32(x[tr.f[k]]) > tr.b[k]) idx |= 1 << k; s += tr.v[idx]; }
      return 1 / (1 + Math.exp(-(e.scale * s + e.bias)));
    }
    case "rf": {
      let s = 0;
      for (const tr of e.trees) { let i = 0; while (tr.l[i] !== -1) i = f32(x[tr.f[i]]) <= tr.t[i] ? tr.l[i] : tr.r[i]; s += tr.p[i]; }
      return s / e.trees.length;
    }
    case "lr": {
      let z = e.intercept;
      for (let k = 0; k < x.length; k++) z += ((x[k] - e.mean[k]) / e.scale[k]) * e.coef[k];
      return 1 / (1 + Math.exp(-z));
    }
  }
  throw new Error("unknown estimator " + e.type);
}
const modelP = (slug: string) => J(`models/${slug}.json`);
async function scoreModel(slug: string, f: Record<string, Float64Array>, n: number) {
  const m = await modelP(slug);
  const out = new Float64Array(n);
  const P = m.meta.predictors as string[];
  for (let j = 0; j < n; j++) {
    const x = P.map((k) => { const v = f[k][j]; return Number.isFinite(v) ? v : 0; });   // fillna(0) as in the paper
    let s = 0; for (const e of m.estimators) s += predictEstimator(e, x);
    out[j] = s / m.estimators.length;
  }
  return out;
}

// ------------------------------------------------------------------ day state (main.day_state)
const dayCache = new Map<string, Promise<any>>();
async function dayState(date: string, models: string[] = []) {
  const key = date;
  if (!dayCache.has(key)) dayCache.set(key, (async () => {
    const { t, f, C } = await dayFeatures(date);
    const p = await params();
    const n = C.cell.length;
    const s: any = { t, f, C, n, ml: {} as Record<string, Promise<Float64Array>> };
    s.freq = Float64Array.from({ length: n }, (_, j) => freqMargin(f.E[j], f.D[j], p.frequentist_ed));
    s.mac = Float64Array.from({ length: n }, (_, j) => macMargin(f.E_G1[j], f.D_G1[j], p.macumba));
    s.sact = Float64Array.from({ length: n }, (_, j) => sactProb(f.E[j], f.D[j], f.ant30[j], f.map_mm[j], f.S[j], p.sact));
    s.t1 = { frequentist_ed: Array.from(s.freq, (v: number) => v >= 0), macumba: Array.from(s.mac, (v: number) => v >= 0), sact: Array.from(s.sact, (v: number) => v >= p.sact.p_star) };
    return s;
  })().catch((e) => { dayCache.delete(key); throw e; }));
  const s = await dayCache.get(key)!;
  for (const m of models) if (!s.ml[m]) s.ml[m] = scoreModel(m, s.f, s.n);
  for (const m of models) s[`ml_${m}`] = await s.ml[m];
  return s;
}
export const _dayState = dayState; // for verification

function inSampleNote(date: string) {
  const y = +date.slice(0, 4);
  if (y >= 2007 && y <= 2012) return "Date lies in the 2007-2012 calibration period: ML and SACT outputs are in-sample.";
  if (y >= 2017) return "Date lies after the 2016 end of the main dated catalogue (NASA GLC); no catalogue evaluation exists for it.";
  return null;
}
async function cellIndex(lat: number, lon: number) {
  const C = await cellsP();
  for (let j = 0; j < C.cell.length; j++) if (Math.abs(C.lat[j] - lat) <= 0.125 && Math.abs(C.lon[j] - lon) <= 0.125) return j;
  return -1;
}
function geo(s: any, props: (j: number) => any) {
  const C = s.C as Cells;
  return { type: "FeatureCollection", features: C.cell.map((c, j) => { const x = C.lon[j], y = C.lat[j];
    return { type: "Feature", id: c, properties: props(j), geometry: { type: "Polygon", coordinates: [[[x - .125, y - .125], [x + .125, y - .125], [x + .125, y + .125], [x - .125, y + .125], [x - .125, y - .125]]] } }; }) };
}
const fin = (v: number) => (Number.isFinite(v) ? v : null);

// ------------------------------------------------------------------ endpoint implementations
function evaluate(x: any, p: any) {
  const res: any = {};
  const Dm = Math.max(x.D, 1);
  for (const [name, q] of Object.entries<any>(p.published)) {
    const mg = pubMargin(x.E, x.D, q.a, q.b);
    res[name] = { exceeded: mg >= 0, log_margin: fin(mg), threshold_E_mm: q.a * (24 * Dm) ** q.b * 24 * Dm };
  }
  const fm = freqMargin(x.E, x.D, p.frequentist_ed);
  res["Frequentist E-D (T5)"] = { exceeded: fm >= 0, log_margin: fin(fm), threshold_E_mm: p.frequentist_ed.alpha * Dm ** p.frequentist_ed.beta };
  const E1 = x.E_G1 ?? x.E, D1 = x.D_G1 ?? x.D;
  const mm = macMargin(E1, D1, p.macumba);
  res["MaCumBA-type I-D"] = { exceeded: mm >= 0, log10_margin: fin(mm), threshold_E_mm: p.macumba.alpha * Math.max(D1, 1) ** p.macumba.beta * Math.max(D1, 1) };
  const pr = sactProb(x.E, x.D, x.A30, x.MAP, x.S, p.sact);
  res["SACT (event-conditional)"] = { exceeded: pr >= p.sact.p_star, probability_given_event: pr, p_star: p.sact.p_star,
    threshold_E_mm: x.D > 0 ? sactE(x.D, x.A30, x.MAP, x.S, p.sact) : null,
    note: "Zero outside rainfall events; the S term is statistically unsupported (coefficient interval spans zero)." };
  for (const v of Object.values<any>(res)) if (v.threshold_E_mm && x.D > 0) v.margin_mm = x.E - v.threshold_E_mm;
  return { in_event: x.D > 0, results: res, disclaimer: DISCLAIMER,
    interpretation: "Historical threshold exceedance indicates rainfall conditions associated with past landslide occurrence; it does not mean a landslide will occur." };
}

async function thresholdGet(lat: number, lon: number, date: string) {
  const s = await dayState(date);
  const j = await cellIndex(lat, lon);
  if (j < 0) return { available: false, message: "Insufficient model/data coverage for this location." };
  const f = s.f, p = await params();
  const out: any = evaluate({ E: f.E[j], D: f.D[j], A30: f.ant30[j], MAP: f.map_mm[j], S: f.S[j], E_G1: f.E_G1[j], D_G1: f.D_G1[j] }, p);
  return { ...out, available: true, date, cell: s.C.cell[j], cell_lat: s.C.lat[j], cell_lon: s.C.lon[j], state: s.C.state[j],
    inputs: { R0: f.R0[j], R1: f.R1[j], E: f.E[j], D: f.D[j], A30: f.ant30[j], MAP: f.map_mm[j], S: f.S[j] }, note: inSampleNote(date), _j: j };
}

async function suscCell(lat: number, lon: number) {
  const L = await J("api/susceptibility_layers.json");
  const meta = await J("susc/cells_meta.json");
  const r = Math.floor((L.north - lat) / L.res), c = Math.floor((lon - L.west) / L.res);
  const la = L.north - L.res * (r + 0.5), lo = L.west + L.res * (c + 0.5);
  const key = `${Math.floor(la)}_${Math.floor(lo)}`;
  let buf: ArrayBuffer;
  try { buf = await once("sc:" + key, () => loader.bin(`susc/cells/${key}.bin`)); } catch { return { available: false, message: "Insufficient model/data coverage for this location." }; }
  const M = new Float64Array(buf), nc = meta.columns.length;
  const col = (name: string) => meta.columns.indexOf(name);
  for (let i = 0; i < M.length / nc; i++) {
    const row = M.subarray(i * nc, (i + 1) * nc);
    if (row[col("row")] !== r || row[col("col")] !== c) continue;
    const code = (k: string) => meta.dicts[k][row[col("code:" + k)]];
    const scores: any = {};
    for (const l of L.layers) { const v = row[col("score:" + l.id)]; if (Number.isFinite(v)) scores[l.id] = { label: l.label, score: v, percentile: row[col("pct:" + l.id)], kind: l.kind }; }
    return { available: true, cell_id: row[col("cell_id")], lat: row[col("lat")], lon: row[col("lon")], state: code("state"), pibe_class: code("susc_class"),
      pibe_percentile: row[col("pibe_pct")], flat_terrain: row[col("slope_max")] < 10, recorded_positive: row[col("y")] === 1,
      record_source: code("src") || null, lithology: code("lith_group") || null, scores, district: null,
      predictors: Object.fromEntries(meta.predictors.map((k: string) => [k, fin(row[col(k)])])),
      explanation: { available: false, message: "Per-cell feature contributions are not available for this model artifact; see global SHAP importance." },
      uncertainty: "Spatial uncertainty surface not available for this model artifact." };
  }
  return { available: false, message: "Insufficient model/data coverage for this location." };
}

async function rainfall(lat: number, lon: number, date: string, days: number) {
  const ix = await rainIndex();
  const t = dayIndex(ix, date);
  if (t === null) throw new HttpError(404, `Rainfall data not available for ${date}; the archive covers ${ix.start} to ${ix.end}. No substitute date is used.`);
  const j = await cellIndex(lat, lon);
  if (j < 0) return { available: false, message: "Insufficient model/data coverage for this location." };
  const C = await cellsP();
  const t0 = Math.max(0, t - days + 1);
  // E, D for each day of the window from the same event engine
  const series = { date: [] as string[], rain: [] as number[], E: [] as number[], D: [] as number[] };
  const R = await rainRows(ix, t0, t);
  for (let k = t0; k <= t; k++) {
    const d = await dayFeaturesCell(isoDay(ix, k), j);
    series.date.push(isoDay(ix, k)); series.rain.push(Math.round(R(k)[C.cell[j]] * 100) / 100); series.E.push(Math.round(d.E * 100) / 100); series.D.push(d.D);
  }
  return { available: true, cell: C.cell[j], cell_lat: C.lat[j], cell_lon: C.lon[j], state: C.state[j], series, source: ix && (await J("rain/index.json")).source };
}
/** E and D for one cell on one day (runs the event state machine for that cell only). */
async function dayFeaturesCell(date: string, j: number) {
  const ix = await rainIndex(); const t = dayIndex(ix, date)!; const C = await cellsP(); const c = C.cell[j], nc = ix.ncell;
  const [mname, k0] = ix.months[monthOf(ix, t)]; const st = await monthState(mname); const R = await rainRows(ix, k0, t);
  let d = st[c], dry = st[nc + c], active = st[2 * nc + c] === 1;
  for (let k = k0; k <= t; k++) { const w = R(k)[c] >= WET; if (w && !active) d = 0; if (w) active = true; dry = w ? 0 : active ? dry + 1 : dry; if (!w && dry >= 2) active = false; if (active) d += 1; }
  const D = active ? d : 0; let E = 0;
  if (D > 0) { const R2 = await rainRows(ix, t - D + 1, t); for (let k = t - D + 1; k <= t; k++) E += R2(k)[c]; }
  return { E, D };
}

async function twoTierCats(s: any, tier1: string, model: string) {
  const meta = (await modelP(model)).meta;
  const sc = s[`ml_${model}`] as Float64Array;
  return Array.from({ length: s.n }, (_, j) => {
    const t1 = s.t1[tier1][j], t2 = sc[j] >= meta.operating_cut, hi = (s.C.pibe_p90[j] ?? NaN) >= 0.9;
    return { cat: !t1 ? 1 : !t2 ? 2 : !hi ? 3 : 4, t1, t2, hi };
  });
}

// ------------------------------------------------------------------ "Why does this cell have this result?"
export const LABELS: Record<string, string> = {
  elev_mean: "mean elevation", relief: "relief", slope_mean: "mean slope", slope_std: "slope variability", slope_max: "maximum slope",
  steep25: "share of slopes > 25°", steep35: "share of slopes > 35°", curv_abs: "curvature", northness: "northness", relief01_mean: "local relief",
  map_mm: "mean annual precipitation", max1d_mm: "mean annual max 1-day rainfall", max3d_mm: "mean annual max 3-day rainfall",
  rl25_1d: "25-yr 1-day rainfall", rl25_3d: "25-yr 3-day rainfall", r50_days: "days ≥ 50 mm per year", jjas_frac: "monsoon share of rainfall",
  cv_annual: "inter-annual rainfall variability", sand: "sand", clay: "clay", silt: "silt", bdod: "bulk density", soc: "soil organic carbon",
  cfvo: "coarse fragments", lc_tree: "tree cover", lc_shrub: "shrub cover", lc_grass: "grassland", lc_crop: "cropland", lc_built: "built-up (fixed at median)",
  lc_bare: "bare ground", lc_snow: "snow/ice", dist_fault_km: "distance to active fault", eq_density: "earthquake density", dist_m6_km: "distance to M ≥ 6 epicentre",
  age_ma: "stratigraphic age", fs_trigrs_p: "TRIGRS failure probability", ahp_index: "AHP index", log_pop: "population (fixed at median)",
  lith_cenozoic_sed: "lithology: Cenozoic sedimentary", lith_older_sed: "lithology: older sedimentary", lith_metamorphic: "lithology: metamorphic",
  lith_volcanic: "lithology: volcanic", lith_volc_sed: "lithology: volcano-sedimentary", lith_intrusive: "lithology: intrusive", lith_other: "lithology: other",
};
const CAVEAT = "Important: feature contributions describe model behaviour and should not be interpreted as proof of physical causation.";

async function whySusceptibility(lat: number, lon: number) {
  const L = await J("api/susceptibility_layers.json");
  const meta = await J("why/shap_meta.json");
  const r = Math.floor((L.north - lat) / L.res), c = Math.floor((lon - L.west) / L.res);
  const key = `${Math.floor(L.north - L.res * (r + 0.5))}_${Math.floor(L.west + L.res * (c + 0.5))}`;
  let buf: ArrayBuffer;
  try { buf = await once("why:" + key, () => loader.bin(`why/shap/${key}.bin`)); } catch { return { available: false }; }
  const nf = meta.n_features, w = 3 + 2 * nf, M = new Float32Array(buf);
  for (let i = 0; i < M.length / w; i++) {
    if (M[i * w] !== r || M[i * w + 1] !== c) continue;
    const contrib = Array.from(M.subarray(i * w + 2, i * w + 2 + nf)), base = M[i * w + 2 + nf], val = Array.from(M.subarray(i * w + 3 + nf, i * w + 3 + 2 * nf));
    const feats = meta.features.map((f: string, k: number) => ({ feature: f, label: LABELS[f] ?? f, group: meta.groups[k], value: val[k], contribution: contrib[k] }));
    const ranked = [...feats].sort((a, b) => b.contribution - a.contribution);
    const groups: Record<string, number> = {};
    feats.forEach((f: any) => (groups[f.group] = (groups[f.group] ?? 0) + f.contribution));
    return { available: true, base_log_odds: base, total_log_odds: base + contrib.reduce((a, b) => a + b, 0),
      raising: ranked.filter((f) => f.contribution > 0).slice(0, 5), lowering: ranked.filter((f) => f.contribution < 0).slice(-3).reverse(),
      groups: Object.entries(groups).map(([group, contribution]) => ({ group, contribution })).sort((a, b) => b.contribution - a.contribution),
      method: meta.method, caveat: CAVEAT };
  }
  return { available: false };
}

async function history(E: number, D: number, cellId: number) {
  const h = await J("why/history.json");
  if (D <= 0) return { in_event: false, text: `No rainfall event was ongoing. In the paper's monitored cell-days, ${h.no_event_landslides} of ${h.total_landslides} recorded landslide days also fell outside a rainfall event, which event-based thresholds cannot flag.` };
  const bin = (edges: number[], v: number) => { let i = 0; while (i + 1 < edges.length && v >= edges[i + 1]) i++; return i; };
  const ei = bin(h.E_edges, E), di = bin(h.D_edges, D);
  const eLo = h.E_edges[ei], eHi = h.E_edges[ei + 1], dLo = h.D_edges[di], dHi = h.D_edges[di + 1];
  const n = h.n[ei][di], k = h.landslides[ei][di];
  const ci = h.cell_exceed.cells.indexOf(cellId);
  const cellDays = ci >= 0 ? h.cell_exceed.counts[ci][ei] : null;
  return { in_event: true, E_range: [eLo, eHi ?? null], D_range: [dLo, dHi ? dHi - 1 : null], similar_days: n, similar_landslide_days: k,
    rate: n ? k / n : null, overall_rate: h.total_event_landslides / h.total_event_days, scope: h.scope,
    cell_days_at_or_above: cellDays, cell_record_days: h.cell_exceed.days,
    text: `Similar event conditions (E ${eLo}${eHi ? `-${eHi}` : "+"} mm, D ${dLo}${dHi ? `-${dHi - 1}` : "+"} days) occurred on ${n.toLocaleString()} monitored cell-days in 2007-2025, ` +
      `of which ${k} had a recorded landslide (${n ? ((100 * k) / n).toFixed(2) : "n/a"} %, against ${((100 * h.total_event_landslides) / h.total_event_days).toFixed(2)} % for all event cell-days).` +
      (cellDays !== null ? ` At this rainfall cell, event rainfall of at least ${eLo} mm occurred on ${cellDays.toLocaleString()} of ${h.cell_exceed.days.toLocaleString()} days in 1991-2025.` : "") };
}

// ------------------------------------------------------------------ router (same paths and shapes as the FastAPI backend)
export async function route(path: string, q: Record<string, any> = {}, body?: any): Promise<any> {
  const num = (k: string) => { const v = Number(q[k]); if (!Number.isFinite(v)) throw new HttpError(422, `Invalid ${k}`); return v; };
  const need = (m: string) => { if (!(m in ML)) throw new HttpError(404, `Unknown nowcast model ${m}`); return m; };
  if (path === "/api/health") return J("api/health.json");
  if (path === "/api/models") return J("api/models.json");
  if (path.startsWith("/api/model-metadata/")) return J(`api/model-metadata/${path.split("/").pop()}.json`).catch(() => { throw new HttpError(404, "Unknown model"); });
  if (path === "/api/susceptibility/layers") return J("api/susceptibility_layers.json");
  if (path === "/api/susceptibility/shap") return J("api/susceptibility_shap.json");
  if (path === "/api/susceptibility/cell") return suscCell(num("lat"), num("lon"));
  if (path === "/api/why/susceptibility") return whySusceptibility(num("lat"), num("lon"));
  if (path === "/api/rainfall") return rainfall(num("lat"), num("lon"), q.date, Math.min(365, Math.max(7, Number(q.days ?? 60))));
  if (path === "/api/threshold/curves") {
    const p = await params(); const A = Number(q.A30 ?? 0), M = Number(q.MAP ?? 2000), S = Number(q.S ?? 0.5);
    const D = Array.from({ length: 60 }, (_, i) => i + 1); const out: any = { D };
    for (const [name, v] of Object.entries<any>(p.published)) out[name] = D.map((d) => v.a * (24 * d) ** v.b * 24 * d);
    out["Frequentist E-D (T5)"] = D.map((d) => p.frequentist_ed.alpha * d ** p.frequentist_ed.beta);
    out["MaCumBA-type I-D (G = 1)"] = D.map((d) => p.macumba.alpha * d ** p.macumba.beta * d);
    out["SACT (event-conditional)"] = D.map((d) => sactE(d, A, M, S, p.sact));
    return { curves: out, inputs: { A30: A, MAP: M, S }, note: "E-D space (event rainfall in mm vs duration in days). Published I-D curves converted with I = E/(24 D). The MaCumBA-type curve uses its own event definition (G = 1)." };
  }
  if (path === "/api/threshold/evaluate" && body) {
    for (const k of ["E", "D", "A30", "MAP", "S"]) if (!Number.isFinite(body[k]) || body[k] < 0) throw new HttpError(422, `Invalid ${k}`);
    if (body.MAP <= 0 || body.S > 1) throw new HttpError(422, "Invalid MAP or S (S must be 0-1)");
    return evaluate(body, await params());
  }
  if (path === "/api/threshold/evaluate") { const r: any = await thresholdGet(num("lat"), num("lon"), q.date); delete r._j; return r; }
  if (path === "/api/nowcast/map") {
    const model = need(q.model ?? "pi_gbm"), mode = q.mode ?? "operating";
    const meta = (await modelP(model)).meta; const s = await dayState(q.date, [model]); const sc = s[`ml_${model}`] as Float64Array;
    const cut = mode === "operating" ? meta.operating_cut : meta.cut5;
    const alert = Array.from(sc, (v) => v >= cut); const sorted = Array.from(sc).sort((a, b) => a - b);
    const qt = (p: number) => { const h = (sorted.length - 1) * p, lo = Math.floor(h); return sorted[lo] + (h - lo) * ((sorted[lo + 1] ?? sorted[lo]) - sorted[lo]); };
    return { installed: true, model: meta.model_name, date: q.date, mode, cut,
      cut_definition: mode === "operating" ? meta.operating_cut_method : meta.cut5_method + " (the paper's 5 % alert budget; about 5 % of calibration cell-days, not a 5 % probability)",
      n_cells: s.n, n_alerted: alert.filter(Boolean).length, alerted_share: alert.filter(Boolean).length / s.n,
      score_stats: { min: sorted[0], median: qt(0.5), p95: qt(0.95), max: sorted[sorted.length - 1] }, output: meta.output, note: inSampleNote(q.date), disclaimer: DISCLAIMER,
      geojson: geo(s, (j) => ({ score: sc[j], alert: alert[j], state: s.C.state[j], R0: s.f.R0[j] })) };
  }
  if (path === "/api/nowcast/predict" && body) {
    const model = need(body.model ?? "pi_gbm"); const meta = (await modelP(model)).meta;
    const s = await dayState(body.date, [model]); const j = await cellIndex(body.lat, body.lon);
    if (j < 0) return { available: false, message: "Insufficient model/data coverage for this location." };
    const sc = s[`ml_${model}`] as Float64Array; const v = sc[j];
    return { available: true, installed: true, model: meta.model_name, score: v, percentile_among_cells_today: Array.from(sc).filter((x) => x <= v).length / s.n,
      above_operating_cut: v >= meta.operating_cut, above_5pct_budget_cut: v >= meta.cut5, metadata: meta, note: inSampleNote(body.date), disclaimer: DISCLAIMER };
  }
  if (path === "/api/twotier/map") {
    const tier1 = q.tier1 ?? "frequentist_ed", model = need(q.model ?? "pi_gbm");
    if (!(tier1 in TIER1)) throw new HttpError(404, "Unknown method");
    const s = await dayState(q.date, [model]); const cats = await twoTierCats(s, tier1, model); const sc = s[`ml_${model}`];
    const counts: any = { 1: 0, 2: 0, 3: 0, 4: 0 }; cats.forEach((c) => counts[c.cat]++);
    return { date: q.date, tier1_method: TIER1[tier1], tier2_model: ML[model], categories: CATS, counts, ml_installed: true,
      logic: { tier1: `${TIER1[tier1]} exceeded on this day`, tier2: `${ML[model]} model score at or above its calibration-derived operating cut`,
        susceptibility: "90th percentile of the national PIBE percentile within the IMD cell is 0.90 or above (High or Very high class)" },
      note: inSampleNote(q.date), banner: "Experimental research framework - not an official warning. This two-tier configuration has not been prospectively validated as an operational warning system.",
      geojson: geo(s, (j) => ({ category: cats[j].cat, tier1: cats[j].t1, tier2: cats[j].t2, high_susceptibility: cats[j].hi, ml_score: sc[j], R0: s.f.R0[j], E: s.f.E[j], D: s.f.D[j], state: s.C.state[j] })) };
  }
  if (path === "/api/analyze") {
    const lat = num("lat"), lon = num("lon"), date = q.date, model = need(q.model ?? "pi_gbm"), tier1 = q.tier1 ?? "frequentist_ed";
    const su: any = await suscCell(lat, lon);
    const th: any = await thresholdGet(lat, lon, date);
    if (!th.available) return { available: false, message: "Insufficient model/data coverage for this location.", susceptibility: su };
    const s = await dayState(date, [model]); const j = th._j; delete th._j;
    const meta = (await modelP(model)).meta; const sc = s[`ml_${model}`] as Float64Array; const v = sc[j];
    const cat = (await twoTierCats(s, tier1, model))[j];
    const label = CATS[cat.cat];
    return { available: true, date, location: { lat, lon, state: th.state, district: null, rainfall_cell: th.cell, rainfall_cell_centre: [th.cell_lat, th.cell_lon] },
      susceptibility: su, rainfall: th.inputs, thresholds: th.results,
      nowcast: { installed: true, model: ML[model], score: v, percentile_among_cells_today: Array.from(sc).filter((x) => x <= v).length / s.n, above_operating_cut: v >= meta.operating_cut, above_5pct_budget_cut: v >= meta.cut5 },
      two_tier: { tier1_method: TIER1[tier1], tier1: cat.t1, tier2: cat.t2, high_susceptibility: cat.hi, category: cat.cat, label },
      interpretation: [su.available ? `Susceptibility: PIBE class ${su.pibe_class} for the 0.05 degree cell.` : "No susceptibility coverage at this point.",
        th.in_event ? `Rainfall: day ${th.inputs.D} of an event with ${Math.round(th.inputs.E)} mm so far.` : "Rainfall: no ongoing rainfall event (D = 0), so event-based thresholds cannot be exceeded.",
        `Two-tier research category: ${label}.`],
      why: await (async () => {
        const sw = await whySusceptibility(lat, lon);
        const p = await params();
        const sactR = th.results["SACT (event-conditional)"], t1R = th.results[TIER1[tier1] === "MaCumBA-type I-D" ? "MaCumBA-type I-D" : TIER1[tier1]];
        return {
          susceptibility: { pibe_class: su.pibe_class ?? null, pibe_percentile: su.pibe_percentile ?? null, contributions: sw },
          rainfall: th.in_event ? `Event rainfall is ${th.inputs.E.toFixed(1)} mm over ${th.inputs.D} days (${th.inputs.A30.toFixed(1)} mm fell in the 30 days before the event; daily rainfall ${th.inputs.R0.toFixed(1)} mm).`
            : `No rainfall event is ongoing (daily rainfall ${th.inputs.R0.toFixed(1)} mm; an event needs a wet day of at least 1 mm and ends after 2 dry days).`,
          threshold: { sact: { threshold_E_mm: sactR.threshold_E_mm, observed_E_mm: th.inputs.E, exceeded: sactR.exceeded, probability_given_event: sactR.probability_given_event, p_star: p.sact.p_star },
                       tier1: { method: TIER1[tier1], threshold_E_mm: t1R.threshold_E_mm, observed_E_mm: th.inputs.E, exceeded: t1R.exceeded } },
          ml: { model: ML[model], score: v, percentile_among_cells_today: Array.from(sc).filter((x) => x <= v).length / s.n, above_operating_cut: v >= meta.operating_cut, output: meta.output },
          history: await history(th.inputs.E, th.inputs.D, th.cell),
          caveat: CAVEAT,
        };
      })(),
      model_information: meta,
      limitations: ["Daily 0.25 degree rainfall misses sub-daily bursts and orographic detail", "The test period is dominated by 2013-2016 NASA GLC events",
        "Catalogue locations are uncertain by up to 25 km", "The two-tier configuration has not been prospectively validated", th.note], disclaimer: DISCLAIMER };
  }
  if (path === "/api/events") return J("api/events.json");
  if (path.startsWith("/api/events/")) return J(`api/events/${path.split("/").pop()}.json`).catch(() => { throw new HttpError(404, "Unknown event"); });
  if (path === "/api/comparison") return J("api/comparison.json");
  if (path.startsWith("/api/tables/")) return J(`api/tables/${path.split("/").pop()}.json`).catch(() => { throw new HttpError(404, "Unknown table"); });
  if (path === "/api/download") return J("api/download.json");
  throw new HttpError(404, `Unknown path ${path}`);
}
