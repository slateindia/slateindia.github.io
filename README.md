# SLATE: Slope Landslide Analytics and Triggering Explorer

Author: Kishan Tiwari (kishantiwari@iitkgp.ac.in)

An interactive research platform for landslide susceptibility and rainfall-triggering analysis, built on the paper
"National landslide susceptibility and rainfall-triggering thresholds in India: spatial transferability, inventory bias
and machine learning". **Research model output. Not an official landslide warning.**

Every value comes from the paper's pipeline outputs, or from its calibrated models applied to the archived IMD
rainfall (1991-2025). The ML nowcast models are retrained with the paper's exact procedure, and the build aborts
unless they reproduce the paper's test-period scores. The tests then check that the app's event features, SACT
probabilities and ML scores match the paper's saved outputs.

## Publish on GitHub Pages (public, no server)

The site is fully static: every computation (events, thresholds, SACT, TRIGRS FS, all six ML models) runs in the
visitor's browser from the exported data in `frontend/public/data` (about 220 MB: gzip-compressed daily IMD rainfall
1991-2025, model trees, susceptibility grid). Nothing is precomputed per date, so every date and cell remains available.

1. Create a GitHub repository and push the contents of this `webapp/` folder to its `main` branch
   (`frontend/public/data` must be committed; no file exceeds 50 MB).
2. In the repository, open Settings, then Pages, and set Source to "GitHub Actions".
3. The workflow `.github/workflows/pages.yml` builds and publishes the site to `https://<user>.github.io/<repository>/`.

Preview the static build locally: `cd frontend && npm run build && npm run preview`, then open http://localhost:3001.
The site must be served over http(s); opening `out/index.html` directly from disk is blocked by browser security rules.

### Keeping the browser engine exact

After changing the analysis, rebuild and re-verify:

```bash
python scripts/build_artifacts.py          # data contract + model retraining (verified against the paper)
python scripts/build_static.py             # export for the static site + Python reference outputs
python scripts/build_explanations.py       # per-cell PIBE contributions (refit verified) + historical context
frontend/node_modules/.bin/tsc -p scripts/tsconfig.verify.json
node scripts/verify_static.mjs             # browser engine vs Python on 8 dates, 4,838 cells, all models
```

Verification result (September 2026): event rainfall, duration, antecedent rainfall, FS and all threshold decisions
identical to the Python backend; LR, RF, LightGBM and CatBoost scores within 1e-15, XGBoost within 7e-7 (its float32
precision); zero alert changes at either cut for any model.

## Run locally with the Python backend (development)

```bash
# 1. build the data contract from ../analysis (once; about 5 minutes including model retraining)
python scripts/build_artifacts.py

# 2. backend (Python 3.9)
pip install -r backend/requirements.txt
cd backend && uvicorn app.main:app --port 8000      # API docs at http://localhost:8000/docs

# 3. frontend against the backend (Node 20+)
cd frontend && npm install && NEXT_PUBLIC_API=http://localhost:8000 npm run dev   # http://localhost:3000
```

Or, after step 1: `docker compose up` (Dockerfiles are provided but were not tested on the build machine).

Tests: `cd backend && python -m pytest` (numerical regression against the paper's outputs in `../analysis/data/interim`).

## Layout

| Path | Contents |
|---|---|
| `IMPLEMENTATION_PLAN.md` | inspection of available and missing artifacts, architecture, risks |
| `scripts/build_artifacts.py` | builds `data/` from the analysis outputs; retrains and verifies the ML nowcasts |
| `backend/app/science.py` | event definition, TRIGRS, thresholds, SACT, features (vendored from the paper's code) |
| `backend/app/store.py` | artifact loading, `RainfallProvider` (static IMD archive; live IMD provider is a stub) |
| `backend/app/main.py` | FastAPI routes |
| `frontend/app/*` | pages: dashboard, analyze, susceptibility, thresholds, nowcast, two-tier, events, comparison, leakage, sensitivity, PIBE explainer, methods, data, about, admin |
| `docs/` | data dictionary, model card, API, scientific methods |
| `data/` | generated artifacts (not versioned); `data/manifest.json` records data, model and application versions |

## Replacing or adding artifacts

Rebuild `data/` with `scripts/build_artifacts.py` after re-running the analysis. A model is "installed" when
`data/models/<id>.joblib` and `<id>.json` exist; missing artifacts are reported as "model artifact not installed" and
never replaced by other output. A live rainfall feed is added by implementing `RainfallProvider` in `backend/app/store.py`.

## Not included, and why

- **District selector:** no district boundary layer was supplied.
- **Per-cell explanations:** SHAP values exist only globally and for a sample of cells, so the app shows "not available".
- **Pixel-level uncertainty maps:** none were produced by the study.
- **Demo mode:** not needed, because all real artifacts are available.
- **Map rendering:** the 0.05° susceptibility grid is served as a server-rendered PNG overlay (under 200 kB) instead of a COG tile server. At this grid size that is simpler and just as fast; add a tile server if finer rasters are introduced.
- **UI components:** shadcn/ui is not used; plain Tailwind components keep the dependency tree small.
