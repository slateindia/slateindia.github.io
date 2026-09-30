"""Data for SLATE's "Why does this cell have this result?" panel. Author: Kishan Tiwari.

1. Refits the national PIBE model exactly as analysis/scripts/04c_map.py, aborts unless it reproduces the published
   pibe_score, and computes exact TreeSHAP contributions (log-odds) of each member for all 0.05 degree cells.
2. Historical context: counts of monitored cell-days (paper's threshold panel, 2007-2025) and recorded landslide days
   per event-rainfall / duration bin, and, for every IMD cell, the number of days in 1991-2025 with event rainfall
   at or above each bin edge.
Output: frontend/public/data/why/
"""
import sys
import json
import importlib
from pathlib import Path
import numpy as np
import pandas as pd

APP = Path(__file__).resolve().parents[1]
AN = APP.parent / "analysis"
sys.path.insert(0, str(AN / "scripts"))
sys.path.insert(0, str(APP / "backend"))
from common import INT  # noqa: E402
OUT = APP / "frontend" / "public" / "data" / "why"
E_EDGES = [0, 10, 25, 50, 100, 200, 400, 800, 1600, 3200]           # mm; last bin open
D_EDGES = [1, 2, 3, 4, 6, 8, 11, 16, 31, 61]                         # days; bin [a, next a), last open


def pibe_shap():
    S4 = importlib.import_module("04_susceptibility")
    oof = pd.read_pickle(INT / "susc_oof.pkl")
    df = pd.read_pickle(INT / "susc_map.pkl")
    d = oof[["cell_id"]].merge(df, on="cell_id", how="left")
    d["region"] = oof.region.values
    y = oof.y.values
    base_cols = sum(S4.GROUPS.values(), [])
    bias_ref = {c: float(df[c].median()) for c in S4.BIAS}
    w = S4.source_weights(d.assign(y=y, src=oof.src.values))
    print("refitting PIBE ...", flush=True)
    m = S4.Variant(S4.VARIANTS[4], base_cols, bias_ref).fit(d, y, w)
    diff = float(np.max(np.abs(m.predict(df) - df.pibe_score.values)))
    print("max |refit - published pibe_score| =", diff, flush=True)
    if diff > 1e-6:
        raise SystemExit("PIBE refit does not reproduce the published map; explanations not written")
    X = m.X(df, adjust=True)
    import xgboost as xgb
    from catboost import Pool
    contribs = []
    xg, lg, cb = m.models
    b = xg.get_booster()
    contribs.append(b.predict(xgb.DMatrix(X, feature_names=list(X.columns)), pred_contribs=True))
    contribs.append(lg.predict(X, pred_contrib=True))
    contribs.append(cb.get_feature_importance(Pool(X), type="ShapValues"))
    for c, name in zip(contribs, ["XGBoost", "LightGBM", "CatBoost"]):   # exactness: contributions sum to each member's log-odds
        margin = {"XGBoost": lambda: b.predict(xgb.DMatrix(X, feature_names=list(X.columns)), output_margin=True),
                  "LightGBM": lambda: lg.predict(X, raw_score=True), "CatBoost": lambda: cb.predict(X, prediction_type="RawFormulaVal")}[name]()
        print(name, "additivity max error", float(np.max(np.abs(c.sum(1) - margin))), flush=True)
    C = np.mean(contribs, 0)                                           # mean member contribution, log-odds; last column = base value
    cols = list(X.columns)
    groups = {f: g for g, fs in S4.GROUPS.items() for f in fs}
    groups.update({f: "process-based" for f in S4.PHYS})
    groups.update({"log_pop": "reporting effort (fixed at national median)", "lc_built": "reporting effort (fixed at national median)"})
    groups.update({f: "lithology" for f in X.columns if f.startswith("lith_")})
    OUT.mkdir(parents=True, exist_ok=True)
    key = np.floor(df.lat.values).astype(int) * 1000 + np.floor(df.lon.values).astype(int)
    rc = np.c_[df.row.values, df.col.values]
    (OUT / "shap").mkdir(exist_ok=True)
    for k in np.unique(key):
        sel = key == k
        M = np.column_stack([rc[sel], C[sel], X.values[sel]]).astype("<f4")   # row, col, contributions..., base, feature values...
        (OUT / "shap" / f"{k // 1000}_{k % 1000}.bin").write_bytes(M.tobytes())
    json.dump({"features": cols, "groups": [groups.get(c, "other") for c in cols], "n_features": len(cols),
               "layout": "float32 rows: row, col, contribution per feature (log-odds), base value, feature value per feature",
               "method": "Exact TreeSHAP of each PIBE member (XGBoost, LightGBM, CatBoost) on the log-odds scale, averaged over the three members; "
                         "reporting covariates (built-up fraction, log population) are fixed at national medians, as for the map.",
               "refit_max_abs_diff": diff}, open(OUT / "shap_meta.json", "w"))


def history():
    from app import science as sc, store
    P = pd.read_pickle(INT / "threshold_panel.pkl")
    ev = P[P.D > 0]
    ei = np.searchsorted(E_EDGES, ev.E.values, side="right") - 1
    di = np.searchsorted(D_EDGES, ev.D.values, side="right") - 1
    n = np.zeros((len(E_EDGES), len(D_EDGES)), int); k = np.zeros_like(n)
    np.add.at(n, (ei, di), 1); np.add.at(k, (ei, di), ev.y.values)
    hist = {"E_edges": E_EDGES, "D_edges": D_EDGES, "n": n.tolist(), "landslides": k.tolist(),
            "total_event_days": int(len(ev)), "total_event_landslides": int(ev.y.sum()),
            "total_days": int(len(P)), "total_landslides": int(P.y.sum()), "no_event_landslides": int(P[P.D == 0].y.sum()),
            "scope": "monitored cell-days of the paper's threshold panel (IMD cells with catalogue coverage, 2007-2025; 2007-2016 for the NASA GLC)"}
    # per IMD cell: days in 1991-2025 with event rainfall >= each edge (G = 2)
    R = store.rainfall().matrix()
    cells = store.imd_cells()
    cells = cells[cells.in_domain]
    E, _ = sc.running_event(R[:, cells.cell.values].astype(np.float32), sc.WET, 2)
    counts = np.stack([(E >= e).sum(0) if e > 0 else (E > 0).sum(0) for e in E_EDGES], 1)
    hist["cell_exceed"] = {"cells": cells.cell.tolist(), "counts": counts.tolist(), "days": int(R.shape[0])}
    json.dump(hist, open(OUT / "history.json", "w"))


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for s in (sys.argv[1:] or ["pibe_shap", "history"]):
        globals()[s]()
        print(s, "done", flush=True)
