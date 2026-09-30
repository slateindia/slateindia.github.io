"""SLATE API. Research model output. Not an official landslide warning."""
from functools import lru_cache
from io import BytesIO
from typing import Optional
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from . import science as sc
from . import store

DISCLAIMER = "Research model output. Not an official landslide warning."
ML = {"lr": "LR", "rf": "RF", "xgboost": "XGBoost", "lightgbm": "LightGBM", "catboost": "CatBoost", "pi_gbm": "PI-GBM"}
TIER1 = {"frequentist_ed": "Frequentist E-D (T5)", "macumba": "MaCumBA-type I-D", "sact": "SACT (event-conditional)"}

app = FastAPI(title="SLATE API", version="1.0.0",
              description="Interactive research platform for landslide susceptibility and rainfall-triggering analysis. " + DISCLAIMER)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def clean(v):
    """JSON-safe floats (NaN/inf -> None)."""
    if isinstance(v, dict):
        return {k: clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [clean(x) for x in v]
    if isinstance(v, (np.floating, float)):
        return None if not np.isfinite(v) else float(v)
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, np.bool_):
        return bool(v)
    return v


# ------------------------------------------------------------------ lookups
def imd_cell_at(lat, lon):
    c = store.imd_cells()
    m = c[(np.abs(c.lat - lat) <= 0.125) & (np.abs(c.lon - lon) <= 0.125)]
    return None if m.empty else m.iloc[0]


@lru_cache
def susc_index():
    g = store.susc_grid()
    return {(int(r), int(c)): i for i, (r, c) in enumerate(zip(g["row"], g["col"]))}


def susc_cell_at(lat, lon):
    L = store.susc_layers()
    r, c = int((L["north"] - lat) // L["res"]), int((lon - L["west"]) // L["res"])
    return susc_index().get((r, c))


@lru_cache
def pibe_pct():
    s = pd.Series(store.susc_grid()["score_pibe_score"])
    return s.rank(pct=True).values


@lru_cache
def imd_pibe_p90():
    """90th percentile of the national PIBE percentile within each IMD cell (same aggregation as S)."""
    g = store.susc_grid()
    df = pd.DataFrame({"lat": np.round(np.round(g["lat"] / 0.25) * 0.25, 2), "lon": np.round(np.round(g["lon"] / 0.25) * 0.25, 2), "p": pibe_pct()})
    q = df.groupby(["lat", "lon"]).p.quantile(0.9)
    c = store.imd_cells()
    return pd.Series([q.get((round(a, 2), round(b, 2)), np.nan) for a, b in zip(c.lat, c.lon)], index=c.cell)


def check_date(date):
    prov = store.rainfall()
    if not prov.available():
        raise HTTPException(503, "Rainfall artifact not installed.")
    t = prov.day_index(date)
    if t is None:
        lo, hi = prov.date_range()
        raise HTTPException(404, f"Rainfall data not available for {date}; the archive covers {lo} to {hi}. No substitute date is used.")
    return t


# ------------------------------------------------------------------ daily state for all domain cells
@lru_cache(maxsize=24)
def day_state(date):
    t = check_date(date)
    cells = store.imd_cells()
    cells = cells[cells.in_domain].reset_index(drop=True)
    doy = pd.Timestamp(date).dayofyear
    f = sc.features(store.rainfall().matrix(), t, cells, doy)
    p = store.threshold_params()
    out = pd.DataFrame({"cell": cells.cell, "lat": cells.lat, "lon": cells.lon, "state": cells.state})
    for k in ["R0", "R1", "A3", "A30", "E", "D", "ant30", "FS", "E_G1", "D_G1", "map_mm", "S"]:
        out[k] = f[k]
    out["freq_margin"] = sc.freq_margin(f["E"], f["D"], p["frequentist_ed"])
    out["macumba_margin"] = sc.macumba_margin(f["E_G1"], f["D_G1"], p["macumba"])
    out["sact_p"] = sc.sact_prob(f["E"], f["D"], f["ant30"], f["map_mm"], f["S"], p["sact"])
    out["sact_E_star"] = np.where(f["D"] > 0, sc.sact_threshold_E(f["D"], f["ant30"], f["map_mm"], f["S"], p["sact"]), np.nan)
    for name, q in p["published"].items():
        out["pub_" + name] = sc.published_margin(f["E"], f["D"], q["a"], q["b"])
    out["t1_frequentist_ed"] = out.freq_margin >= 0
    out["t1_macumba"] = out.macumba_margin >= 0
    out["t1_sact"] = out.sact_p >= p["sact"]["p_star"]
    X = pd.DataFrame({k: f[k] for k in sc_feats(pi=True)}).fillna(0)
    for slug, name in ML.items():
        ms, meta = store.ml_model(slug), store.ml_meta(slug)
        if ms is None:
            out["ml_" + slug] = np.nan
            continue
        out["ml_" + slug] = np.mean([m.predict_proba(X[meta["predictors"]])[:, 1] for m in ms], 0)
    out["pibe_p90"] = imd_pibe_p90().reindex(out.cell).values
    out["history_complete"] = f["history_complete"]
    return out


def sc_feats(pi=False):
    base = ["R0", "R1", "A3", "A7", "A15", "A30", "A60", "maxR3", "E", "D", "ant30", "doy_s", "doy_c", "map_mm", "rl25_1d",
            "rl25_3d", "E_rl3", "R0_rl1", "slope_rep", "sand", "clay", "S"]
    return base + ["FS"] if pi else base


def in_sample_note(date):
    y = pd.Timestamp(date).year
    if 2007 <= y <= 2012:
        return "Date lies in the 2007-2012 calibration period: ML and SACT outputs are in-sample."
    if y >= 2017:
        return "Date lies after the 2016 end of the main dated catalogue (NASA GLC); no catalogue evaluation exists for it."
    return None


def geo(df, props):
    feats = []
    for _, r in df.iterrows():
        x, y = r.lon, r.lat
        feats.append({"type": "Feature", "id": int(r.cell), "properties": clean({k: r[k] for k in props}),
                      "geometry": {"type": "Polygon", "coordinates": [[[x - .125, y - .125], [x + .125, y - .125], [x + .125, y + .125], [x - .125, y + .125], [x - .125, y - .125]]]}})
    return {"type": "FeatureCollection", "features": feats}


# ------------------------------------------------------------------ system and metadata
@app.get("/api/health")
def health():
    prov = store.rainfall()
    return clean({"status": "ok", "disclaimer": DISCLAIMER, "artifacts": store.status(),
                  "rainfall_provider": prov.name, "rainfall_range": prov.date_range() if prov.available() else None,
                  "live_provider": {"name": store.IMDRainfallProvider.name, "available": False},
                  "manifest": store.jload("manifest.json")})


@app.get("/api/models")
def models():
    L = store.susc_layers()
    return clean({"susceptibility": L["layers"],
                  "thresholds": list(TIER1.values()) + list(store.threshold_params()["published"]),
                  "nowcast": [store.ml_meta(s) or {"id": s, "model_name": n, "installed": False, "status": "model artifact not installed"} for s, n in ML.items()]})


@app.get("/api/model-metadata/{model_id}")
def model_metadata(model_id: str):
    if model_id in ML:
        m = store.ml_meta(model_id)
        if m is None:
            raise HTTPException(404, "model artifact not installed")
        return m
    p = store.threshold_params()
    if model_id in p:
        return clean(p[model_id])
    for l in store.susc_layers()["layers"]:
        if l["id"] == model_id:
            return clean(l)
    raise HTTPException(404, f"Unknown model {model_id}")


@app.get("/api/boundaries/states")
def states():
    return FileResponse(store.DATA_ROOT / "boundaries" / "states.geojson", media_type="application/geo+json")


# ------------------------------------------------------------------ susceptibility
@app.get("/api/susceptibility/layers")
def susc_layers():
    return clean(store.susc_layers())


@app.get("/api/susceptibility/map.png")
def susc_map(model: str = "pibe", mode: str = Query("class", pattern="^(class|score)$")):
    from .render import grid_png
    L = store.susc_layers()
    layer = next((l for l in L["layers"] if l["id"] == model), None)
    if layer is None:
        raise HTTPException(404, f"Unknown susceptibility layer {model}")
    g = store.susc_grid()
    classes = None
    if model == "pibe" and mode == "class":
        classes = np.array([L["classes"].index(c) if c in L["classes"] else 0 for c in g["susc_class"]])
    return Response(grid_png(g, L, g[layer["column"]], mode, classes), media_type="image/png", headers={"Cache-Control": "max-age=86400"})


@app.get("/api/susceptibility/cell")
def susc_cell(lat: float, lon: float):
    i = susc_cell_at(lat, lon)
    if i is None:
        return {"available": False, "message": "Insufficient model/data coverage for this location."}
    g = store.susc_grid()
    L = store.susc_layers()
    scores = {}
    for l in L["layers"]:
        v = g[l["column"]][i]
        if np.isfinite(v):
            col = g[l["column"]]
            scores[l["id"]] = {"label": l["label"], "score": float(v), "percentile": float((col[np.isfinite(col)] <= v).mean()), "kind": l["kind"]}
    pred = {k: g[k][i] for k in ["elev_mean", "relief", "slope_mean", "slope_max", "map_mm", "rl25_3d", "sand", "clay", "lc_tree",
                                  "lc_crop", "lc_built", "lc_bare", "dist_fault_km", "eq_density", "population", "age_ma"]}
    return clean({"available": True, "cell_id": int(g["cell_id"][i]), "lat": g["lat"][i], "lon": g["lon"][i], "state": str(g["state"][i]),
                  "pibe_class": str(g["susc_class"][i]), "pibe_percentile": pibe_pct()[i], "flat_terrain": bool(g["slope_max"][i] < 10),
                  "recorded_positive": bool(g["y"][i] == 1), "record_source": str(g["src"][i]) or None, "lithology": str(g["lith_group"][i]) or None,
                  "scores": scores, "predictors": pred, "district": None,
                  "explanation": {"available": False, "message": "Per-cell feature contributions are not available for this model artifact; see global SHAP importance."},
                  "uncertainty": "Spatial uncertainty surface not available for this model artifact."})


@app.get("/api/susceptibility/shap")
def shap():
    return store.jload("susceptibility/shap_global.json")


# ------------------------------------------------------------------ rainfall
@app.get("/api/rainfall")
def rainfall(lat: float, lon: float, date: str, days: int = Query(60, ge=7, le=365)):
    t = check_date(date)
    c = imd_cell_at(lat, lon)
    if c is None:
        return {"available": False, "message": "Insufficient model/data coverage for this location."}
    R = store.rainfall().matrix()
    t0 = max(0, t - days + 1)
    r = R[max(0, t - sc.HISTORY + 1):t + 1, int(c.cell)].astype(float)
    E, D = sc.running_event(r, sc.WET, 2)
    n = len(r)
    dates = store.rainfall().dates()[t0:t + 1].astype(str)
    return clean({"available": True, "cell": int(c.cell), "cell_lat": c.lat, "cell_lon": c.lon, "state": c.state,
                  "series": {"date": dates.tolist(), "rain": r[n - len(dates):].round(2).tolist(),
                             "E": E[n - len(dates):].round(2).tolist(), "D": D[n - len(dates):].tolist()},
                  "source": store.rainfall().name})


@app.get("/api/rainfall/map")
def rainfall_map(date: str):
    s = day_state(date)
    return geo(s, ["R0", "E", "D", "state"])


# ------------------------------------------------------------------ thresholds
@app.get("/api/threshold/curves")
def curves(A30: float = 0, MAP: float = 2000, S: float = 0.5):
    p = store.threshold_params()
    D = np.arange(1, 61, dtype=float)
    out = {"D": D.tolist()}
    for name, q in p["published"].items():
        out[name] = (q["a"] * (24 * D) ** q["b"] * 24 * D).tolist()
    f = p["frequentist_ed"]; out["Frequentist E-D (T5)"] = (f["alpha"] * D ** f["beta"]).tolist()
    m = p["macumba"]; out["MaCumBA-type I-D (G = 1)"] = (m["alpha"] * D ** m["beta"] * D).tolist()
    out["SACT (event-conditional)"] = sc.sact_threshold_E(D, A30, MAP, S, p["sact"]).tolist()
    return clean({"curves": out, "inputs": {"A30": A30, "MAP": MAP, "S": S},
                  "note": "E-D space (event rainfall in mm vs duration in days). Published I-D curves converted with I = E/(24 D). "
                          "The MaCumBA-type curve uses its own event definition (G = 1)."})


class ThresholdInput(BaseModel):
    E: float = Field(..., ge=0, description="Event rainfall (mm)")
    D: float = Field(..., ge=0, description="Event duration (days); 0 = no ongoing event")
    A30: float = Field(0, ge=0, description="Rainfall in the 30 days before event start (mm)")
    MAP: float = Field(..., gt=0, description="Mean annual precipitation (mm)")
    S: float = Field(..., ge=0, le=1, description="Frozen pre-2013 susceptibility percentile")
    E_G1: Optional[float] = Field(None, ge=0, description="Event rainfall under the MaCumBA event definition (G = 1)")
    D_G1: Optional[float] = Field(None, ge=0)


def evaluate(x):
    p = store.threshold_params()
    E, D, A, M, S = [np.array([v], float) for v in (x["E"], x["D"], x["A30"], x["MAP"], x["S"])]
    E1 = np.array([x.get("E_G1", x["E"]) if x.get("E_G1") is not None else x["E"]]); D1 = np.array([x.get("D_G1") if x.get("D_G1") is not None else x["D"]])
    res = {}
    for name, q in p["published"].items():
        mg = sc.published_margin(E, D, q["a"], q["b"])[0]
        res[name] = {"exceeded": bool(mg >= 0), "log_margin": mg, "threshold_E_mm": q["a"] * (24 * max(D[0], 1)) ** q["b"] * 24 * max(D[0], 1)}
    f = p["frequentist_ed"]
    res["Frequentist E-D (T5)"] = {"exceeded": bool(sc.freq_margin(E, D, f)[0] >= 0), "log_margin": sc.freq_margin(E, D, f)[0],
                                   "threshold_E_mm": f["alpha"] * max(D[0], 1) ** f["beta"]}
    m = p["macumba"]
    res["MaCumBA-type I-D"] = {"exceeded": bool(sc.macumba_margin(E1, D1, m)[0] >= 0), "log10_margin": sc.macumba_margin(E1, D1, m)[0],
                               "threshold_E_mm": m["alpha"] * max(D1[0], 1) ** m["beta"] * max(D1[0], 1)}
    s = p["sact"]
    pr = sc.sact_prob(E, D, A, M, S, s)[0]
    res["SACT (event-conditional)"] = {"exceeded": bool(pr >= s["p_star"]), "probability_given_event": pr, "p_star": s["p_star"],
                                       "threshold_E_mm": sc.sact_threshold_E(D, A, M, S, s)[0] if D[0] > 0 else None,
                                       "note": "Zero outside rainfall events; the S term is statistically unsupported (coefficient interval spans zero)."}
    for v in res.values():
        if v.get("threshold_E_mm") and D[0] > 0:
            v["margin_mm"] = x["E"] - v["threshold_E_mm"]
    return {"in_event": bool(D[0] > 0), "results": res,
            "interpretation": "Historical threshold exceedance indicates rainfall conditions associated with past landslide occurrence; it does not mean a landslide will occur.",
            "disclaimer": DISCLAIMER}


@app.post("/api/threshold/evaluate")
def threshold_post(x: ThresholdInput):
    return clean(evaluate(x.model_dump()))


@app.get("/api/threshold/evaluate")
def threshold_get(lat: float, lon: float, date: str):
    s = day_state(date)
    c = imd_cell_at(lat, lon)
    row = s[s.cell == int(c.cell)] if c is not None else s.iloc[0:0]
    if row.empty:
        return {"available": False, "message": "Insufficient model/data coverage for this location."}
    r = row.iloc[0]
    out = evaluate({"E": r.E, "D": r.D, "A30": r.ant30, "MAP": r.map_mm, "S": r.S, "E_G1": r.E_G1, "D_G1": r.D_G1})
    out.update({"available": True, "date": date, "cell": int(r.cell), "cell_lat": r.lat, "cell_lon": r.lon, "state": r.state,
                "inputs": {"R0": r.R0, "R1": r.R1, "E": r.E, "D": r.D, "A30": r.ant30, "MAP": r.map_mm, "S": r.S},
                "note": in_sample_note(date)})
    return clean(out)


# ------------------------------------------------------------------ nowcast
@app.get("/api/nowcast/map")
def nowcast_map(date: str, model: str = "pi_gbm", mode: str = Query("operating", pattern="^(operating|budget)$")):
    if model not in ML:
        raise HTTPException(404, f"Unknown nowcast model {model}")
    meta = store.ml_meta(model)
    if meta is None:
        return {"installed": False, "message": "model artifact not installed", "model": ML[model]}
    s = day_state(date)
    col = "ml_" + model
    cut = meta["operating_cut"] if mode == "operating" else meta["cut5"]
    s = s.assign(score=s[col], alert=s[col] >= cut)
    fc = geo(s, ["score", "alert", "state", "R0"])
    return clean({"installed": True, "model": meta["model_name"], "date": date, "mode": mode, "cut": cut,
                  "cut_definition": meta["operating_cut_method"] if mode == "operating" else meta["cut5_method"] + " (the paper's 5 % alert budget; about 5 % of calibration cell-days, not a 5 % probability)",
                  "n_cells": len(s), "n_alerted": int(s.alert.sum()), "alerted_share": float(s.alert.mean()),
                  "score_stats": {"min": s.score.min(), "median": s.score.median(), "p95": s.score.quantile(.95), "max": s.score.max()},
                  "output": meta["output"], "note": in_sample_note(date), "disclaimer": DISCLAIMER, "geojson": fc})


class NowcastInput(BaseModel):
    lat: float
    lon: float
    date: str
    model: str = "pi_gbm"


@app.post("/api/nowcast/predict")
def nowcast_predict(x: NowcastInput):
    if x.model not in ML:
        raise HTTPException(404, f"Unknown nowcast model {x.model}")
    meta = store.ml_meta(x.model)
    if meta is None:
        return {"installed": False, "message": "model artifact not installed"}
    s = day_state(x.date)
    c = imd_cell_at(x.lat, x.lon)
    row = s[s.cell == int(c.cell)] if c is not None else s.iloc[0:0]
    if row.empty:
        return {"available": False, "message": "Insufficient model/data coverage for this location."}
    v = float(row.iloc[0]["ml_" + x.model])
    return clean({"available": True, "installed": True, "model": meta["model_name"], "score": v, "percentile_among_cells_today": float((s["ml_" + x.model] <= v).mean()),
                  "above_operating_cut": v >= meta["operating_cut"], "above_5pct_budget_cut": v >= meta["cut5"], "metadata": meta,
                  "note": in_sample_note(x.date), "disclaimer": DISCLAIMER})


# ------------------------------------------------------------------ two-tier research priority
CATS = {1: "No rainfall threshold exceedance", 2: "Threshold exceeded, ML score below research cut",
        3: "Threshold exceeded and ML score above research cut", 4: "Threshold exceeded, ML score above cut, and High/Very high susceptibility"}


def two_tier(s, tier1, model):
    meta = store.ml_meta(model)
    t1 = s["t1_" + tier1]
    t2 = s["ml_" + model] >= meta["operating_cut"] if meta else pd.Series(False, index=s.index)
    hi = s.pibe_p90 >= 0.90
    cat = np.where(~t1, 1, np.where(~t2, 2, np.where(~hi, 3, 4)))
    return cat, t1, t2, hi


@app.get("/api/twotier/map")
def twotier_map(date: str, tier1: str = "frequentist_ed", model: str = "pi_gbm"):
    if tier1 not in TIER1 or model not in ML:
        raise HTTPException(404, "Unknown method")
    s = day_state(date)
    cat, t1, t2, hi = two_tier(s, tier1, model)
    s = s.assign(category=cat, tier1=t1, tier2=t2, high_susceptibility=hi, ml_score=s["ml_" + model])
    return clean({"date": date, "tier1_method": TIER1[tier1], "tier2_model": ML[model], "categories": CATS,
                  "counts": {int(k): int((cat == k).sum()) for k in CATS}, "ml_installed": store.ml_meta(model) is not None,
                  "logic": {"tier1": f"{TIER1[tier1]} exceeded on this day", "tier2": f"{ML[model]} model score at or above its calibration-derived operating cut",
                            "susceptibility": "90th percentile of the national PIBE percentile within the IMD cell is 0.90 or above (High or Very high class)"},
                  "note": in_sample_note(date),
                  "banner": "Experimental research framework - not an official warning. This two-tier configuration has not been prospectively validated as an operational warning system.",
                  "geojson": geo(s, ["category", "tier1", "tier2", "high_susceptibility", "ml_score", "R0", "E", "D", "state"])})


# ------------------------------------------------------------------ analyze a location
@app.get("/api/analyze")
def analyze(lat: float, lon: float, date: str, model: str = "pi_gbm", tier1: str = "frequentist_ed"):
    if model not in ML or tier1 not in TIER1:
        raise HTTPException(404, "Unknown method")
    su = susc_cell(lat, lon)
    th = threshold_get(lat, lon, date)
    if not th.get("available"):
        return {"available": False, "message": "Insufficient model/data coverage for this location.", "susceptibility": su}
    s = day_state(date)
    row = s[s.cell == th["cell"]]
    cat, t1, t2, hi = two_tier(row, tier1, model)
    meta = store.ml_meta(model)
    v = float(row["ml_" + model].iloc[0]) if meta else None
    nc = {"installed": meta is not None, "model": ML[model], "score": v,
          "percentile_among_cells_today": float((s["ml_" + model] <= v).mean()) if meta else None,
          "above_operating_cut": bool(v >= meta["operating_cut"]) if meta else None,
          "above_5pct_budget_cut": bool(v >= meta["cut5"]) if meta else None}
    tier_txt = CATS[int(cat[0])]
    interp = [f"Susceptibility: PIBE class {su.get('pibe_class', 'n/a')} for the 0.05 degree cell." if su.get("available") else "No susceptibility coverage at this point.",
              "Rainfall: no ongoing rainfall event (D = 0), so event-based thresholds cannot be exceeded." if not th["in_event"] else
              f"Rainfall: day {int(th['inputs']['D'])} of an event with {th['inputs']['E']:.0f} mm so far.",
              f"Two-tier research category: {tier_txt}."]
    return clean({"available": True, "date": date, "location": {"lat": lat, "lon": lon, "state": th["state"], "district": None,
                                                                "rainfall_cell": th["cell"], "rainfall_cell_centre": [th["cell_lat"], th["cell_lon"]]},
                  "susceptibility": su, "rainfall": th["inputs"], "thresholds": th["results"], "nowcast": nc,
                  "two_tier": {"tier1_method": TIER1[tier1], "tier1": bool(t1.iloc[0]), "tier2": bool(t2.iloc[0]),
                               "high_susceptibility": bool(hi.iloc[0]), "category": int(cat[0]), "label": tier_txt},
                  "interpretation": interp, "model_information": meta,
                  "limitations": ["Daily 0.25 degree rainfall misses sub-daily bursts and orographic detail",
                                  "The test period is dominated by 2013-2016 NASA GLC events", "Catalogue locations are uncertain by up to 25 km",
                                  "The two-tier configuration has not been prospectively validated", th.get("note")],
                  "disclaimer": DISCLAIMER})


# ------------------------------------------------------------------ events, validation, downloads
@app.get("/api/events")
def events():
    return store.jload("events/index.json")


@app.get("/api/events/{event_id}")
def event(event_id: str):
    p = store.DATA_ROOT / "events" / f"{event_id}.json"
    if not p.exists():
        raise HTTPException(404, "Unknown event")
    d = store.jload(f"events/{event_id}.json")
    c = store.imd_cells().set_index("cell")
    d["cell_coords"] = {k: [float(c.loc[int(k), "lat"]), float(c.loc[int(k), "lon"])] for k in d["daily"]}
    return d


@app.get("/api/tables/{name}")
def table(name: str):
    if not name.replace("_", "").isalnum() or not (store.DATA_ROOT / "validation" / f"{name}.csv").exists():
        raise HTTPException(404, "Unknown table")
    return clean(store.validation(name).to_dict("records"))


@app.get("/api/comparison")
def comparison():
    names = ["T_susc_cv", "T_topk", "T_susc_by_source", "T_threshold_skill", "T_threshold_ci", "T_leakage_audit", "T_sact_ablation",
             "T_sact_sensitivity", "T_bias_sensitivity", "T_buffer_sensitivity", "T_pibe_ladder"]
    out = {n: store.validation(n).to_dict("records") for n in names if (store.DATA_ROOT / "validation" / f"{n}.csv").exists()}
    si = store.jload("validation/tables_for_si.json")
    out["event_only"] = next((t for t in si if t["caption"].startswith("Table S14")), None)
    out["sact_coefficients"] = next((t for t in si if t["caption"].startswith("Table S13")), None)
    out["numbers"] = store.jload("validation/numbers.json")
    return clean(out)


@app.get("/api/download")
def downloads():
    root = store.DOWNLOAD_ROOT
    if not root.exists():
        return {"available": False, "files": []}
    files = [{"path": str(p.relative_to(root)).replace("\\", "/"), "bytes": p.stat().st_size} for p in sorted(root.rglob("*"))
             if p.is_file() and "code" not in p.relative_to(root).parts]
    return {"available": True, "files": files, "metadata": {"crs": "EPSG:4326", "susceptibility_resolution": "0.05 degree",
            "rainfall_resolution": "0.25 degree daily", "training_period_nowcast": "2007-2012", "evaluation_period": "2013-2025"}}


@app.get("/api/download/{path:path}")
def download(path: str):
    root = store.DOWNLOAD_ROOT.resolve()
    p = (root / path).resolve()
    if root not in p.parents or not p.is_file():
        raise HTTPException(404, "File not found")
    return FileResponse(p, filename=p.name)
