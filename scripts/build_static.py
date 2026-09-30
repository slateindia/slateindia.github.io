"""Export everything the static (GitHub Pages) site needs into frontend/public/data. Author: Kishan Tiwari.

The browser engine (frontend/lib/engine.ts) recomputes events, thresholds, SACT, TRIGRS FS and all ML nowcasts from
these files; scripts/verify_static.mjs checks it against the Python backend. Run after build_artifacts.py.
"""
import sys
import json
import shutil
from pathlib import Path
import numpy as np
import pandas as pd

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP / "backend"))
from app import main as api, store, science as sc  # noqa: E402
from app.render import grid_png  # noqa: E402

OUT = APP / "frontend" / "public" / "data"


def dump(obj, rel):
    p = OUT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    json.dump(api.clean(obj), open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"), allow_nan=False)


# ------------------------------------------------------------------ rainfall, event durations
def event_states(R, gap, starts):
    """running_event state (d, dry, active) just before each day index in `starts` (same update rules as science.running_event)."""
    C = R.shape[1]
    d = np.zeros(C, int); dry = np.zeros(C, int); active = np.zeros(C, bool)
    out, want = {}, set(starts)
    for t in range(R.shape[0]):
        if t in want:
            out[t] = (d.copy(), dry.copy(), active.copy())
        w = R[t] >= sc.WET
        st = w & ~active
        d[st] = 0
        active |= w
        dry = np.where(w, 0, np.where(active, dry + 1, dry))
        active &= ~(~w & (dry >= gap))
        d = np.where(active, d + 1, d)
    return out


def rainfall():
    import gzip
    z = np.load(store.DATA_ROOT / "rainfall" / "imd_cells.npz")
    R, dates = z["rain"].astype(np.float32), z["dates"]
    months = pd.PeriodIndex(pd.DatetimeIndex(dates), freq="M")
    firsts = [int(np.flatnonzero(months == m)[0]) for m in months.unique()]
    print("event states at month starts ...", flush=True)
    st = {g: event_states(R, g, firsts) for g in (2, 1)}
    (OUT / "rain").mkdir(parents=True, exist_ok=True)
    index = []
    for m, k0 in zip(months.unique(), firsts):
        k = np.flatnonzero(months == m)
        name = str(m)
        # float32 [days x cells] little-endian, gzip (lossless)
        (OUT / "rain" / f"{name}.bin.gz").write_bytes(gzip.compress(R[k].astype("<f4").tobytes(), 9))
        s2, s1 = st[2][k0], st[1][k0]
        state = np.concatenate([s2[0].astype("<u2").view("<u1"), s2[1].astype("<u2").view("<u1"), s2[2].astype("<u2").view("<u1"),
                                s1[0].astype("<u2").view("<u1"), s1[1].astype("<u2").view("<u1"), s1[2].astype("<u2").view("<u1")])
        (OUT / "rain" / f"{name}.state.bin").write_bytes(state.tobytes())  # uint16 x 6 blocks of ncell: d, dry, active for G=2 then G=1
        index.append([name, int(k[0]), int(len(k))])
    dump({"start": str(dates[0]), "end": str(dates[-1]), "ncell": int(R.shape[1]), "months": index,
          "source": store.rainfall().name}, "rain/index.json")


# ------------------------------------------------------------------ IMD-cell static inputs incl. TRIGRS constants
def cells():
    c = store.imd_cells()
    c = c[c.in_domain].reset_index(drop=True)
    slope = np.clip(np.nan_to_num(c.slope_rep.values, nan=20), 1, 60)
    p = sc.texture_params(np.nan_to_num(c.sand.values, nan=40), np.nan_to_num(c.clay.values, nan=25), slope)
    d = np.radians(slope)
    kern = np.array([sc.trigrs_kernel(p["Z"][j], p["D0"][j], d[j], 30) for j in range(len(c))])
    tphi = np.tan(np.radians(p["phi_deg"]))
    out = {k: c[k].tolist() for k in ["cell", "lat", "lon", "state", "map_mm", "rl25_1d", "rl25_3d", "slope_rep", "sand", "clay", "S"]}
    out.update({"pibe_p90": api.imd_pibe_p90().reindex(c.cell).tolist(), "Ks": p["Ks"].tolist(), "Zbeta": (p["Z"] * np.cos(d) ** 2).tolist(),
                "fsA": (tphi / np.tan(d)).tolist(), "c": p["c_kpa"].tolist(), "tphi": tphi.tolist(),
                "den": (20.0 * p["Z"] * np.sin(d) * np.cos(d)).tolist(), "kernel": kern.tolist()})
    dump(out, "static/cells.json")


# ------------------------------------------------------------------ ML models as plain arrays
def export_estimator(m):
    n = type(m).__name__
    if n == "XGBClassifier":
        b = m.get_booster()
        j = json.loads(b.save_raw("json").decode())
        L = j["learner"]
        bs = float(L["learner_model_param"]["base_score"].strip("[]"))
        trees = [{"l": t["left_children"], "r": t["right_children"], "f": t["split_indices"], "t": t["split_conditions"],
                  "dl": t["default_left"]} for t in L["gradient_booster"]["model"]["trees"]]
        return {"type": "xgb", "base_score": bs, "trees": trees}
    if n == "LGBMClassifier":
        dm = m.booster_.dump_model()
        trees = []
        for ti in dm["tree_info"]:
            l, r, f, t, v = [], [], [], [], []
            def walk(node):
                i = len(l); l.append(-1); r.append(-1); f.append(-1); t.append(0.0); v.append(0.0)
                if "leaf_value" in node:
                    v[i] = node["leaf_value"]
                else:
                    assert node["decision_type"] == "<="
                    f[i], t[i] = node["split_feature"], node["threshold"]
                    l[i] = walk(node["left_child"]); r[i] = walk(node["right_child"])
                return i
            walk(ti["tree_structure"])
            trees.append({"l": l, "r": r, "f": f, "t": t, "v": v})
        assert dm["objective"].startswith("binary sigmoid:1")
        return {"type": "lgbm", "trees": trees}
    if n == "CatBoostClassifier":
        tmp = OUT / "_cb.json"
        m.save_model(str(tmp), format="json")
        j = json.load(open(tmp))
        tmp.unlink()
        trees = [{"f": [s["float_feature_index"] for s in t["splits"]], "b": [s["border"] for s in t["splits"]], "v": t["leaf_values"]}
                 for t in j["oblivious_trees"]]
        sb = j["scale_and_bias"]
        return {"type": "catboost", "scale": sb[0], "bias": sb[1][0], "trees": trees}
    if n == "RandomForestClassifier":
        trees = []
        for e in m.estimators_:
            t = e.tree_
            val = t.value[:, 0, :]
            trees.append({"l": t.children_left.tolist(), "r": t.children_right.tolist(), "f": t.feature.tolist(),
                          "t": t.threshold.tolist(), "p": (val[:, 1] / val.sum(1)).tolist()})
        return {"type": "rf", "trees": trees}
    if n == "Pipeline":
        s, lr = m.steps[0][1], m.steps[1][1]
        return {"type": "lr", "mean": s.mean_.tolist(), "scale": s.scale_.tolist(), "coef": lr.coef_[0].tolist(), "intercept": float(lr.intercept_[0])}
    raise ValueError(n)


def models():
    for slug in api.ML:
        ms = store.ml_model(slug)
        dump({"meta": store.ml_meta(slug), "estimators": [export_estimator(m) for m in ms]}, f"models/{slug}.json")


# ------------------------------------------------------------------ susceptibility
def susceptibility():
    L = store.susc_layers()
    g = store.susc_grid()
    for l in L["layers"]:
        for mode in ["class", "score"]:
            cls = None
            if l["id"] == "pibe" and mode == "class":
                cls = np.array([L["classes"].index(c) if c in L["classes"] else 0 for c in g["susc_class"]])
            (OUT / "susc" / "png").mkdir(parents=True, exist_ok=True)
            (OUT / "susc" / "png" / f"{l['id']}_{mode}.png").write_bytes(grid_png(g, L, g[l["column"]], mode, cls))
    pct = {}
    for l in L["layers"]:
        v = g[l["column"]].astype(float)
        ok = np.isfinite(v)
        p = np.full(len(v), np.nan)
        s = np.sort(v[ok])
        p[ok] = np.searchsorted(s, v[ok], side="right") / ok.sum()   # share of cells with score <= v, as the API
        pct[l["id"]] = p
    preds = ["elev_mean", "relief", "slope_mean", "slope_max", "map_mm", "rl25_3d", "sand", "clay", "lc_tree", "lc_crop", "lc_built",
             "lc_bare", "dist_fault_km", "eq_density", "population", "age_ma"]
    ppct = api.pibe_pct()
    dicts = {k: sorted(set(map(str, g[k]))) for k in ["state", "susc_class", "src", "lith_group"]}
    cols = ["lat", "lon", "cell_id", "row", "col", "y", "pibe_pct"] + [f"score:{l['id']}" for l in L["layers"]] +            [f"pct:{l['id']}" for l in L["layers"]] + preds + [f"code:{k}" for k in dicts]
    M = np.column_stack([g["lat"], g["lon"], g["cell_id"], g["row"], g["col"], g["y"], ppct] + [g[l["column"]] for l in L["layers"]] +
                        [pct[l["id"]] for l in L["layers"]] + [g[k] for k in preds] +
                        [np.array([dicts[k].index(str(v)) for v in g[k]]) for k in dicts]).astype("<f8")
    key = np.floor(g["lat"]).astype(int) * 1000 + np.floor(g["lon"]).astype(int)
    (OUT / "susc" / "cells").mkdir(parents=True, exist_ok=True)
    for kk in np.unique(key):
        (OUT / "susc" / "cells" / f"{kk // 1000}_{kk % 1000}.bin").write_bytes(M[key == kk].tobytes())  # float64 [cells x cols]
    dump({"columns": cols, "dicts": dicts, "predictors": preds}, "susc/cells_meta.json")
    dump(L, "api/susceptibility_layers.json")
    dump(store.jload("susceptibility/shap_global.json"), "api/susceptibility_shap.json")


# ------------------------------------------------------------------ static API responses and downloads
def static_api():
    dump(api.comparison(), "api/comparison.json")
    for f in (store.DATA_ROOT / "validation").glob("T_*.csv"):
        dump(api.table(f.stem), f"api/tables/{f.stem}.json")
    dump(api.events(), "api/events.json")
    for e in api.events():
        dump(api.event(e["id"]), f"api/events/{e['id']}.json")
    dump(api.models(), "api/models.json")
    for mid in list(api.ML) + ["sact", "frequentist_ed", "macumba", "published"] + [l["id"] for l in store.susc_layers()["layers"]]:
        dump(api.model_metadata(mid), f"api/model-metadata/{mid}.json")
    dump(store.threshold_params(), "api/threshold_params.json")
    h = api.health()
    h["artifacts"] = {k: {**v, "path": v["path"]} for k, v in h["artifacts"].items()}
    h["deployment"] = "static site: all computation runs in the browser from the exported data"
    dump(h, "api/health.json")
    shutil.copy(store.DATA_ROOT / "boundaries" / "states.geojson", OUT / "states.geojson")
    # downloads: small deposit files are hosted with the site; the full deposit is on Zenodo
    dep = store.DOWNLOAD_ROOT
    files = []
    for p in sorted(dep.rglob("*")):
        rel = p.relative_to(dep).as_posix()
        if p.is_file() and not rel.startswith("code/") and p.stat().st_size < 20e6:
            (OUT / "downloads" / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(p, OUT / "downloads" / rel)
            files.append({"path": rel, "bytes": p.stat().st_size, "hosted": True})
        elif p.is_file():
            files.append({"path": rel, "bytes": p.stat().st_size, "hosted": False})
    dump({"available": True, "files": files, "zenodo": "https://doi.org/[DOI to be added]",
          "metadata": {"crs": "EPSG:4326", "susceptibility_resolution": "0.05 degree", "rainfall_resolution": "0.25 degree daily",
                       "training_period_nowcast": "2007-2012", "evaluation_period": "2013-2025"}}, "api/download.json")


def reference():
    """Python reference outputs for the Node verification (not deployed)."""
    ref = {}
    for d in ["1998-07-01", "2008-08-20", "2013-06-17", "2014-07-15", "2018-08-16", "2023-07-10", "2025-12-31", "1991-03-15"]:
        s = api.day_state(d)
        ref[d] = {k: s[k].tolist() for k in ["cell", "R0", "E", "D", "ant30", "A30", "FS", "E_G1", "D_G1", "freq_margin", "macumba_margin",
                                              "sact_p", "t1_frequentist_ed", "t1_macumba", "t1_sact"] + [f"ml_{m}" for m in api.ML]}
    p = APP / "scripts" / "_reference.json"
    json.dump(api.clean(ref), open(p, "w"))


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    steps = sys.argv[1:] or ["rainfall", "cells", "models", "susceptibility", "static_api", "reference"]
    for s in steps:
        globals()[s]()
        print(s, "done", flush=True)
