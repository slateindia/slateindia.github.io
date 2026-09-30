# API

Author: Kishan Tiwari. Interactive OpenAPI docs: `http://localhost:8000/docs`. Dates are `YYYY-MM-DD` within the IMD
archive (1991-01-01 to 2025-12-31); a date outside it returns 404 and is never substituted.

| Method and path | Parameters | Returns |
|---|---|---|
| `GET /api/health` | | status, artifact availability, rainfall provider and range, manifest |
| `GET /api/models` | | susceptibility layers, threshold methods, nowcast model metadata or "not installed" |
| `GET /api/model-metadata/{id}` | `pi_gbm`, `catboost`, …, `sact`, `frequentist_ed`, `macumba`, `pibe`, … | metadata JSON |
| `GET /api/boundaries/states` | | state GeoJSON |
| `GET /api/susceptibility/layers` | | grid geometry and layers |
| `GET /api/susceptibility/map.png` | `model`, `mode=class|score` | RGBA PNG covering the grid bounds |
| `GET /api/susceptibility/cell` | `lat`, `lon` | class, percentile, scores of every layer, predictors, flat-terrain flag; or a coverage message |
| `GET /api/susceptibility/shap` | | global SHAP importance |
| `GET /api/rainfall` | `lat`, `lon`, `date`, `days` | daily rainfall, E and D series for the IMD cell |
| `GET /api/rainfall/map` | `date` | GeoJSON of IMD cells with R0, E, D |
| `GET /api/threshold/curves` | `A30`, `MAP`, `S` | E-D curves for all thresholds |
| `GET /api/threshold/evaluate` | `lat`, `lon`, `date` | inputs and exceedance, threshold E and margin for every method |
| `POST /api/threshold/evaluate` | `{E, D, A30, MAP, S, E_G1?, D_G1?}` | same, for manual inputs (validated) |
| `GET /api/nowcast/map` | `date`, `model`, `mode=operating|budget` | GeoJSON with scores and alert flags, cut definition, statistics |
| `POST /api/nowcast/predict` | `{lat, lon, date, model}` | score, cut comparisons, metadata |
| `GET /api/twotier/map` | `date`, `tier1`, `model` | category per cell (1-4), counts, logic, banner |
| `GET /api/analyze` | `lat`, `lon`, `date`, `model`, `tier1` | full location report |
| `GET /api/events`, `/api/events/{id}` | | hindcast summaries and daily series |
| `GET /api/comparison` | | validation tables, event-only and SACT coefficient tables, numbers |
| `GET /api/tables/{name}` | e.g. `T_leakage_audit` | one validation table |
| `GET /api/download`, `/api/download/{path}` | | Zenodo deposit file list and files |

Every response carrying model output includes the disclaimer "Research model output. Not an official landslide warning."
