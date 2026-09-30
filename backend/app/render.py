"""PNG overlays of the 0.05 degree grid (the browser never receives the full raster table)."""
from io import BytesIO
import numpy as np
from PIL import Image

# sequential, perceptually ordered ramp (light to dark), used for classes and percentiles alike
RAMP = np.array([[255, 247, 236], [253, 212, 158], [252, 141, 89], [215, 48, 31], [127, 0, 0]], float)


def ramp(x):
    """x in [0, 1] -> RGB by linear interpolation along RAMP."""
    pos = np.clip(x, 0, 1) * (len(RAMP) - 1)
    i = np.minimum(pos.astype(int), len(RAMP) - 2)
    f = (pos - i)[:, None]
    return RAMP[i] * (1 - f) + RAMP[i + 1] * f


def grid_png(g, L, values, mode, classes=None):
    v = np.asarray(values, float)
    ok = np.isfinite(v)
    img = np.zeros((L["nrows"], L["ncols"], 4), np.uint8)
    if classes is not None:  # classes supplied by the artifact (PIBE national map)
        rgb = RAMP[np.clip(classes, 0, 4)]
    elif mode == "class":  # area-share classes of this layer's own ranking (60/20/10/5/5 %)
        pct = np.full(len(v), np.nan)
        pct[ok] = (np.argsort(np.argsort(v[ok])) + 0.5) / ok.sum()
        cls = np.digitize(pct, [0.60, 0.80, 0.90, 0.95])
        rgb = RAMP[np.clip(cls, 0, 4)]
    else:  # continuous percentile rank
        pct = np.full(len(v), np.nan)
        pct[ok] = (np.argsort(np.argsort(v[ok])) + 0.5) / ok.sum()
        rgb = ramp(np.nan_to_num(pct))
    r, c = g["row"][ok], g["col"][ok]
    img[r, c, :3] = rgb[ok].astype(np.uint8)
    img[r, c, 3] = 230
    buf = BytesIO()
    Image.fromarray(img, "RGBA").save(buf, "PNG", optimize=True)
    return buf.getvalue()
