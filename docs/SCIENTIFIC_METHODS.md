# Scientific methods implemented

Author: Kishan Tiwari. The app implements, and does not alter, the methods of the source paper.

1. **Rainfall events.** For each IMD 0.25° cell, a wet day has ≥ 1 mm. An event starts on a wet day and ends after
   G consecutive dry days (G = 2; G = 1 for the MaCumBA-type threshold). E is event rainfall to date, D the number of
   days since the start (0 outside events), and A30 the rainfall in the 30 days before the event start. The app rebuilds
   the event state from the preceding 730 days; tests confirm identity with the paper's panel.
2. **Thresholds.** Published I-D curves applied unchanged (I = E/(24 D) in mm/h, D in hours). Frequentist E-D:
   E = α D^β at 5 % exceedance. MaCumBA-type: I = α D^β in mm/day with G = 1. SACT: an event-conditional logistic model
   with a closed-form E* threshold at p*; the S term is statistically unsupported.
3. **Nowcasts.** 22 daily predictors (PI-GBM adds the TRIGRS FS) passed to the paper's models; operating cut and 5 %
   budget cut from calibration-period inner out-of-fold predictions. "5 % budget" means about 5 % of calibration
   cell-days on alert, not a 5 % probability.
4. **Two-tier research priority.** Category 1: Tier-1 threshold not exceeded. 2: exceeded, ML score below its operating
   cut. 3: exceeded and ML at or above the cut. 4: as 3, and the IMD cell's 90th-percentile PIBE percentile ≥ 0.90 (High or
   Very high). Not prospectively validated; not a warning level.
5. **Susceptibility.** The PIBE national map with its area-share classes; other layers are spatial cross-validation
   out-of-fold scores of the modelled cells. Class display for those layers applies the same 60/20/10/5/5 % area shares
   to each layer's own ranking.
6. **Label-leakage control.** S comes from PIBE trained on landslide records dated 2012 or earlier. Predictor layers are
   current, not historical, so this controls label leakage only.
7. **Evaluation context.** Calibration 2007-2012; holdout 2013-2025 with 376 of 377 landslide days in 2013-2016 (the NASA GLC
   ends in 2016). Outputs for 2007-2012 dates are in-sample; dates after 2016 have no catalogue evaluation.
8. **Language.** Outputs are "model scores", "historical threshold exceedance" and "research priority"; the words warning,
   safe and danger are not used for model output.
9. **"Why does this cell have this result?"** Susceptibility contributions are exact TreeSHAP values (log-odds) of the
   three PIBE members, averaged, for a PIBE refit that reproduces the published map exactly (max difference 0.0);
   reporting covariates are fixed at national medians as for the map. Because PIBE averages member probabilities, the
   averaged log-odds contributions explain the members' behaviour rather than summing exactly to the ensemble score.
   Historical context counts monitored cell-days of the paper's threshold panel (2007-2025) in the same event-rainfall and
   duration bin, the recorded landslide days among them, and the days in 1991-2025 on which the cell's event rainfall
   reached the bin's lower edge. Contributions describe model behaviour, not physical causation.
