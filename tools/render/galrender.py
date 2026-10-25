"""Turn the stored FIRE-2 maps into web images.

Starlight: each stellar-age map is weighted by a rough light-to-mass ratio for a
simple stellar population of that age in three bands (blue, green, red), dimmed
by dust mixed in with the stars (slab model, transmission (1 - e^-tau) / tau),
and shown with an asinh stretch (Lupton et al. 2004) so faint outskirts and
bright centers both read. Star-forming gas can add a faint pink glow, the
color of ionized hydrogen.
"""
import h5py
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

import os

# Folder with the website_*.hdf5 files from extract_website_data.py (override with WEBSITE_DATA).
DATA = os.path.join(os.environ.get("WEBSITE_DATA", "website_data"), "")

# Rough light-to-mass ratios (arbitrary units) per age bin, in R, G, B order.
AGE_LIGHT = {
    "star_age_lt10Myr":      (9.0, 15.0, 26.0),
    "star_age_10to100Myr":   (2.3, 3.2, 4.5),
    "star_age_lt100Myr":     (3.9, 5.8, 9.0),     # movie kit: young bins merged
    "star_age_100Myrto1Gyr": (0.85, 0.95, 1.05),
    "star_age_1to5Gyr":      (0.33, 0.30, 0.26),
    "star_age_gt5Gyr":       (0.135, 0.105, 0.075),
    "star_age_gt1Gyr":       (0.20, 0.16, 0.12),  # movie kit: old bins merged
}
# V-band optical depth per (Msun / kpc^2) of gas-phase metals, for Milky Way-like
# dust (A_V / N_H = 5.3e-22 mag cm^2 at solar metallicity): 4.4e-6.
TAU_V_PER_METAL = 4.4e-6
TAU_BAND = (0.75, 1.0, 1.32)        # R, G, B optical depth relative to V
HALPHA = (1.0, 0.10, 0.45)          # R, G, B color of the star-forming-gas glow


def decode(ds):
    data = ds[()]
    kmax = np.iinfo(data.dtype).max
    lo, hi = float(ds.attrs["min"]), float(ds.attrs["max"])
    val = lo + (data.astype(np.float64) - 1.0) / (kmax - 1.0) * (hi - lo)
    out = 10.0 ** val if ds.attrs["encoding"] in ("log", b"log") else val
    out[data == 0] = 0.0
    return np.flipud(out)          # stored row 0 = bottom; images want row 0 = top


def load(group, names=None):
    names = names or [k for k in group.keys() if isinstance(group[k], h5py.Dataset)]
    maps = {n: decode(group[n]) for n in names if n in group}
    return maps, np.asarray(group.attrs["extent_kpc"], dtype=float)


YOUNG = ("star_age_lt10Myr", "star_age_10to100Myr", "star_age_lt100Myr")


def transmission(tau, mode, xi=0.35):
    """Fraction of light that escapes a column of optical depth tau.
    'mixed'    stars and dust share one layer: (1 - e^-tau) / tau
    'embedded' stars sit inside a dust layer: on average half the column is in front
    'sandwich' a dust layer of fractional thickness xi inside a thicker stellar layer
    """
    with np.errstate(invalid="ignore", divide="ignore", over="ignore"):
        mixed = np.where(tau > 1e-4, -np.expm1(-tau) / np.maximum(tau, 1e-12), 1.0 - 0.5 * tau)
    if mode == "mixed":
        return mixed
    if mode == "embedded":
        return np.exp(-0.5 * tau)
    return 0.5 * (1.0 - xi) * (1.0 + np.exp(-tau)) + xi * mixed


def starlight(maps, dust=1.0, halpha=0.0, balance=(1.0, 1.0, 1.0), young_model="mixed",
              old_model="mixed", birth_tau=1.0, xi=0.35, tau_cap=200.0, halpha_blur=0.0):
    """Linear RGB flux (H x W x 3) from the stellar-age maps, dimmed by dust mixed in
    with the stars. Stars younger than 10 Myr also sit in their birth clouds
    (extra V-band optical depth birth_tau, as in Charlot and Fall 2000)."""
    shape = next(iter(maps.values())).shape
    rgb = np.zeros(shape + (3,))
    tau_v = None
    if dust and "gas_dust" in maps:
        tau_v = np.minimum(dust * TAU_V_PER_METAL * maps["gas_dust"], tau_cap)
    for name, w in AGE_LIGHT.items():
        if name not in maps:
            continue
        young = name in YOUNG
        for c in range(3):
            layer = w[c] * balance[c] * maps[name]
            if tau_v is not None:
                layer = layer * transmission(TAU_BAND[c] * tau_v, young_model if young else old_model, xi)
            if name in ("star_age_lt10Myr", "star_age_lt100Myr") and birth_tau:
                frac = 1.0 if name == "star_age_lt10Myr" else 0.3
                layer = layer * (1 - frac + frac * np.exp(-TAU_BAND[c] * birth_tau))
            rgb[..., c] += layer
    if halpha and "gas_sfr" in maps:
        glow = maps["gas_sfr"]
        if halpha_blur:
            from scipy import ndimage
            glow = ndimage.gaussian_filter(glow, halpha_blur)
        if tau_v is not None:
            glow = glow * transmission(0.75 * tau_v, "mixed")
        for c in range(3):
            rgb[..., c] += halpha * HALPHA[c] * glow
    return rgb


def asinh_rgb(rgb, white=None, pct=99.6, soft=12.0, sat=1.0):
    """Lupton-style asinh stretch that keeps colors. white: flux that maps to ~1."""
    lum = rgb.mean(axis=2)
    if white is None:
        pos = lum[lum > 0]
        white = np.percentile(pos, pct) if pos.size else 1.0
    x = lum / white
    with np.errstate(invalid="ignore", divide="ignore"):
        f = np.where(x > 0, np.arcsinh(soft * x) / np.arcsinh(soft) / np.maximum(x, 1e-30), 0.0)
    out = rgb / white * f[..., None]
    if sat != 1.0:
        grey = out.mean(axis=2, keepdims=True)
        out = grey + sat * (out - grey)
    # soft-clip: colors that overflow fade toward white instead of hue-shifting
    m = out.max(axis=2, keepdims=True)
    over = np.maximum(m - 1.0, 0.0)
    out = np.where(m > 1.0, out / np.maximum(m, 1e-9) + over / (1.0 + over) * (1.0 - out / np.maximum(m, 1e-9)), out)
    return np.clip(out, 0.0, 1.0), white


def to_image(arr01, gamma=1.0):
    a = np.clip(arr01, 0, 1) ** (1.0 / gamma)
    return Image.fromarray((a * 255 + 0.5).astype(np.uint8))


def crop_kpc(maps, extent, width=None, height=None, cx=0.0, cy=0.0):
    """Crop every map to a box [cx +- width/2, cy +- height/2] in kpc (image coords: rows top -> bottom)."""
    umin, umax, vmin, vmax = extent
    ny, nx = next(iter(maps.values())).shape
    px = nx / (umax - umin)
    width = width or (umax - umin)
    height = height or (vmax - vmin)
    c0 = int(round((cx - width / 2 - umin) * px)); c1 = c0 + int(round(width * px))
    r0 = int(round((vmax - (cy + height / 2)) * px)); r1 = r0 + int(round(height * px))
    out = {}
    for k, v in maps.items():
        pad = np.zeros((r1 - r0, c1 - c0))
        rr0, rr1, cc0, cc1 = max(r0, 0), min(r1, ny), max(c0, 0), min(c1, nx)
        pad[rr0 - r0:rr1 - r0, cc0 - c0:cc1 - c0] = v[rr0:rr1, cc0:cc1]
        out[k] = pad
    return out, (cx - width / 2, cx + width / 2, cy - height / 2, cy + height / 2), px


FONT_PATHS = [os.environ.get("WEBSITE_FONT", ""),            # e.g. a local copy of Jost[wght].ttf
              os.path.expanduser("~/Library/Fonts/Jost[wght].ttf"),
              "/root/.fonts/Jost[wght].ttf",
              "/System/Library/Fonts/Helvetica.ttc",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]


def font(size, weight=450):
    for p in FONT_PATHS:
        try:
            f = ImageFont.truetype(p, size)
            try:
                f.set_variation_by_axes([weight])
            except Exception:
                pass
            return f
        except OSError:
            pass
    return ImageFont.load_default()


def scale_bar(img, kpc_per_px, length_kpc, label=None, margin=None, color=(235, 238, 245)):
    img = img.copy(); d = ImageDraw.Draw(img)
    W, H = img.size
    margin = margin or max(12, W // 40)
    L = length_kpc / kpc_per_px
    lw = max(2, W // 400)
    y = H - margin
    d.line([(margin, y), (margin + L, y)], fill=color, width=lw)
    f = font(max(12, W // 48))
    text = label or "{:g} kpc".format(length_kpc)
    tb = d.textbbox((0, 0), text, font=f)
    d.text((margin, y - lw - (tb[3] - tb[1]) - max(4, W // 200)), text, fill=color, font=f)
    return img


def label(img, text, pos="tl", margin=None, size=None, color=(235, 238, 245)):
    img = img.copy(); d = ImageDraw.Draw(img)
    W, H = img.size
    margin = margin or max(12, W // 40)
    f = font(size or max(12, W // 40))
    tb = d.textbbox((0, 0), text, font=f)
    w, h = tb[2] - tb[0], tb[3] - tb[1]
    x = margin if "l" in pos else W - margin - w
    y = margin - tb[1] if "t" in pos else H - margin - h - tb[1]
    d.text((x, y), text, fill=color, font=f)
    return img
