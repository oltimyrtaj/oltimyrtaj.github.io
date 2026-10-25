"""'Chemical fingerprints' figures for the Research page, one per element ([Fe/H], [Mg/Fe],
[O/Fe], [C/N]), from website_chemistry.hdf5 (extract_website_data.py v1.2, Romeo at
z = 0): orbital circularity on the left and rotation speed on the right.

Each panel is a column-normalized 2D histogram of raw star counts: every star in the
stage-1 file (stars within 20 kpc), no other cut. The export's bins are merged 2 x 2
to match the suite figure (200 abundance bins, 220 in j_z/j_c, 400 in v_phi), each
column is divided by its peak, and the color runs on a log scale from 0.4 to 1 of
that peak, as in the suite figure. The phase bands above each panel mark the median
abundance of stars born at stellar spin-up and at cooldown (phase_medians, 50th
percentile, 0.125 Gyr window).

python make_chemistry.py      (needs matplotlib; writes images/research/chem-*.png)
"""
import os

import h5py
import matplotlib as mpl
mpl.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.colors import LogNorm
from matplotlib.patches import FancyBboxPatch
import numpy as np
from PIL import Image

import galrender as G

SRC = G.DATA + "website_chemistry.hdf5"
OUTDIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "images", "research")
FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")


def jost(weight):
    """Static Jost instance from the variable font (galrender.FONT_PATHS), or None."""
    path = os.path.join(FONT_DIR, "Jost-%d.ttf" % weight)
    if not os.path.exists(path):
        try:
            from fontTools.ttLib import TTFont
            from fontTools.varLib.instancer import instantiateVariableFont
            var = next(p for p in G.FONT_PATHS if p.endswith(".ttf") and "Jost" in p and os.path.exists(p))
            f = instantiateVariableFont(TTFont(var), {"wght": weight})
            for rec in f["name"].names:
                if rec.nameID in (1, 4, 6, 16):
                    rec.string = "Jost%d" % weight
            os.makedirs(FONT_DIR, exist_ok=True)
            f.save(path)
        except Exception:
            return None
    font_manager.fontManager.addfont(path)
    return "Jost%d" % weight


REG, MED = jost(400) or "DejaVu Sans", jost(500) or "DejaVu Sans"
mpl.rcParams.update({"font.family": REG, "mathtext.fontset": "custom", "mathtext.rm": REG,
                     "mathtext.it": REG, "mathtext.bf": MED})

Y = {"jzjc": dict(view=(-1.0, 1.0), ticks=[-1, -0.5, 0, 0.5, 1], label=r"Orbital circularity, $j_z\,/\,j_c$"),
     "v_dot_phihat": dict(view=(-150.0, 350.0), ticks=[-100, 0, 100, 200, 300],
                          label=r"Rotation speed, $v_\phi$ (km s$^{-1}$)")}
ELEMENTS = {
    "feh":  dict(key="fe_over_h", label="[Fe/H]", view=(-2.0, 0.2), xticks=[-2, -1.5, -1, -0.5, 0]),
    "mgfe": dict(key="mg_over_fe", label="[Mg/Fe], axis reversed", view=(0.425, -0.05),
                 xticks=[0.4, 0.3, 0.2, 0.1, 0]),
    "ofe":  dict(key="o_over_fe", label="[O/Fe], axis reversed", view=(0.42, -0.05),
                 xticks=[0.4, 0.3, 0.2, 0.1, 0]),
    "cn":   dict(key="c_over_n", label="[C/N], axis reversed", view=(0.55, -0.12)),
}
BG, PANEL, INK, INK2, RULE = "#04070E", "#080D1A", "#E8ECF4", "#A7B0C4", "#2A3552"
PHASE = {"proto": "#FF8062", "thick": "#FFC95F", "thin": "#AFCBFF"}
CMAP = mpl.colormaps["magma"]
NORM = LogNorm(vmin=0.4, vmax=1.0)

src = h5py.File(SRC, "r")["Romeo"]


def column_normalized(ykey, xkey):
    h = src["hist"]["%s__vs__%s" % (ykey, xkey)][()].astype(float)
    ye, xe = src["edges"][ykey][()], src["edges"][xkey][()]
    ny, nx = h.shape
    h = h.reshape(ny // 2, 2, nx // 2, 2).sum(axis=(1, 3))
    ye, xe = ye[::2], xe[::2]
    peak = h.max(axis=0, keepdims=True)
    with np.errstate(invalid="ignore", divide="ignore"):
        v = np.where(peak > 0, h / peak, np.nan)
    v[v < 0.4] = np.nan
    return xe, ye, v


def element_figure(name, out):
    e = ELEMENTS[name]
    med = src["phase_medians"][e["key"]][()]          # rows gas spin-up, stellar spin-up, cooldown
    spin, cool = float(med[1, 1]), float(med[2, 1])
    fig = plt.figure(figsize=(15.0, 7.4), dpi=140, facecolor=BG)
    L, R, B, T = 0.075, 0.985, 0.2, 0.76
    gap = 0.075
    pw = (R - L - gap) / 2
    for col, ykey in enumerate(("jzjc", "v_dot_phihat")):
        y = Y[ykey]
        x0 = L + col * (pw + gap)
        ax = fig.add_axes([x0, B, pw, T - B], facecolor=PANEL)
        xe, ye, v = column_normalized(ykey, e["key"])
        ax.pcolormesh(xe, ye, np.ma.masked_invalid(v), cmap=CMAP, norm=NORM, shading="flat",
                      rasterized=True, edgecolors="none")
        ax.set_xlim(*e["view"]); ax.set_ylim(*y["view"])
        if "xticks" in e:
            ax.set_xticks(e["xticks"])
        ax.set_yticks(y["ticks"], labels=[("%g" % t).replace("-", "−") for t in y["ticks"]])
        for s in ax.spines.values():
            s.set_color(RULE); s.set_linewidth(1.0)
        ax.tick_params(colors=INK2, labelsize=15, length=5, width=1.0)
        ax.xaxis.set_major_formatter(mpl.ticker.FuncFormatter(lambda t, _: ("%g" % t).replace("-", "−")))
        ax.set_ylabel(y["label"], color=INK, fontsize=17, labelpad=8)
        ax.set_xlabel(e["label"], color=INK, fontsize=18, labelpad=6)
        bx = fig.add_axes([x0, T + 0.014, pw, 0.03], facecolor=BG)
        bx.set_xlim(*e["view"]); bx.set_ylim(0, 1); bx.axis("off")
        lo, hi = e["view"]
        for ph, a, b in [("proto", lo, spin), ("thick", spin, cool), ("thin", cool, hi)]:
            bx.fill_between([a, b], 0, 1, color=PHASE[ph], lw=0)
        yy = -0.255
        ax.annotate("", xy=(0.74, yy), xytext=(0.26, yy), xycoords="axes fraction",
                    arrowprops=dict(arrowstyle="-|>,head_length=0.6,head_width=0.3", color=INK2, lw=1.3))
        ax.text(0.0, yy, "older stars", transform=ax.transAxes, ha="left", va="center", fontsize=14, color=INK2)
        ax.text(1.0, yy, "younger stars", transform=ax.transAxes, ha="right", va="center", fontsize=14, color=INK2)
    fig.text(L, 0.935, "Romeo's stars today", ha="left", va="center", fontsize=21, family=MED, color=INK)
    fig.text(L + 0.175, 0.935, "within 20 kpc of the center", ha="left", va="center", fontsize=15, color=INK2)
    lx, ly = L, 0.86
    for ph, lab in [("proto", "Protogalaxy"), ("thick", "Thick disk"), ("thin", "Thin disk")]:
        fig.patches.append(FancyBboxPatch((lx, ly - 0.016), 0.024, 0.032, boxstyle="round,pad=0,rounding_size=0.003",
                                          transform=fig.transFigure, color=PHASE[ph], lw=0))
        fig.text(lx + 0.031, ly, lab, ha="left", va="center", fontsize=15, color=INK)
        lx += 0.125
    cax = fig.add_axes([R - 0.16, 0.925, 0.16, 0.022])
    cb = fig.colorbar(mpl.cm.ScalarMappable(norm=NORM, cmap=CMAP), cax=cax, orientation="horizontal")
    cb.set_ticks([0.4, 0.6, 0.8, 1.0], labels=["0.4", "0.6", "0.8", "1"])
    cb.ax.minorticks_off()
    cb.ax.tick_params(colors=INK2, labelsize=13, length=3)
    cb.outline.set_edgecolor(RULE)
    fig.text(R - 0.17, 0.936, "share of each column's peak", ha="right", va="center", fontsize=13, color=INK2)
    fig.savefig(out, dpi=140, facecolor=BG)
    plt.close(fig)
    print("wrote", out, Image.open(out).size, "spin-up %.3f  cooldown %.3f" % (spin, cool))


if __name__ == "__main__":
    os.makedirs(OUTDIR, exist_ok=True)
    for name in ELEMENTS:
        element_figure(name, os.path.join(OUTDIR, "chem-%s.png" % name))
