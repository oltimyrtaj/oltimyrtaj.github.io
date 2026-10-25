"""Disk-formation movie of Romeo from website_movie_Romeo.hdf5.

Layout (1280 x 720): face-on view on the left, edge-on view top right, and the
lookback time, redshift and a three-phase timeline bottom right. Consecutive
snapshots (about 250 Myr apart) dissolve into each other.
"""
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

import galrender as G
import make_images as M

OUT = M.OUT
W, H = 1280, 720
FACE = 720                       # face-on panel is FACE x FACE on the left
RIGHT_X = FACE + 0
RW = W - FACE                    # right column width (560)
EDGE_H = RW // 2                 # edge-on panel RW x EDGE_H
FPS, HOLD, FADE, END_HOLD = 24, 5, 4, 36

T_SPIN_STAR, T_COOL = 11.7, 5.92     # Romeo, lookback Gyr (Table 1)
PHASE_COL = {"Protogalaxy": (255, 128, 98), "Thick disk": (255, 201, 95), "Thin disk": (175, 203, 255)}

mv = M.movie
lb = mv["meta/lookback_Gyr"][()]
zz = mv["meta/redshift"][()]
N = len(lb)


def maps_at(view, i):
    out = {}
    for n in mv[view].keys():
        ds = mv[view][n]
        data = ds[i]
        lo, hi = float(ds.attrs["min"]), float(ds.attrs["max"])
        val = 10.0 ** (lo + (data.astype(np.float64) - 1.0) / 254.0 * (hi - lo))
        val[data == 0] = 0.0
        out[n] = np.flipud(val)
    return out


def linear_rgb(view, i):
    return M.blur_rgb(G.starlight(maps_at(view, i), **M.STAR_KW), 0.5)


def smooth_whites(view):
    w = []
    for i in range(N):
        lum = linear_rgb(view, i).mean(axis=2)
        w.append(np.percentile(lum[lum > 0], M.PCT))
    return 10 ** ndimage.gaussian_filter1d(np.log10(w), 1.5, mode="nearest")


def panel(view, i, white, size, soft):
    arr, _ = G.asinh_rgb(linear_rgb(view, i), white=white, soft=soft)
    return np.asarray(G.to_image(arr).resize(size, Image.LANCZOS), dtype=np.float32)


def base_frames():
    wf, we = smooth_whites("faceon"), smooth_whites("edgeon")
    frames = []
    for i in range(N):
        canvas = np.zeros((H, W, 3), np.float32)
        canvas[:, :] = M.BG
        canvas[:, :FACE] = panel("faceon", i, wf[i], (FACE, FACE), M.SOFT)
        canvas[:EDGE_H, RIGHT_X:RIGHT_X + RW] = panel("edgeon", i, we[i], (RW, EDGE_H), 8.0)
        frames.append(canvas)
        print("snapshot", i, "of", N, end="\r", flush=True)
    print()
    return frames


def phase_of(t):
    return "Protogalaxy" if t > T_SPIN_STAR else ("Thick disk" if t > T_COOL else "Thin disk")


def overlay(img, t, z):
    d = ImageDraw.Draw(img)
    ink = M.INK
    kpc_face = 50.0 / FACE
    # panel labels and scale bars
    M.text(d, (22, 20), "Face-on", 22, weight=500, anchor="lt")
    M.text(d, (RIGHT_X + 18, 16), "Edge-on", 22, weight=500, anchor="lt")
    M.bar(img, kpc_face, 10, xy=(22, FACE - 24), size=18)
    d.line([(FACE, 0), (FACE, H)], fill=(18, 22, 34), width=2)
    d.line([(FACE, EDGE_H), (W, EDGE_H)], fill=(18, 22, 34), width=2)
    # time and phase
    x0, y0 = RIGHT_X + 34, EDGE_H + 44
    label = "Today" if t < 0.04 else "{:.1f} billion years ago".format(t)
    M.text(d, (x0, y0), label, 40, weight=400, anchor="lt")
    M.text(d, (x0, y0 + 56), "Redshift {:.1f}".format(max(z, 0.0)), 22, anchor="lt", fill=(170, 180, 200))
    ph = phase_of(t)
    M.text(d, (x0, y0 + 100), ph, 30, weight=500, anchor="lt", fill=PHASE_COL[ph])
    # timeline: lookback 13.8 (left) to 0 (right)
    bx0, bx1, by = x0, W - 40, y0 + 186
    def X(tt):
        return bx0 + (13.8 - tt) / 13.8 * (bx1 - bx0)
    for name, a, b in [("Protogalaxy", 13.8, T_SPIN_STAR), ("Thick disk", T_SPIN_STAR, T_COOL), ("Thin disk", T_COOL, 0.0)]:
        col = PHASE_COL[name]
        alpha = 1.0 if name == ph else 0.45
        c = tuple(int(v * alpha + 20 * (1 - alpha)) for v in col)
        d.rectangle([X(a), by, X(b), by + 8], fill=c)
    mx = X(t)
    d.ellipse([mx - 8, by - 4, mx + 8, by + 12], fill=ink)
    for tick, txt in [(13.8, "Big Bang"), (0.0, "Today")]:
        M.text(d, (X(tick), by + 22), txt, 17, anchor="lt" if tick > 1 else "rt", fill=(170, 180, 200))
    M.text(d, (bx0, H - 34), "FIRE-2 simulation of Romeo, a Milky Way-mass galaxy", 17, anchor="lt", fill=(150, 160, 182))
    return img


def main(out_rel="gallery/disk-formation"):
    frames = base_frames()
    path = os.path.join(OUT, out_rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".raw.mp4"
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "{}x{}".format(W, H),
           "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p",
           "-movflags", "+faststart", path + ".mp4"]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    count = 0
    poster = None
    for i in range(N):
        nxt = min(i + 1, N - 1)
        steps = [(frames[i], lb[i], zz[i])] * HOLD
        if i < N - 1:
            for k in range(1, FADE + 1):
                f = k / (FADE + 1.0)
                steps.append((frames[i] * (1 - f) + frames[nxt] * f, lb[i] * (1 - f) + lb[nxt] * f, zz[i] * (1 - f) + zz[nxt] * f))
        else:
            steps += [(frames[i], lb[i], zz[i])] * END_HOLD
        for arr, t, z in steps:
            img = overlay(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)), t, z)
            p.stdin.write(img.tobytes())
            count += 1
            poster = img
    p.stdin.close(); p.wait()
    poster.save(path + "-poster.jpg", "JPEG", quality=88, optimize=True, progressive=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", path + ".mp4", "-c:v", "libvpx-vp9", "-b:v", "0",
                    "-crf", "34", "-row-mt", "1", "-an", path + ".webm"], check=True)
    for ext in [".mp4", ".webm", "-poster.jpg"]:
        print(out_rel + ext, "{:.2f} MB".format(os.path.getsize(path + ext) / 1e6))
    print(count, "frames,", round(count / FPS, 1), "s")


if __name__ == "__main__":
    main()
