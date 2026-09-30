"""Artifact loading and the rainfall-provider abstraction. All data come from DATA_ROOT (see docs/DATA_DICTIONARY.md)."""
import os
import json
from functools import lru_cache
from pathlib import Path
import numpy as np
import pandas as pd

DATA_ROOT = Path(os.environ.get("DATA_ROOT", Path(__file__).resolve().parents[2] / "data"))
DOWNLOAD_ROOT = Path(os.environ.get("DOWNLOAD_ROOT", Path(__file__).resolve().parents[3] / "Zenodo_Deposit"))


def jload(rel):
    return json.load(open(DATA_ROOT / rel, encoding="utf-8"))


# ------------------------------------------------------------------ rainfall providers
class RainfallProvider:
    """Interface for daily rainfall on the IMD 0.25 degree land-cell grid."""
    name = "abstract"

    def available(self) -> bool: ...
    def date_range(self): ...
    def day_index(self, date: str): ...
    def matrix(self) -> np.ndarray: ...
    def get_daily_rainfall(self, date: str): ...


class StaticFileRainfallProvider(RainfallProvider):
    """IMD 0.25 degree daily gridded rainfall 1991-2025 from the archived cell cube."""
    name = "IMD 0.25 degree daily gridded rainfall (static archive)"

    def __init__(self, path):
        self.path = Path(path)
        self._z = None

    def _load(self):
        if self._z is None:
            z = np.load(self.path)
            self._z = {"rain": z["rain"], "dates": z["dates"]}
            self._index = pd.Series(np.arange(len(z["dates"])), index=pd.DatetimeIndex(z["dates"]))
        return self._z

    def available(self):
        return self.path.exists()

    def date_range(self):
        d = self._load()["dates"]
        return str(d[0]), str(d[-1])

    def day_index(self, date):
        self._load()
        ts = pd.Timestamp(date)
        return int(self._index[ts]) if ts in self._index.index else None

    def matrix(self):
        return self._load()["rain"]

    def dates(self):
        return self._load()["dates"]

    def get_daily_rainfall(self, date):
        t = self.day_index(date)
        return None if t is None else self.matrix()[t]


class IMDRainfallProvider(RainfallProvider):
    """Placeholder for a live IMD feed. No public real-time API is configured, so this provider is never active."""
    name = "IMD live feed (not configured)"

    def available(self):
        return False


# ------------------------------------------------------------------ cached artifacts
@lru_cache
def rainfall():
    return StaticFileRainfallProvider(DATA_ROOT / "rainfall" / "imd_cells.npz")


@lru_cache
def imd_cells():
    return pd.read_csv(DATA_ROOT / "static" / "imd_cells.csv")


@lru_cache
def susc_grid():
    z = np.load(DATA_ROOT / "susceptibility" / "grid.npz", allow_pickle=False)
    return {k: z[k] for k in z.files}


@lru_cache
def susc_layers():
    return jload("susceptibility/layers.json")


@lru_cache
def threshold_params():
    return jload("thresholds/params.json")


@lru_cache
def ml_model(slug):
    import joblib
    p = DATA_ROOT / "models" / f"{slug}.joblib"
    return joblib.load(p) if p.exists() else None


def ml_meta(slug):
    p = DATA_ROOT / "models" / f"{slug}.json"
    return json.load(open(p)) if p.exists() else None


@lru_cache
def validation(name):
    return pd.read_csv(DATA_ROOT / "validation" / f"{name}.csv")


def status():
    """Availability of every artifact (admin page)."""
    items = {"rainfall": DATA_ROOT / "rainfall" / "imd_cells.npz", "imd_cells": DATA_ROOT / "static" / "imd_cells.csv",
             "susceptibility_grid": DATA_ROOT / "susceptibility" / "grid.npz", "threshold_params": DATA_ROOT / "thresholds" / "params.json",
             "states": DATA_ROOT / "boundaries" / "states.geojson", "events": DATA_ROOT / "events" / "index.json",
             "validation": DATA_ROOT / "validation" / "numbers.json", "downloads": DOWNLOAD_ROOT}
    for s in ["lr", "rf", "xgboost", "lightgbm", "catboost", "pi_gbm"]:
        items["model_" + s] = DATA_ROOT / "models" / f"{s}.joblib"
    return {k: {"installed": p.exists(), "path": str(p.relative_to(DATA_ROOT.parent)) if p.exists() and DATA_ROOT.parent in p.parents else p.name,
                "modified": pd.Timestamp(p.stat().st_mtime, unit="s").isoformat(timespec="seconds") if p.exists() else None}
            for k, p in items.items()}
