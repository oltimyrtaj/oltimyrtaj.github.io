/* Research-page figure, 2D fallback: used only when galaxy-gl.js cannot start
   (no WebGL2 with float render targets). A heuristic toy model of the three
   kinematic phases of a Milky Way-mass galaxy, after Myrtaj et al. (2026). It
   is drawn from simple rules and contains no simulation data.

   Rules of the toy:
   - Stars keep the orbit they were born on. Like the WebGL version, it shows
     starlight on a dark sky: young stars are blue and bright, old stars are
     orange and faint.
   - Protogalaxy: cold gas streams in along three filaments of unequal
     strength, small satellites merge in along them, bursts of star formation
     blow hot gas out, the gas is clumpy, orbits point in random directions,
     and all baryons slosh around the center of mass (the + marker).
   - Baryonic settling: the sloshing dies away just before spin-up.
   - Spin-up: the gas orbits line up first. Stars born a little later inherit
     the rotation, so the stellar disk lags the gas. Outflows leave in two
     cones along the spin axis.
   - Cooldown: a hot inner halo appears, the streams and outflows fade, the gas
     disk becomes thin, and new stars form on nearly circular orbits.

   The slider sets the epoch (0 = first stars, 1 = today). The page opens at
   today, and Play runs the history from the start. */
(function () {
  "use strict";

  if (window.__galaxyGL) return;
  var canvas = document.getElementById("galaxy");
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext("2d");
  if (!ctx) return;
  var slider = document.getElementById("epoch");
  var playButton = document.getElementById("play");
  var statusEl = document.getElementById("epoch-status");
  var figure = canvas.closest(".instrument");
  var scaleEl = figure && figure.querySelector(".scalebar");
  var scaleLine = scaleEl && scaleEl.querySelector(".scalebar-line");
  var scaleLabel = scaleEl && scaleEl.querySelector(".scalebar-label");
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  // ---- Timeline of the toy model ----
  var T_SPIN = 0.30;          // gas spin-up
  var T_COOL = 0.58;          // cooldown (inner halo virializes)
  var LAG = 0.035;            // stars spin up this much later than the gas
  var PLAY_SECONDS = 20;
  var COS_I = 0, SIN_I = 1;       // viewing angle, set by the Edge-on and Face-on buttons
  function setIncl(deg) {
    COS_I = Math.cos(deg * Math.PI / 180);
    SIN_I = Math.sin(deg * Math.PI / 180);
  }
  setIncl(84);

  // ---- Small helpers ----
  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rand = mulberry32(22806);
  function gauss() {
    var u = 1 - rand(), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function hash1(n) {
    var x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(a, b, x) {
    var t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function norm3(v) {
    var L = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1;
    return [v[0] / L, v[1] / L, v[2] / L];
  }
  function cross3(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function isoNormal() {
    var th = Math.acos(1 - 2 * rand()), ps = rand() * 2 * Math.PI;
    return [Math.sin(th) * Math.cos(ps), Math.sin(th) * Math.sin(ps), Math.cos(th)];
  }

  // How ordered the gas is at epoch t: 0 = random orbits, 1 = rotating disk.
  function order(t) { return smooth(T_SPIN, T_SPIN + 0.035, t); }
  // Spread of orbital planes (radians) once the gas rotates.
  function spread(t) {
    var thick = lerp(0.36, 0.28, smooth(T_SPIN, T_COOL, t));
    return lerp(thick, 0.055, smooth(T_COOL, T_COOL + 0.07, t));
  }
  // Disk scale length grows as the galaxy grows.
  function scaleLength(t) {
    return lerp(0.12, 0.15, smooth(T_SPIN, T_COOL, t)) + 0.06 * smooth(T_COOL, 1, t);
  }
  // Radius drawn from an exponential disk (r e^(-r/h)), kept inside the frame.
  function diskRadius(h) {
    var r;
    do { r = -h * Math.log(rand() * rand() + 1e-9); } while (r > 0.95);
    return r;
  }
  // Star formation history: low and bursty, then a bursty peak, then steady.
  function sfr(t) {
    var burst = Math.max(0, Math.sin(41 * t) + Math.sin(67 * t + 1.3)) * 0.5;
    if (t < T_SPIN) return (0.30 + 0.45 * t / T_SPIN) * (0.55 + 1.1 * burst);
    if (t < T_COOL) return 1.25 * (0.75 + 0.6 * burst);
    return 1.0 - 0.25 * (t - T_COOL);
  }
  // Angular speed for a gently rising, then flat rotation curve.
  function omega(r) { return 0.16 / Math.sqrt(r * r + 0.0064); }
  // Play spends longer on the eventful early phases.
  function playRate(t) { return lerp(0.55, 1.25, smooth(0.28, 0.62, t)); }
  var PLAY_NORM = 0;
  for (var q = 0; q < 1000; q++) PLAY_NORM += 0.001 / playRate((q + 0.5) / 1000);
  function inflowLevel(t) {
    return smooth(0, 0.03, t) * lerp(1.0, 0.5, smooth(T_SPIN - 0.05, T_COOL - 0.05, t)) *
           (1 - smooth(T_COOL - 0.05, T_COOL + 0.05, t));
  }
  function outflowLevel(t) {
    return smooth(0, 0.025, t) * (1 - smooth(T_COOL, T_COOL + 0.07, t)) * lerp(1.0, 0.6, order(t));
  }

  // Orbital-plane basis for a unit normal n: e1 = n x X, e2 = n x e1.
  function basis(nx, ny, nz, out, k) {
    var L = Math.sqrt(ny * ny + nz * nz);
    if (L < 1e-4) {
      out[k] = 0; out[k + 1] = 1; out[k + 2] = 0;
      out[k + 3] = 0; out[k + 4] = 0; out[k + 5] = 1;
      return;
    }
    out[k] = 0; out[k + 1] = nz / L; out[k + 2] = -ny / L;
    out[k + 3] = -L; out[k + 4] = nx * ny / L; out[k + 5] = nx * nz / L;
  }

  // Polar angle of an orbit normal: isotropic when disordered, a narrow
  // spread around +z once ordered. u is a fixed random number per particle.
  function tilt(u, w, s) {
    var iso = Math.acos(1 - 2 * u);
    var disk = Math.min(Math.PI, s * Math.sqrt(-2 * Math.log(1 - 0.999 * u)));
    return lerp(iso, disk, w);
  }

  // ---- Stars ----
  var N_STARS = 2600;
  var births = [];
  while (births.length < N_STARS) {
    var tb = rand();
    if (rand() * 1.6 < sfr(tb)) births.push(tb);
  }
  births.sort(function (a, b) { return a - b; });

  var sTb = new Float32Array(N_STARS);
  var sR = new Float32Array(N_STARS);
  var sOm = new Float32Array(N_STARS);
  var sPh = new Float32Array(N_STARS);
  var sE = new Float32Array(N_STARS * 6);
  for (var i = 0; i < N_STARS; i++) {
    var t = births[i];
    var tk = Math.max(0, t - LAG);
    var w = order(tk);
    var th = tilt(rand(), w, spread(tk));
    var ps = rand() * 2 * Math.PI;
    var nx = Math.sin(th) * Math.cos(ps), ny = Math.sin(th) * Math.sin(ps), nz = Math.cos(th);
    basis(nx, ny, nz, sE, i * 6);
    var rSph = 0.095 * Math.sqrt(-2 * Math.log(1 - 0.995 * rand()));
    var rDisk = diskRadius(scaleLength(tk));
    var r = lerp(rSph, rDisk, w);
    sTb[i] = t;
    sR[i] = r;
    sOm[i] = omega(r);
    sPh[i] = rand() * 2 * Math.PI;
  }

  // ---- Gas ----
  // Each gas particle has two configurations: a disordered one (in a clump,
  // or on its own randomly oriented orbit) and an ordered disk orbit. The
  // drawn position blends the two by the order parameter, so the gas streams
  // smoothly into the disk at spin-up. Angular speeds do not depend on the
  // epoch, so dragging the slider never makes particles jump.
  var N_GAS = 700, N_CLUMPS = 7, DIFFUSE = 255;
  var clumps = [];
  for (var c = 0; c < N_CLUMPS; c++) {
    var cth = Math.acos(1 - 2 * rand());
    var cps = rand() * 2 * Math.PI;
    var cr = 0.06 + 0.18 * rand();
    var ce = new Float32Array(6);
    var cnx = Math.sin(cth) * Math.cos(cps), cny = Math.sin(cth) * Math.sin(cps), cnz = Math.cos(cth);
    basis(cnx, cny, cnz, ce, 0);
    clumps.push({
      n: [cnx, cny, cnz],
      e: ce,
      r: cr,
      om: omega(cr) * (rand() < 0.5 ? -1 : 1),
      ph: rand() * 2 * Math.PI
    });
  }
  var gC = new Uint8Array(N_GAS);
  var gR0 = new Float32Array(N_GAS);    // disordered radius
  var gW0 = new Float32Array(N_GAS);    // disordered angular speed
  var gP0 = new Float32Array(N_GAS);    // disordered phase offset
  var gZ0 = new Float32Array(N_GAS);    // offset out of a clump's plane
  var gE0 = new Float32Array(N_GAS * 6); // basis of a diffuse particle's orbit
  var gU = new Float32Array(N_GAS);
  var gPsi = new Float32Array(N_GAS);
  var gShape = new Float32Array(N_GAS);
  var gW1 = new Float32Array(N_GAS);    // disk angular speed
  var gP1 = new Float32Array(N_GAS);    // disk phase offset
  for (var j = 0; j < N_GAS; j++) {
    if (rand() < 0.3) {
      gC[j] = DIFFUSE;
      var dth = Math.acos(1 - 2 * rand()), dps = rand() * 2 * Math.PI;
      basis(Math.sin(dth) * Math.cos(dps), Math.sin(dth) * Math.sin(dps), Math.cos(dth), gE0, j * 6);
      gR0[j] = 0.04 + 0.2 * rand();
      gW0[j] = omega(gR0[j]);
      gP0[j] = rand() * 2 * Math.PI;
    } else {
      var cc = Math.floor(rand() * N_CLUMPS);
      gC[j] = cc;
      gR0[j] = Math.max(0.01, clumps[cc].r + 0.03 * gauss());
      gW0[j] = clumps[cc].om;
      gP0[j] = clumps[cc].ph + 0.35 * gauss();
      gZ0[j] = 0.025 * gauss();
    }
    gU[j] = rand();
    gPsi[j] = rand() * 2 * Math.PI;
    do { gShape[j] = -Math.log(rand() * rand() + 1e-9); } while (gShape[j] > 4);
    gW1[j] = omega(0.19 * gShape[j]);
    gP1[j] = rand() * 2 * Math.PI;
  }
  var tmp = new Float32Array(6);

  // ---- Cold streams along three filaments of unequal strength ----
  var R_OUT = 0.8, R_IN = 0.035;
  function makeStream(d, axis, phi, S, wd) {
    d = norm3(d);
    var b = norm3(cross3(d, axis));
    return { d: d, b: b, n: cross3(d, b), phi: phi, S: S, w: wd };
  }
  var STREAMS = [
    makeStream([-0.80, 0.25, 0.55], [0, 1, 0], 1.3, 1.0, 0.034),
    makeStream([0.85, -0.30, -0.35], [0, 1, 0], -1.1, 0.6, 0.027),
    makeStream([0.20, 0.45, 0.87], [0, 1, 0], -0.9, 0.35, 0.021)
  ];
  function streamPoint(st, s, out) {
    var R = R_IN + (R_OUT - R_IN) * (1 - s);
    var ph = st.phi * s * s;
    var cp = Math.cos(ph), sp = Math.sin(ph);
    for (var k = 0; k < 3; k++) {
      out[k] = R * (cp * st.d[k] + sp * st.b[k]);
      out[3 + k] = -sp * st.d[k] + cp * st.b[k];
    }
  }
  var N_IN = 420;
  var inSt = new Uint8Array(N_IN), inS0 = new Float32Array(N_IN), inG = new Float32Array(N_IN * 2);
  for (j = 0; j < N_IN; j++) {
    var xr = rand() * 1.95;
    inSt[j] = xr < 1 ? 0 : (xr < 1.6 ? 1 : 2);
    var clumpy = rand() < 0.55;
    inS0[j] = clumpy ? Math.floor(rand() * 6) / 6 + 0.02 * gauss() : rand();
    inG[2 * j] = (clumpy ? 0.45 : 1) * gauss();
    inG[2 * j + 1] = (clumpy ? 0.45 : 1) * gauss();
  }

  // ---- Minor mergers ----
  // [merge epoch, infall time, filament (-1: none), weight, merge radius]
  var SAT_SPEC = [
    [0.055, 0.06, 0, 520, 0.06], [0.085, 0.07, -1, 380, 0.07], [0.115, 0.08, 1, 760, 0.07],
    [0.145, 0.07, 0, 450, 0.08], [0.18, 0.08, -1, 420, 0.08], [0.21, 0.09, 0, 880, 0.09],
    [0.25, 0.08, 2, 400, 0.09], [0.36, 0.10, 1, 480, 0.12], [0.47, 0.10, -1, 340, 0.14],
    [0.74, 0.14, -1, 300, 0.17]
  ];
  var sats = [], satStars = [];
  for (var si = 0; si < SAT_SPEC.length; si++) {
    var spec = SAT_SPEC[si], d, b, phi;
    if (spec[2] >= 0) {
      var st0 = STREAMS[spec[2]], jt = isoNormal();
      d = norm3([st0.d[0] + 0.25 * jt[0], st0.d[1] + 0.25 * jt[1], st0.d[2] + 0.25 * jt[2]]);
      var bd = st0.b[0] * d[0] + st0.b[1] * d[1] + st0.b[2] * d[2];
      b = norm3([st0.b[0] - bd * d[0], st0.b[1] - bd * d[1], st0.b[2] - bd * d[2]]);
      phi = st0.phi * (0.8 + 0.4 * rand());
    } else {
      do { d = isoNormal(); } while (Math.abs(d[1]) > 0.75);
      b = norm3(cross3(d, isoNormal()));
      phi = (rand() < 0.5 ? -1 : 1) * (0.7 + 0.9 * rand());
    }
    var sat = { ts: spec[0] - spec[1], tm: spec[0], R0: 0.75, Rm: spec[4], d: d, b: b, phi: phi,
                ecc: 0.35 + 0.35 * rand(), rb: 0.022 * Math.cbrt(spec[3] / 500) };
    var cph = Math.cos(phi), sph = Math.sin(phi), sg = phi < 0 ? -1 : 1;
    sat.e1 = norm3([cph * d[0] + sph * b[0], cph * d[1] + sph * b[1], cph * d[2] + sph * b[2]]);
    sat.td = norm3([sg * (-sph * d[0] + cph * b[0]), sg * (-sph * d[1] + cph * b[1]), sg * (-sph * d[2] + cph * b[2])]);
    sat.nr = cross3(sat.e1, sat.td);
    sats.push(sat);
    var count = Math.round(spec[3] / 16);
    for (var m = 0; m < count; m++) {
      var al = 0.6 * gauss(), ri = sat.Rm * clamp(Math.exp(0.4 * gauss()), 0.4, 2.6);
      satStars.push({ s: si, tb: Math.max(0.004, sat.tm - 0.008 - 0.16 * Math.pow(rand(), 1.2)),
                      ca: Math.cos(al), sa: Math.sin(al), r: ri, om: omega(ri), ph0: rand() * 2 * Math.PI,
                      beta: rand() * 2 * Math.PI, rb: sat.rb * (0.2 + Math.abs(gauss())),
                      ecc: sat.ecc * (0.6 + 0.8 * rand()) });
    }
  }
  function satCenter(s, u, out) {
    var R = lerp(s.R0, s.Rm, u), up = Math.max(u, 0), ph = s.phi * up * up;
    var cp = Math.cos(ph), sp = Math.sin(ph);
    out[0] = R * (cp * s.d[0] + sp * s.b[0]);
    out[1] = R * (cp * s.d[1] + sp * s.b[1]);
    out[2] = R * (cp * s.d[2] + sp * s.b[2]);
  }

  // ---- Hot outflow plumes: staggered episodes that repeat every SHELL_P seconds ----
  var N_SLOT = 5, PER_SLOT = 60, SHELL_P = 3.5;
  var outDir = new Float32Array(N_SLOT * PER_SLOT * 3), outF = new Float32Array(N_SLOT * PER_SLOT);
  for (j = 0; j < N_SLOT * PER_SLOT; j++) {
    var od = isoNormal();
    outDir[3 * j] = od[0]; outDir[3 * j + 1] = od[1]; outDir[3 * j + 2] = od[2];
    outF[j] = 0.45 + 0.55 * Math.sqrt(rand());
  }

  // ---- Colors: starlight on a dark sky, as in the WebGL version ----
  var SKY = "rgb(3, 4, 9)";
  var AGE_RGB = [[133, 173, 255], [199, 217, 255], [255, 242, 219], [255, 204, 145], [255, 163, 102]];
  var SF_RGB = [255, 93, 151], IN_RGB = [84, 224, 204], OUT_RGB = [189, 140, 255];
  var HALO_RGB = [107, 115, 255], MARK_RGB = [220, 228, 255];
  var sprites = {};
  var dpr = 1;

  function rgba(rgb, a) {
    return "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + a + ")";
  }
  function makeSprite(rgb, cssSize, stops) {
    var px = Math.max(2, Math.round(cssSize * dpr));
    var c = document.createElement("canvas");
    c.width = c.height = px;
    var g = c.getContext("2d");
    var grad = g.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
    for (var k = 0; k < stops.length; k++) grad.addColorStop(stops[k][0], rgba(rgb, stops[k][1]));
    g.fillStyle = grad;
    g.fillRect(0, 0, px, px);
    return c;
  }
  function makeSprites() {
    var star = [[0, 1], [0.32, 0.8], [1, 0]];
    sprites.stars = AGE_RGB.map(function (rgb, k) { return makeSprite(rgb, k === 0 ? 5.4 : 4.4, star); });
    sprites.gas = makeSprite(SF_RGB, 11, [[0, 0.6], [0.3, 0.3], [1, 0]]);
    sprites.inflow = makeSprite(IN_RGB, 12, [[0, 0.6], [0.35, 0.3], [1, 0]]);
    sprites.outflow = makeSprite(OUT_RGB, 16, [[0, 0.45], [0.4, 0.2], [1, 0]]);
  }
  // Age in Gyr sets the color bin and, through a fade of roughly age^-0.7,
  // the opacity, so young stars dominate the light.
  function ageBin(age) {
    var la = Math.log(age) / Math.LN10;
    return la < -1.5 ? 0 : la < -0.5 ? 1 : la < 0.35 ? 2 : la < 0.85 ? 3 : 4;
  }
  function ageAlpha(age) {
    var L = Math.min(Math.pow(age / 0.01, -0.7), 1.2);
    return clamp(0.4 + 0.6 * (Math.log(L) / Math.LN10 + 2.1) / 2.2, 0.4, 1);
  }

  // ---- Layout ----
  var W = 0, H = 0, S = 1, CX = 0, CY = 0;
  function resize() {
    var box = canvas.parentElement.getBoundingClientRect();
    var newDpr = Math.min(2, window.devicePixelRatio || 1);
    var w = Math.max(1, Math.round(box.width * newDpr));
    var h = Math.max(1, Math.round(box.height * newDpr));
    if (w === W && h === H && newDpr === dpr) return;
    var dprChanged = newDpr !== dpr;
    dpr = newDpr;
    W = canvas.width = w;
    H = canvas.height = h;
    S = Math.min(0.47 * W, 0.78 * H);
    CX = W / 2;
    CY = H / 2;
    if (dprChanged || !sprites.gas) makeSprites();
    draw();
  }

  // ---- State ----
  var T = slider ? Number(slider.value) / 1000 : 1;
  var tau = 2.5;
  var playing = false;
  var visible = true;

  function sloshAmp(t) { return 0.075 * (1 - smooth(T_SPIN - 0.09, T_SPIN - 0.01, t)); }
  function haloLevel(t) { return smooth(T_COOL - 0.01, T_COOL + 0.07, t); }

  function countBorn(t) {
    var lo = 0, hi = N_STARS;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (sTb[mid] <= t) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  var pt = new Float32Array(6), cen = new Float32Array(3), site = new Float32Array(3);
  function plot(spr, x, y, z) {
    var half = spr.width / 2;
    ctx.drawImage(spr, CX + x * S - half, CY - (y * COS_I + z * SIN_I) * S - half);
  }

  function draw() {
    if (!W || !sprites.gas) return;
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = SKY;
    ctx.fillRect(0, 0, W, H);

    // Sloshing offset of all baryons around the center of mass
    var A = sloshAmp(T);
    var ox = A * Math.sin(0.83 * tau + 1.3);
    var oy = A * 0.8 * Math.sin(0.61 * tau + 0.4);
    var oz = A * 0.7 * Math.sin(1.07 * tau + 2.1);

    // Hot inner halo after cooldown
    var hl = haloLevel(T);
    if (hl > 0.001) {
      var R = 0.66 * S;
      var grad = ctx.createRadialGradient(CX, CY, 0, CX, CY, R);
      grad.addColorStop(0, rgba(HALO_RGB, 0.1 * hl));
      grad.addColorStop(0.5, rgba(HALO_RGB, 0.04 * hl));
      grad.addColorStop(1, rgba(HALO_RGB, 0));
      ctx.fillStyle = grad;
      ctx.fillRect(CX - R, CY - R, 2 * R, 2 * R);
    }

    ctx.globalCompositeOperation = "lighter";

    // Cold streams flowing in
    var lev = inflowLevel(T);
    if (lev > 0.01) {
      for (var j = 0; j < N_IN; j++) {
        var stm = STREAMS[inSt[j]];
        var sv = inS0[j] + 0.06 * tau;
        sv -= Math.floor(sv);
        var prof = (0.3 + 0.7 * sv) * smooth(0, 0.14, sv) * (1 - smooth(0.84, 0.99, sv));
        var al = lev * stm.S * prof;
        if (al < 0.02) continue;
        streamPoint(stm, sv, pt);
        var wd = stm.w * (1.25 - 0.85 * sv), g1 = inG[2 * j], g2 = inG[2 * j + 1];
        ctx.globalAlpha = Math.min(1, al) * 0.5;
        plot(sprites.inflow,
             pt[0] + wd * (g1 * stm.n[0] + g2 * pt[3]) + ox * sv,
             pt[1] + wd * (g1 * stm.n[1] + g2 * pt[4]) + oy * sv,
             pt[2] + wd * (g1 * stm.n[2] + g2 * pt[5]) + oz * sv);
      }
    }

    // Hot outflows: lopsided plumes early, two cones once the disk forms
    var of = outflowLevel(T), wo = order(T);
    if (of > 0.01) {
      for (var slot = 0; slot < N_SLOT; slot++) {
        var phs = tau / SHELL_P + slot / N_SLOT, ep = Math.floor(phs), age = phs - ep;
        var h1 = hash1(ep * 7.13 + slot * 1.37), h2 = hash1(ep * 3.71 + slot * 5.19 + 0.5);
        var h3 = hash1(ep * 1.93 + slot * 2.71 + 0.25), h4 = hash1(ep * 9.17 + slot * 0.61 + 0.75);
        site[0] = site[1] = site[2] = 0;
        if (h1 < 0.6 * (1 - wo)) {
          var cl = clumps[Math.floor(h2 * N_CLUMPS) % N_CLUMPS], ca = cl.ph + cl.om * (tau - age * SHELL_P);
          for (var k = 0; k < 3; k++) site[k] = cl.r * (Math.cos(ca) * cl.e[k] + Math.sin(ca) * cl.e[k + 3]);
        }
        var cz = 1 - 2 * h3, sz = Math.sqrt(Math.max(0, 1 - cz * cz)), pp = 2 * Math.PI * h4;
        var Dx = sz * Math.cos(pp), Dy = sz * Math.sin(pp), Dz = cz;
        var Rmax = lerp(0.15, 0.3, wo) * (0.8 + 0.4 * h1), grow = 1 - (1 - age) * (1 - age);
        ctx.globalAlpha = of * (0.5 + 0.8 * h2) * Math.pow(1 - age, 1.6) * smooth(0, 0.07, age) * 0.4;
        for (j = slot * PER_SLOT; j < (slot + 1) * PER_SLOT; j++) {
          var ux = outDir[3 * j], uy = outDir[3 * j + 1], uz = outDir[3 * j + 2];
          var p1 = norm3([ux + 1.15 * Dx, uy + 1.15 * Dy, uz + 1.15 * Dz]);
          var p2 = norm3([ux, uy, uz + (uz < 0 ? -1.8 : 1.8)]);
          var rad = Rmax * outF[j] * grow;
          plot(sprites.outflow, site[0] + lerp(p1[0], p2[0], wo) * rad + ox,
               site[1] + lerp(p1[1], p2[1], wo) * rad + oy, site[2] + lerp(p1[2], p2[2], wo) * rad + oz);
        }
      }
    }

    // Gas
    var w = order(T), sp = spread(T), hGas = 0.95 * scaleLength(T);
    var nGas = Math.round(N_GAS * lerp(1, 0.55, T));
    var gs = sprites.gas, gHalf = gs.width / 2;
    ctx.globalAlpha = 0.2;
    for (j = 0; j < nGas; j++) {
      var x0 = 0, y0 = 0, z0 = 0, x1 = 0, y1 = 0, z1 = 0;
      if (w < 1) {
        // Disordered: in a clump or on a randomly oriented orbit
        var a0 = gP0[j] + gW0[j] * tau;
        var c0 = Math.cos(a0), s0 = Math.sin(a0), r0 = gR0[j];
        var e, base, zoff = 0, n = null;
        if (gC[j] === DIFFUSE) { e = gE0; base = j * 6; }
        else { var gcl = clumps[gC[j]]; e = gcl.e; base = 0; zoff = gZ0[j]; n = gcl.n; }
        x0 = r0 * (c0 * e[base] + s0 * e[base + 3]);
        y0 = r0 * (c0 * e[base + 1] + s0 * e[base + 4]);
        z0 = r0 * (c0 * e[base + 2] + s0 * e[base + 5]);
        if (n) { x0 += zoff * n[0]; y0 += zoff * n[1]; z0 += zoff * n[2]; }
      }
      if (w > 0) {
        // Ordered: a disk orbit whose tilt shrinks as the disk cools
        var th = tilt(gU[j], 1, sp);
        var st = Math.sin(th);
        basis(st * Math.cos(gPsi[j]), st * Math.sin(gPsi[j]), Math.cos(th), tmp, 0);
        var a1 = gP1[j] + gW1[j] * tau;
        var c1 = Math.cos(a1), s1 = Math.sin(a1), r1 = hGas * gShape[j];
        x1 = r1 * (c1 * tmp[0] + s1 * tmp[3]);
        y1 = r1 * (c1 * tmp[1] + s1 * tmp[4]);
        z1 = r1 * (c1 * tmp[2] + s1 * tmp[5]);
      }
      var x = lerp(x0, x1, w) + ox;
      var y = lerp(y0, y1, w) + oy;
      var z = lerp(z0, z1, w) + oz;
      var px = CX + x * S, py = CY - (y * COS_I + z * SIN_I) * S;
      ctx.drawImage(gs, px - gHalf, py - gHalf);
    }

    // Stars, colored and dimmed by age
    var born = countBorn(T);
    for (var i = 0; i < born; i++) {
      var agei = Math.max((T - sTb[i]) * 13.3, 0.003);
      var spr = sprites.stars[ageBin(agei)], half = spr.width / 2;
      ctx.globalAlpha = ageAlpha(agei);
      var kk = i * 6;
      var a = sPh[i] + sOm[i] * tau;
      var cs = Math.cos(a), sn = Math.sin(a), rr = sR[i];
      var sx = rr * (cs * sE[kk] + sn * sE[kk + 3]) + ox;
      var sy = rr * (cs * sE[kk + 1] + sn * sE[kk + 4]) + oy;
      var szz = rr * (cs * sE[kk + 2] + sn * sE[kk + 5]) + oz;
      ctx.drawImage(spr, CX + sx * S - half, CY - (sy * COS_I + szz * SIN_I) * S - half);
    }

    // Satellite stars: a ball on the infall path, then debris on eccentric orbits
    for (i = 0; i < satStars.length; i++) {
      var q = satStars[i];
      if (q.tb > T) continue;
      var ageq = Math.max((T - q.tb) * 13.3, 0.003);
      ctx.globalAlpha = 0.8 * ageAlpha(ageq);
      var sat = sats[q.s];
      var u = Math.min(1, (T - sat.ts) / (sat.tm - sat.ts));
      satCenter(sat, u, cen);
      var e2x = q.ca * sat.td[0] + q.sa * sat.nr[0], e2y = q.ca * sat.td[1] + q.sa * sat.nr[1], e2z = q.ca * sat.td[2] + q.sa * sat.nr[2];
      var pb = q.ph0 + 1.4 * tau, cb = Math.cos(pb), sb = Math.sin(pb), cbe = Math.cos(q.beta), sbe = Math.sin(q.beta);
      var nnx = sat.e1[1] * e2z - sat.e1[2] * e2y, nny = sat.e1[2] * e2x - sat.e1[0] * e2z, nnz = sat.e1[0] * e2y - sat.e1[1] * e2x;
      var bx = cen[0] + q.rb * (cb * sat.e1[0] + sb * (cbe * e2x + sbe * nnx));
      var by = cen[1] + q.rb * (cb * sat.e1[1] + sb * (cbe * e2y + sbe * nny));
      var bz = cen[2] + q.rb * (cb * sat.e1[2] + sb * (cbe * e2z + sbe * nnz));
      var ph = q.om * 22 * (T - sat.tm);
      var ro = q.r * (1 + q.ecc * (1 - Math.cos(1.4 * ph))), co = Math.cos(ph), so = Math.sin(ph);
      var mix = smooth(sat.tm - 0.012, sat.tm + 0.018, T);
      plot(sprites.stars[ageBin(ageq)],
           lerp(bx, ro * (co * sat.e1[0] + so * e2x), mix) + ox,
           lerp(by, ro * (co * sat.e1[1] + so * e2y), mix) + oy,
           lerp(bz, ro * (co * sat.e1[2] + so * e2z), mix) + oz);
    }

    // Center of mass marker, faded out once the galaxy has settled
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 0.85 * (1 - smooth(T_SPIN - 0.02, T_SPIN + 0.04, T));
    ctx.strokeStyle = rgba(MARK_RGB, 1);
    ctx.lineWidth = Math.max(1, dpr);
    var mk = 6 * dpr;
    ctx.beginPath();
    ctx.moveTo(CX - mk, CY); ctx.lineTo(CX + mk, CY);
    ctx.moveTo(CX, CY - mk); ctx.lineTo(CX, CY + mk);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (scaleEl) {
      var pxPerKpc = S / dpr / 30, len = 0.5, nice = [0.5, 1, 2, 5, 10, 20];
      for (var ni = 0; ni < nice.length; ni++) if (nice[ni] * pxPerKpc <= 120) len = nice[ni];
      scaleLine.style.width = (len * pxPerKpc).toFixed(1) + "px";
      scaleLabel.textContent = len + " kpc";
      scaleEl.hidden = false;
    }
  }

  // ---- Status text ----
  var PHASES = [
    { until: T_SPIN - 0.07, name: "Protogalaxy",
      text: "Cold gas streams accrete asymmetrically along filaments, small satellite galaxies merge constantly, and bursts of star formation blow hot gas back out \u2014 the galaxy is in a state of disequilibrium. Baryons slosh with a bulk velocity offset around the center of mass (+)." },
    { until: T_SPIN, name: "Baryonic settling",
      text: "The sloshing dies down, and the gas and stars settle onto the center of mass as the baryons become well-centered within the total potential." },
    { until: T_SPIN + 0.06, name: "Onset of rotation",
      text: "The gas begins to rotate coherently. Young stars born from cold, molecular, dense star-forming gas also form a disk sometime after." },
    { until: T_COOL, name: "Thick disk",
      text: "Star formation peaks but stays bursty, and outflows leave above and below the disk. New stars rotate with the gas, on thick, tilted orbits." },
    { until: T_COOL + 0.07, name: "Cooldown",
      text: "The gas around the inner galaxy becomes hot and stable, the cold streams and outflows fade, and star formation becomes steady." },
    { until: 0.985, name: "Thin disk",
      text: "Incoming gas settles into a thin, cold disk, and new stars form on nearly circular orbits." },
    { until: 2, name: "Today",
      text: "For the most part, each generation of stars keeps the orbits it was born on, leaving a round spheroid laced with the debris of merged satellites, a thick disk and a thin disk." }
  ];
  var shownPhase = -1;
  function updateStatus() {
    var p = 0;
    while (T >= PHASES[p].until) p++;
    if (p === shownPhase) return;
    shownPhase = p;
    if (slider) slider.setAttribute("aria-valuetext", PHASES[p].name);
    if (statusEl) {
      statusEl.textContent = "";
      var strong = document.createElement("strong");
      strong.textContent = PHASES[p].name + ".";
      statusEl.appendChild(strong);
      statusEl.appendChild(document.createTextNode(" " + PHASES[p].text));
    }
  }

  // Reserve room for the longest status line, so the legend and caption below
  // stay put as the phases change. Measured again whenever the width changes.
  var statusWidth = -1;
  function reserveStatusHeight() {
    if (!statusEl || !statusEl.parentNode) return;
    var width = statusEl.offsetWidth;
    if (!width || width === statusWidth) return;
    statusWidth = width;
    var probe = statusEl.cloneNode(false);
    probe.removeAttribute("id");
    probe.removeAttribute("aria-live");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = "position:absolute;left:-10000px;top:0;visibility:hidden;min-height:0;width:" + width + "px";
    statusEl.parentNode.appendChild(probe);
    var tallest = 0;
    for (var i = 0; i < PHASES.length; i++) {
      probe.textContent = "";
      var label = document.createElement("strong");
      label.textContent = PHASES[i].name + ".";
      probe.appendChild(label);
      probe.appendChild(document.createTextNode(" " + PHASES[i].text));
      tallest = Math.max(tallest, probe.offsetHeight);
    }
    probe.parentNode.removeChild(probe);
    statusEl.style.minHeight = tallest + "px";
  }

  // ---- Animation loop ----
  var running = false, last = 0;
  function wantLoop() {
    return visible && !document.hidden && (playing || !reduce.matches);
  }
  function startLoop() {
    if (running || !wantLoop()) return;
    running = true;
    last = 0;
    requestAnimationFrame(frame);
  }
  function frame(now) {
    if (!wantLoop()) { running = false; return; }
    var dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    if (!reduce.matches) tau += dt;
    if (playing) {
      T = Math.min(1, T + dt * playRate(T) * PLAY_NORM / PLAY_SECONDS);
      if (slider) slider.value = String(Math.round(T * 1000));
      updateStatus();
      if (T >= 1) setPlaying(false);
    }
    draw();
    requestAnimationFrame(frame);
  }

  function setPlaying(on) {
    playing = on;
    if (playButton) {
      playButton.setAttribute("aria-pressed", on ? "true" : "false");
      var label = playButton.querySelector(".label");
      if (label) label.textContent = on ? "Pause" : "Play";
    }
    if (on) startLoop();
  }

  var toggles = figure && figure.querySelector(".toggles");
  if (toggles) {
    toggles.hidden = false;
    toggles.querySelectorAll("button[data-incl]").forEach(function (b) {
      b.addEventListener("click", function () {
        toggles.querySelectorAll("button[data-incl]").forEach(function (o) {
          o.setAttribute("aria-pressed", o === b ? "true" : "false");
        });
        setIncl(Number(b.dataset.incl));
        draw();
      });
    });
  }

  if (slider) {
    slider.addEventListener("input", function () {
      if (playing) setPlaying(false);
      T = Number(slider.value) / 1000;
      updateStatus();
      if (!running) draw();
    });
  }
  if (playButton) {
    playButton.addEventListener("click", function () {
      if (playing) { setPlaying(false); return; }
      if (T >= 0.995) { T = 0; if (slider) slider.value = "0"; updateStatus(); }
      setPlaying(true);
    });
  }

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (visible) startLoop();
    }).observe(canvas);
  }
  document.addEventListener("visibilitychange", startLoop);
  function onMotionChange() { if (reduce.matches) draw(); else startLoop(); }
  if (reduce.addEventListener) reduce.addEventListener("change", onMotionChange);

  if ("ResizeObserver" in window) {
    new ResizeObserver(resize).observe(canvas.parentElement);
  } else {
    window.addEventListener("resize", resize);
  }

  makeSprites();
  resize();
  updateStatus();
  reserveStatusHeight();
  if ("ResizeObserver" in window && statusEl) new ResizeObserver(reserveStatusHeight).observe(statusEl);
  else window.addEventListener("resize", reserveStatusHeight);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { statusWidth = -1; reserveStatusHeight(); });
  draw();
  startLoop();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(resize);
})();
