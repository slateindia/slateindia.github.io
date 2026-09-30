"""Scientific core, vendored from the paper's pipeline (analysis/scripts/common.py and 05_thresholds.py).

Definitions are unchanged: wet day >= 1 mm; an event ends after G consecutive dry days; E is rainfall cumulated
from the event start to the day, D the days since the start (0 outside events); antecedent rainfall is the total
over n days before the event start; TRIGRS infinite-depth solution with a 30-day response memory.
"""
import numpy as np
from scipy.special import erfc

WET = 1.0
HISTORY = 730  # days of history used to rebuild event state; resynchronises after any G-day dry spell


def running_event(r, wet=WET, gap=2):
    """E, D for every day. r: (T,) or (T, C) daily rainfall; loops over time, vectorised over cells."""
    r = np.asarray(r, float)
    one = r.ndim == 1
    r2 = r[:, None] if one else r
    T, C = r2.shape
    E = np.zeros((T, C)); D = np.zeros((T, C), dtype=int)
    e = np.zeros(C); d = np.zeros(C, dtype=int); dry = np.zeros(C, dtype=int); active = np.zeros(C, bool)
    for t in range(T):
        w = r2[t] >= wet
        start = w & ~active
        e[start] = 0.0; d[start] = 0
        active |= w
        dry = np.where(w, 0, np.where(active, dry + 1, dry))
        active &= ~(~w & (dry >= gap))
        e = np.where(active, e + r2[t], e); d = np.where(active, d + 1, d)
        E[t] = np.where(active, e, 0.0); D[t] = np.where(active, d, 0)
    return (E[:, 0], D[:, 0]) if one else (E, D)


def ierfc(x):
    return np.exp(-x * x) / np.sqrt(np.pi) - x * erfc(x)


def trigrs_kernel(Z, D0, slope_rad, ndays, dt=86400.0):
    D1 = D0 / np.cos(slope_rad) ** 2
    t = np.arange(ndays + 1) * dt
    with np.errstate(divide="ignore", invalid="ignore"):
        F = np.where(t > 0, 2 * np.sqrt(D1 * t) * ierfc(Z / (2 * np.sqrt(D1 * t))), 0.0)
    return np.diff(F)


def trigrs_fs(rain_mm, slope_deg, Z, Ks, D0, c_kpa, phi_deg, gamma_s=20.0, memory=30):
    d = np.radians(slope_deg)
    beta = np.cos(d) ** 2
    I = np.minimum(rain_mm / 1000.0 / 86400.0, Ks) / Ks
    psi = np.minimum(np.convolve(I, trigrs_kernel(Z, D0, d, memory))[: len(I)], Z * beta)
    tphi = np.tan(np.radians(phi_deg))
    return tphi / np.tan(d) + (c_kpa - psi * 9.81 * tphi) / (gamma_s * Z * np.sin(d) * np.cos(d))


def texture_params(sand, clay, slope_deg):
    sand = np.clip(sand, 0, 100); clay = np.clip(clay, 0, 100)
    Ks = 10 ** (-0.60 + 0.0126 * sand - 0.0064 * clay) * 7.056e-6
    fc = np.clip(clay / 50.0, 0, 1)
    return dict(Ks=Ks, D0=100 * Ks, c_kpa=2.0 + 10.0 * fc, phi_deg=35.0 - 13.0 * fc, Z=np.interp(slope_deg, [10, 45], [3.0, 0.8]))


def features(R, t, cells, doy):
    """All daily predictors on day index t for the cells (DataFrame rows of static inputs, column `cell`).

    R: (T, ncell) rainfall. Returns dict of arrays, one value per cell, same definitions as the paper's panel.
    """
    t0 = max(0, t - HISTORY + 1)
    r = R[t0:t + 1, cells.cell.values].astype(float)
    n = r.shape[0]
    cs = np.vstack([np.zeros((1, r.shape[1])), np.cumsum(r, 0)])
    E, D = running_event(r, WET, 2)
    E1, D1 = running_event(r, WET, 1)
    k = n - 1
    start = k - np.maximum(D[k], 1) + 1
    ant = {m: cs[np.clip(start, 0, None), np.arange(r.shape[1])] - cs[np.clip(start - m, 0, None), np.arange(r.shape[1])]
           for m in (15, 30, 60)}
    win = {m: cs[n] - cs[max(n - m, 0)] for m in (3, 7, 15, 30, 60)}
    slope = np.clip(np.nan_to_num(cells.slope_rep.values, nan=20), 1, 60)
    p = texture_params(np.nan_to_num(cells.sand.values, nan=40), np.nan_to_num(cells.clay.values, nan=25), slope)
    fs = np.array([trigrs_fs(r[:, j], slope[j], p["Z"][j], p["Ks"][j], p["D0"][j], p["c_kpa"][j], p["phi_deg"][j])[-1]
                   for j in range(r.shape[1])])
    f = {"R0": r[k], "R1": r[k - 1] if k else np.zeros(r.shape[1]), "A3": win[3], "A7": win[7], "A15": win[15],
         "A30": win[30], "A60": win[60], "maxR3": r[max(k - 2, 0):k + 1].max(0), "E": E[k], "D": D[k].astype(float),
         "ant15": ant[15], "ant30": ant[30], "ant60": ant[60], "FS": fs,
         "doy_s": np.full(r.shape[1], np.sin(2 * np.pi * doy / 365.25)), "doy_c": np.full(r.shape[1], np.cos(2 * np.pi * doy / 365.25)),
         "map_mm": cells.map_mm.values, "rl25_1d": cells.rl25_1d.values, "rl25_3d": cells.rl25_3d.values,
         "slope_rep": cells.slope_rep.values, "sand": cells.sand.values, "clay": cells.clay.values, "S": cells.S.values,
         "E_G1": E1[k], "D_G1": D1[k].astype(float), "history_complete": D[k] < n - 60}
    f["E_rl3"] = f["E"] / f["rl25_3d"]; f["R0_rl1"] = f["R0"] / f["rl25_1d"]
    return f


# ------------------------------------------------------------------ thresholds
def published_margin(E, D, a, b):
    """log(I / threshold) for I = a D^b in mm/h and hours; -inf outside events."""
    Dh = 24 * np.maximum(D, 1)
    I = E / Dh
    with np.errstate(divide="ignore"):
        return np.where(D > 0, np.log(np.maximum(I, 1e-6) / (a * Dh ** b)), -np.inf)


def freq_margin(E, D, p):
    return np.where(D > 0, np.log(np.maximum(E, 1e-6) / (p["alpha"] * np.maximum(D, 1) ** p["beta"])), -np.inf)


def macumba_margin(E1, D1, p):
    """log10(I / threshold), I = E/D mm/day, event definition with the calibrated gap (G = 1)."""
    return np.where(D1 > 0, np.log10(np.maximum(E1 / np.maximum(D1, 1), 1e-6)) - np.log10(p["alpha"])
                    - p["beta"] * np.log10(np.maximum(D1, 1)), -np.inf)


def sact_prob(E, D, A30, MAP, S, p):
    """Event-conditional SACT probability (zero outside rainfall events)."""
    x = (p["b0"] + p["bE"] * np.log(np.maximum(E, 0.1)) + p["bD"] * np.log(np.maximum(D, 1))
         + p["bA"] * np.log1p(A30 / p["A0_mm"]) + p["bMAP"] * np.log(MAP / p["M0_mm"]) + p["bS"] * S)
    return np.where(D > 0, 1 / (1 + np.exp(-x)), 0.0)


def sact_threshold_E(D, A30, MAP, S, p):
    """Closed-form SACT event-rainfall threshold E* (mm) at p*."""
    return p["E0_mm"] * np.exp(p["ln_alpha"]) * np.maximum(D, 1) ** p["beta_D"] * (1 + A30 / p["A0_mm"]) ** p["gamma_A"] \
        * (MAP / p["M0_mm"]) ** p["delta_MAP"] * np.exp(p["eps_S"] * S)


def top_budget(scores, budget=0.05):
    """Boolean mask of approximately the top `budget` share of finite scores (a ranking, not a probability)."""
    s = np.asarray(scores, float)
    ok = np.isfinite(s)
    if not ok.any():
        return np.zeros(len(s), bool)
    cut = np.quantile(s[ok], 1 - budget)
    return ok & (s >= cut)
