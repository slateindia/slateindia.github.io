"""Build the web-app data contract (webapp/data) from the analysis outputs. Author: Kishan Tiwari.

Nothing here invents values: every layer is copied or derived from the paper's pipeline outputs. The ML nowcast
models, which the pipeline did not save, are retrained with exactly the paper's procedure (05_thresholds.py,
seed 42) and must reproduce the saved test predictions, otherwise the build aborts.

Usage (from webapp/): python scripts/build_artifacts.py [--skip-ml]
"""
import sys
import json
import shutil
import importlib
from pathlib import Path
import numpy as np
import pandas as pd

APP = Path(__file__).resolve().parents[1]
AN = APP.parent / "analysis"
sys.path.insert(0, str(AN / "scripts"))
from common import INT, TAB, SEED, best_tss_cut, contingency  # noqa: E402

OUT = APP / "data"
VERSION = "1.0.0"
CAL_END, BUDGET = 2012, 0.05
FEAT = ["R0", "R1", "A3", "A7", "A15", "A30", "A60", "maxR3", "E", "D", "ant30", "doy_s", "doy_c",
        "map_mm", "rl25_1d", "rl25_3d", "E_rl3", "R0_rl1", "slope_rep", "sand", "clay", "S"]
FEAT_PI = FEAT + ["FS"]
ML_NAMES = ["LR", "RF", "XGBoost", "LightGBM", "CatBoost", "PI-GBM"]
GBM3 = ("XGBoost", "LightGBM", "CatBoost")


def dump(obj, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    json.dump(obj, open(path, "w", encoding="utf-8"), indent=1, ensure_ascii=False, default=float)


# ------------------------------------------------------------------ rainfall and IMD-cell static inputs
def rainfall_and_cells():
    thr = importlib.import_module("05_thresholds")
    R, dates, cells = thr.load()
    (OUT / "rainfall").mkdir(parents=True, exist_ok=True)
    shutil.copy(INT / "imd_cells.npz", OUT / "rainfall" / "imd_cells.npz")
    keep = ["cell", "lat", "lon", "row", "col", "state", "map_mm", "rl25_1d", "rl25_3d", "slope_rep", "sand", "clay",
            "S", "S50", "S75", "S100"]
    c = cells[keep].copy()
    num = c.select_dtypes("number").columns
    c[num] = c[num].astype("float64")  # float32 -> exact float64 so the CSV round trip keeps model inputs bit-identical
    c[["cell", "row", "col"]] = c[["cell", "row", "col"]].astype(int)
    c["in_domain"] = c[["S", "map_mm", "slope_rep", "sand", "clay"]].notna().all(1)
    (OUT / "static").mkdir(exist_ok=True)
    c.to_csv(OUT / "static" / "imd_cells.csv", index=False)
    return thr


# ------------------------------------------------------------------ threshold parameters and budget cuts
def thresholds(thr):
    P = pd.read_pickle(INT / "threshold_panel.pkl")
    cal = P[P.year <= CAL_END]
    pr = pd.read_csv(TAB / "T_threshold_params.csv").set_index("method")
    fr, mc, sa = pr.loc["FREQ-ED T5"], pr.loc["MaCumBA-type I-D"], pr.loc["SACT"]
    lsc = np.where(cal.D > 0, np.log(np.maximum(cal.E, 1e-6) / (fr.alpha * np.maximum(cal.D, 1) ** fr.beta)), -20)
    X = np.c_[np.log(np.maximum(cal.E, 0.1)), np.log(np.maximum(cal.D, 1)), np.log1p(cal.ant30 / 100.0),
              np.log(cal.map_mm / 1000.0), cal.S]
    b = np.array([sa.bE, sa.bD, sa.bA, sa.bMAP, sa.bS])
    p_cal = np.where(cal.D > 0, 1 / (1 + np.exp(-(sa.b0 + X @ b))), 0.0)
    out = {
        "published": {k: {"a": a, "b": bb, "form": "I = a D^b, I in mm/h, D in hours"} for k, (a, bb) in thr.LIT_ID.items()},
        "frequentist_ed": {"alpha": fr.alpha, "beta": fr.beta, "alpha_ci": [fr.alpha_lo, fr.alpha_hi],
                           "beta_ci": [fr.beta_lo, fr.beta_hi], "gap_days": 2, "form": "E = alpha D^beta (mm, days), 5 % exceedance",
                           "cut5_log_margin": float(np.quantile(lsc, 1 - BUDGET))},
        "macumba": {"alpha": mc.alpha, "beta": mc.beta, "gap_days": int(mc.gap_days), "form": "I = alpha D^beta (mm/day, days)",
                    "calibration_TSS": mc.cal_TSS},
        "sact": {"b0": sa.b0, "bE": sa.bE, "bD": sa.bD, "bA": sa.bA, "bMAP": sa.bMAP, "bS": sa.bS,
                 "ci": {k: [sa[k + "_lo"], sa[k + "_hi"]] for k in ["bE", "bD", "bA", "bMAP", "bS"]},
                 "p_star": sa.p_star, "cut5": float(np.quantile(p_cal, 1 - BUDGET)),
                 "ln_alpha": sa.ln_alpha, "beta_D": sa.beta_D, "gamma_A": sa.gamma_A, "delta_MAP": sa.delta_MAP, "eps_S": sa.eps_S,
                 "exponent_ci": {k: [sa[k + "_lo"], sa[k + "_hi"]] for k in ["beta_D", "gamma_A", "delta_MAP", "eps_S"]},
                 "E0_mm": 1, "D0_days": 1, "A0_mm": 100, "M0_mm": 1000, "gap_days": 2, "S_aggregation": "90th percentile in IMD cell",
                 "pseudo_R2": sa.pseudo_R2_McFadden, "brier_test": sa.brier_test, "brier_climatology": sa.brier_climatology,
                 "note": "Event-conditional: p is the probability of a landslide on a cell-day given an ongoing rainfall event; "
                         "zero outside events. The S coefficient interval spans zero, so eps_S has no stable physical interpretation."},
    }
    dump(out, OUT / "thresholds" / "params.json")
    return P


# ------------------------------------------------------------------ ML nowcasts (paper procedure)
def ml_models(P):
    import joblib
    from sklearn.linear_model import LogisticRegression
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.preprocessing import StandardScaler
    from sklearn.pipeline import make_pipeline
    import xgboost as xgb
    import lightgbm as lgb
    from catboost import CatBoostClassifier

    def models():
        return {
            "LR": make_pipeline(StandardScaler(), LogisticRegression(C=0.5, max_iter=3000)),
            "RF": RandomForestClassifier(500, min_samples_leaf=5, max_features="sqrt", n_jobs=-1, random_state=SEED),
            "XGBoost": xgb.XGBClassifier(n_estimators=400, learning_rate=0.03, max_depth=3, subsample=0.8, colsample_bytree=0.8,
                                         min_child_weight=5, tree_method="hist", n_jobs=-1, random_state=SEED),
            "LightGBM": lgb.LGBMClassifier(n_estimators=400, learning_rate=0.03, num_leaves=7, min_child_samples=20, subsample=0.8,
                                           subsample_freq=1, colsample_bytree=0.8, random_state=SEED, verbose=-1),
            "CatBoost": CatBoostClassifier(iterations=500, learning_rate=0.05, depth=4, random_seed=SEED, verbose=0, thread_count=-1),
        }

    def undersample(yv, seed):
        r = np.random.default_rng(seed)
        pos, neg = np.flatnonzero(yv == 1), np.flatnonzero(yv == 0)
        return np.sort(np.r_[pos, r.choice(neg, min(len(neg), 20 * len(pos)), replace=False)])

    def fit_ml(name, Xtr, ytr_, seed):
        i = undersample(ytr_, seed)
        if name.startswith("PI"):
            return [models()[k].fit(Xtr.iloc[i], ytr_[i]) for k in GBM3]
        return [models()[name].fit(Xtr.iloc[i], ytr_[i])]

    def pred_ml(ms, X):
        return np.mean([m.predict_proba(X)[:, 1] for m in ms], 0)

    cal, test = P[P.year <= CAL_END], P[P.year > CAL_END]
    ref = pd.read_pickle(INT / "threshold_test_pred.pkl")
    ytr, years = cal.y.values, cal.year.values
    for name in ML_NAMES:
        cols = FEAT_PI if name.startswith("PI") else FEAT
        Xc, Xt = cal[cols].fillna(0).reset_index(drop=True), test[cols].fillna(0)
        inner = np.zeros(len(cal))
        for yy in np.unique(years):
            tr, va = np.flatnonzero(years != yy), np.flatnonzero(years == yy)
            inner[va] = pred_ml(fit_ml(name, Xc.iloc[tr], ytr[tr], SEED + int(yy)), Xc.iloc[va])
        cut, cut5 = float(best_tss_cut(ytr, inner)), float(np.quantile(inner, 1 - BUDGET))
        ms = fit_ml(name, Xc, ytr, SEED)
        st = pred_ml(ms, Xt)
        refcol = "PI-GBM (proposed)" if name == "PI-GBM" else name
        diff = float(np.max(np.abs(st - ref[refcol].values)))
        if diff > 1e-6:
            raise SystemExit(f"{name}: retrained scores differ from the paper's test predictions (max |diff| = {diff:.2e})")
        k = contingency(test.y, st >= cut)
        slug = name.lower().replace("-", "_")
        joblib.dump(ms, OUT / "models" / f"{slug}.joblib")
        dump({"model_name": name, "id": slug, "version": VERSION, "module": "nowcast", "output": "model score (not a calibrated probability; trained on negatives undersampled 20:1)",
              "members": list(GBM3) if name == "PI-GBM" else [name],
              "training_period": "2007-2012", "evaluation_period": "2013-2025 (376 of 377 landslide days in 2013-2016)",
              "spatial_resolution": "0.25 degree (IMD cell)", "susceptibility_resolution": "0.05 degree aggregated (90th percentile)",
              "temporal_resolution": "daily", "predictors": cols, "operating_cut": cut, "operating_cut_method": "TSS-optimal on year-grouped inner out-of-fold calibration predictions",
              "alert_budget": BUDGET, "cut5": cut5, "cut5_method": "95th percentile of inner out-of-fold calibration scores",
              "susceptibility_input": "frozen pre-2013 PIBE (label-leakage-controlled)",
              "reproduction_check": {"max_abs_diff_vs_paper_test_scores": diff, "test_TSS": k["TSS"], "test_POD": k["POD"]},
              "source_paper": "Tiwari K et al., National landslide susceptibility and rainfall-triggering thresholds in India (manuscript)",
              "limitations": ["Daily 0.25 degree rainfall misses sub-daily bursts", "Evaluation dominated by 2013-2016 NASA GLC events",
                              "Scores for 2007-2012 are in-sample for the final model", "Not prospectively validated"]},
             OUT / "models" / f"{slug}.json")
        print(f"{name}: cut {cut:.4f}, cut5 {cut5:.4f}, TSS {k['TSS']:.3f}, max diff {diff:.1e}", flush=True)


# ------------------------------------------------------------------ susceptibility grid
SUSC_MODELS = {"pibe": ("PIBE (national map)", "pibe_score"), "pibe_oof": ("PIBE", "PIBE"), "v0": ("Plain GBM ensemble (V0)", "V0"),
               "fr": ("Frequency ratio", "FR"), "lr": ("Logistic regression", "LR"), "rf": ("Random forest", "RF"),
               "xgboost": ("XGBoost", "XGBoost"), "lightgbm": ("LightGBM", "LightGBM"), "catboost": ("CatBoost", "CatBoost"),
               "ahp": ("AHP", "AHP"), "trigrs": ("TRIGRS Monte Carlo", "TRIGRS-MC"), "s_pre": ("Frozen pre-2013 PIBE (S)", "S_pre")}


def susceptibility():
    m = pd.read_pickle(INT / "susc_map.pkl").merge(pd.read_pickle(INT / "susc_pre2013.pkl"), on="cell_id", how="left")
    oof = pd.read_pickle(INT / "susc_oof.pkl")
    m = m.merge(oof[["cell_id", "fold", "PIBE", "V0", "FR", "LR", "RF", "XGBoost", "LightGBM", "CatBoost", "AHP", "TRIGRS-MC"]],
                on="cell_id", how="left")
    lith = {i: s for i, s in enumerate(sorted(m.lith_group.dropna().astype(str).unique()))}
    arr = {"cell_id": m.cell_id.values.astype(np.int64), "row": m.row.values.astype(np.int16), "col": m.col.values.astype(np.int16),
           "lat": m.lat.values, "lon": m.lon.values, "state": m.state.fillna("").astype(str).values,
           "susc_class": m.susc_class.astype(str).values, "y": m.y.values.astype(np.int8), "src": m.src.fillna("").astype(str).values,
           "lith_group": m.lith_group.fillna("").astype(str).values}
    for k in ["elev_mean", "relief", "slope_mean", "slope_max", "map_mm", "rl25_3d", "sand", "clay", "lc_tree", "lc_crop",
              "lc_built", "lc_bare", "dist_fault_km", "eq_density", "population", "age_ma"]:
        arr[k] = m[k].values.astype(np.float32)
    for _, col in SUSC_MODELS.values():
        arr["score_" + col] = m[col].values.astype(np.float32)
    arr = {k: (v.astype("U") if v.dtype == object else v) for k, v in arr.items()}  # no pickled arrays
    (OUT / "susceptibility").mkdir(parents=True, exist_ok=True)
    np.savez_compressed(OUT / "susceptibility" / "grid.npz", **arr)
    # grid geometry, checked against every cell
    west = float((m.lon - m.col * 0.05).round(4).mode()[0]) - 0.025
    north = float((m.lat + m.row * 0.05).round(4).mode()[0]) + 0.025
    assert np.allclose(m.lon, west + 0.025 + m.col * 0.05, atol=1e-4)
    cv = pd.read_csv(TAB / "T_susc_cv.csv").set_index("model")
    layers = []
    for key, (label, col) in SUSC_MODELS.items():
        cvrow = {"pibe": "PIBE", "pibe_oof": "PIBE", "v0": "V0"}.get(key, col)
        metrics = cv.loc[cvrow, ["AUC", "AUC_lo", "AUC_hi", "AP", "AP_lo", "AP_hi"]].to_dict() if cvrow in cv.index else None
        layers.append({"id": key, "label": label, "column": "score_" + col, "n_cells": int(m[col].notna().sum()),
                       "kind": {"pibe": "national refit, reporting covariates fixed at national medians",
                                "s_pre": "trained on landslide records dated 2012 or earlier, spatially out-of-fold, national percentile"}.get(
                           key, "spatial cross-validation out-of-fold score (modelled cells only)"),
                       "cv_metrics": metrics})
    dump({"west": west, "north": north, "res": 0.05, "nrows": int(m.row.max()) + 1, "ncols": int(m.col.max()) + 1,
          "crs": "EPSG:4326", "classes": ["Very low", "Low", "Moderate", "High", "Very high"],
          "class_area_share": [60, 20, 10, 5, 5], "layers": layers}, OUT / "susceptibility" / "layers.json")
    shap = pd.read_csv(TAB / "T_shap.csv")
    dump({"model": "CatBoost member of PIBE", "type": "global mean |SHAP|", "note": "Model attribution, not physical causation.",
          "features": shap.to_dict("records")}, OUT / "susceptibility" / "shap_global.json")


# ------------------------------------------------------------------ boundaries, events, validation, metadata
def boundaries():
    import geopandas as gpd
    g = gpd.read_file(AN / "data" / "raw" / "aux" / "Admin2.shp").to_crs(4326)
    name = [c for c in g.columns if c.lower() in ("st_nm", "name", "state", "st_name")][0]
    g = g[[name, "geometry"]].rename(columns={name: "name"})
    g["geometry"] = g.geometry.simplify(0.01)
    (OUT / "boundaries").mkdir(parents=True, exist_ok=True)
    g.to_file(OUT / "boundaries" / "states.geojson", driver="GeoJSON")


def events():
    inv = pd.read_csv(INT / "inventory_clean.csv")
    hc = pd.read_csv(TAB / "T_hindcast.csv")
    z = np.load(INT / "imd_cells.npz")
    dates = z["dates"].astype(str)
    ev = []
    for eid, state, src, t0, t1, doi in [("kerala_2018", "Kerala", "SRC_KERALA2018", "2018-06-01", "2018-08-31", "10.17026/dans-x6c-y7x2"),
                                         ("himachal_2023", "Himachal Pradesh", "SRC_HP2023", "2023-06-15", "2023-08-31", "10.5281/zenodo.10492992")]:
        h = hc[hc.event == state]
        daily = pd.read_pickle(INT / f"hindcast_daily_{src}.pkl")
        daily["date"] = dates[daily.t.values]
        agg = pd.read_pickle(INT / f"hindcast_{src}.pkl").reset_index()
        pts = inv[inv.source == src][["lat", "lon"]].round(4)
        doc = {"id": eid, "name": f"{state} {t0[:4]}", "state": state, "period": [t0, t1],
               "wettest_days": h.wettest_days.iloc[0].split(", "), "inventory_doi": doi,
               "n_landslides": int(len(pts)), "n_cells": int(h.cells.iloc[0]), "n_landslide_cells": int(h.ls_cells.iloc[0]),
               "metrics": h.drop(columns=["event", "wettest_days"]).to_dict("records"),
               "cells": agg.to_dict("records"), "landslides": pts.values.tolist(),
               "daily": {c: {"date": g.date.tolist(), "rain": g.R0.round(2).tolist(), "sact": g.SACT.round(6).tolist(),
                             "pigbm": g["PI-GBM"].round(6).tolist(), "freq": g.FREQ.astype(int).tolist()} for c, g in daily.groupby("cell")},
               "caveat": "Single-event hindcast: an event-level demonstration, not an estimate of general skill. "
                         "Neither inventory was used in calibration or in S."}
        dump(doc, OUT / "events" / f"{eid}.json")
        ev.append({k: doc[k] for k in ["id", "name", "state", "period", "wettest_days", "n_landslides", "n_cells", "n_landslide_cells", "caveat"]})
    dump(ev, OUT / "events" / "index.json")


def validation():
    d = OUT / "validation"
    d.mkdir(parents=True, exist_ok=True)
    for f in TAB.glob("T_*.csv"):
        shutil.copy(f, d / f.name)
    for f in ["numbers.json", "tables_for_ms.json", "tables_for_si.json"]:
        shutil.copy(TAB / f, d / f)


def manifest():
    dump({"application_version": VERSION, "data_version": VERSION, "model_version": VERSION, "author": "Kishan Tiwari",
          "built": str(pd.Timestamp.now().date()), "source": "analysis pipeline outputs (see Zenodo deposit)",
          "rainfall": "IMD 0.25 degree daily gridded rainfall, 1991-01-01 to 2025-12-31"}, OUT / "manifest.json")


def main():
    OUT.mkdir(exist_ok=True)
    (OUT / "models").mkdir(exist_ok=True)
    thr = rainfall_and_cells(); print("rainfall + cells", flush=True)
    P = thresholds(thr); print("thresholds", flush=True)
    susceptibility(); print("susceptibility", flush=True)
    boundaries(); events(); validation(); manifest(); print("boundaries, events, validation", flush=True)
    if "--skip-ml" not in sys.argv:
        ml_models(P)


if __name__ == "__main__":
    main()
