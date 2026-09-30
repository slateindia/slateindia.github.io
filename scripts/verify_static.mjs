// Verifies the in-browser engine against the Python backend (scripts/_reference.json from build_static.py).
// Usage (from webapp/): npx --prefix frontend tsc -p scripts/tsconfig.verify.json && node scripts/verify_static.mjs
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(here, "..", "frontend", "public", "data");
const eng = await import(pathToFileURL(path.join(here, "_build", "engine.js")).href);
eng.setLoader({
  json: async (rel) => JSON.parse(fs.readFileSync(path.join(DATA, rel), "utf8")),
  bin: async (rel, gz) => { const b = fs.readFileSync(path.join(DATA, rel)); const u = gz ? zlib.gunzipSync(b) : b; return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength); },
});
const ref = JSON.parse(fs.readFileSync(path.join(here, "_reference.json"), "utf8"));
const models = ["lr", "rf", "xgboost", "lightgbm", "catboost", "pi_gbm"];
const meta = Object.fromEntries(models.map((m) => [m, JSON.parse(fs.readFileSync(path.join(DATA, "models", m + ".json"), "utf8")).meta]));
let fail = 0;
for (const [date, r] of Object.entries(ref)) {
  const s = await eng._dayState(date, models);
  const C = s.C;
  const pos = new Map(r.cell.map((c, i) => [c, i]));
  const idx = C.cell.map((c) => pos.get(c));
  const md = (a, b) => Math.max(...idx.map((i, j) => { const x = a[j], y = b[i]; if (y === null && !Number.isFinite(x)) return 0; return Math.abs(x - y); }));
  const rel = (a, b) => Math.max(...idx.map((i, j) => Math.abs(a[j] - b[i]) / Math.max(1, Math.abs(b[i]))));
  const out = { E: rel(s.f.E, r.E), D: md(s.f.D, r.D), ant30: rel(s.f.ant30, r.ant30), A30: rel(s.f.A30, r.A30), FS: rel(s.f.FS, r.FS),
    E_G1: rel(s.f.E_G1, r.E_G1), D_G1: md(s.f.D_G1, r.D_G1), sact: md(s.sact, r.sact_p) };
  const flips = { freq: idx.filter((i, j) => s.t1.frequentist_ed[j] !== r.t1_frequentist_ed[i]).length, mac: idx.filter((i, j) => s.t1.macumba[j] !== r.t1_macumba[i]).length,
    sact: idx.filter((i, j) => s.t1.sact[j] !== r.t1_sact[i]).length };
  const ml = {}, mlflip = {};
  for (const m of models) {
    ml[m] = md(s[`ml_${m}`], r[`ml_${m}`]);
    mlflip[m] = idx.filter((i, j) => (s[`ml_${m}`][j] >= meta[m].operating_cut) !== (r[`ml_${m}`][i] >= meta[m].operating_cut) ||
      (s[`ml_${m}`][j] >= meta[m].cut5) !== (r[`ml_${m}`][i] >= meta[m].cut5)).length;
  }
  const bad = out.D > 0 || out.D_G1 > 0 || out.E > 1e-9 || out.ant30 > 1e-9 || out.FS > 1e-9 || out.sact > 1e-9 || Object.values(flips).some((v) => v) ||
    Object.values(ml).some((v) => v > 1e-6) || Object.values(mlflip).some((v) => v);
  fail += bad;
  console.log(date, bad ? "FAIL" : "ok", JSON.stringify({ n: idx.length, ...Object.fromEntries(Object.entries(out).map(([k, v]) => [k, +v.toExponential(1)])) }),
    "flips", JSON.stringify(flips), "ml", JSON.stringify(Object.fromEntries(Object.entries(ml).map(([k, v]) => [k, +v.toExponential(1)]))), "mlflips", JSON.stringify(mlflip));
}
process.exit(fail ? 1 : 0);
