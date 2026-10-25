"""Remove the extended cold gas and the satellite from the after-cooldown halo map.

Used on the "after cooldown" panel of gallery/hot-inner-halo.jpg only (Olti asked for
the extended gas on the left and the infalling satellite at lower right to go).

What is kept
  the main disk: its dense core grown into the surrounding cold gas, inside a rounded
  box that ends just past the core's tips, plus a thin shell around it that keeps the
  disk's own warm interface (the cyan rim) wherever that rim is not part of what is removed
What replaces the removed gas, scale by scale
  the radial profile of the clean hot halo, plus a smooth (harmonic) interpolation of its
  deviations from that profile across the hole, so the fill meets the hole's edge; on
  top, the halo's own grain (structure below a few kpc), copied from mirror-image
  positions at the same radius (180 degree turn, reflections across the disk plane and
  its minor axis, then other turns), blended smoothly where one source gives way to the
  next. Where the fill touches the disk, a short ramp recreates the cold-to-hot interface.
"""
import numpy as np
from scipy import ndimage, sparse
from scipy.sparse.linalg import spsolve


def _component_at_center(mask, cy, cx, box=20):
    lab, _ = ndimage.label(mask)
    near = lab[cy - box:cy + box, cx - box:cx + box]
    ids, counts = np.unique(near[near > 0], return_counts=True)
    return lab == ids[np.argmax(counts)]


def _nconv(field, weight, sigma):
    num = ndimage.gaussian_filter(field * weight, sigma)
    den = ndimage.gaussian_filter(weight, sigma)
    return num / np.maximum(den, 1e-12)


def _harmonic(values, unknown):
    """Laplace(f) = 0 on unknown pixels, f = values elsewhere (4-neighbor stencil)."""
    ny, nx = values.shape
    ys, xs = np.nonzero(unknown)
    n = ys.size
    if n == 0:
        return values.copy()
    index = -np.ones(values.shape, dtype=np.int64)
    index[ys, xs] = np.arange(n)
    deg = np.zeros(n)
    rhs = np.zeros(n)
    rows, cols = [], []
    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        yy, xx = ys + dy, xs + dx
        ok = (yy >= 0) & (yy < ny) & (xx >= 0) & (xx < nx)
        deg[ok] += 1
        p = np.nonzero(ok)[0]
        q = index[yy[ok], xx[ok]]
        inner = q >= 0
        rows.append(p[inner])
        cols.append(q[inner])
        rhs[p[~inner]] += values[yy[ok][~inner], xx[ok][~inner]]
    rows = np.concatenate(rows + [np.arange(n)])
    cols = np.concatenate(cols + [np.arange(n)])
    data = np.concatenate([-np.ones(rows.size - n), deg])
    A = sparse.csr_matrix((data, (rows, cols)), shape=(n, n))
    out = values.copy()
    out[ys, xs] = spsolve(A.tocsc(), rhs)
    return out


def _radial_profile(field, ok, r, nbins=60):
    edges = np.linspace(0, r.max(), nbins + 1)
    idx = np.clip(np.digitize(r, edges) - 1, 0, nbins - 1)
    med = np.full(nbins, np.nan)
    for i in range(nbins):
        sel = ok & (idx == i)
        if sel.sum() > 50:
            med[i] = np.median(field[sel])
    centers = 0.5 * (edges[1:] + edges[:-1])
    good = np.isfinite(med)
    med = ndimage.gaussian_filter1d(np.interp(centers, centers[good], med[good]), 1.5, mode="nearest")
    return np.interp(r, centers, med)


def remove_features(maps, ext, core_sigma=2e7, rim_sigma=9e6,
                    tip_pad=1.06, half_thick_kpc=10.0, shell_kpc=1.4, cool_cut=5.25, warm_cut=5.55,
                    reach_kpc=4.0, detail_kpc=3.0, blend_kpc=1.2, feather_kpc=1.0, ramp_kpc=0.45,
                    return_masks=False):
    gm, lt = maps["gas_mass"], maps["gas_logT"]
    ny, nx = gm.shape
    kpc = (ext[1] - ext[0]) / nx

    def px(d):
        return max(1, int(round(d / kpc)))

    cy, cx = int(round(ext[3] / kpc)), int(round(-ext[0] / kpc))       # pixel of (0, 0)
    yy, xx = np.mgrid[0:ny, 0:nx]
    dens = ndimage.gaussian_filter(gm, 1.0)

    # ---- the main disk
    core = _component_at_center(dens > core_sigma, cy, cx)
    w = gm * core
    mx, my = (w * xx).sum() / w.sum(), (w * yy).sum() / w.sum()
    cxx = (w * (xx - mx) ** 2).sum() / w.sum()
    cyy = (w * (yy - my) ** 2).sum() / w.sum()
    cxy = (w * (xx - mx) * (yy - my)).sum() / w.sum()
    theta = 0.5 * np.arctan2(2 * cxy, cxx - cyy)
    u = np.array([np.cos(theta), np.sin(theta)])
    along = (xx - mx) * u[0] + (yy - my) * u[1]
    across = -(xx - mx) * u[1] + (yy - my) * u[0]
    lo, hi = along[core].min() * tip_pad, along[core].max() * tip_pad

    def rounded_box(pad_kpc):
        """Around the disk: tapers like an ellipse past the left tip (where the removed
        gas joins the disk) and like a rounded box on the right (where the disk ends
        on its own)."""
        b = (half_thick_kpc + pad_kpc) / kpc
        a_left = -lo + pad_kpc / kpc
        a_right = hi + pad_kpc / kpc
        left = (along < 0) & ((along / a_left) ** 2 + (across / b) ** 2 < 1.0)
        right = (along >= 0) & ((along / a_right) ** 4 + (across / b) ** 2 < 1.0)
        return left | right

    box = rounded_box(0.0)
    # the disk's own outline: its density contour, inside the box, without thin attachments
    body = _component_at_center((dens > rim_sigma) & box, cy, cx)
    body = ndimage.binary_opening(body, iterations=px(0.8))
    body = _component_at_center(body | core & box, cy, cx)
    # round off the cut at the left tip
    tip = along < 0.6 * lo
    closed = ndimage.binary_closing(body, iterations=px(1.2))
    rounded = ndimage.gaussian_filter(closed.astype(float), 1.4 / kpc) > 0.5
    keep = np.where(tip, rounded & box, body) | (core & box)
    keep = ndimage.binary_fill_holes(keep)
    # the disk's own interface: warm gas just outside it, inside the box (not past the tips)
    shell = ndimage.binary_dilation(keep, iterations=px(shell_kpc)) & ~keep & rounded_box(shell_kpc * 0.5)
    protect = shell & (lt >= 4.6)

    # ---- what to remove: cool gas outside the disk, and the warm skin around it
    seed = (lt < cool_cut) & ~keep & ~protect
    reach = ndimage.binary_dilation(seed, iterations=px(reach_kpc))
    remove = (seed | (reach & (lt < warm_cut))) & ~keep & ~protect
    remove = ndimage.binary_closing(remove, iterations=3)
    remove = ndimage.binary_dilation(remove, iterations=px(0.6)) & ~keep & ~protect
    lab, n = ndimage.label(~remove & ~keep & ~protect)
    if n:
        sizes = ndimage.sum(np.ones_like(lab), lab, index=np.arange(1, n + 1))
        remove |= np.isin(lab, 1 + np.nonzero(sizes < 400)[0])
    remove &= ~keep & ~protect

    # ---- clean hot halo, and the fill's large scales
    near_disk = ndimage.binary_dilation(keep | protect, iterations=px(2.5))
    clean = (gm > 0) & ~ndimage.binary_dilation(remove, iterations=px(1.5)) & ~near_disk
    lg = np.log10(np.maximum(gm, 1e-30))
    r = np.hypot(xx - cx, yy - cy) * kpc
    known_s = ndimage.binary_erosion(clean, iterations=2)[::4, ::4]
    parts = {}
    for name, field in (("lg", lg), ("lt", lt)):
        prof = _radial_profile(field, clean, r)
        dev = field - prof
        broad = _nconv(dev, clean.astype(float), detail_kpc / kpc)
        large = ndimage.zoom(_harmonic(broad[::4, ::4].copy(), ~known_s), 4, order=1)[:ny, :nx]
        detail = np.where(clean, dev - broad, 0.0)
        parts[name] = (prof, large, detail)

    # ---- the grain: mirror-image positions at the same radius, blended smoothly
    vx, vy = xx - mx, yy - my
    pa = vx * u[0] + vy * u[1]
    sources = [(mx - vx, my - vy),                                          # 180 degree turn
               (mx + 2 * pa * u[0] - vx, my + 2 * pa * u[1] - vy),          # across the disk plane
               (mx - 2 * pa * u[0] + vx, my - 2 * pa * u[1] + vy)]          # across the minor axis
    for deg in (60, -60, 120, -120, 30, -30, 150, -150, 90, -90):
        c, s = np.cos(np.radians(deg)), np.sin(np.radians(deg))
        sources.append((mx + c * vx - s * vy, my + s * vx + c * vy))
    for f in (1.35, 1.8):                                                   # same direction, farther out
        sources.append((mx - f * vx, my - f * vy))
        sources.append((mx + f * (2 * pa * u[0] - vx), my + f * (2 * pa * u[1] - vy)))
    need = ndimage.binary_dilation(remove, iterations=px(feather_kpc * 2))
    remaining = np.ones(gm.shape)
    acc = {"lg": np.zeros(gm.shape), "lt": np.zeros(gm.shape)}
    wsum = np.zeros(gm.shape)
    w2sum = np.zeros(gm.shape)
    sig = blend_kpc / kpc
    for sx, sy in sources:
        ix = np.round(sx).astype(int)
        iy = np.round(sy).astype(int)
        inside = (ix >= 0) & (ix < nx) & (iy >= 0) & (iy < ny)
        valid = np.zeros(gm.shape)
        valid[inside] = clean[iy[inside], ix[inside]]
        valid *= need
        soft = ndimage.gaussian_filter(valid, sig) * valid                 # tapers toward invalid edges
        wk = remaining * soft
        if wk.max() <= 0:
            continue
        ixc, iyc = np.clip(ix, 0, nx - 1), np.clip(iy, 0, ny - 1)
        for name in acc:
            acc[name] += wk * parts[name][2][iyc, ixc]
        wsum += wk
        w2sum += wk * wk
        remaining *= (1.0 - soft)
    # blending uncorrelated sources lowers the grain's contrast by sqrt(sum w^2) / sum w: undo it
    contrast = np.clip(wsum / np.sqrt(np.maximum(w2sum, 1e-18)), 1.0, 1.6)
    grain = {name: acc[name] / np.maximum(wsum, 1e-9) * contrast for name in acc}
    unfilled = need & (wsum < 0.2)

    # ---- composite
    m = ndimage.gaussian_filter(remove.astype(float), feather_kpc / kpc)
    m = np.clip(np.maximum(m * 1.8, remove), 0, 1)
    m[keep | protect] = 0.0
    d_disk = ndimage.distance_transform_edt(~keep) * kpc
    edge = keep & ~ndimage.binary_erosion(keep, iterations=2)
    lt_edge, lg_edge = float(np.median(lt[edge])), float(np.median(lg[edge]))
    ramp = np.exp(-d_disk / ramp_kpc) * (m > 0)
    out = dict(maps)
    for name, key, base, edge_val in (("lg", "gas_mass", lg, lg_edge), ("lt", "gas_logT", lt, lt_edge)):
        prof, large, _ = parts[name]
        fill = prof + large + grain[name]
        fill = fill + (edge_val - fill) * ramp
        val = base * (1 - m) + fill * m
        out[key] = 10 ** val if name == "lg" else val
    if return_masks:
        return out, dict(keep=keep, protect=protect, remove=remove, clean=clean, unfilled=unfilled,
                         theta=theta, lt_edge=lt_edge, lg_edge=lg_edge)
    return out, remove
