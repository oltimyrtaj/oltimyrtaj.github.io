/* Research-page figure (WebGL2): a heuristic toy model of the three kinematic
   phases of a Milky Way-mass galaxy, after Myrtaj et al. (2026), drawn as
   accumulated starlight with gas and dust. It is built from simple rules and
   contains no simulation data.

   Rules, each chosen to echo a result of the paper or the FIRE work it builds
   on:
   - Stars keep their birth orbits, so the galaxy today shows a round spheroid,
     a thick disk and a thin disk at once.
   - Protogalaxy: cold gas arrives along three filaments of unequal strength,
     so accretion is lopsided. Small satellite galaxies fall in, mostly along
     the same filaments, are torn apart, and leave their stars in the halo.
     Bursty star formation in clumps blows hot gas out in lopsided plumes, and
     all baryons slosh around the center of mass (+).
   - Baryonic settling ends the sloshing. The gas spins up first and young
     stars spin up a little later (LAG).
   - Thick disk: the highest star formation, still bursty, in giant clumps that
     migrate inward, on thick tilted orbits. Outflows leave in two cones along
     the spin axis, the filaments weaken, and mergers become rare.
   - Cooldown: the inner halo turns hot (faint violet glow), the cold streams
     and outflows fade, star formation becomes steady, and the gas settles into
     a thin disk.
   - Spiral arms are a density wave. The two trailing arms form a pattern that
     turns rigidly and slowly, with corotation near 9 kpc. Gas and stars orbit
     at their own speed and pass through the arms, slowing and crowding as they
     cross them. Gas lights up in the arms, and the young stars it forms drift
     ahead of them inside corotation.
   - Starlight: each star fades roughly as age^-0.7 and reddens with age. Dust
     in the gas absorbs and reddens the light.
   When WebGL2 with float render targets is missing, galaxy.js draws a simpler
   2D version instead. */
(function () {
  'use strict';

  var canvas = document.getElementById('galaxy');
  if (!canvas) return;
  var figure = canvas.closest('.instrument');

  function probe() {
    try {
      var c = document.createElement('canvas');
      c.width = c.height = 4;
      var g = c.getContext('webgl2');
      if (!g) return false;
      if (!g.getExtension('EXT_color_buffer_float') && !g.getExtension('EXT_color_buffer_half_float')) return false;
      var tex = g.createTexture();
      g.bindTexture(g.TEXTURE_2D, tex);
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA16F, 4, 4, 0, g.RGBA, g.HALF_FLOAT, null);
      var fb = g.createFramebuffer();
      g.bindFramebuffer(g.FRAMEBUFFER, fb);
      g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex, 0);
      var ok = g.checkFramebufferStatus(g.FRAMEBUFFER) === g.FRAMEBUFFER_COMPLETE;
      var lose = g.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      return ok;
    } catch (e) {
      return false;
    }
  }
  if (!probe()) return;

  // ---------------------------------------------------------------- DOM
  var slider = document.getElementById('epoch');
  var playButton = document.getElementById('play');
  var statusEl = document.getElementById('epoch-status');
  var comEl = figure && figure.querySelector('.com-marker');
  var scaleEl = figure && figure.querySelector('.scalebar');
  var scaleLine = scaleEl && scaleEl.querySelector('.scalebar-line');
  var scaleLabel = scaleEl && scaleEl.querySelector('.scalebar-label');
  var toggles = figure && figure.querySelector('.toggles');
  var captionLight = figure && figure.querySelector('[data-caption="light"]');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ---------------------------------------------------------------- model
  var T_SPIN = 0.30, T_COOL = 0.58, LAG = 0.035;
  var PLAY_SECONDS = 22;     // Play runs the whole history in about this long
  var GYR_PER_T = 13.3;      // epoch 0..1 spans 0.5..13.8 Gyr of cosmic time
  var KPC_PER_UNIT = 30;
  var SPIN_K = 22;           // orbital phase per unit epoch: scrubbing fast-forwards rotation
  var AMBIENT_RATE = 0.3;    // orbital phase per real second
  var PITCH = 19 * Math.PI / 180;
  var ARM0 = 0.6;
  var R_CR = 0.30;           // corotation radius of the spiral pattern (about 9 kpc)
  var ARM_GAS = 0.75;        // how strongly gas slows and crowds in the arms (0..1)
  var ARM_STARS = 0.16;      // the same for thin-disk stars
  var DUST_K = 14;           // dust optical depth per unit gas column (tuned by eye)
  var HA_K = 0.9;            // brightness of star-forming gas
  var IN_K = 15;             // brightness of the cold inflows
  var OUT_K = 85;            // brightness of the hot outflows
  var EXPOSURE_K = 1.6;      // overall exposure
  var SHARP_K = 0.6;         // weight of the resolved star sprites
  var DIFFUSE_K = 1.6;       // weight of the blurred, unresolved starlight
  var GS = 1000;             // gas weights are stored x1000 so half floats keep their precision

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
  function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  function order(t) { return smooth(T_SPIN, T_SPIN + 0.035, t); }
  function thinness(t) { return smooth(T_COOL, T_COOL + 0.07, t); }
  function spread(t) {
    return lerp(lerp(0.34, 0.26, smooth(T_SPIN, T_COOL, t)), 0.045, thinness(t));
  }
  function hThick(t) { return lerp(0.07, 0.1, smooth(T_SPIN, T_COOL, t)); }
  function hThin(t) { return lerp(0.105, 0.14, smooth(T_COOL, 1, t)); }
  function omega(r) { return 0.16 / Math.sqrt(r * r + 0.0036); }
  var OMEGA_P = omega(R_CR);
  // Arm angle against radius. It falls outward while orbits advance in +angle,
  // so the arms trail.
  function spiral(r) { return -Math.log(Math.max(r, 0.02) / 0.05) / Math.tan(PITCH); }
  function armReach(r) { return smooth(0.04, 0.09, r); }   // no arms in the bulge
  function zoomAt(t) { return 1 + 1.15 * (1 - smooth(0.1, 0.62, t)); }
  // Play spends longer on the eventful early phases.
  function playRate(t) { return lerp(0.55, 1.25, smooth(0.28, 0.62, t)); }
  var PLAY_NORM = 0;
  for (var q = 0; q < 1000; q++) PLAY_NORM += 0.001 / playRate((q + 0.5) / 1000);

  var BURSTS = [[0.03, 0.8], [0.065, 1.0], [0.1, 0.7], [0.135, 1.1], [0.17, 0.8], [0.205, 1.2],
                [0.24, 0.9], [0.272, 1.0], [0.318, 1.1], [0.352, 0.8], [0.388, 1.2], [0.42, 0.9],
                [0.455, 1.0], [0.49, 0.8], [0.522, 0.9], [0.553, 0.7]];
  function burstLevel(t) {
    var s = 0;
    for (var i = 0; i < BURSTS.length; i++) {
      var d = (t - BURSTS[i][0]) / 0.007;
      s += BURSTS[i][1] * Math.exp(-0.5 * d * d);
    }
    return s;
  }
  function sfr(t) {
    var base = t < T_SPIN ? 0.25 + 0.35 * t / T_SPIN : (t < T_COOL ? 0.9 : 0.75 - 0.2 * (t - T_COOL) / (1 - T_COOL));
    var bursty = 1 - thinness(t);
    return base * ((1 - bursty) + bursty * (0.35 + 1.4 * burstLevel(t)));
  }
  function outflow(t) {
    var s = 0;
    for (var i = 0; i < BURSTS.length; i++) {
      var d = (t - BURSTS[i][0]) / 0.02;
      if (d > 0 && d < 8) s += BURSTS[i][1] * d * Math.exp(1 - d);
    }
    return s * (1 - thinness(t));
  }
  // Cold streams: strong early, weaker in the thick disk, gone once the inner
  // halo is hot.
  function inflowLevel(t) {
    return smooth(0, 0.03, t) * lerp(1.0, 0.5, smooth(T_SPIN - 0.05, T_COOL - 0.05, t)) *
           (1 - smooth(T_COOL - 0.05, T_COOL + 0.05, t));
  }
  // Hot outflows: strongest in the shallow early potential, pulsing with the
  // bursts, gone after cooldown.
  function outflowLevel(t) {
    return smooth(0, 0.025, t) * (1 - thinness(t)) * lerp(1.0, 0.6, order(t)) *
           (0.45 + 0.55 * Math.min(1.6, burstLevel(t)));
  }

  function basis(n, out, k) {
    var L = Math.sqrt(n[1] * n[1] + n[2] * n[2]);
    if (L < 1e-5) { out[k] = 0; out[k + 1] = 1; out[k + 2] = 0; out[k + 3] = 0; out[k + 4] = 0; out[k + 5] = 1; return; }
    out[k] = 0; out[k + 1] = n[2] / L; out[k + 2] = -n[1] / L;
    out[k + 3] = -L; out[k + 4] = n[0] * n[1] / L; out[k + 5] = n[0] * n[2] / L;
  }
  function isoNormal() {
    var th = Math.acos(1 - 2 * rand()), ps = rand() * 2 * Math.PI;
    return [Math.sin(th) * Math.cos(ps), Math.sin(th) * Math.sin(ps), Math.cos(th)];
  }
  function tiltNormal(sig, base) {
    var th = Math.min(Math.PI, sig * Math.sqrt(-2 * Math.log(1 - 0.999 * rand())));
    var ps = rand() * 2 * Math.PI;
    var n = [Math.sin(th) * Math.cos(ps), Math.sin(th) * Math.sin(ps), Math.cos(th)];
    if (!base) return n;
    // rotate n from +z onto base
    var e = new Float32Array(6);
    basis(base, e, 0);
    return [n[0] * e[3] + n[1] * e[0] + n[2] * base[0],
            n[0] * e[4] + n[1] * e[1] + n[2] * base[1],
            n[0] * e[5] + n[1] * e[2] + n[2] * base[2]];
  }
  function diskRadius(h, rmax) {
    var r;
    do { r = -h * Math.log(rand() * rand() + 1e-9); } while (r > rmax);
    return r;
  }

  function makeClump(kind) {
    var n = kind === 'proto' ? isoNormal() : tiltNormal(0.12, null);
    var e = new Float32Array(6);
    basis(n, e, 0);
    var r0 = kind === 'proto' ? 0.025 + 0.085 * rand() : 0.05 + 0.13 * rand();
    var sign = kind === 'proto' && rand() < 0.5 ? -1 : 1;
    return { n: n, e: e, r0: r0, om: omega(r0) * sign, sign: sign, ph: rand() * 2 * Math.PI, kind: kind };
  }
  var protoClumps = [], thickClumps = [];
  for (var c = 0; c < 8; c++) protoClumps.push(makeClump('proto'));
  for (c = 0; c < 8; c++) thickClumps.push(makeClump('thick'));
  function clumpRadius(cl, t) {
    return cl.kind === 'thick' ? cl.r0 * (1 - 0.45 * smooth(T_SPIN, T_COOL, t)) : cl.r0;
  }
  function clumpPos(cl, clk, t, out) {
    var ph = cl.ph + cl.om * clk, r = clumpRadius(cl, t);
    out[0] = r * (Math.cos(ph) * cl.e[0] + Math.sin(ph) * cl.e[3]);
    out[1] = r * (Math.cos(ph) * cl.e[1] + Math.sin(ph) * cl.e[4]);
    out[2] = r * (Math.cos(ph) * cl.e[2] + Math.sin(ph) * cl.e[5]);
  }

  // ---------------------------------------------------------------- filaments
  // Each cold stream falls in from direction d and bends toward b by phi
  // radians on its way in, so it brings angular momentum about its own axis.
  // The three axes differ, which keeps the protogalaxy's spin incoherent.
  var R_OUT = 0.8, R_IN = 0.035, FLOW = 0.25;
  function makeStream(d, axis, phi, S, w) {
    d = norm3(d);
    var b = norm3(cross3(d, axis));
    var cl = [];
    for (var i = 0; i < 6; i++) cl.push(rand());
    return { d: d, b: b, n: cross3(d, b), phi: phi, S: S, w: w, clumps: cl };
  }
  var STREAMS = [
    makeStream([-0.80, 0.25, 0.55], [0, 1, 0], 1.3, 1.0, 0.034),
    makeStream([0.85, -0.30, -0.35], [0, 1, 0], -1.1, 0.6, 0.027),
    makeStream([0.20, 0.45, 0.87], [0, 1, 0], -0.9, 0.35, 0.021)
  ];
  // s runs from 0 at the far end to 1 at the galaxy. out: position, then the
  // in-plane direction perpendicular to the radius.
  function streamPoint(st, s, out) {
    var R = R_IN + (R_OUT - R_IN) * (1 - s);
    var ph = st.phi * s * s;
    var cp = Math.cos(ph), sp = Math.sin(ph);
    for (var i = 0; i < 3; i++) {
      out[i] = R * (cp * st.d[i] + sp * st.b[i]);
      out[3 + i] = -sp * st.d[i] + cp * st.b[i];
    }
  }
  var tmp6 = new Float32Array(6);
  streamPoint(STREAMS[0], 0.9, tmp6);
  var LOPSIDE = norm3([tmp6[0], tmp6[1], tmp6[2]]);   // the side the dominant stream feeds

  // ---------------------------------------------------------------- satellites
  // Minor mergers: [merge epoch, infall time, filament (-1: none), stars, merge radius]
  var SAT_SPEC = [
    [0.055, 0.06, 0, 520, 0.06], [0.085, 0.07, -1, 380, 0.07], [0.115, 0.08, 1, 760, 0.07],
    [0.145, 0.07, 0, 450, 0.08], [0.18, 0.08, -1, 420, 0.08], [0.21, 0.09, 0, 880, 0.09],
    [0.25, 0.08, 2, 400, 0.09], [0.36, 0.10, 1, 480, 0.12], [0.47, 0.10, -1, 340, 0.14],
    [0.74, 0.14, -1, 300, 0.17]
  ];
  var N_SAT = SAT_SPEC.length;
  var small = Math.min(window.innerWidth || 1024, screen.width || 1024) < 700;
  var SATS = [];
  for (var si = 0; si < N_SAT; si++) {
    var spec = SAT_SPEC[si], d, b, phi;
    if (spec[2] >= 0) {
      var st0 = STREAMS[spec[2]], jit = isoNormal();
      d = norm3([st0.d[0] + 0.25 * jit[0], st0.d[1] + 0.25 * jit[1], st0.d[2] + 0.25 * jit[2]]);
      var bd = dot3(st0.b, d);
      b = norm3([st0.b[0] - bd * d[0], st0.b[1] - bd * d[1], st0.b[2] - bd * d[2]]);
      phi = st0.phi * (0.8 + 0.4 * rand());
    } else {
      do { d = isoNormal(); } while (Math.abs(d[1]) > 0.75);
      b = norm3(cross3(d, isoNormal()));
      phi = (rand() < 0.5 ? -1 : 1) * (0.7 + 0.9 * rand());
    }
    var nst = Math.round(spec[3] * (small ? 0.45 : 1));
    SATS.push({ ts: spec[0] - spec[1], tm: spec[0], R0: 0.75, Rm: spec[4], d: d, b: b, phi: phi,
                ecc: 0.35 + 0.35 * rand(), kap: 1.3 + 0.3 * rand(), n: nst,
                rb: 0.018 * Math.cbrt(spec[3] / 500) });
  }
  // Position along the infall path. Before ts the satellite is still farther out.
  function satCenter(s, u, out) {
    var R = lerp(s.R0, s.Rm, u), up = Math.max(u, 0), ph = s.phi * up * up;
    var cp = Math.cos(ph), sp = Math.sin(ph);
    out[0] = R * (cp * s.d[0] + sp * s.b[0]);
    out[1] = R * (cp * s.d[1] + sp * s.b[1]);
    out[2] = R * (cp * s.d[2] + sp * s.b[2]);
  }
  function satU(s, t) { return Math.min(1, (t - s.ts) / (s.tm - s.ts)); }

  // ---------------------------------------------------------------- stars
  var N_HOST = small ? 50000 : 120000;
  var N_SATSTARS = 0;
  for (si = 0; si < N_SAT; si++) N_SATSTARS += SATS[si].n;
  var N_STARS = N_HOST + N_SATSTARS;
  var STRIDE = 13;
  var starData = new Float32Array(N_STARS * STRIDE);
  var sampleIdx = [];
  var tmpE = new Float32Array(6);
  function putStar(i, tb, r, omS, psi, e1, e2, cat, lum, omB) {
    var k = i * STRIDE;
    starData[k] = tb; starData[k + 1] = r; starData[k + 2] = omS; starData[k + 3] = psi;
    starData[k + 4] = e1[0]; starData[k + 5] = e1[1]; starData[k + 6] = e1[2];
    starData[k + 7] = e2[0]; starData[k + 8] = e2[1]; starData[k + 9] = e2[2];
    starData[k + 10] = cat; starData[k + 11] = lum; starData[k + 12] = omB;
  }
  var e1v = [0, 0, 0], e2v = [0, 0, 0];
  for (var i = 0; i < N_HOST; i++) {
    var tb;
    do { tb = rand(); } while (rand() * 2.0 > sfr(tb));
    var tk = Math.max(0, tb - LAG);
    var w = order(tk);
    var cat = tb < T_SPIN + LAG ? 0 : (tb < T_COOL + LAG ? 1 : 2);
    var lum = Math.exp(0.35 * gauss());
    var n, r, psi, omS, omB, viaBasis = false;
    var thinBorn = thinness(tk) > 0.5;
    if (w < 0.5) {
      var pick = rand();
      if (pick < 0.08 && tb > 0.02) {
        // born in the inner part of a cold stream, then on its own orbit
        var stb = STREAMS[rand() < 0.65 ? 0 : 1];
        streamPoint(stb, 0.8 + 0.15 * rand(), tmp6);
        var P = [tmp6[0] + 0.01 * gauss(), tmp6[1] + 0.01 * gauss(), tmp6[2] + 0.01 * gauss()];
        r = Math.sqrt(dot3(P, P));
        var e1s = [P[0] / r, P[1] / r, P[2] / r];
        var sg = stb.phi < 0 ? -1 : 1;
        var td = [sg * tmp6[3], sg * tmp6[4], sg * tmp6[5]];
        var tdd = dot3(td, e1s);
        td = norm3([td[0] - tdd * e1s[0], td[1] - tdd * e1s[1], td[2] - tdd * e1s[2]]);
        var nn = cross3(e1s, td), al = 0.3 * gauss();
        e1v = e1s;
        e2v = [Math.cos(al) * td[0] + Math.sin(al) * nn[0], Math.cos(al) * td[1] + Math.sin(al) * nn[1], Math.cos(al) * td[2] + Math.sin(al) * nn[2]];
        psi = 0; omS = 0.9 * omega(r); omB = 0; viaBasis = true;
      } else if (pick < 0.56) {
        var pc = protoClumps[Math.floor(rand() * protoClumps.length)];
        r = Math.max(0.004, pc.r0 + 0.008 * gauss());
        n = tiltNormal(0.2, pc.n);
        psi = pc.ph + 0.25 * gauss();
        omS = omega(r) * pc.sign;
        omB = pc.om;
      } else {
        n = isoNormal();
        r = 0.045 * Math.sqrt(-2 * Math.log(1 - 0.995 * rand()));
        psi = rand() * 2 * Math.PI;
        omS = omB = omega(r);
      }
    } else if (!thinBorn) {
      if (rand() < 0.45) {
        var tc = thickClumps[Math.floor(rand() * thickClumps.length)];
        r = Math.max(0.004, clumpRadius(tc, tb) + 0.01 * gauss());
        n = tiltNormal(0.6 * spread(tk), tc.n);
        psi = tc.ph + 0.3 * gauss();
        omS = omega(r);
        omB = tc.om;
      } else {
        n = tiltNormal(spread(tk), null);
        r = lerp(0.045 * Math.sqrt(-2 * Math.log(1 - 0.995 * rand())), diskRadius(hThick(tk), 0.5), w);
        psi = rand() * 2 * Math.PI;
        omS = omB = omega(r);
      }
    } else {
      n = tiltNormal(spread(tk), null);
      r = diskRadius(hThin(tb), 0.85);
      omS = omega(r);
      if (rand() < 0.65 * armReach(r)) {
        // born where the gas crosses an arm; the pattern turns at OMEGA_P
        psi = ARM0 + spiral(r) + (rand() < 0.5 ? 0 : Math.PI) + 0.12 * gauss();
        omB = OMEGA_P;
      } else {
        psi = rand() * 2 * Math.PI;
        omB = omS;
      }
    }
    if (!viaBasis) {
      basis(n, tmpE, 0);
      e1v = [tmpE[0], tmpE[1], tmpE[2]];
      e2v = [tmpE[3], tmpE[4], tmpE[5]];
    }
    putStar(i, tb, r, omS, psi, e1v, e2v, cat, lum, omB);
    if (i % 16 === 0) sampleIdx.push(i);
  }
  // Satellite stars: a compact ball on the infall path, then debris on
  // eccentric orbits through the merge point. Slot 12 holds the ball radius.
  var SAT_A = new Float32Array(N_SAT * 4), SAT_D = new Float32Array(N_SAT * 3);
  var SAT_B = new Float32Array(N_SAT * 3), SAT_C = new Float32Array(N_SAT * 4);
  var idx = N_HOST, Pm = [0, 0, 0];
  for (si = 0; si < N_SAT; si++) {
    var s = SATS[si];
    SAT_A.set([s.ts, s.tm, s.R0, s.Rm], si * 4);
    SAT_D.set(s.d, si * 3); SAT_B.set(s.b, si * 3);
    SAT_C.set([s.phi, s.ecc, s.kap, 0], si * 4);
    satCenter(s, 1, Pm);
    var e1m = norm3(Pm);
    var sgn = s.phi < 0 ? -1 : 1, cph = Math.cos(s.phi), sph = Math.sin(s.phi);
    var tdir = norm3([sgn * (-sph * s.d[0] + cph * s.b[0]), sgn * (-sph * s.d[1] + cph * s.b[1]), sgn * (-sph * s.d[2] + cph * s.b[2])]);
    var nrm = cross3(e1m, tdir);
    for (var m = 0; m < s.n; m++) {
      var tbs = Math.max(0.004, s.tm - 0.008 - 0.16 * Math.pow(rand(), 1.2));
      var alpha = 0.6 * gauss();
      var e2m = [Math.cos(alpha) * tdir[0] + Math.sin(alpha) * nrm[0],
                 Math.cos(alpha) * tdir[1] + Math.sin(alpha) * nrm[1],
                 Math.cos(alpha) * tdir[2] + Math.sin(alpha) * nrm[2]];
      var ri = s.Rm * clamp(Math.exp(0.4 * gauss()), 0.4, 2.6);
      putStar(idx++, tbs, ri, omega(ri), rand() * 2 * Math.PI, e1m, e2m, 3 + si,
              0.3 * Math.exp(0.35 * gauss()), s.rb * (0.2 + Math.abs(gauss())));
    }
  }

  // ---------------------------------------------------------------- gas
  var N_GAS = small ? 12000 : 14000;
  var G = {
    kindP: new Uint8Array(N_GAS), cP: new Uint8Array(N_GAS), offP: new Float32Array(N_GAS * 3),
    eP: new Float32Array(N_GAS * 6), rP: new Float32Array(N_GAS), omP: new Float32Array(N_GAS), phP: new Float32Array(N_GAS),
    kindK: new Uint8Array(N_GAS), cK: new Uint8Array(N_GAS), offK: new Float32Array(N_GAS * 3),
    shapeK: new Float32Array(N_GAS), phK: new Float32Array(N_GAS), omK: new Float32Array(N_GAS),
    uK: new Float32Array(N_GAS), psiK: new Float32Array(N_GAS),
    shapeN: new Float32Array(N_GAS), phN: new Float32Array(N_GAS), omN: new Float32Array(N_GAS), zN: new Float32Array(N_GAS),
    uN: new Float32Array(N_GAS), psiN: new Float32Array(N_GAS),
    out: new Uint8Array(N_GAS), dir: new Float32Array(N_GAS * 3), side: new Float32Array(N_GAS), delay: new Float32Array(N_GAS)
  };
  for (var j = 0; j < N_GAS; j++) {
    G.kindP[j] = rand() < 0.62 ? 0 : 1;
    G.cP[j] = Math.floor(rand() * protoClumps.length);
    G.offP[3 * j] = 0.013 * gauss(); G.offP[3 * j + 1] = 0.013 * gauss(); G.offP[3 * j + 2] = 0.009 * gauss();
    basis(isoNormal(), G.eP, 6 * j);
    G.rP[j] = 0.03 + 0.2 * Math.pow(rand(), 0.8);
    G.omP[j] = omega(G.rP[j]) * (rand() < 0.5 ? -1 : 1);
    G.phP[j] = rand() * 2 * Math.PI;
    G.kindK[j] = rand() < 0.5 ? 0 : 1;
    G.cK[j] = Math.floor(rand() * thickClumps.length);
    G.offK[3 * j] = 0.016 * gauss(); G.offK[3 * j + 1] = 0.016 * gauss(); G.offK[3 * j + 2] = 0.008 * gauss();
    G.uK[j] = rand(); G.psiK[j] = rand() * 2 * Math.PI;
    var sh;
    do { sh = -Math.log(rand() * rand() + 1e-9); } while (sh > 6);
    G.shapeK[j] = sh; G.phK[j] = rand() * 2 * Math.PI; G.omK[j] = omega(0.09 * sh);
    do { sh = -Math.log(rand() * rand() + 1e-9); } while (sh > 5.5);
    // thin disk: phN is the gas parcel's phase relative to the spiral pattern
    G.shapeN[j] = sh; G.phN[j] = rand() * 2 * Math.PI; G.omN[j] = omega(0.12 * sh);
    G.zN[j] = gauss(); G.uN[j] = rand(); G.psiN[j] = rand() * 2 * Math.PI;
    G.out[j] = rand() < 0.3 ? 1 : 0;
    var dn = isoNormal();
    G.dir[3 * j] = dn[0]; G.dir[3 * j + 1] = dn[1]; G.dir[3 * j + 2] = dn[2];
    G.side[j] = rand() < 0.5 ? -1 : 1;
    G.delay[j] = rand();
  }

  // cold streams
  var N_IN = small ? 1800 : 2800;
  var IN_ST = new Uint8Array(N_IN), IN_S0 = new Float32Array(N_IN), IN_G = new Float32Array(N_IN * 2), IN_CL = new Uint8Array(N_IN);
  for (j = 0; j < N_IN; j++) {
    var x = rand() * 1.95, ks = x < 1 ? 0 : (x < 1.6 ? 1 : 2);
    IN_ST[j] = ks;
    if (rand() < 0.55) {
      var cls = STREAMS[ks].clumps;
      IN_S0[j] = cls[Math.floor(rand() * cls.length)] + 0.014 * gauss();
      IN_G[2 * j] = 0.45 * gauss(); IN_G[2 * j + 1] = 0.45 * gauss(); IN_CL[j] = 1;
    } else {
      IN_S0[j] = rand();
      IN_G[2 * j] = gauss(); IN_G[2 * j + 1] = gauss(); IN_CL[j] = 0;
    }
  }

  // gas carried in by the satellites
  var N_SG = small ? 36 : 56;
  var SG_OFF = new Float32Array(N_SAT * N_SG * 3), SG_LAG = new Float32Array(N_SAT * N_SG);
  for (j = 0; j < N_SAT * N_SG; j++) {
    var rbj = SATS[Math.floor(j / N_SG)].rb, tail = rand() < 0.3;
    SG_LAG[j] = tail ? 0.03 + 0.12 * rand() : 0;
    var sc = tail ? 0.8 : 1.4;
    SG_OFF[3 * j] = sc * rbj * gauss(); SG_OFF[3 * j + 1] = sc * rbj * gauss(); SG_OFF[3 * j + 2] = sc * rbj * gauss();
  }

  // hot outflow plumes: N_SLOT staggered episodes that repeat with period SHELL_P
  var N_SLOT = 6, PER_SLOT = small ? 240 : 380, N_OUT = N_SLOT * PER_SLOT, SHELL_P = 1.5;
  var OUT_DIR = new Float32Array(N_OUT * 3), OUT_F = new Float32Array(N_OUT), OUT_SZ = new Float32Array(N_OUT);
  for (j = 0; j < N_OUT; j++) {
    var od = isoNormal();
    OUT_DIR[3 * j] = od[0]; OUT_DIR[3 * j + 1] = od[1]; OUT_DIR[3 * j + 2] = od[2];
    OUT_F[j] = 0.45 + 0.55 * Math.sqrt(rand());
    OUT_SZ[j] = 0.7 + 0.6 * rand();
  }

  var N_ALL = N_GAS + N_IN + N_SAT * N_SG + N_OUT;
  var GSTRIDE = 8;           // x, y, z, size in px, dust, star-forming, inflow, outflow
  var gasData = new Float32Array(N_ALL * GSTRIDE);
  var eTmp = new Float32Array(6);
  var cpos = new Float32Array(48);
  var site = new Float32Array(3), cen = new Float32Array(3);

  function tiltBasis(u, psi, sig, out) {
    var th = Math.min(Math.PI, sig * Math.sqrt(-2 * Math.log(1 - 0.999 * u)));
    var st = Math.sin(th);
    basis([st * Math.cos(psi), st * Math.sin(psi), Math.cos(th)], out, 0);
    return [st * Math.cos(psi), st * Math.sin(psi), Math.cos(th)];
  }

  // Gas weights are per device pixel, so they are rescaled by the canvas size
  // (resK) to keep surface brightness and dust the same on every screen.
  var nOut = 0, pxScale = 1, resK = 1;
  function emit(x, y, z, size, dust, ha, inf, outf) {
    var px = clamp(1.6 * size * pxScale, 3.0, Math.min(maxPoint, 160));
    var area = px * px / resK, k = nOut * GSTRIDE;
    gasData[k] = x; gasData[k + 1] = y; gasData[k + 2] = z; gasData[k + 3] = px;
    gasData[k + 4] = dust * GS / area; gasData[k + 5] = ha * GS / area;
    gasData[k + 6] = inf * GS / area; gasData[k + 7] = outf * GS / area;
    nOut++;
  }

  function computeGas(t, clock, slosh, pxPerUnit) {
    nOut = 0; pxScale = pxPerUnit; resK = Math.pow(W / 954, 2);
    var wPK = order(t), wKN = thinness(t);
    var sp = spread(t), hK = hThick(t), hN = hThin(t);
    var D = outflow(t);
    var fGas = lerp(1.0, 0.5, t);
    var nVis = Math.round(N_GAS * fGas);
    var Z = 0.12 + 0.88 * smooth(0, 0.75, t);
    var sf = sfr(t);
    var i, k, a, cph, sph, rr;
    for (i = 0; i < protoClumps.length; i++) {
      var cl = protoClumps[i], ph = cl.ph + cl.om * clock, r = clumpRadius(cl, t);
      cpos[3 * i] = r * (Math.cos(ph) * cl.e[0] + Math.sin(ph) * cl.e[3]);
      cpos[3 * i + 1] = r * (Math.cos(ph) * cl.e[1] + Math.sin(ph) * cl.e[4]);
      cpos[3 * i + 2] = r * (Math.cos(ph) * cl.e[2] + Math.sin(ph) * cl.e[5]);
    }
    for (i = 0; i < thickClumps.length; i++) {
      var tcl = thickClumps[i], tph = tcl.ph + tcl.om * clock, tr = clumpRadius(tcl, t);
      k = 24 + 3 * i;
      cpos[k] = tr * (Math.cos(tph) * tcl.e[0] + Math.sin(tph) * tcl.e[3]);
      cpos[k + 1] = tr * (Math.cos(tph) * tcl.e[1] + Math.sin(tph) * tcl.e[4]);
      cpos[k + 2] = tr * (Math.cos(tph) * tcl.e[2] + Math.sin(tph) * tcl.e[5]);
    }

    // the galaxy's own gas: protogalaxy clumps and cloud, thick-disk clumps,
    // thin disk with spiral arms, blended by the phase weights
    for (var j = 0; j < nVis; j++) {
      var x0 = 0, y0 = 0, z0 = 0, x1 = 0, y1 = 0, z1 = 0, x2 = 0, y2 = 0, z2 = 0;
      var s0 = 0, s1 = 0, s2 = 0, f0 = 0, f1 = 0, f2 = 0;
      if (wPK < 1) {
        if (G.kindP[j] === 0) {
          var pc = protoClumps[G.cP[j]], ci = 3 * G.cP[j];
          var o0 = G.offP[3 * j], o1 = G.offP[3 * j + 1], o2 = G.offP[3 * j + 2];
          x0 = cpos[ci] + o0 * pc.e[0] + o1 * pc.e[3] + o2 * pc.n[0];
          y0 = cpos[ci + 1] + o0 * pc.e[1] + o1 * pc.e[4] + o2 * pc.n[1];
          z0 = cpos[ci + 2] + o0 * pc.e[2] + o1 * pc.e[5] + o2 * pc.n[2];
          s0 = 0.011; f0 = 1;
        } else {
          a = G.phP[j] + G.omP[j] * clock; cph = Math.cos(a); sph = Math.sin(a); rr = G.rP[j];
          k = 6 * j;
          x0 = rr * (cph * G.eP[k] + sph * G.eP[k + 3]);
          y0 = rr * (cph * G.eP[k + 1] + sph * G.eP[k + 4]);
          z0 = rr * (cph * G.eP[k + 2] + sph * G.eP[k + 5]);
          // the cloud bulges toward the side the strongest stream feeds
          var lop = 1 + 0.4 * (x0 * LOPSIDE[0] + y0 * LOPSIDE[1] + z0 * LOPSIDE[2]) / rr;
          x0 *= lop; y0 *= lop; z0 *= lop;
          s0 = 0.03; f0 = 0;
        }
      }
      if (wPK > 0 && wKN < 1) {
        if (G.kindK[j] === 0) {
          var tc = thickClumps[G.cK[j]], ti = 24 + 3 * G.cK[j];
          var q0 = G.offK[3 * j], q1 = G.offK[3 * j + 1], q2 = G.offK[3 * j + 2];
          x1 = cpos[ti] + q0 * tc.e[0] + q1 * tc.e[3] + q2 * tc.n[0];
          y1 = cpos[ti + 1] + q0 * tc.e[1] + q1 * tc.e[4] + q2 * tc.n[1];
          z1 = cpos[ti + 2] + q0 * tc.e[2] + q1 * tc.e[5] + q2 * tc.n[2];
          s1 = 0.013; f1 = 1;
        } else {
          tiltBasis(G.uK[j], G.psiK[j], sp, eTmp);
          a = G.phK[j] + G.omK[j] * clock; cph = Math.cos(a); sph = Math.sin(a); rr = hK * G.shapeK[j];
          x1 = rr * (cph * eTmp[0] + sph * eTmp[3]);
          y1 = rr * (cph * eTmp[1] + sph * eTmp[4]);
          z1 = rr * (cph * eTmp[2] + sph * eTmp[5]);
          s1 = 0.02; f1 = 0;
        }
      }
      if (wKN > 0) {
        // Density wave: the parcel's phase relative to the pattern, qd, grows
        // at (omega - OMEGA_P). Mapping it through qd - A/2 sin(2 qd) makes the
        // parcel linger near qd = 0 and pi, where the two arms are.
        var nrm = tiltBasis(G.uN[j], G.psiN[j], sp, eTmp);
        rr = hN * G.shapeN[j];
        var A = ARM_GAS * armReach(rr);
        var qd = G.phN[j] + (G.omN[j] - OMEGA_P) * clock;
        a = ARM0 + spiral(rr) + OMEGA_P * clock + qd - 0.5 * A * Math.sin(2 * qd);
        var sq = Math.sin(qd);
        var inArm = A > 0 ? Math.exp(-sq * sq / 0.14) * A / ARM_GAS : 0;
        s2 = lerp(0.014, 0.011, inArm); f2 = 0.12 + 0.88 * inArm;
        cph = Math.cos(a); sph = Math.sin(a);
        var zz = 0.004 * G.zN[j];
        x2 = rr * (cph * eTmp[0] + sph * eTmp[3]) + zz * nrm[0];
        y2 = rr * (cph * eTmp[1] + sph * eTmp[4]) + zz * nrm[1];
        z2 = rr * (cph * eTmp[2] + sph * eTmp[5]) + zz * nrm[2];
      }
      var x = lerp(lerp(x0, x1, wPK), x2, wKN);
      var y = lerp(lerp(y0, y1, wPK), y2, wKN);
      var z = lerp(lerp(z0, z1, wPK), z2, wKN);
      var size = lerp(lerp(s0, s1, wPK), s2, wKN);
      var sfw = lerp(lerp(f0, f1, wPK), f2, wKN);
      if (G.out[j] && D > 0.01) {
        var d0 = G.dir[3 * j], d1 = G.dir[3 * j + 1], d2 = G.dir[3 * j + 2];
        var b0 = lerp(d0, 0.35 * d0, wPK), b1 = lerp(d1, 0.35 * d1, wPK), b2 = lerp(d2, G.side[j] + 0.35 * d2, wPK);
        var bn = Math.sqrt(b0 * b0 + b1 * b1 + b2 * b2) || 1;
        var push = 0.11 * D * (0.5 + G.delay[j]);
        x += b0 / bn * push; y += b1 / bn * push; z += b2 / bn * push;
        size *= 1 + 2.5 * push / 0.11;
        sfw *= 0.3;
      }
      emit(x + slosh[0], y + slosh[1], z + slosh[2], size, Z * (0.7 + 0.15 * sfw), sfw * sf * 1.4, 0, 0);
    }

    // cold streams flowing in along the filaments
    var lev = inflowLevel(t);
    if (lev > 0.002) {
      var inNorm = 2800 / N_IN;
      for (j = 0; j < N_IN; j++) {
        var stm = STREAMS[IN_ST[j]];
        var sv = IN_S0[j] + FLOW * clock;
        sv -= Math.floor(sv);
        streamPoint(stm, sv, tmp6);
        var wd = stm.w * (1.25 - 0.85 * sv), g1 = IN_G[2 * j], g2 = IN_G[2 * j + 1];
        var prof = (0.3 + 0.7 * sv) * smooth(0, 0.14, sv) * (1 - smooth(0.84, 0.99, sv));
        var e = lev * stm.S * prof * (IN_CL[j] ? 1.5 : 1.0);
        if (e < 1e-4) continue;
        var knot = IN_CL[j] ? smooth(0.78, 0.95, sv) : 0;
        emit(tmp6[0] + wd * (g1 * stm.n[0] + g2 * tmp6[3]) + slosh[0] * sv,
             tmp6[1] + wd * (g1 * stm.n[1] + g2 * tmp6[4]) + slosh[1] * sv,
             tmp6[2] + wd * (g1 * stm.n[2] + g2 * tmp6[5]) + slosh[2] * sv,
             (IN_CL[j] ? 0.011 : 0.02) * (1.15 - 0.45 * sv),
             Z * 0.12 * e, 0.5 * e * knot * inNorm, e * inNorm, 0);
      }
    }

    // satellites' gas: a star-forming core and a stripped tail along the path
    var sgNorm = 56 / N_SG;
    for (var s = 0; s < N_SAT; s++) {
      var sat = SATS[s];
      var vis = 1 - smooth(sat.tm - 0.004, sat.tm + 0.014, t);
      if (vis < 0.01) continue;
      var u = satU(sat, t);
      for (j = s * N_SG; j < (s + 1) * N_SG; j++) {
        satCenter(sat, u - SG_LAG[j], cen);
        var isTail = SG_LAG[j] > 0;
        emit(cen[0] + SG_OFF[3 * j] + slosh[0] * 0.5, cen[1] + SG_OFF[3 * j + 1] + slosh[1] * 0.5,
             cen[2] + SG_OFF[3 * j + 2] + slosh[2] * 0.5,
             isTail ? 0.013 : 0.009, Z * 0.8 * vis * sgNorm, (isTail ? 0.25 : 0.9) * vis * sgNorm, 0, 0);
      }
    }

    // hot outflows: lopsided plumes from clumps or the center early on,
    // two cones along the spin axis once the disk forms
    var of = outflowLevel(t);
    if (of > 0.002) {
      var outNorm = 2280 / N_OUT;
      for (var slot = 0; slot < N_SLOT; slot++) {
        var phs = clock / SHELL_P + slot / N_SLOT, ep = Math.floor(phs), age = phs - ep;
        var h1 = hash1(ep * 7.13 + slot * 1.37), h2 = hash1(ep * 3.71 + slot * 5.19 + 0.5);
        var h3 = hash1(ep * 1.93 + slot * 2.71 + 0.25), h4 = hash1(ep * 9.17 + slot * 0.61 + 0.75);
        site[0] = site[1] = site[2] = 0;
        if (h1 < 0.6 * (1 - wPK)) clumpPos(protoClumps[Math.floor(h2 * 8) % 8], clock - age * SHELL_P, t, site);
        var cth = 1 - 2 * h3, sth = Math.sqrt(Math.max(0, 1 - cth * cth)), pph = 2 * Math.PI * h4;
        var Dx = sth * Math.cos(pph), Dy = sth * Math.sin(pph), Dz = cth;
        var strength = of * (0.5 + 0.8 * h2);
        var Rmax = lerp(0.15, 0.3, wPK) * (0.8 + 0.4 * h1);
        var grow = 1 - (1 - age) * (1 - age);
        var fade = Math.pow(1 - age, 1.6) * smooth(0, 0.07, age);
        for (j = slot * PER_SLOT; j < (slot + 1) * PER_SLOT; j++) {
          var ux = OUT_DIR[3 * j], uy = OUT_DIR[3 * j + 1], uz = OUT_DIR[3 * j + 2];
          var px1 = ux + 1.15 * Dx, py1 = uy + 1.15 * Dy, pz1 = uz + 1.15 * Dz;
          var l1 = Math.sqrt(px1 * px1 + py1 * py1 + pz1 * pz1) || 1;
          var cz = uz + (uz < 0 ? -1.8 : 1.8);
          var l2 = Math.sqrt(ux * ux + uy * uy + cz * cz) || 1;
          var dx = lerp(px1 / l1, ux / l2, wPK), dy = lerp(py1 / l1, uy / l2, wPK), dz = lerp(pz1 / l1, cz / l2, wPK);
          var rad = Rmax * OUT_F[j] * grow;
          var eo = strength * fade;
          emit(site[0] + dx * rad + slosh[0], site[1] + dy * rad + slosh[1], site[2] + dz * rad + slosh[2],
               (0.012 + 0.05 * age) * OUT_SZ[j], Z * 0.1 * eo, 0, 0, eo * outNorm);
        }
      }
    }
    return nOut;
  }

  // ---------------------------------------------------------------- WebGL
  var gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false,
                                          powerPreference: 'high-performance' });
  if (!gl) return;
  if (!gl.getExtension('EXT_color_buffer_float')) gl.getExtension('EXT_color_buffer_half_float');
  var maxPoint = (gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) || [1, 64])[1];

  var VS_STARS = [
    '#version 300 es',
    'precision highp float;',
    'layout(location=0) in vec4 a0;',   // tb, r, omega_star, psi
    'layout(location=1) in vec3 a1;',   // e1
    'layout(location=2) in vec3 a2;',   // e2
    'layout(location=3) in vec3 a3;',   // category, luminosity scale, omega at birth (satellites: ball radius)
    'uniform float uT; uniform float uSpinK; uniform float uAmb;',
    'uniform vec3 uSlosh; uniform vec2 uView; uniform vec2 uScale;',
    'uniform float uSize; uniform float uGyr;',
    'uniform float uOmP; uniform float uArm0; uniform float uInvTanP; uniform float uArmA;',
    'uniform vec4 uSatA[' + N_SAT + ']; uniform vec3 uSatD[' + N_SAT + ']; uniform vec3 uSatB[' + N_SAT + ']; uniform vec4 uSatC[' + N_SAT + '];',
    'out vec4 vCol;',
    'vec3 ageColor(float la) {',
    '  vec3 c0 = vec3(0.52, 0.68, 1.0); vec3 c1 = vec3(0.78, 0.85, 1.0); vec3 c2 = vec3(1.0, 0.95, 0.86);',
    '  vec3 c3 = vec3(1.0, 0.8, 0.57); vec3 c4 = vec3(1.0, 0.64, 0.4);',
    '  if (la < -2.0) return c0;',
    '  if (la < -1.0) return mix(c0, c1, la + 2.0);',
    '  if (la < 0.0) return mix(c1, c2, la + 1.0);',
    '  if (la < 0.7) return mix(c2, c3, la / 0.7);',
    '  return mix(c3, c4, clamp((la - 0.7) / 0.45, 0.0, 1.0));',
    '}',
    'void main() {',
    '  float tb = a0.x;',
    '  if (tb > uT) { gl_Position = vec4(2.0, 2.0, 0.0, 1.0); gl_PointSize = 0.0; vCol = vec4(0.0); return; }',
    '  float cat = a3.x;',
    '  vec3 p;',
    '  if (cat > 2.5) {',
    // satellite star: ball on the infall path, blending into debris orbits
    '    int k = int(cat + 0.5) - 3;',
    '    vec4 sa = uSatA[k]; vec4 sc = uSatC[k];',
    '    float u = min(1.0, (uT - sa.x) / (sa.y - sa.x));',
    '    float up = max(u, 0.0);',
    '    float phi = sc.x * up * up;',
    '    vec3 C = mix(sa.z, sa.w, u) * (cos(phi) * uSatD[k] + sin(phi) * uSatB[k]);',
    '    vec3 n = cross(a1, a2);',
    '    float beta = 6.2831853 * fract(a0.y * 97.31);',
    '    float pb = a0.w + 1.4 * (uSpinK * uT + uAmb);',
    '    vec3 ball = C + a3.z * (cos(pb) * a1 + sin(pb) * (cos(beta) * a2 + sin(beta) * n));',
    '    float ph = a0.z * uSpinK * (uT - sa.y);',
    '    float ecc = sc.y * (0.6 + 0.8 * fract(a0.y * 53.7));',
    '    float rr = a0.y * (1.0 + ecc * (1.0 - cos(sc.z * (0.85 + 0.3 * fract(a0.y * 71.3)) * ph)));',
    '    vec3 orb = rr * (cos(ph) * a1 + sin(ph) * a2);',
    '    p = mix(ball, orb, smoothstep(sa.y - 0.012, sa.y + 0.018, uT)) + uSlosh;',
    '  } else {',
    '    float ph = a0.w + a3.z * (uSpinK * tb + uAmb) + a0.z * uSpinK * (uT - tb);',
    '    if (cat > 1.5 && uArmA > 0.0) {',
    // thin-disk stars linger a little where they cross the arms
    '      float r = a0.y;',
    '      float A = uArmA * smoothstep(0.04, 0.09, r);',
    '      float th = uArm0 - log(max(r, 0.02) / 0.05) * uInvTanP + uOmP * (uSpinK * uT + uAmb);',
    '      float qd = ph - th;',
    '      ph = th + qd - 0.5 * A * sin(2.0 * qd);',
    '    }',
    '    p = a0.y * (cos(ph) * a1 + sin(ph) * a2) + uSlosh;',
    '  }',
    '  vec2 s = vec2(p.x, p.y * uView.x + p.z * uView.y);',
    '  gl_Position = vec4(s * uScale, 0.0, 1.0);',
    '  float age = max((uT - tb) * uGyr, 0.003);',
    '  float L = min(pow(age / 0.01, -0.7), 1.2);',
    '  vCol = vec4(ageColor(log(age) / log(10.0)) * L * a3.y, 0.0);',
    '  gl_PointSize = uSize * (age < 0.03 ? 1.25 : 1.0);',
    '}'
  ].join('\n');

  var FS_SPRITE = [
    '#version 300 es',
    'precision highp float;',
    'in vec4 vCol; out vec4 o;',
    'void main() {',
    '  vec2 d = gl_PointCoord * 2.0 - 1.0;',
    '  float r2 = dot(d, d);',
    '  if (r2 > 1.0) discard;',
    '  o = vCol * exp(-4.0 * r2);',
    '}'
  ].join('\n');

  var VS_GAS = [
    '#version 300 es',
    'precision highp float;',
    'layout(location=0) in vec4 a0;',   // x, y, z, size in device px
    'layout(location=1) in vec4 a1;',   // dust, star-forming, inflow, outflow (per px^2)
    'uniform vec2 uView; uniform vec2 uScale;',
    'out vec4 vCol;',
    'void main() {',
    '  vec2 s = vec2(a0.x, a0.y * uView.x + a0.z * uView.y);',
    '  gl_Position = vec4(s * uScale, 0.0, 1.0);',
    '  gl_PointSize = a0.w;',
    '  vCol = a1;',
    '}'
  ].join('\n');

  var VS_FULL = [
    '#version 300 es',
    'out vec2 vUv;',
    'void main() {',
    '  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));',
    '  vUv = p;',
    '  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FS_COMP = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUv; out vec4 o;',
    'uniform sampler2D uLight; uniform sampler2D uGas; uniform sampler2D uBlur;',
    'uniform float uExposure; uniform float uDust; uniform float uHa; uniform float uIn; uniform float uOut;',
    'uniform float uSharp; uniform float uDiffuse;',
    'uniform vec3 uHaCol; uniform vec3 uInCol; uniform vec3 uOutCol;',
    'uniform vec3 uBg; uniform vec3 uHaloCol; uniform float uHalo; uniform vec2 uScale; uniform float uHaloR;',
    'void main() {',
    '  vec4 L = uSharp * texture(uLight, vUv) + uDiffuse * texture(uBlur, vUv);',
    '  vec4 g = texture(uGas, vUv);',
    '  float tau = uDust * g.r;',
    '  vec3 col = L.rgb * exp(-tau * vec3(0.72, 1.0, 1.35)) * uExposure;',
    '  col += uHaCol * g.g * uHa * exp(-0.5 * tau);',
    '  col += uInCol * g.b * uIn * exp(-0.25 * tau);',
    '  col += uOutCol * g.a * uOut;',
    '  vec2 m = (vUv * 2.0 - 1.0) / uScale;',
    '  col += uHaloCol * uHalo * exp(-dot(m, m) / (uHaloR * uHaloR));',
    '  float I = max((col.r + col.g + col.b) / 3.0, 1e-6);',
    '  float Q = 5.0;',
    '  col *= asinh(Q * I) / (Q * I) * (Q / asinh(Q));',
    '  col = pow(clamp(col, 0.0, 1.0), vec3(0.85));',
    '  o = vec4(uBg + col * (vec3(1.0) - uBg), 1.0);',
    '}'
  ].join('\n');

  // Diffuse light: a blurred copy of the starlight stands in for the unresolved
  // stars between the particles, and gives bright regions a soft glow.
  var FS_DOWN = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUv; out vec4 o;',
    'uniform sampler2D uSrc; uniform vec2 uTexel;',
    'void main() {',
    '  o = 0.25 * (texture(uSrc, vUv + uTexel * vec2(-1.0, -1.0)) + texture(uSrc, vUv + uTexel * vec2(1.0, -1.0))',
    '            + texture(uSrc, vUv + uTexel * vec2(-1.0, 1.0)) + texture(uSrc, vUv + uTexel * vec2(1.0, 1.0)));',
    '}'
  ].join('\n');

  var FS_BLUR = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUv; out vec4 o;',
    'uniform sampler2D uSrc; uniform vec2 uStep;',
    'void main() {',
    '  vec4 c = vec4(0.0); float ws = 0.0;',
    '  for (int i = -7; i <= 7; i++) {',
    '    float w = exp(-0.5 * float(i * i) / 9.0);',
    '    c += w * texture(uSrc, vUv + uStep * float(i)); ws += w;',
    '  }',
    '  o = c / ws;',
    '}'
  ].join('\n');

  function shader(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function program(vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, shader(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var u = {};
    var n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) {
      var info = gl.getActiveUniform(p, i);
      u[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { p: p, u: u };
  }

  var progStars, progGas, progComp, progDown, progBlur, starVAO, gasVAO, gasBuf;
  try {
    progStars = program(VS_STARS, FS_SPRITE);
    progGas = program(VS_GAS, FS_SPRITE);
    progComp = program(VS_FULL, FS_COMP);
    progDown = program(VS_FULL, FS_DOWN);
    progBlur = program(VS_FULL, FS_BLUR);
  } catch (err) {
    // Hand the figure to the 2D version on a fresh canvas
    if (window.console) console.warn('galaxy-gl: ' + err.message);
    var fresh = canvas.cloneNode(false);
    canvas.parentNode.replaceChild(fresh, canvas);
    return;
  }
  window.__galaxyGL = true;

  starVAO = gl.createVertexArray();
  gl.bindVertexArray(starVAO);
  var starBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, starBuf);
  gl.bufferData(gl.ARRAY_BUFFER, starData, gl.STATIC_DRAW);
  var SB = STRIDE * 4;
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, SB, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, SB, 16);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, SB, 28);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, SB, 40);

  gasVAO = gl.createVertexArray();
  gl.bindVertexArray(gasVAO);
  gasBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, gasBuf);
  gl.bufferData(gl.ARRAY_BUFFER, gasData.byteLength, gl.DYNAMIC_DRAW);
  var GB = GSTRIDE * 4;
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, GB, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, GB, 16);
  gl.bindVertexArray(null);

  var targets = { w: 0, h: 0 };
  function makeTarget(w, h, old) {
    if (old) { gl.deleteTexture(old.tex); gl.deleteFramebuffer(old.fb); }
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex: tex, fb: fb };
  }

  // ---------------------------------------------------------------- state
  var state = {
    T: slider ? Number(slider.value) / 1000 : 1,
    tau: 0,
    playing: false,
    incl: 84, inclTarget: 84,
    visible: true
  };
  var W = 0, H = 0, dpr = 1, cssW = 0;

  function resize() {
    var box = canvas.parentElement.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = Math.max(1, Math.round(box.width * dpr)), h = Math.max(1, Math.round(box.height * dpr));
    var scale = Math.min(1, Math.sqrt(2.2e6 / (w * h)));
    w = Math.round(w * scale); h = Math.round(h * scale);
    cssW = box.width;
    if (w === W && h === H) return;
    W = canvas.width = w; H = canvas.height = h;
    targets.light = makeTarget(W, H, targets.light);
    targets.gas = makeTarget(W, H, targets.gas);
    targets.bw = Math.max(1, Math.round(W / 4));
    targets.bh = Math.max(1, Math.round(H / 4));
    targets.blurA = makeTarget(targets.bw, targets.bh, targets.blurA);
    targets.blurB = makeTarget(targets.bw, targets.bh, targets.blurB);
    draw();
  }

  function slosh(t, tau) {
    var A = 0.05 * (1 - smooth(T_SPIN - 0.09, T_SPIN - 0.01, t));
    var c = 9 * t + 0.35 * tau;
    return [A * Math.sin(0.83 * 7 * c + 1.3), A * 0.8 * Math.sin(0.61 * 7 * c + 0.4), A * 0.7 * Math.sin(1.07 * 7 * c + 2.1)];
  }

  function exposure(t) {
    // light and light-weighted radius of a subsample, for automatic exposure
    var Lsum = 0, Lr2 = 0;
    for (var i = 0; i < sampleIdx.length; i++) {
      var k = sampleIdx[i] * STRIDE, tb = starData[k];
      if (tb > t) continue;
      var age = Math.max((t - tb) * GYR_PER_T, 0.003);
      var L = Math.min(Math.pow(age / 0.01, -0.7), 1.2) * starData[k + 11];
      var r = starData[k + 1];
      Lsum += L;
      Lr2 += L * r * r;
    }
    if (Lsum <= 0) return 1;
    var reff = Math.sqrt(Lr2 / Lsum) + 0.01;
    var S = pxPerUnit(t);
    var sb = (Lsum * 16) / (Math.PI * Math.pow(reff * S, 2)) * Math.pow(starSize(), 2);
    return EXPOSURE_K / sb;
  }

  function pxPerUnit(t) { return 0.6 * W * zoomAt(t); }
  function starSize() { return 6.0 * dpr * (W / Math.max(1, cssW * dpr)); }

  function draw() {
    if (!W) return;
    var t = state.T;
    var incl = state.incl * Math.PI / 180;
    var view = [Math.cos(incl), Math.sin(incl)];
    var S = pxPerUnit(t);
    var scale = [2 * S / W, 2 * S / H];
    var amb = reduce.matches ? 0 : AMBIENT_RATE * state.tau;
    var clock = SPIN_K * t + amb;
    var sl = slosh(t, state.tau);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.viewport(0, 0, W, H);

    gl.bindFramebuffer(gl.FRAMEBUFFER, targets.light.fb);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(progStars.p);
    var u = progStars.u;
    gl.uniform1f(u.uT, t); gl.uniform1f(u.uSpinK, SPIN_K); gl.uniform1f(u.uAmb, amb);
    gl.uniform3fv(u.uSlosh, sl); gl.uniform2fv(u.uView, view); gl.uniform2fv(u.uScale, scale);
    gl.uniform1f(u.uSize, Math.min(starSize(), maxPoint)); gl.uniform1f(u.uGyr, GYR_PER_T);
    gl.uniform1f(u.uOmP, OMEGA_P); gl.uniform1f(u.uArm0, ARM0);
    gl.uniform1f(u.uInvTanP, 1 / Math.tan(PITCH)); gl.uniform1f(u.uArmA, ARM_STARS * thinness(t));
    gl.uniform4fv(u['uSatA[0]'], SAT_A); gl.uniform3fv(u['uSatD[0]'], SAT_D);
    gl.uniform3fv(u['uSatB[0]'], SAT_B); gl.uniform4fv(u['uSatC[0]'], SAT_C);
    gl.bindVertexArray(starVAO);
    gl.drawArrays(gl.POINTS, 0, N_STARS);

    var nGas = computeGas(t, clock, sl, S);
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets.gas.fb);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(progGas.p);
    gl.uniform2fv(progGas.u.uView, view); gl.uniform2fv(progGas.u.uScale, scale);
    gl.bindVertexArray(gasVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, gasBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, gasData.subarray(0, nGas * GSTRIDE));
    gl.drawArrays(gl.POINTS, 0, nGas);

    // diffuse light: quarter-resolution copy, blurred horizontally then vertically
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    gl.viewport(0, 0, targets.bw, targets.bh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets.blurA.fb);
    gl.useProgram(progDown.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, targets.light.tex);
    gl.uniform1i(progDown.u.uSrc, 0);
    gl.uniform2f(progDown.u.uTexel, 1 / W, 1 / H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.useProgram(progBlur.p);
    gl.uniform1i(progBlur.u.uSrc, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets.blurB.fb);
    gl.bindTexture(gl.TEXTURE_2D, targets.blurA.tex);
    var spanK = Math.max(1, W / 954);   // keep the glow the same width on high-density screens
    gl.uniform2f(progBlur.u.uStep, spanK / targets.bw, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets.blurA.fb);
    gl.bindTexture(gl.TEXTURE_2D, targets.blurB.tex);
    gl.uniform2f(progBlur.u.uStep, 0, spanK / targets.bh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(progComp.p);
    var c = progComp.u;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, targets.light.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, targets.gas.tex);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, targets.blurA.tex);
    gl.uniform1i(c.uLight, 0); gl.uniform1i(c.uGas, 1); gl.uniform1i(c.uBlur, 2);
    gl.uniform1f(c.uSharp, SHARP_K);
    gl.uniform1f(c.uDiffuse, DIFFUSE_K);
    gl.uniform1f(c.uExposure, exposure(t));
    gl.uniform1f(c.uDust, DUST_K * 14000 / N_GAS / GS);
    gl.uniform1f(c.uHa, HA_K * 14000 / N_GAS / GS);
    gl.uniform1f(c.uIn, IN_K / GS);
    gl.uniform1f(c.uOut, OUT_K / GS);
    gl.uniform3fv(c.uHaCol, [1.0, 0.36, 0.56]);
    gl.uniform3fv(c.uInCol, [0.33, 0.88, 0.8]);
    gl.uniform3fv(c.uOutCol, [0.74, 0.55, 1.0]);
    gl.uniform3fv(c.uBg, [0.012, 0.016, 0.035]);
    gl.uniform3fv(c.uHaloCol, [0.42, 0.45, 1.0]);
    gl.uniform1f(c.uHalo, 0.025 * smooth(T_COOL - 0.01, T_COOL + 0.07, t));
    gl.uniform2fv(c.uScale, scale);
    gl.uniform1f(c.uHaloR, 0.38);
    gl.bindVertexArray(null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    updateOverlays(t);
  }

  // ---------------------------------------------------------------- overlays
  var NICE = [0.5, 1, 2, 5, 10, 20];
  function updateOverlays(t) {
    if (comEl) {
      var vis = 1 - smooth(T_SPIN - 0.02, T_SPIN + 0.04, t);
      comEl.style.opacity = String(0.85 * vis);
    }
    if (scaleEl && cssW) {
      var pxPerKpc = 0.6 * cssW * zoomAt(t) / KPC_PER_UNIT;
      var len = NICE[0];
      for (var i = 0; i < NICE.length; i++) {
        if (NICE[i] * pxPerKpc <= 120) len = NICE[i];
      }
      scaleLine.style.width = (len * pxPerKpc).toFixed(1) + 'px';
      scaleLabel.textContent = len + ' kpc';
    }
  }

  // ---------------------------------------------------------------- status
  var PHASES = [
    { until: T_SPIN - 0.07, name: 'Protogalaxy',
      text: 'Cold gas streams accrete asymmetrically along filaments, small satellite galaxies merge constantly, and bursts of star formation blow hot gas back out \u2014 the galaxy is in a state of disequilibrium. Baryons slosh with a bulk velocity offset around the center of mass (+).' },
    { until: T_SPIN, name: 'Baryonic settling',
      text: 'The sloshing dies down, and the gas and stars settle onto the center of mass as the baryons become well-centered within the total potential.' },
    { until: T_SPIN + 0.06, name: 'Onset of rotation',
      text: 'The gas begins to rotate coherently. Young stars born from cold, molecular, dense star-forming gas also form a disk sometime after.' },
    { until: T_COOL, name: 'Thick disk',
      text: 'Star formation peaks but stays bursty, in giant clumps, and outflows leave above and below the disk. New stars rotate with the gas, on thick, tilted orbits.' },
    { until: T_COOL + 0.07, name: 'Cooldown',
      text: 'The gas around the inner galaxy becomes hot and stable, the cold streams and outflows fade, and star formation becomes steady.' },
    { until: 0.985, name: 'Thin disk',
      text: 'Gas settles into a thin, cold disk. It flows through a slowly turning spiral pattern and forms stars as it crosses the arms.' },
    { until: 2, name: 'Today',
      text: 'For the most part, each generation of stars keeps the orbits it was born on, leaving a round spheroid laced with the debris of merged satellites, a thick disk and a thin disk.' }
  ];
  var shownPhase = -1;
  function updateStatus() {
    var p = 0;
    while (state.T >= PHASES[p].until) p++;
    if (p === shownPhase) return;
    shownPhase = p;
    if (slider) slider.setAttribute('aria-valuetext', PHASES[p].name);
    if (statusEl) {
      statusEl.textContent = '';
      var strong = document.createElement('strong');
      strong.textContent = PHASES[p].name + '.';
      statusEl.appendChild(strong);
      statusEl.appendChild(document.createTextNode(' ' + PHASES[p].text));
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
    probe.removeAttribute('id');
    probe.removeAttribute('aria-live');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;min-height:0;width:' + width + 'px';
    statusEl.parentNode.appendChild(probe);
    var tallest = 0;
    for (var i = 0; i < PHASES.length; i++) {
      probe.textContent = '';
      var label = document.createElement('strong');
      label.textContent = PHASES[i].name + '.';
      probe.appendChild(label);
      probe.appendChild(document.createTextNode(' ' + PHASES[i].text));
      tallest = Math.max(tallest, probe.offsetHeight);
    }
    probe.parentNode.removeChild(probe);
    statusEl.style.minHeight = tallest + 'px';
  }

  // ---------------------------------------------------------------- loop
  var running = false, last = 0;
  function animating() {
    return state.playing || Math.abs(state.incl - state.inclTarget) > 0.05 || !reduce.matches;
  }
  function wantLoop() { return state.visible && !document.hidden && animating(); }
  function startLoop() {
    if (running || !wantLoop()) return;
    running = true;
    last = 0;
    requestAnimationFrame(frame);
  }
  function frame(now) {
    if (!wantLoop()) { running = false; draw(); return; }
    var dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    if (!reduce.matches) state.tau += dt;
    if (state.playing) {
      state.T = Math.min(1, state.T + dt * playRate(state.T) * PLAY_NORM / PLAY_SECONDS);
      if (slider) slider.value = String(Math.round(state.T * 1000));
      updateStatus();
      if (state.T >= 1) setPlaying(false);
    }
    var di = state.inclTarget - state.incl;
    state.incl += Math.abs(di) < 0.05 ? di : di * Math.min(1, dt * 6);
    draw();
    requestAnimationFrame(frame);
  }
  function setPlaying(on) {
    state.playing = on;
    if (playButton) {
      playButton.setAttribute('aria-pressed', on ? 'true' : 'false');
      var label = playButton.querySelector('.label');
      if (label) label.textContent = on ? 'Pause' : 'Play';
    }
    if (on) startLoop();
  }

  if (slider) {
    slider.addEventListener('input', function () {
      if (state.playing) setPlaying(false);
      state.T = Number(slider.value) / 1000;
      updateStatus();
      if (!running) draw();
    });
  }
  if (playButton) {
    playButton.addEventListener('click', function () {
      if (state.playing) { setPlaying(false); return; }
      if (state.T >= 0.995) { state.T = 0; if (slider) slider.value = '0'; updateStatus(); }
      setPlaying(true);
    });
  }

  if (toggles) {
    toggles.hidden = false;
    toggles.querySelectorAll('button[data-incl]').forEach(function (b) {
      b.addEventListener('click', function () {
        toggles.querySelectorAll('button[data-incl]').forEach(function (o) { o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
        state.inclTarget = Number(b.dataset.incl);
        if (reduce.matches) { state.incl = state.inclTarget; draw(); } else startLoop();
      });
    });
  }
  if (scaleEl) scaleEl.hidden = false;
  if (comEl) comEl.hidden = false;
  if (captionLight) captionLight.hidden = false;

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      state.visible = entries[0].isIntersecting;
      if (state.visible) startLoop();
    }).observe(canvas);
  }
  document.addEventListener('visibilitychange', startLoop);
  if (reduce.addEventListener) reduce.addEventListener('change', function () { draw(); startLoop(); });
  canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); running = false; });
  canvas.addEventListener('webglcontextrestored', function () { location.reload(); });

  // Tuning hook used while calibrating the look; harmless on the live page.
  window.__galaxyTune = {
    set: function (p) {
      if (p.dust != null) DUST_K = p.dust;
      if (p.ha != null) HA_K = p.ha;
      if (p.inflow != null) IN_K = p.inflow;
      if (p.outflow != null) OUT_K = p.outflow;
      if (p.exposure != null) EXPOSURE_K = p.exposure;
      if (p.sharp != null) SHARP_K = p.sharp;
      if (p.diffuse != null) DIFFUSE_K = p.diffuse;
      if (p.armGas != null) ARM_GAS = p.armGas;
      if (p.armStars != null) ARM_STARS = p.armStars;
    },
    frame: function (T, incl, mode, tau) {   // mode is ignored: the model shows starlight only
      state.T = T; state.incl = state.inclTarget = incl; state.tau = tau || 0;
      draw();
      return canvas.toDataURL('image/png');
    }
  };

  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas.parentElement);
  else window.addEventListener('resize', resize);
  resize();
  updateStatus();
  reserveStatusHeight();
  if ('ResizeObserver' in window && statusEl) new ResizeObserver(reserveStatusHeight).observe(statusEl);
  else window.addEventListener('resize', reserveStatusHeight);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { statusWidth = -1; reserveStatusHeight(); });
  draw();
  startLoop();
})();
