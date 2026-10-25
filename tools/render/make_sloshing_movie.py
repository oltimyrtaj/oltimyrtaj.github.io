"""Movie of Thelma from website_sloshing_Thelma.hdf5, from the protogalaxy until today,
with the published sloshing parameter s_b of Myrtaj et al. (2026) drawn alongside.

Layout (1280 x 720): Thelma's stars and cold gas on the left (the stored field of view,
40 kpc across, box x-y projection, centered on the center of mass of all matter within
20 kpc), and on the right the lookback time, the redshift, the phase, and s_b against
lookback time, with the formation of the gas disk, the formation of the stellar disk and
cooldown marked (gas and stellar spin-up in the paper). s_b is vel_bar / v_r90_star
from website_timeseries.hdf5, the values plotted in the paper. Each snapshot holds, then
dissolves into the next, with screen time proportional to the time between snapshots,
so the clock runs at a steady rate.

The arrow is the net bulk motion of the baryons relative to the galaxy's center, the
vector behind s_b, projected onto the image. It starts at the galaxy's center
(host_coordinates.hdf5). Its direction is the bulk velocity of the gas relative to the
host velocity, since the gas carries most of the mass in s_b (the gas and young stars)
and the export stores no young-star velocities. Its full length is s_b as plotted,
interpolated between the paper's epochs, at ARROW_KPC kpc per unit s_b.

python make_sloshing_movie.py      (needs ffmpeg; writes images/research/sloshing-thelma.*)
"""
import os
import subprocess

import h5py
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

import galrender as G
import make_images as M

GALAXY = "Thelma"
T_GAS_SPIN, T_STAR_SPIN, T_COOL = 7.8, 4.6, 2.35   # Thelma, lookback Gyr (Table 1)
END_LOOKBACK = 0.0                   # last frame: the first snapshot at or after this lookback (0 = today)
W, H = 1280, 720
VIEW = 720                           # galaxy panel is VIEW x VIEW on the left
FPS, FRAMES_PER_GYR, HOLD_SHARE, END_HOLD = 24, 40, 0.5, 36
PROTO, THICK, THIN = (255, 128, 98), (255, 201, 95), (175, 203, 255)
TEAL, WARM = (84, 224, 204), (255, 179, 107)
DIM, AXIS = (150, 160, 182), (70, 80, 104)

f = h5py.File(G.DATA + "website_sloshing_%s.hdf5" % GALAXY, "r")
FOV = float(f.attrs["fov_kpc"])      # kpc across the stored maps
lb_all = f["meta/lookback_Gyr"][()]
N = int(np.sum(lb_all >= END_LOOKBACK - 1e-6))     # snapshots run from early to late
lb = lb_all[:N]
zz = f["meta/redshift"][:N]
ts = h5py.File(G.DATA + "website_timeseries.hdf5", "r")[GALAXY]
sb_t = ts["lbt"][()]
sb_v = ts["vel_bar"][()] / ts["v_r90_star"][()]
T0, T1 = 13.6, lb[-1] - 0.45         # s_b panel: lookback range, left to right


def sb_at(t):
    return float(np.interp(-t, -sb_t, sb_v))


# the arrow: s_b times the direction of the gas bulk velocity relative to the host
ARROW_KPC = 12.0                     # arrow length in kpc for s_b = 1
dv = f["meta/v_gas_kms"][:N] - f["meta/host_velocity_kms"][:N]
VEC = dv / np.linalg.norm(dv, axis=1)[:, None] * np.array([sb_at(t) for t in lb])[:, None]
HOST = -f["meta/x_total_kpc"][:N]    # galaxy center relative to the map center, kpc


def maps_at(i, view="faceon"):
    out = {}
    for n in f[view].keys():
        ds = f[view][n]
        data = ds[i]
        lo, hi = float(ds.attrs["min"]), float(ds.attrs["max"])
        val = 10.0 ** (lo + (data.astype(np.float64) - 1.0) / 254.0 * (hi - lo))
        val[data == 0] = 0.0
        out[n] = np.flipud(val)
    return out


def smooth_log(values):
    return 10 ** ndimage.gaussian_filter1d(np.log10(values), 1.5, mode="nearest")


def galaxy_frames():
    stars, gas = [], []
    for i in range(N):
        m = maps_at(i)
        stars.append(M.blur_rgb(G.starlight(m, **M.STAR_KW), 0.6))
        gas.append(ndimage.gaussian_filter(m["gas_cold"], 0.9))
        print("snapshot", i + 1, "of", N, end="\r", flush=True)
    print()
    white = smooth_log([np.percentile(s.mean(axis=2)[s.mean(axis=2) > 0], 99.7) for s in stars])
    g_lo = smooth_log([np.percentile(g[g > 0], 45) for g in gas])
    g_hi = smooth_log([np.percentile(g[g > 0], 99.8) for g in gas])
    frames = []
    for i in range(N):
        s_arr, _ = G.asinh_rgb(stars[i], white=white[i], soft=25)
        g = M.log_norm(gas[i], lo=np.log10(g_lo[i]), hi=np.log10(g_hi[i])) ** 1.4
        rgb = M.screen(s_arr, g[..., None] * M.TEAL * 0.8)
        img = G.to_image(rgb).resize((VIEW, VIEW), Image.LANCZOS)
        frames.append(np.asarray(img, dtype=np.float32))
    return frames


def text_sb(d, xy, size, fill):
    """'s' with a subscript 'b'."""
    x, y = xy
    d.text((x, y), "s", font=G.font(size, 450), fill=fill, anchor="ls")
    w = d.textlength("s", font=G.font(size, 450))
    d.text((x + w + 1, y + size * 0.22), "b", font=G.font(int(size * 0.68), 450), fill=fill, anchor="ls")


# Arrow shade by s_b: nearly invisible near 0, light near 0.2, dark when s_b is large.
SHADE = [(0.00, (255, 240, 222), 0.06), (0.10, (255, 236, 214), 0.35), (0.20, (255, 222, 190), 1.0),
         (0.35, (238, 128, 72), 1.0), (0.50, (196, 52, 38), 1.0), (0.65, (128, 18, 30), 1.0)]


def shade(s):
    """(fill RGBA, halo RGBA) for an arrow of strength s_b = s."""
    xs = [p[0] for p in SHADE]
    rgb = [float(np.interp(s, xs, [p[1][c] for p in SHADE])) for c in range(3)]
    alpha = float(np.interp(s, xs, [p[2] for p in SHADE]))
    dark = float(np.clip((s - 0.25) / 0.3, 0.0, 1.0))          # dark fills get a light halo
    halo = [(1 - dark) * a + dark * b for a, b in zip((4, 6, 12), (255, 244, 230))]
    fill = tuple(int(round(v)) for v in rgb) + (int(round(255 * alpha)),)
    return fill, tuple(int(round(v)) for v in halo) + (int(round(150 * alpha)),)


def arrow(img, vec, host):
    """Projected bulk-motion arrow from the galaxy's center, shaded by s_b over a contrasting halo."""
    px = VIEW / FOV
    x0, y0 = VIEW / 2 + host[0] * px, VIEW / 2 - host[1] * px
    dx, dy = vec[0] * ARROW_KPC * px, -vec[1] * ARROW_KPC * px
    L = float(np.hypot(dx, dy))
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    head = min(22.0, 0.45 * L)
    fill, halo = shade(float(np.linalg.norm(vec)))
    for width, col in ((11, halo), (5, fill)):
        if L > 6:
            ux, uy = dx / L, dy / L
            tip = (x0 + dx, y0 + dy)
            base = (tip[0] - ux * head, tip[1] - uy * head)
            d.line([(x0, y0), base], fill=col, width=width)
            grow = (width - 5) * 0.9
            hw = 0.6 * head + grow
            pts = [(tip[0] + ux * grow, tip[1] + uy * grow),
                   (base[0] - uy * hw - ux * grow, base[1] + ux * hw - uy * grow),
                   (base[0] + uy * hw - ux * grow, base[1] - ux * hw - uy * grow)]
            d.polygon(pts, fill=col)
        r = 6 if width > 5 else 4
        d.ellipse([x0 - r, y0 - r, x0 + r, y0 + r], fill=col)
    img.paste(Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB"))
    return img


def phase(t):
    if t > T_GAS_SPIN:
        return "Protogalaxy", PROTO
    if t > T_STAR_SPIN:
        return "Gas disk forming", TEAL
    if t > T_COOL:
        return "Thick disk", THICK
    return "Thin disk", THIN


def dashed(d, x, y0, y1, fill):
    for y in range(int(y0), int(y1), 14):
        d.line([(x, y), (x, min(y + 7, y1))], fill=fill, width=2)


def overlay(img, t, z, vec=None, host=None):
    if vec is not None:
        arrow(img, vec, host)
    d = ImageDraw.Draw(img)
    # galaxy panel
    M.text(d, (24, 22), GALAXY, 30, weight=500, anchor="lt")
    M.text(d, (24, 62), "Stars, with cold gas in teal", 22, anchor="lt", fill=(200, 208, 224))
    M.text(d, (24, 92), "Arrow: net bulk motion of the baryons,", 22, anchor="lt", fill=(200, 208, 224))
    M.text(d, (24, 122), "darker for larger s", 22, anchor="lt", fill=(200, 208, 224))
    xb = 24 + d.textlength("darker for larger s", font=G.font(22, 450)) + 1
    d.text((xb, 122 + 22 * 0.22 + 22 * 0.95), "b", font=G.font(15, 450), fill=(200, 208, 224), anchor="ls")
    M.bar(img, FOV / VIEW, 5, xy=(24, VIEW - 26), size=22)
    d.line([(VIEW, 0), (VIEW, H)], fill=(18, 22, 34), width=2)
    # time and phase
    x0 = VIEW + 40
    M.text(d, (x0, 34), "Today" if t < 0.05 else "{:.1f} billion years ago".format(t), 42, anchor="lt")
    M.text(d, (x0, 92), "Redshift {:.1f}".format(max(z, 0.0)), 26, anchor="lt", fill=DIM)
    name, col = phase(t)
    M.text(d, (x0, 136), name, 32, weight=500, anchor="lt", fill=col)
    # s_b against lookback time
    px0, px1, py0, py1 = x0 + 46, W - 34, 290, 588
    ymax = 0.7

    def X(tt):
        return px0 + (T0 - tt) / (T0 - T1) * (px1 - px0)

    def Y(v):
        return py1 - min(v, ymax) / ymax * (py1 - py0)

    M.text(d, (x0, 212), "Sloshing parameter, ", 26, anchor="ls", fill=(232, 236, 246))
    text_sb(d, (x0 + d.textlength("Sloshing parameter, ", font=G.font(26, 450)), 212), 26, (232, 236, 246))
    for v in (0.0, 0.2, 0.4, 0.6):
        d.line([(px0, Y(v)), (px1, Y(v))], fill=(26, 32, 48), width=1)
        M.text(d, (px0 - 12, Y(v)), "{:g}".format(v), 20, anchor="rm", fill=DIM)
    d.line([(px0, py1), (px1, py1)], fill=AXIS, width=2)
    for tt in range(13, int(np.ceil(T1)) - 1, -1):
        major = tt % 2 == 0
        d.line([(X(tt), py1), (X(tt), py1 + (9 if major else 5))], fill=AXIS, width=2)
        if major:
            M.text(d, (X(tt), py1 + 14), str(tt), 20, anchor="mt", fill=DIM)
    M.text(d, ((px0 + px1) / 2, py1 + 44), "Billion years ago", 20, anchor="mt", fill=DIM)
    # the three transitions: dashed lines in the plot, named in a key above it
    marks = [(T_GAS_SPIN, "Gas disk forms", TEAL), (T_STAR_SPIN, "Stellar disk forms", THICK), (T_COOL, "Cooldown", THIN)]
    kx = x0
    for tm, label, col in marks:
        dashed(d, X(tm), py0, py1, col)
        for k in range(3):
            d.line([(kx + k * 9, 250), (kx + k * 9 + 5, 250)], fill=col, width=3)
        M.text(d, (kx + 32, 250), label, 19, anchor="lm", fill=col)
        kx += 32 + d.textlength(label, font=G.font(19, 450)) + 18
    # the curve: faint ahead of the current time, bright behind it
    sel = (sb_t <= T0) & (sb_t >= T1)
    tt, vv = sb_t[sel], sb_v[sel]
    d.line([(X(a), Y(b)) for a, b in zip(tt, vv)], fill=(64, 72, 94), width=3, joint="curve")
    past = [(X(a), Y(b)) for a, b in zip(tt, vv) if a >= t]
    vt = sb_at(t)
    if past:
        d.line(past + [(X(t), Y(vt))], fill=WARM, width=4, joint="curve")
    d.ellipse([X(t) - 8, Y(vt) - 8, X(t) + 8, Y(vt) + 8], fill=(255, 255, 255), outline=WARM, width=3)
    M.text(d, (x0, H - 30), "FIRE-2 simulation of a Milky Way-mass galaxy", 19, anchor="lb", fill=DIM)
    return img


def schedule():
    """(snapshot index, next index, blend weight) per video frame: each interval gets screen
    time in proportion to the time it covers, half as a hold and half as a dissolve."""
    out = []
    for i in range(N - 1):
        n = max(2, int(round(FRAMES_PER_GYR * (lb[i] - lb[i + 1]))))
        hold = int(round(HOLD_SHARE * n))
        out += [(i, i + 1, 0.0)] * hold
        fade = n - hold
        out += [(i, i + 1, k / (fade + 1.0)) for k in range(1, fade + 1)]
    out += [(N - 1, N - 1, 0.0)] * END_HOLD
    return out


def main(out_rel="research/sloshing-thelma", poster_t=12.2):
    frames = galaxy_frames()
    path = os.path.join(M.OUT, out_rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "{}x{}".format(W, H),
           "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p",
           "-movflags", "+faststart", path + ".mp4"]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    count, poster, best = 0, None, 1e9
    for i, j, w in schedule():
        arr = frames[i] * (1 - w) + frames[j] * w
        t = lb[i] * (1 - w) + lb[j] * w
        z = zz[i] * (1 - w) + zz[j] * w
        canvas = Image.new("RGB", (W, H), M.BG)
        canvas.paste(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)), (0, 0))
        img = overlay(canvas, t, z, VEC[i] * (1 - w) + VEC[j] * w, HOST[i] * (1 - w) + HOST[j] * w)
        p.stdin.write(img.tobytes())
        count += 1
        if abs(t - poster_t) < best:
            best, poster = abs(t - poster_t), img.copy()
    p.stdin.close(); p.wait()
    poster.save(path + "-poster.jpg", "JPEG", quality=88, optimize=True, progressive=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", path + ".mp4", "-c:v", "libvpx-vp9", "-b:v", "0",
                    "-crf", "34", "-row-mt", "1", "-an", path + ".webm"], check=True)
    for ext in [".mp4", ".webm", "-poster.jpg"]:
        print(out_rel + ext, "{:.2f} MB".format(os.path.getsize(path + ext) / 1e6))
    print(count, "frames,", round(count / FPS, 1), "s,", N, "snapshots from %.2f to %.2f Gyr ago" % (lb[0], lb[-1]))


if __name__ == "__main__":
    main()
