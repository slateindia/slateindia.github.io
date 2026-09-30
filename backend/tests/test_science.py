"""Unit and numerical regression tests. Reference values come from the paper's saved pipeline outputs
(analysis/data/interim), never from hand-typed expectations."""
from pathlib import Path
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app import science as sc
from app import store
from app.main import app, day_state

INT = Path(__file__).resolve().parents[3] / "analysis" / "data" / "interim"
needs_ref = pytest.mark.skipif(not (INT / "threshold_panel.pkl").exists(), reason="paper pipeline outputs not present")
client = TestClient(app)


def test_event_definition():
    r = np.array([0, 5, 10, 0, 0, 0, 3, 0, 20, 0], float)
    E, D = sc.running_event(r, 1, 2)
    assert E.tolist() == [0, 5, 15, 15, 0, 0, 3, 3, 23, 23] and D.tolist() == [0, 1, 2, 3, 0, 0, 1, 2, 3, 4]
    E2, D2 = sc.running_event(np.c_[r, r[::-1]], 1, 2)  # vectorised over cells
    assert np.allclose(E2[:, 0], E) and np.allclose(E2[:, 1], sc.running_event(r[::-1], 1, 2)[0])


def test_budget_is_a_ranking():
    s = np.arange(1000, dtype=float)
    assert sc.top_budget(s, 0.05).sum() == 50


def test_sact_outside_event_is_zero():
    p = store.threshold_params()["sact"]
    assert sc.sact_prob(np.array([500.0]), np.array([0.0]), np.array([100.0]), np.array([2000.0]), np.array([0.9]), p)[0] == 0


def test_sact_closed_form_is_the_p_star_contour():
    p = store.threshold_params()["sact"]
    D, A, M, S = np.array([5.0]), np.array([80.0]), np.array([1500.0]), np.array([0.6])
    E = sc.sact_threshold_E(D, A, M, S, p)
    assert np.isclose(sc.sact_prob(E, D, A, M, S, p)[0], p["p_star"], rtol=1e-6)


@needs_ref
@pytest.mark.parametrize("date", ["2014-07-15", "2013-06-17"])
def test_features_thresholds_and_ml_match_paper(date):
    ref = pd.read_pickle(INT / "threshold_test_pred.pkl")
    panel = pd.read_pickle(INT / "threshold_panel.pkl")
    t = store.rainfall().day_index(date)
    s = day_state(date).set_index("cell")
    pr = panel[panel.t == t].set_index("cell")
    rr = ref[ref.t == t].set_index("cell")
    assert len(pr) > 50
    for a, b in [("E", "E"), ("D", "D"), ("ant30", "ant30"), ("A30", "A30"), ("R0", "R0"), ("FS", "FS"), ("S", "S")]:
        assert np.allclose(s.loc[pr.index, a], pr[b], rtol=1e-6, atol=1e-6), a
    assert np.allclose(s.loc[rr.index, "sact_p"], rr.SACT, rtol=1e-6, atol=1e-9)
    if store.ml_meta("pi_gbm"):
        assert np.allclose(s.loc[rr.index, "ml_pi_gbm"], rr["PI-GBM (proposed)"], atol=1e-6)
        assert np.allclose(s.loc[rr.index, "ml_catboost"], rr["CatBoost"], atol=1e-6)


@needs_ref
def test_hindcast_scores_match_paper():
    if not store.ml_meta("pi_gbm"):
        pytest.skip("PI-GBM artifact not installed")
    h = pd.read_pickle(INT / "hindcast_daily_SRC_KERALA2018.pkl")
    t = store.rainfall().day_index("2018-08-16")
    ref = h[h.t == t].set_index("cell")
    s = day_state("2018-08-16").set_index("cell")
    assert np.allclose(s.loc[ref.index, "ml_pi_gbm"], ref["PI-GBM"], atol=1e-6)
    assert np.allclose(s.loc[ref.index, "sact_p"], ref.SACT, atol=1e-9)
    assert (s.loc[ref.index, "t1_frequentist_ed"] == ref.FREQ.astype(bool)).all()


def test_susceptibility_lookup_roundtrip():
    g = store.susc_grid()
    i = 12345
    r = client.get("/api/susceptibility/cell", params={"lat": float(g["lat"][i]), "lon": float(g["lon"][i])}).json()
    assert r["available"] and r["cell_id"] == int(g["cell_id"][i]) and r["pibe_class"] == str(g["susc_class"][i])


def test_api_contracts():
    assert client.get("/api/health").json()["status"] == "ok"
    assert client.get("/api/susceptibility/cell", params={"lat": 15.0, "lon": 65.0}).json()["available"] is False
    r = client.get("/api/threshold/evaluate", params={"lat": 30.5, "lon": 79.0, "date": "2026-02-01"})
    assert r.status_code == 404 and "No substitute date" in r.json()["detail"]
    assert client.post("/api/threshold/evaluate", json={"E": 100, "D": 3, "A30": 50, "MAP": 2000, "S": 1.5}).status_code == 422
    ok = client.post("/api/threshold/evaluate", json={"E": 100, "D": 3, "A30": 50, "MAP": 2000, "S": 0.5}).json()
    assert "does not mean a landslide will occur" in ok["interpretation"] and ok["disclaimer"]
    assert client.get("/api/susceptibility/map.png", params={"model": "rf"}).headers["content-type"] == "image/png"
    assert len(client.get("/api/events").json()) == 2
