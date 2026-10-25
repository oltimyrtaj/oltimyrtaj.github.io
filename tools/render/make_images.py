"""Build every still image for the website from the exported FIRE-2 maps.

python make_images.py [names...]     # default: all
Run from the site folder with the HDF5 files in ./website_data (or set WEBSITE_DATA).
Outputs replace the images in images/research and images/gallery.
"""
import os
import sys

import h5py
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

import galrender as G
from halo_fill import remove_features   # after-cooldown cleanup (Olti, Oct 2026)

# Images are written straight into the site, at the paths the pages use.
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "images")
BG = (4, 6, 12)
INK = (232, 236, 246)
STAR_KW = dict(dust=1.0, birth_tau=1.0, halpha=5.0e7, halpha_blur=1.4, balance=(0.9, 1.0, 1.12))
SOFT, PCT = 20.0, 99.8

featured = h5py.File(G.DATA + "website_featured.hdf5", "r")
mosaic = h5py.File(G.DATA + "website_mosaic.hdf5", "r")
halo = h5py.File(G.DATA + "website_halo.hdf5", "r")
pair = h5py.File(G.DATA + "website_pair.hdf5", "r")
movie = h5py.File(G.DATA + "website_movie_Romeo.hdf5", "r")

# Lookback times on the paper's convention (snapshot_times.txt), keyed by snapshot.
SNAP_LBT = dict(zip(movie["meta/snapshot"][()].tolist(), movie["meta/lookback_Gyr"][()].tolist()))


def ago(group):
    lb = SNAP_LBT[int(group.attrs["snapshot"])]
    return "Today" if lb < 0.05 else "{:.1f} Gyr ago".format(lb)


def save(img, rel, quality=88):
    path = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.convert("RGB").save(path, "JPEG", quality=quality, optimize=True, progressive=True)
    print("wrote", rel, img.size, "{:.0f} KB".format(os.path.getsize(path) / 1e3))


def blur_rgb(rgb, sigma):
    if not sigma:
        return rgb
    return np.stack([ndimage.gaussian_filter(rgb[..., c], sigma) for c in range(3)], axis=-1)


def starlight_panel(group, crop=None, white=None, blur=0.6, pct=PCT, soft=SOFT, **kw):
    """(PIL image, white, kpc per pixel) of mock starlight for one stored view."""
    maps, ext = G.load(group)
    if crop:
        maps, ext, _ = G.crop_kpc(maps, ext, **crop)
    kpc_px = (ext[1] - ext[0]) / next(iter(maps.values())).shape[1]
    opts = dict(STAR_KW); opts.update(kw)
    rgb = blur_rgb(G.starlight(maps, **opts), blur)
    arr, white = G.asinh_rgb(rgb, white=white, pct=pct, soft=soft)
    return G.to_image(arr), white, kpc_px


def text(draw, xy, s, size, weight=450, fill=INK, anchor="la"):
    draw.text(xy, s, font=G.font(size, weight), fill=fill, anchor=anchor)


def bar(img, kpc_px, kpc, xy=None, size=None):
    """Scale bar with its label, bottom-left by default."""
    d = ImageDraw.Draw(img)
    W, H = img.size
    size = size or max(13, int(W / 46))
    m = int(size * 1.1)
    x0, y0 = xy if xy else (m, H - m)
    d.line([(x0, y0), (x0 + kpc / kpc_px, y0)], fill=INK, width=max(2, size // 9))
    text(d, (x0, y0 - size * 0.45), "{:g} kpc".format(kpc), size, anchor="ld")
    return img


# Framing for each phase: (source, label, field of view in kpc, scale bar in kpc, edge-on softness).
# Sources: "featured:<epoch>:<fov group>" or "movie:<lookback Gyr>" (the movie's 50 kpc frames).
PHASES = [("featured:protogalaxy:fov25", "Protogalaxy", 25.0, 5, SOFT),
          ("movie:7.05", "Thick disk", 36.0, 5, 8.0),
          ("featured:today:fov60", "Thin disk", 50.0, 10, 6.0)]


def movie_view(view, lookback):
    """Decoded maps for the movie frame nearest a lookback time, like G.load()."""
    lb = movie["meta/lookback_Gyr"][()]
    i = int(np.argmin(np.abs(lb - lookback)))
    maps = {}
    for n in movie[view].keys():
        ds = movie[view][n]
        data = ds[i]
        lo, hi = float(ds.attrs["min"]), float(ds.attrs["max"])
        val = 10.0 ** (lo + (data.astype(np.float64) - 1.0) / 254.0 * (hi - lo))
        val[data == 0] = 0.0
        maps[n] = np.flipud(val)
    return maps, np.asarray(movie[view].attrs["extent_kpc"], float), float(lb[i])


def phase_source(src, view):
    """(maps, extent, lookback) for one phase source and view."""
    kind, *rest = src.split(":")
    if kind == "movie":
        return movie_view(view, float(rest[0]))
    ep, fov = rest
    g = featured["Romeo/{}/{}/{}".format(ep, fov, view)]
    maps, ext = G.load(g)
    return maps, ext, SNAP_LBT[int(featured["Romeo/" + ep].attrs["snapshot"])]


def phase_view(src, width, view, out_w, edge_soft):
    maps, ext, lb = phase_source(src, view)
    h = width if view == "faceon" else width / 2
    maps, ext, _ = G.crop_kpc(maps, ext, width=width, height=h)
    kpc_px = (ext[1] - ext[0]) / next(iter(maps.values())).shape[1]
    rgb = blur_rgb(G.starlight(maps, **STAR_KW), 0.6)
    arr, _ = G.asinh_rgb(rgb, pct=PCT, soft=SOFT if view == "faceon" else edge_soft)
    img = G.to_image(arr)
    out_h = out_w if view == "faceon" else out_w // 2
    scale = img.size[0] / out_w
    return img.resize((out_w, out_h), Image.LANCZOS), kpc_px * scale, lb


def ago_lb(lb):
    return "Today" if lb < 0.05 else "{:.1f} Gyr ago".format(lb)


# ----------------------------------------------------------------------------- research tiles
def research_tiles():
    names = ["research/phase-protogalaxy.jpg", "research/phase-thick-disk.jpg", "research/phase-thin-disk.jpg"]
    for (src, label, width, bar_kpc, edge_soft), rel in zip(PHASES, names):
        img, kpc_px, lb = phase_view(src, width, "edgeon", 800, edge_soft)
        d = ImageDraw.Draw(img)
        text(d, (24, 22), ago_lb(lb), 24, anchor="lt")
        bar(img, kpc_px, bar_kpc, size=22)
        save(img, rel)


# ----------------------------------------------------------------------------- three phases
def three_phases():
    col_w, gap = 640, 6
    W, H = 3 * col_w + 2 * gap, col_w + gap + col_w // 2
    canvas = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(canvas)
    for i, (src, label, width, bar_kpc, edge_soft) in enumerate(PHASES):
        face, kpc_px, lb = phase_view(src, width, "faceon", col_w, edge_soft)
        edge, _, _ = phase_view(src, width, "edgeon", col_w, edge_soft)
        x = i * (col_w + gap)
        canvas.paste(face, (x, 0))
        canvas.paste(edge, (x, col_w + gap))
        text(d, (x + 26, 24), label, 30, weight=500, anchor="lt")
        text(d, (x + 26, 62), ago_lb(lb), 22, anchor="lt")
        bar(canvas, kpc_px, bar_kpc, xy=(x + 26, H - 24), size=20)
    save(canvas, "gallery/three-phases.jpg")


# ----------------------------------------------------------------------------- twelve galaxies
ORDER = ["Romeo", "Juliet", "Romulus", "Remus", "Thelma", "Louise",     # ELVIS pairs on top
         "m12b", "m12c", "m12f", "m12i", "m12m", "m12r"]


def twelve():
    tile, gap = 512, 4
    whites = []
    for name in ORDER:
        maps, ext = G.load(mosaic[name + "/faceon"])
        lum = G.starlight(maps, **STAR_KW).mean(axis=2)
        whites.append(np.percentile(lum[lum > 0], PCT))
    white = float(np.median(whites))          # one brightness scale for the whole suite
    W, H = 6 * tile + 5 * gap, 2 * (tile + tile // 2) + gap
    canvas = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(canvas)
    for k, name in enumerate(ORDER):
        r, c = divmod(k, 6)
        x, y = c * (tile + gap), r * (tile + tile // 2 + gap)
        face, _, kpc_px = starlight_panel(mosaic[name + "/faceon"], white=white)
        edge, _, _ = starlight_panel(mosaic[name + "/edgeon"], white=white)
        canvas.paste(face, (x, y))
        canvas.paste(edge, (x, y + tile))
        text(d, (x + 20, y + 18), name, 28, weight=500, anchor="lt")
    bar(canvas, kpc_px, 10, xy=(20, tile + tile // 2 - 18), size=20)
    save(canvas.resize((2400, int(round(2400 * H / W))), Image.LANCZOS), "gallery/twelve-galaxies.jpg", quality=86)


# ----------------------------------------------------------------------------- helpers for gas maps
def log_norm(a, lo_pct=35, hi_pct=99.7, lo=None, hi=None):
    pos = a[a > 0]
    lo = np.log10(np.percentile(pos, lo_pct)) if lo is None else lo
    hi = np.log10(np.percentile(pos, hi_pct)) if hi is None else hi
    x = (np.log10(np.maximum(a, 1e-30)) - lo) / (hi - lo)
    x[a <= 0] = 0
    return np.clip(x, 0, 1)


def screen(*layers):
    out = np.zeros_like(layers[0])
    for l in layers:
        out = 1 - (1 - out) * (1 - np.clip(l, 0, 1))
    return out


TEAL = np.array([84, 224, 204]) / 255.0


# ----------------------------------------------------------------------------- spin-up
def spinup():
    g = featured["Romeo/spinup_gas"]
    tiles = []
    for view in ["faceon", "edgeon"]:
        maps, ext = G.load(g["fov25/" + view])
        maps, ext, _ = G.crop_kpc(maps, ext, width=12.5, height=12.5)
        kpc_px = (ext[1] - ext[0]) / maps["gas_cold"].shape[1]
        stars = blur_rgb(G.starlight(maps, **STAR_KW), 0.6)
        s_arr, _ = G.asinh_rgb(stars, pct=99.7, soft=25)
        gas = log_norm(ndimage.gaussian_filter(maps["gas_cold"], 0.9), lo_pct=45, hi_pct=99.8) ** 1.4
        rgb = screen(s_arr, gas[..., None] * TEAL * 0.8)
        tiles.append((G.to_image(rgb).resize((800, 800), Image.LANCZOS), kpc_px * 512 / 800, view))
    gap = 6
    canvas = Image.new("RGB", (2 * 800 + gap, 800), BG)
    d = ImageDraw.Draw(canvas)
    for i, (img, kpc_px, view) in enumerate(tiles):
        canvas.paste(img, (i * (800 + gap), 0))
        text(d, (i * (800 + gap) + 26, 24), "Face-on" if view == "faceon" else "Edge-on", 28, weight=500, anchor="lt")
    text(d, (26, 62), ago(g) + ", at the onset of gas rotation", 22, anchor="lt")
    bar(canvas, tiles[0][1], 2, xy=(26, 800 - 26), size=20)
    save(canvas, "gallery/gas-and-stars-spin-up.jpg")


# ----------------------------------------------------------------------------- temperature maps
T_STOPS = [(3.8, (30, 60, 170)), (4.4, (45, 125, 245)), (4.9, (84, 224, 204)),
           (5.4, (176, 110, 240)), (5.85, (250, 92, 84)), (6.3, (255, 196, 92)), (6.8, (255, 246, 214))]


def t_color(logT):
    xs = np.array([s[0] for s in T_STOPS]); cs = np.array([s[1] for s in T_STOPS], float) / 255
    x = np.clip(logT, xs[0], xs[-1])
    return np.stack([np.interp(x, xs, cs[:, c]) for c in range(3)], axis=-1)


def temp_density(maps, lo_pct=3, hi_pct=99.9, floor=0.28, gamma=0.75, blur=0.7):
    dens = ndimage.gaussian_filter(maps["gas_mass"], blur)
    b = floor + (1 - floor) * log_norm(dens, lo_pct=lo_pct, hi_pct=hi_pct) ** gamma
    b[maps["gas_mass"] <= 0] = 0
    return t_color(maps["gas_logT"]) * b[..., None]


def colorbar(canvas, x, y, w, h, size=18):
    d = ImageDraw.Draw(canvas)
    xs = np.linspace(4.0, 6.5, w)
    strip = (t_color(np.repeat(xs[None, :], h, axis=0)) * 255).astype(np.uint8)
    canvas.paste(Image.fromarray(strip), (x, y))
    for v, sup in [(4, "⁴"), (5, "⁵"), (6, "⁶")]:
        px = x + int((v - 4.0) / 2.5 * (w - 1))
        d.line([(px, y + h), (px, y + h + 6)], fill=INK, width=2)
        text(d, (px, y + h + 9), "10" + sup + " K", size, anchor="mt")
    text(d, (x, y - 8), "Gas temperature", size, anchor="ld")


def hot_halo():
    tiles = []
    for ep in ["before_cooldown", "after_cooldown"]:
        g = halo["Romeo/" + ep]
        maps, ext = G.load(g["edgeon"])
        if ep == "after_cooldown":
            maps, _ = remove_features(maps, ext)
        kpc_px = (ext[1] - ext[0]) / maps["gas_mass"].shape[1]
        tiles.append((G.to_image(temp_density(maps)).resize((900, 900), Image.LANCZOS), kpc_px * 1024 / 900, g, ep))
    gap = 6
    canvas = Image.new("RGB", (2 * 900 + gap, 900), BG)
    d = ImageDraw.Draw(canvas)
    for i, (img, kpc_px, g, ep) in enumerate(tiles):
        x = i * (900 + gap)
        canvas.paste(img, (x, 0))
        text(d, (x + 28, 26), "Before cooldown" if ep == "before_cooldown" else "After cooldown", 30, weight=500, anchor="lt")
        text(d, (x + 28, 66), ago(g), 22, anchor="lt")
    bar(canvas, tiles[0][1], 20, xy=(28, 900 - 30), size=20)
    colorbar(canvas, 2 * 900 + gap - 28 - 300, 900 - 70, 300, 14)
    save(canvas, "gallery/hot-inner-halo.jpg")


# ----------------------------------------------------------------------------- pair
def romeo_juliet():
    g = pair["RomeoJuliet/faceon"]
    maps, ext = G.load(g)
    width = 1180.0                                       # crop to the pair with ~170 kpc margins
    maps, ext, _ = G.crop_kpc(maps, ext, width=width, height=width * 9 / 16)
    kpc_px = (ext[1] - ext[0]) / maps["gas_mass"].shape[1]
    dens = log_norm(ndimage.gaussian_filter(maps["gas_mass"], 1.2), lo_pct=1, hi_pct=99.95)
    hot = np.clip((maps["gas_logT"] - 4.6) / 1.2, 0, 1)[..., None]
    tint = TEAL * (1 - hot) + np.array([0.62, 0.36, 0.95]) * hot
    gas = tint * (0.55 * dens ** 1.25)[..., None]
    st = log_norm(ndimage.gaussian_filter(maps["star_mass"], 0.8), lo_pct=55, hi_pct=99.995) ** 1.6
    rgb = screen(gas, st[..., None] * np.array([1.0, 0.94, 0.84]))
    img = G.to_image(rgb).resize((1920, 1080), Image.LANCZOS)
    kpc_px *= maps["gas_mass"].shape[1] / 1920
    d = ImageDraw.Draw(img)
    sep = 839.0
    for name, s_ in [("Romeo", -0.5), ("Juliet", 0.5)]:
        px = (s_ * sep - ext[0]) / kpc_px
        text(d, (px, 1080 / 2 + 150), name, 44, weight=500, anchor="mt")
    bar(img, kpc_px, 100, size=32)
    save(img, "gallery/romeo-and-juliet.jpg")


# ----------------------------------------------------------------------------- cold gas disk
PINK = np.array([255, 93, 151]) / 255.0
ICE = np.array([150, 205, 255]) / 255.0


def gas_disk():
    g = featured["Romeo/today/fov60/faceon"]
    maps, ext = G.load(g)
    kpc_px = (ext[1] - ext[0]) / maps["gas_cold"].shape[1]
    cold = log_norm(ndimage.gaussian_filter(maps["gas_cold"], 0.7), lo_pct=20, hi_pct=99.8)
    base = np.stack([cold ** 1.6 * 0.55, cold ** 1.15 * 0.85, cold ** 0.9], axis=-1) * ICE / ICE.max()
    sf = log_norm(ndimage.gaussian_filter(maps["gas_sfr"], 1.0), lo_pct=40, hi_pct=99.9) ** 1.6
    img = G.to_image(screen(base, sf[..., None] * PINK * 0.9))
    text(ImageDraw.Draw(img), (26, 24), ago(featured["Romeo/today"]), 26, anchor="lt")
    bar(img, kpc_px, 10, size=24)
    save(img, "gallery/gas-face-on.jpg")


# ----------------------------------------------------------------------------- birth phases
PHASE_RGB = {"star_phase_proto": (255, 128, 98), "star_phase_thick": (255, 201, 95), "star_phase_thin": (175, 203, 255)}


def birth_phases():
    g = featured["Romeo/today/fov60/edgeon"]
    maps, ext = G.load(g)
    maps, ext, _ = G.crop_kpc(maps, ext, width=40, height=20)
    pw, ph, gap = 900, 450, 6
    kpc_px = (ext[1] - ext[0]) / pw
    layers = {}
    for name, col in PHASE_RGB.items():
        a = log_norm(ndimage.gaussian_filter(maps[name], 0.8), lo_pct=30, hi_pct=99.8) ** 2.0
        layers[name] = a[..., None] * (np.array(col) / 255.0)
    panels = [("All stars today", screen(*layers.values())),
              ("Born in the protogalaxy", layers["star_phase_proto"]),
              ("Born in the thick disk", layers["star_phase_thick"]),
              ("Born in the thin disk", layers["star_phase_thin"])]
    canvas = Image.new("RGB", (2 * pw + gap, 2 * ph + gap), BG)
    d = ImageDraw.Draw(canvas)
    for k, (label, arr) in enumerate(panels):
        x, y = (k % 2) * (pw + gap), (k // 2) * (ph + gap)
        canvas.paste(G.to_image(arr).resize((pw, ph), Image.LANCZOS), (x, y))
        text(d, (x + 24, y + 20), label, 26, weight=500, anchor="lt")
    bar(canvas, kpc_px, 5, xy=(24, ph - 24), size=20)
    save(canvas, "gallery/birth-phases.jpg")


JOBS = {"research": research_tiles, "three": three_phases, "twelve": twelve, "spinup": spinup,
        "halo": hot_halo, "pair": romeo_juliet, "gas": gas_disk, "phases": birth_phases}

if __name__ == "__main__":
    for n in (sys.argv[1:] or list(JOBS)):
        JOBS[n]()
