# SLATE (Slope Landslide Analytics and Triggering Explorer): implementation plan

Author: Kishan Tiwari (kishantiwari@iitkgp.ac.in)

Interactive research platform for landslide susceptibility and rainfall-triggering analysis, built on the
artifacts of the manuscript "National landslide susceptibility and rainfall-triggering thresholds in India".
Research model output. Not an official landslide warning.

## 1. Inspection results

| Artifact | Location | Status | Use in app |
|---|---|---|---|
| IMD 0.25° daily rainfall, 4,964 land cells, 1991-01-01 to 2025-12-31 | `analysis/data/interim/imd_cells.npz` | available | rainfall, event reconstruction (E, D, A30), thresholds and nowcast features for any cell and date |
| IMD climatology (MAP, return levels) | `imd_climatology.npz`, `features_005.pkl` | available | MAP, rl25 for SACT and ML |
| 0.05° predictors (115,720 cells) | `features_005.pkl` | available | cell information panel |
| National PIBE score and class (115,701 cells) | `susc_map.pkl` | available | default susceptibility map |
| Out-of-fold scores of AHP, TRIGRS-MC, FR, LR, RF, XGBoost, LightGBM, CatBoost, V0-V4, PIBE (113,290 modelled cells) | `susc_oof.pkl` | available | model-selectable susceptibility maps (labelled "spatial cross-validation out-of-fold score") |
| Frozen pre-2013 susceptibility S_pre | `susc_pre2013.pkl` | available | S for SACT and ML (90th percentile within each IMD cell) |
| Threshold parameters (published, frequentist E-D, MaCumBA-type, SACT coefficients and intervals) | `outputs/tables/T_threshold_params.csv`, `05_thresholds.py` | available | threshold engine |
| Trained ML nowcast models (LR, RF, XGBoost, LightGBM, CatBoost, PI-GBM) | none saved | **missing** | regenerated deterministically (seed 42) from `threshold_panel.pkl` by `scripts/build_artifacts.py`, and verified against the saved test predictions |
| ML operating cuts and 5 % budget cuts | not saved | **missing** | recomputed with the paper's year-grouped inner out-of-fold procedure |
| Test predictions 2013-2025 | `threshold_test_pred.pkl` | available | regression reference for SACT and ML |
| Hindcasts Kerala 2018, Himachal 2023 | `hindcast_*.pkl`, `T_hindcast.csv` | available | event explorer |
| Landslide inventory with source and coordinates | `inventory_clean.csv` | available | event landslide points |
| Validation tables (CV, CIs, leakage audit, sensitivity, ablation, event-only) | `outputs/tables/*.csv`, `tables_for_si.json` | available | comparison, leakage, sensitivity pages |
| State boundaries | `analysis/data/raw/aux/Admin2.shp` (DataMeet) | available | map overlay |
| District boundaries | none | **missing** | district selector omitted until a layer is supplied |
| SHAP values (PIBE CatBoost member, sample of cells) | `T_shap.csv`, `shap_values.npy` | available (global only) | global importance; per-cell "why" only for sampled cells, otherwise "not available" |
| Pixel-level uncertainty surfaces | none | missing | UI states "Spatial uncertainty surface not available" |
| Live IMD feed | none | missing | `IMDRainfallProvider` interface only; static provider covers 1991-2025 |

## 2. What can be computed

- Rainfall, event rainfall E, duration D (G = 2 and G = 1), antecedent A15/A30/A60, all 22 ML features and the daily TRIGRS FS, for every IMD cell in the study domain and every date 1991-2025, using the same code as the paper (vendored in `backend/app/science.py`).
- Published, frequentist E-D, MaCumBA-type and SACT threshold exceedance and margins for any cell-date.
- ML nowcast scores for any cell-date once the retrained models are installed. Dates inside the calibration period (2007-2012) are flagged as in-sample.
- Two-tier research-priority categories per IMD cell and date.

## 3. Architecture

```
webapp/
  scripts/build_artifacts.py   reads analysis outputs -> webapp/data (data contract below); retrains + verifies ML
  backend/  FastAPI (Python 3.9): app/main.py (routes), app/store.py (artifact loading), app/science.py
            (event definition, TRIGRS, thresholds, features), app/render.py (PNG overlays), tests/
  frontend/ Next.js 14 + TypeScript + Tailwind + MapLibre GL + Recharts
  docs/     DATA_DICTIONARY.md, MODEL_CARD.md, API.md, SCIENTIFIC_METHODS.md
  data/     generated, not versioned (DATA_ROOT)
  docker-compose.yml
```

Data contract (`webapp/data`): `rainfall/imd_cells.npz`; `static/imd_cells.csv` (IMD cell static inputs: lat, lon,
state, MAP, return levels, representative slope, sand, clay, S, S50, S75, S100); `susceptibility/grid.npz` (0.05° rows/cols,
lat/lon, state, PIBE score/class, S_pre, OOF scores per model, selected predictors); `models/*.joblib` and
`models/*.json` (metadata, predictors, cuts); `thresholds/params.json`; `events/*.json`; `validation/*.csv`;
`boundaries/states.geojson`; `manifest.json` (data, model and application versions).

Susceptibility maps are served as server-rendered PNG overlays of the 0.05° grid (about 590 × 590 px, under 200 kB),
which is smaller than a tile pyramid for this grid and never sends the full raster table to the browser. GeoTIFFs for
download come from the Zenodo deposit. Daily IMD-grid layers are served as GeoJSON of the ≤ 4,964 cells with values.

## 4. API

`/api/health`, `/api/models`, `/api/model-metadata/{id}`, `/api/susceptibility/layers`,
`/api/susceptibility/map.png`, `/api/susceptibility/cell`, `/api/rainfall`, `/api/rainfall/map`,
`/api/threshold/curves`, `GET|POST /api/threshold/evaluate`, `/api/nowcast/map`, `POST /api/nowcast/predict`,
`/api/twotier/map`, `/api/analyze`, `/api/events`, `/api/events/{id}`, `/api/comparison`,
`/api/tables/{name}`, `/api/download`, `/api/download/{file}`. OpenAPI docs at `/docs`.

## 5. Frontend pages

Dashboard, Analyze a location, Susceptibility, Rainfall thresholds, ML nowcast, Two-tier priority map, Historical
events, Model comparison, PIBE explainer, Methods, Leakage audit, Sensitivity, Data & downloads, About, Admin (dev).

## 6. Scientific rules enforced

Disclaimer on every output page; no "warning/safe/danger" wording; scores labelled "model score" (ML outputs are
undersampled-training scores, not calibrated probabilities); SACT labelled event-conditional; S exponent flagged
unstable; label-leakage-controlled ≠ historical hindcast; test period dominated by 2013-2016; single-event hindcasts;
no substitution of dates or models; missing artifacts shown as "not installed".

## 7. Risks and assumptions

- Retrained ML models must reproduce the paper's test scores; `build_artifacts.py` aborts if the maximum absolute
  difference exceeds 1e-6 (tree libraries are deterministic with the fixed seed and thread settings used).
- The IMD record ends 2025-12-31; later dates return "rainfall data not available", never a substitute.
- Rolling features use a 730-day history window; the event state resynchronises after any 2-day dry spell, and a
  regression test checks E, D, A30 and FS against the paper's panel.
- Docker files are provided but could not be tested on the build machine (Docker not installed).
- shadcn/ui is not used; plain Tailwind components keep the dependency tree small.
