# Model cards

Author: Kishan Tiwari. Source: the paper's methods; values from the exported data in `frontend/public/data`.

## PIBE (susceptibility)
- **Purpose:** relative national ranking of landslide susceptibility with reduced influence of heterogeneous reporting effort.
- **Input data:** 36 predictors at 0.05° (terrain, rainfall climatology, soil, land cover, tectonics, lithology), plus TRIGRS P(FS<1) and the AHP index; population and built-up fraction as reporting covariates.
- **Training data and target:** recorded-positive 0.05° cells from the harmonised inventory (1995-2025); other cells are unlabelled background (positive-unlabelled framing).
- **Model:** mean of XGBoost, LightGBM and CatBoost with source weights and monotone constraints; reporting covariates fixed at national medians for prediction.
- **Validation:** five 1° spatial-block folds; leave-one-region-out transfer; block bootstrap intervals.
- **Metrics:** PIBE AUC 0.955 (95 % interval in `api/susceptibility_layers.json`), AP 0.484.
- **Limitations:** agrees less with catalogue labels than the unadjusted ensemble by design; not a probability; no pixel uncertainty.
- **Resolution:** 0.05°, static.

## Frozen pre-2013 PIBE (S)
- **Purpose:** susceptibility covariate for the triggering models that is free of landslide labels after 2012.
- **Training data:** the same design, trained only on records dated 2012 or earlier (171 cells), predicted spatially out-of-fold.
- **Known leakage controls:** later landslide labels excluded. Predictor layers are *not* historically reconstructed (WorldCover 2021, WorldPop 2020, earthquakes to 2026), so this is label-leakage-controlled, not a historical hindcast. S shares 2007-2012 labels with the threshold calibration period.

## SACT (event-conditional threshold)
- **Purpose:** test whether conditioning a daily threshold on antecedent rainfall, climate and susceptibility adds skill.
- **Target:** landslide on a cell-day, *conditional on an ongoing rainfall event*; zero outside events.
- **Model:** logistic regression on ln E, ln D, ln(1 + A30/100 mm), ln(MAP/1000 mm) and S, fitted on 2007-2012 event days; the operating point p* maximises calibration TSS.
- **Metrics:** 2013-2025 TSS 0.580, AUC 0.832, POD at the 5 % budget 0.164; event days only TSS 0.263, AUC 0.700.
- **Limitations:** the S coefficient interval spans zero, so the S exponent has no stable physical interpretation; the E-D-only formulation performs as well.

## ML nowcasts (LR, RF, XGBoost, LightGBM, CatBoost, PI-GBM)
- **Purpose:** daily cell-level model scores for spatial prioritisation.
- **Input:** 22 daily predictors (PI-GBM adds the daily TRIGRS FS); exact list in `frontend/public/data/models/<id>.json`.
- **Training:** 2007-2012 monitored cell-days, negatives undersampled 20:1, fixed hyperparameters, seed 42; operating cut from year-grouped inner out-of-fold predictions; 5 % budget cut = 95th percentile of those predictions.
- **Output:** model score, not a calibrated probability.
- **Metrics (2013-2025):** PI-GBM TSS 0.618, AUC 0.889, POD at 5 % budget 0.454; event days only TSS 0.392, AUC 0.811. The boosting models differ within uncertainty.
- **Reproduction:** retrained models match the paper's test scores (max |diff| ≤ 3e-16).
- **Limitations:** daily 0.25° rainfall; evaluation dominated by 2013-2016 events; 2007-2012 outputs are in-sample; not prospectively validated.

## Thresholds (published, frequentist E-D, MaCumBA-type)
Parameters in `frontend/public/data/api/threshold_params.json`. Frequentist E-D: 5 % exceedance of calibration triggering conditions, E = α D^β. MaCumBA-type: I-D slope from regression, intercept and gap (G = 1) optimised for TSS on 2007-2012.
