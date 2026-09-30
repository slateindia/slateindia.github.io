# Data and code for: National landslide susceptibility and rainfall-triggering thresholds in India: spatial transferability, inventory bias and machine learning

Author: Kishan Tiwari (kishantiwari@iitkgp.ac.in), [co-authors]
Version: 1.0
Licence: data under CC BY 4.0; code under the MIT licence (see `LICENSE`).

This deposit contains the harmonised landslide inventory, the 0.05° predictor table, spatial cross-validation folds and out-of-fold scores, the national PIBE susceptibility grid, the frozen pre-2013 susceptibility used by the triggering models, the daily threshold calibration and test panels, test predictions, event hindcasts, all result tables and figures, and the scripts that regenerate every number in the manuscript.

## Contents

```
data/
  inventory_raw_workbook.xlsx                 compiled raw inventory (9,642 records, 1995-2026, 13 sources)
  inventory_harmonised.csv                    harmonised inventory (9,608 records, 1995-2025) with modelling-subset flags
  predictors_005deg.csv.gz                    36 predictors and labels for every 0.05° cell
  susceptibility_oof_scores_and_folds.csv.gz  spatial-block folds, regions and out-of-fold scores of all susceptibility models
  susceptibility_national_005deg.csv.gz       national PIBE score and class, component scores, frozen pre-2013 score
  susceptibility_frozen_pre2013.csv           frozen pre-2013 PIBE percentile S_pre for every 0.05° cell
  grids/pibe_score.tif                        PIBE score, 0.05°, EPSG:4326, nodata -9999
  grids/pibe_class.tif                        PIBE class 1-5 (Very low 60 %, Low 20 %, Moderate 10 %, High 5 %, Very high 5 % of area), nodata 0
  grids/susceptibility_frozen_pre2013.tif     frozen pre-2013 susceptibility, 0.05°, nodata -9999
  imd_cell_index.csv                          IMD 0.25° land cell index -> cell-centre lat/lon
  threshold_panel_celldays.csv.gz             monitored cell-days 2007-2025 with rainfall, event and static predictors
  threshold_test_predictions.csv.gz           2013-2025 test cell-days with SACT and ML scores
  triggering_conditions.csv                   rainfall conditions on landslide days (all years)
  hindcasts/                                  Kerala 2018 and Himachal Pradesh 2023 hindcasts (per cell and per cell-day)
tables/     all result tables (CSV) and numbers.json, the source of every number in the manuscript
figures/    Figs 1-9 and S1 (PNG and PDF, 600 dpi; numbering follows the analysis scripts, see note below)
code/scripts/     pipeline (run order in code/README_pipeline.md)
code/manuscript/  manuscript text sources with {{number}} placeholders filled from tables/numbers.json
requirements.txt  Python 3.9 package versions
```

Figure file numbering: the files are named by analysis step. In the manuscript, Fig02_workflow is Fig. S2, Fig09_region_transfer is Fig. S3, and Fig03 to Fig08 are Figs 2 to 7.

## Key definitions

- Grid: 0.05° susceptibility cells (`cell_id`, centre `lat`/`lon`, `row`/`col` from the north-west corner); 0.25° IMD rainfall cells (`cell`, see `imd_cell_index.csv`).
- `y` (susceptibility tables): 1 = recorded-positive cell; 0 = unlabelled background (not confirmed stable). Cells adjacent to positives are excluded from modelling.
- `fold`: spatial cross-validation fold of 1° blocks; `region`: NW Himalaya, NE India, Western Ghats or rest of India (leave-one-region-out tests).
- `src`: inventory source of the positive cell.
- Score columns in `susceptibility_oof_scores_and_folds`: AHP, TRIGRS-MC (P(FS<1)), FR, LR, RF, XGBoost, LightGBM, CatBoost; V0-V4 the PIBE component ladder (V0 plain GBM ensemble, V1 + process features, V2 + source weights, V3 + monotone constraints, V4 = PIBE with reporting-covariate adjustment); PIBE_cal isotonic-calibrated PIBE; Blend exploratory nested blend.
- `pibe_score`: PIBE score of the model refitted on all cells, with population and built-up fraction fixed at national medians. `susc_class`: area-share class. It is a relative ranking, not a probability.
- `S_pre`: national percentile (0-1) of PIBE retrained only on landslide records dated 2012 or earlier, predicted spatially out-of-fold. Predictor layers are not reconstructed to 2012 (for example WorldCover 2021, WorldPop 2020), so this controls leakage of later landslide labels only.
- Threshold panel (one row per monitored cell-day): `t` day index from 1991-01-01 and `date`; `y` landslide on that cell-day; `R0`, `R1` rainfall on the day and previous day (mm); `A3`-`A60` running totals (mm); `maxR3` 3-day maximum; `E` cumulated event rainfall (mm) and `D` event duration (days) with wet day ≥ 1 mm and a 2-day no-rain gap (D = 0 outside events); `ant15`/`ant30`/`ant60` rainfall before the event start; `FS` daily TRIGRS factor of safety; `map_mm` mean annual precipitation; `rl25_1d`, `rl25_3d` 25-year return levels; `slope_rep` representative slope; `sand`, `clay` (%); `S`, `S50`, `S75`, `S100` frozen susceptibility aggregated in the IMD cell (90th percentile, median, 75th percentile, maximum); `doy_s`, `doy_c` seasonality; `E_rl3`, `R0_rl1` rainfall normalised by return levels.
- Calibration period 2007-2012; test period 2013-2025 (376 of 377 test landslide days fall in 2013-2016). SACT scores are zero outside rainfall events.
- Hindcasts: `*_days` alert days per cell (suffix 5 = 5 % alert budget), `n_ls` mapped landslides in the cell, `peak_*` alerted on any of the three wettest days.

## Data not redistributed

Third-party inputs must be downloaded from their providers (details in `code/README_pipeline.md` and the manuscript): IMD 0.25° daily gridded rainfall (India Meteorological Department, Pune), Copernicus GLO-90 DEM, SoilGrids 2.0, ESA WorldCover 2021, WorldPop 2020, GEM Global Active Faults, USGS ComCat, and the Generalized Geology of the World via Macrostrat. The inventory files combine records from the NASA Global Landslide Catalog, the Kerala 2018 (doi:10.17026/dans-x6c-y7x2), Himachal Pradesh 2023 (doi:10.5281/zenodo.10492992) and Chamoli 1999 (doi:10.5281/zenodo.15647406) inventories and other sources listed in the manuscript; cite the original sources when reusing them.

## Reproducing the results

Install Python 3.9 and `pip install -r requirements.txt`, place the raw inputs in `code/data/raw` as described in `code/README_pipeline.md`, copy `data/inventory_raw_workbook.xlsx` to the deposit root as `India_Landslide_Intensive_Survey_1995_2026.xlsx`, and run the scripts in order from `code/scripts` (outputs are written to `code/outputs` and `code/data/interim`). `08_numbers.py` rebuilds `tables/numbers.json` and the tables; `07_manuscript.py` rebuilds the manuscript (needs Microsoft Word's MML2OMML.XSL for equations). All randomness uses seed 42.

## Citation

Tiwari K, [co-authors] (2026) National landslide susceptibility and rainfall-triggering thresholds in India: spatial transferability, inventory bias and machine learning. Landslides (submitted). Data and code: Zenodo, doi:[DOI].
