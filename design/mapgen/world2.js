/* The whole world of LiteWorldsQuest after tbuuol's draft (design/worldmap-draft.png), 2026-10-29, second take: laid out
   on the draft's own pixels (1 px of the draft = 2 m), Blockshire at (0, 0). No creatures: the land, one river, the
   mountains in the north, the places, the one road in the order it is played, and the dungeon doors. */
(function () {
  const cv = document.getElementById('c'), cx = cv.getContext('2d');
  const K = 2, I = (ix, iy) => [(ix - 300) * K, (iy - 790) * K];   /* draft pixels -> metres */
  const [ex0, ez0] = I(0, 0), [ex1, ez1] = I(1536, 1024), EXT = [ex0, ez0, ex1, ez1];
  cv.width = +(new URLSearchParams(location.search).get('w') || 2200); cv.height = Math.round(cv.width * (ez1 - ez0) / (ex1 - ex0));
  const W = cv.width, H = cv.height, sx = (ex1 - ex0) / W, sz = (ez1 - ez0) / H;
  const P = (x, z) => [(x - ex0) / sx, (z - ez0) / sz], S = m => m / sx, PI = (ix, iy) => P(...I(ix, iy));

  const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
  const noise = (x, z) => Math.sin(x * 0.173 + Math.cos(z * 0.091) * 2.1) * Math.cos(z * 0.157 + Math.sin(x * 0.083) * 1.7);
  function fbm(x, z) { let a = 0, f = 1, w = 1; for (let i = 0; i < 4; i++) { a += w * noise(x * f, z * f); f *= 2.03; w *= 0.5; } return a; }
  function ridged(x, z) { let a = 0, f = 1, w = 1; for (let i = 0; i < 4; i++) { a += w * (1 - Math.abs(noise(x * f, z * f))); f *= 2.1; w *= 0.5; } return a; }
  function segDist(x, z, pts) {
    let best = 1e9, at = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], vx = bx - ax, vz = bz - az, L = vx * vx + vz * vz;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L)), d = Math.hypot(x - ax - vx * t, z - az - vz * t);
      if (d < best) { best = d; at = (i + t) / (pts.length - 1); }
    }
    return [best, at];
  }
  const near = (x, z, ix, iy, r) => { const [a, b] = I(ix, iy); return smooth(1 - Math.hypot(x - a, z - b) / (r * K)); };

  /* --- the coast, traced off the draft (its pixels) --------------------------------------------------------- */
  const LAND = [[0, 0], [1536, 0], [1536, 1024], [905, 1024], [890, 975], [860, 940], [780, 905], [700, 885], [610, 895], [520, 875],
    [450, 885], [400, 870], [330, 905], [250, 895], [140, 905], [70, 870], [45, 800], [75, 720], [150, 695], [260, 685], [360, 665],
    [415, 615], [410, 545], [350, 490], [260, 462], [185, 448], [140, 400], [85, 345], [40, 300], [0, 280]].map(p => I(p[0], p[1]));
  function coast(x, z) {   /* signed: + on land, metres to the shore */
    let inside = false, best = 1e9;
    for (let i = 0, j = LAND.length - 1; i < LAND.length; j = i++) {
      const [xi, zi] = LAND[i], [xj, zj] = LAND[j];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
      const vx = xi - xj, vz = zi - zj, t = Math.max(0, Math.min(1, ((x - xj) * vx + (z - zj) * vz) / (vx * vx + vz * vz)));
      best = Math.min(best, Math.hypot(x - xj - vx * t, z - zj - vz * t));
    }
    best += 14 * noise(x * 0.02, z * 0.02);
    return inside ? best : -best;
  }
  /* the one river: out of the northern hills, down a fall at the Trollberg's foot, round the Goblin Village, under the bridge,
     past the Unicorn Forest and Genesis' east, into the sea */
  const RIVER = [[615, 0], [596, 80], [598, 160], [648, 245], [688, 318], [645, 372], [552, 382], [468, 418], [452, 478], [502, 526],
                 [600, 548], [700, 572], [782, 632], [848, 690], [888, 778], [880, 880], [872, 960]].map(p => I(p[0], p[1]));
  /* its second arm round the Goblin Village's east: the village is an island, reached only over the bridge */
  const ARM = [[645, 372], [690, 405], [702, 450], [680, 505], [640, 540], [600, 548]].map(p => I(p[0], p[1]));
  const ROUTE = [[300, 790], [322, 735], [350, 668], [395, 608], [392, 545], [352, 505], [318, 440], [330, 370], [395, 300], [470, 255],
                 [560, 225], [612, 205], [680, 225], [745, 280], [790, 330], [850, 395], [930, 470], [1010, 430], [1080, 360], [1150, 300],
                 [1210, 270]].map(p => I(p[0], p[1]));
  const BRANCHES = [
    { pts: [[930, 470], [1060, 500], [1180, 520], [1290, 540]], w: 5 },                                     /* the Forest to the Ruins */
    { pts: [[1290, 540], [1320, 620], [1340, 700], [1350, 790]], w: 4 },                                     /* the Ruins down into the Swamp */
    { pts: [[1350, 790], [1260, 800], [1170, 790], [1080, 780]], w: 4 },                                     /* the Swamp to the Cemetery: the end */
    { pts: [[745, 280], [790, 230], [760, 175], [800, 135], [780, 100], [815, 75]], w: 3 },                  /* up the Trollberg to the hoard */
    { pts: [[395, 608], [450, 560], [502, 526], [560, 470], [590, 425]], w: 3 },                             /* over the bridge to the Goblin Village */
    { pts: [[300, 790], [400, 800], [520, 790], [640, 775], [680, 765]], w: 5 },                             /* Blockshire - Genesis, the only road there */
  ].map(b => ({ pts: b.pts.map(p => I(p[0], p[1])), w: b.w }));

  /* --- heights --------------------------------------------------------------------------------------------- */
  function height(x, z) {
    const c = coast(x, z);
    if (c < 0) return -0.5 - 9 * Math.min(1, -c / 70);
    let h = 8 + 4 * Math.sin(x * 0.005 + 1) * Math.cos(z * 0.006) + 3 * fbm(x * 0.03, z * 0.03);
    h = h * (1 - near(x, z, 470, 240, 170)) + (4 + 1.5 * fbm(x * 0.02, z * 0.02)) * near(x, z, 470, 240, 170);   /* the Valley */
    /* the Trollberg: a mountain, its hoard on top */
    const tb = near(x, z, 815, 75, 300);
    h += 135 * Math.pow(tb, 1.5) * (0.85 + 0.25 * ridged(x * 0.012, z * 0.012));
    /* the Mountains: snowy ridges in the north-east, the fortress on a wide shelf among them */
    const [mcx, mcz] = I(1250, 150), mwx = x + 160 * fbm(x * 0.003, z * 0.003), mwz = z + 160 * fbm(z * 0.003 + 4, x * 0.003);
    const mt = smooth(1.35 - Math.hypot((mwx - mcx) / 1.3, mwz - mcz) / (330 * K));
    h += mt * (70 + 190 * Math.pow(ridged(x * 0.008 + 5, z * 0.008) / 1.9, 1.8));
    const fort = near(x, z, 1225, 215, 105);
    h = h * (1 - fort) + (95 + 4 * fbm(x * 0.05, z * 0.05)) * fort;   /* the fortress' shelf: rock, below the snow */
    /* the far north: hills, mountains beyond the Valley */
    h += Math.pow(smooth((I(0, 70)[1] + 90 * fbm(x * 0.004, 3) - z) / 160), 1.4) * (40 + 90 * Math.pow(ridged(x * 0.009, z * 0.01) / 1.9, 1.5)) * (1 - near(x, z, 600, 20, 70));
    /* the Ruins: a rocky plateau with cliffs */
    const rp = smooth((1 - Math.hypot((x - I(1320, 520)[0]) / 1.2, z - I(1320, 520)[1]) / (175 * K) + 0.2 * fbm(x * 0.006, z * 0.006)) * 6);
    h += 32 * rp + 6 * rp * fbm(x * 0.05, z * 0.05);
    /* the Cemetery's hill, the Swamp low and wet, Genesis' building ground flat */
    h += 7 * near(x, z, 1040, 790, 150);
    const sw = near(x, z, 1390, 850, 260); h = h * (1 - sw) + (0.15 + 0.7 * fbm(x * 0.03, z * 0.03)) * sw;
    const gen = near(x, z, 680, 765, 130); h = h * (1 - gen) + 6 * gen;
    /* Blockshire on its cliff */
    const rb = Math.hypot(x, z), plateau = 1 - smooth((rb - 75) / 45); h = h * (1 - plateau) + 14 * plateau;
    /* the shore: cliffs at Blockshire and the rocky north-west, sand in the bays */
    const cliffy = Math.max(near(x, z, 220, 860, 260), near(x, z, 60, 330, 160));
    const cl = c < 10 ? -1 + (h + 1) * Math.pow(c / 10, 0.35) : h, be = Math.min(h, 0.35 + c * 0.04 + Math.max(0, c - 40) * 4);   /* a beach only near the water */
    h = be + (cl - be) * cliffy;
    /* the river, and its fall at the Trollberg */
    for (const [R, w0, w1] of [[RIVER, 5, 10], [ARM, 5, 6]]) {
      const [d, t] = segDist(x, z, R), w = w0 + (w1 - w0) * t;
      if (d < w + 14) { const k = smooth((d - w) / 14); h = h * k + -2.4 * (1 - k); }
    }
    return h;
  }
  function weights(x, z, h) {
    const wx = x + 120 * fbm(x * 0.003 + 3, z * 0.003), wz = z + 120 * fbm(z * 0.003, x * 0.003 + 7);
    const w = { valley: near(wx, wz, 470, 240, 200), troll: near(wx, wz, 815, 120, 260) * smooth((h - 15) / 30),
                fey: near(wx, wz, 935, 470, 230), ruins: near(wx, wz, 1320, 520, 200), cemetery: near(wx, wz, 1040, 800, 170),
                swamp: near(wx, wz, 1390, 850, 270), mountain: smooth((h - 70) / 40) };
    let rest = 1; for (const k in w) rest -= w[k]; w.green = Math.max(0.05, rest);
    return w;
  }
  const best = w => { let b = 'green', v = 0; for (const k in w) if (w[k] > v) { v = w[k]; b = k; } return b; };

  /* --- paint -------------------------------------------------------------------------------------------- */
  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const C = { deep: hex('#173f6e'), shallow: hex('#42b8bb'), sand: hex('#e2cf98'), rock: hex('#87827a'), snow: hex('#f1f3f6'),
              green: [hex('#86b95a'), hex('#4f7c36')], valley: [hex('#a2c862'), hex('#6f9a40')], troll: [hex('#a49058'), hex('#7a6a44')],
              fey: [hex('#5aa88a'), hex('#2f6f5a')], ruins: [hex('#9a967e'), hex('#706c5c')], cemetery: [hex('#7c876c'), hex('#5a6452')],
              swamp: [hex('#727c44'), hex('#4f5832')], mountain: [hex('#8f8a80'), hex('#6e6a64')] };
  const Hg = new Float32Array(W * H);
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) Hg[py * W + px] = height(ex0 + px * sx, ez0 + py * sz);
  const img = cx.createImageData(W, H), d = img.data, L = [-0.55, 0.62, -0.55], ln = Math.hypot(...L);
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const x = ex0 + px * sx, z = ez0 + py * sz, i = py * W + px, h = Hg[i];
    let col;
    const bw = h > -0.35 ? weights(x, z, h) : null, pool = bw && bw.swamp > 0.55 && h < 0.3;
    if (h < -0.35 || pool) {
      const k = Math.min(1, (-0.35 - h) / 7);
      col = pool ? hex('#3f5e4a') : mix(C.shallow, C.deep, Math.pow(Math.max(0, k), 0.7));
      if (!pool && -0.35 - h < 0.5) col = mix(col, [245, 250, 245], (0.5 - (-0.35 - h)) * 1.1);
      col = mix(col, [255, 255, 255], Math.max(0, noise(x * 0.5, z * 1.7) - 0.86) * 1.4);
    } else {
      const hx = Hg[i + (px < W - 1 ? 1 : 0)] - Hg[i - (px > 0 ? 1 : 0)], hz = Hg[i + (py < H - 1 ? W : 0)] - Hg[i - (py > 0 ? W : 0)];
      const nx = -hx / (2 * sx) * 2.2, nz = -hz / (2 * sz) * 2.2, nl = Math.hypot(nx, 1, nz), slope = Math.hypot(hx / (2 * sx), hz / (2 * sz));   /* relief drawn a little steeper than it is */
      const sh = 0.58 + 0.7 * ((nx * L[0] + L[1] + nz * L[2]) / (nl * ln)), t = Math.min(1, Math.max(0, (h - 2) / 40));
      col = [0, 0, 0]; let tw = 0;
      for (const b in bw) { const c2 = mix(C[b][0], C[b][1], t); col = [col[0] + c2[0] * bw[b], col[1] + c2[1] * bw[b], col[2] + c2[2] * bw[b]]; tw += bw[b]; }
      col = col.map(v => v / tw);
      if (h < 0.9 && coast(x, z) < 50 && bw.swamp < 0.5) col = mix(col, C.sand, Math.min(1, (0.9 - h) * 2));
      if (slope > 0.75) col = mix(col, C.rock, Math.min(1, (slope - 0.75) * 1.5));
      const hs = h + 18 * fbm(x * 0.02, z * 0.02) - slope * 25;   /* snow lies on the gentler tops, ragged at its edge */
      if (hs > 145) col = mix(col, C.snow, Math.min(1, (hs - 145) / 15));
      col = col.map(v => v * sh + noise(x * 0.6, z * 0.6) * 4);
    }
    const j = i * 4; d[j] = col[0]; d[j + 1] = col[1]; d[j + 2] = col[2]; d[j + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  const hAt = (x, z) => { const px = Math.round((x - ex0) / sx), py = Math.round((z - ez0) / sz); return px < 0 || py < 0 || px >= W || py >= H ? -9 : Hg[py * W + px]; };

  /* --- roads --------------------------------------------------------------------------------------------- */
  function road(pts, w, col) {
    cx.lineCap = cx.lineJoin = 'round';
    cx.strokeStyle = '#7a5a34'; cx.lineWidth = S(w) + 3; cx.beginPath(); pts.forEach((p, i) => { const [a, b] = P(p[0], p[1]); i ? cx.lineTo(a, b) : cx.moveTo(a, b); }); cx.stroke();
    cx.strokeStyle = col || '#dcb878'; cx.lineWidth = Math.max(1.5, S(w)); cx.stroke();
  }
  for (const b of BRANCHES) road(b.pts, b.w);
  road(ROUTE, 6, '#e8c47e');
  for (const [ix, iy, rot] of [[502, 526, 0.9], [612, 205, 0.2], [400, 803, 0.0]]) {   /* bridges */
    const [a, b] = PI(ix, iy); cx.save(); cx.translate(a, b); cx.rotate(rot); cx.fillStyle = '#6a4626'; cx.fillRect(-13, -5, 26, 10); cx.fillStyle = '#c9a274'; cx.fillRect(-12, -3.4, 24, 6.8); cx.restore();
  }

  /* --- trees --------------------------------------------------------------------------------------------- */
  const rnd = (() => { let a = 777; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const CLEAR = [[300, 790, 40], [400, 560, 26], [590, 425, 30], [470, 250, 22], [815, 75, 35], [1220, 205, 150], [1320, 520, 120], [1060, 780, 70], [1350, 800, 40], [680, 765, 95], [930, 478, 22]];
  const onRoad = (x, z) => [{ pts: ROUTE, w: 6 }, ...BRANCHES].some(r => segDist(x, z, r.pts)[0] < r.w + 5);
  const trees = [];
  for (let n = 0; n < 60000; n++) {
    const x = ex0 + rnd() * (ex1 - ex0), z = ez0 + rnd() * (ez1 - ez0), h = hAt(x, z);
    if (h < 0.8 || h > 150) continue;
    const w = weights(x, z, h), b = best(w);
    /* woods only where there are woods: the Greenwood round Blockshire and Saltwind, the Unicorn Forest; elsewhere open
       country with groves */
    const gw = near(x, z, 250, 720, 230);
    let dens = { green: 0.1 + 0.75 * gw, valley: 0.08, troll: 0.22, fey: 0.95, ruins: 0.08, cemetery: 0.22, swamp: 0.4, mountain: 0.1 }[b];
    const grove = smooth(0.2 + 1.6 * fbm(x * 0.006 + 11, z * 0.006 + 5));
    dens = b === 'fey' || gw > 0.4 ? dens * smooth(0.55 + 1.3 * fbm(x * 0.004 + 11, z * 0.004 + 5)) : dens * (0.3 + 2.2 * grove);
    if (h > 70) dens *= Math.max(0, 1 - (h - 70) / 25);   /* the tree line */
    if (rnd() > dens) continue;
    if (CLEAR.some(c => { const [a, bb] = I(c[0], c[1]); return Math.hypot(x - a, z - bb) < c[2] * K; }) || onRoad(x, z)) continue;
    const bay = coast(x, z) < 60 && z < I(0, 690)[1] && z > I(0, 440)[1] && x < I(440, 0)[0];
    trees.push([x, z, 0.8 + rnd() * 0.6, bay ? 'palm' : b === 'fey' ? 'fey' : b === 'swamp' ? 'swamp' : b === 'cemetery' ? 'dead' : h > 40 || rnd() < 0.5 ? 'pine' : 'oak']);
  }
  trees.sort((a, b) => a[1] - b[1]);
  const TC = { pine: ['#2b5430', '#43733c'], oak: ['#3d6b2a', '#5d8d36'], fey: ['#1f5a4c', '#57c2a4'], swamp: ['#46552a', '#66773a'], dead: ['#4a463a', '#6a6656'] };
  for (const [x, z, s, kind] of trees) {
    const [px, py] = P(x, z), r = S(3.6 * s) + 1.5;
    if (kind === 'palm') { cx.strokeStyle = '#2f5a24'; cx.lineWidth = 1.3; for (let i = 0; i < 6; i++) { const a = i * 1.05 + x; cx.beginPath(); cx.moveTo(px, py); cx.lineTo(px + Math.cos(a) * r * 1.6, py + Math.sin(a) * r * 1.6); cx.stroke(); } continue; }
    const [c0, c1] = TC[kind];
    cx.fillStyle = 'rgba(15,25,8,.33)'; cx.beginPath(); cx.ellipse(px + r * 0.5, py + r * 0.45, r, r * 0.8, 0, 0, 7); cx.fill();
    cx.fillStyle = c0; cx.beginPath(); cx.arc(px, py, r, 0, 7); cx.fill();
    cx.fillStyle = c1; cx.beginPath(); cx.arc(px - r * 0.3, py - r * 0.3, r * 0.5, 0, 7); cx.fill();
    if (kind === 'fey' && rnd() < 0.08) { cx.fillStyle = 'rgba(160,240,255,.8)'; cx.beginPath(); cx.arc(px + rnd() * 6 - 3, py + rnd() * 6 - 3, 1.3, 0, 7); cx.fill(); }
  }

  /* --- places ---------------------------------------------------------------------------------------------- */
  function house(x, z, w, dd, rot, roof) {
    const [px, py] = P(x, z), a = S(w) + 2, b = S(dd) + 2;
    cx.save(); cx.translate(px, py); cx.rotate(rot || 0);
    cx.fillStyle = 'rgba(0,0,0,.35)'; cx.fillRect(-a / 2 + 1.5, -b / 2 + 1.5, a, b);
    cx.fillStyle = roof || '#9a5a30'; cx.fillRect(-a / 2, -b / 2, a, b); cx.fillStyle = 'rgba(255,255,255,.18)'; cx.fillRect(-a / 2, -b / 2, a, b / 2);
    cx.strokeStyle = 'rgba(40,20,10,.8)'; cx.lineWidth = 0.8; cx.strokeRect(-a / 2, -b / 2, a, b); cx.restore();
  }
  function village(ix, iy, n, r, roof, seed) {
    let s = seed; const rr = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; const [x, z] = I(ix, iy);
    for (let i = 0; i < n; i++) { const a = rr() * 6.28, q = r * K * Math.sqrt(rr()); house(x + Math.cos(a) * q, z + Math.sin(a) * q, 7 + rr() * 5, 5 + rr() * 4, rr() * 3, roof); }
  }
  function walls(pts, col, tower) {
    const Q = pts.map(p => PI(p[0], p[1]));
    cx.strokeStyle = col; cx.lineWidth = 6; cx.lineJoin = 'round'; cx.beginPath(); Q.forEach(([a, b], i) => i ? cx.lineTo(a, b) : cx.moveTo(a, b)); cx.closePath(); cx.stroke();
    for (const [a, b] of Q) { cx.fillStyle = col; cx.beginPath(); cx.arc(a, b, 7, 0, 7); cx.fill(); cx.fillStyle = tower; cx.beginPath(); cx.arc(a, b, 3.5, 0, 7); cx.fill(); }
  }
  function ship(ix, iy, len, rot, sails) {
    const [px, py] = PI(ix, iy), L = S(len) + 8, B = L * 0.27;
    cx.save(); cx.translate(px, py); cx.rotate(rot);
    cx.fillStyle = '#5a3820'; cx.beginPath(); cx.moveTo(0, -L / 2); cx.quadraticCurveTo(B / 2, -L / 4, B / 2, L / 2); cx.lineTo(-B / 2, L / 2); cx.quadraticCurveTo(-B / 2, -L / 4, 0, -L / 2); cx.fill();
    cx.fillStyle = sails; cx.fillRect(-B * 0.8, -L * 0.15, B * 1.6, 3); cx.fillRect(-B * 0.7, L * 0.12, B * 1.4, 3); cx.restore();
  }
  function label(text, ix, iy, size, o) {
    o = o || {}; const [px, py] = PI(ix, iy);
    cx.font = (o.italic ? 'italic ' : '') + 'bold ' + size + 'px "DejaVu Serif", Georgia, serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.lineWidth = Math.max(3, size / 4.5); cx.strokeStyle = o.halo || 'rgba(255,248,230,.9)'; cx.strokeText(text, px, py + (o.dy || 0));
    cx.fillStyle = o.color || '#3a2610'; cx.fillText(text, px, py + (o.dy || 0));
  }
  function door(ix, iy, name, sub) {
    const [px, py] = PI(ix, iy);
    cx.fillStyle = '#1a1210'; cx.strokeStyle = '#e8c060'; cx.lineWidth = 2;
    cx.beginPath(); cx.moveTo(px - 8, py + 7); cx.lineTo(px - 8, py - 2); cx.arc(px, py - 2, 8, Math.PI, 0); cx.lineTo(px + 8, py + 7); cx.closePath(); cx.fill(); cx.stroke();
    label(name, ix, iy, 13, { dy: 19, color: '#4a1a10', italic: true }); if (sub) label(sub, ix, iy, 11, { dy: 34, color: '#7a1a10', italic: true });
  }
  function banner(n, title, sub, ix, iy) {
    const [px, py] = PI(ix, iy); cx.font = 'bold 20px "DejaVu Serif"'; const w = Math.max(cx.measureText(title).width, 130) + 46;
    cx.fillStyle = 'rgba(236,222,188,.95)'; cx.strokeStyle = '#5a3a16'; cx.lineWidth = 2;
    cx.beginPath(); cx.roundRect(px - w / 2, py - 23, w, 48, 4); cx.fill(); cx.stroke();
    cx.fillStyle = '#2a1a08'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(title, px + (n ? 10 : 0), py - 8);
    cx.font = 'italic 13px "DejaVu Serif"'; cx.fillText(sub, px + (n ? 10 : 0), py + 12);
    if (n) { cx.fillStyle = '#8a2a14'; cx.beginPath(); cx.arc(px - w / 2 + 16, py, 11, 0, 7); cx.fill(); cx.fillStyle = '#fff2d8'; cx.font = 'bold 13px "DejaVu Sans"'; cx.fillText(String(n), px - w / 2 + 16, py + 0.5); }
  }

  /* Blockshire on its cliff, a lighthouse below */
  { const [a, b] = P(-20, -20), [c, e] = P(20, 20); cx.strokeStyle = '#5a3a1a'; cx.lineWidth = 2; cx.strokeRect(a, b, c - a, e - b); }
  village(300, 790, 6, 7, '#a0602e', 3);
  { const [a, b] = PI(255, 885); cx.fillStyle = '#efe7d6'; cx.beginPath(); cx.arc(a, b, 5, 0, 7); cx.fill(); cx.fillStyle = '#e04020'; cx.beginPath(); cx.arc(a, b, 2.5, 0, 7); cx.fill(); }
  /* Saltwind on the bay, its dock, the Pirate Ship; Mermaid Cove's rock */
  village(400, 560, 7, 14, '#a0602e', 7);
  { const [a, b] = PI(392, 575), [c, e] = PI(340, 600); cx.strokeStyle = '#c9a274'; cx.lineWidth = 4; cx.beginPath(); cx.moveTo(a, b); cx.lineTo(c, e); cx.stroke(); }
  ship(330, 610, 30, 1.9, '#1a1a1a'); ship(85, 545, 24, 2.6, '#6a6052');
  for (const [ix, iy, r] of [[265, 575, 14], [285, 590, 9], [250, 598, 8], [275, 560, 6]]) { const [a, b] = PI(ix, iy); cx.fillStyle = '#7d776c'; cx.beginPath(); cx.arc(a, b, S(r * K), 0, 7); cx.fill(); cx.fillStyle = '#a49e92'; cx.beginPath(); cx.arc(a - 2, b - 2, S(r * K) * 0.5, 0, 7); cx.fill(); }
  /* the Goblin Village on its island in the river */
  village(590, 425, 12, 26, '#6a7a3a', 13);
  /* the centaurs' stone circle in the Valley */
  for (let i = 0; i < 10; i++) { const a = i * 0.628, [px, py] = P(I(470, 250)[0] + Math.cos(a) * 30, I(470, 250)[1] + Math.sin(a) * 30); cx.fillStyle = '#9a968c'; cx.fillRect(px - 2.5, py - 2.5, 5, 5); }
  /* the trolls' huts on the Trollberg's slopes, the hoard on its summit */
  for (const [ix, iy] of [[740, 250], [770, 205], [890, 150], [920, 230], [700, 160], [860, 255]]) { const [x, z] = I(ix, iy); house(x, z, 12, 9, ix * 0.1, '#6a5a3a'); }
  { const [a, b] = PI(815, 75); cx.fillStyle = '#d8b040'; cx.beginPath(); cx.arc(a, b, 9, 0, 7); cx.fill(); cx.strokeStyle = '#5a3a10'; cx.lineWidth = 2; cx.stroke(); cx.fillStyle = '#5a3a10'; cx.font = 'bold 12px "DejaVu Sans"'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText('◆', a, b); }
  /* the Minotaur Fortress: big, walls and towers round a keep, horns over the gate */
  walls([[1075, 115], [1360, 105], [1395, 250], [1330, 330], [1110, 320], [1060, 230]], '#3a3438', '#7a2a1a');
  walls([[1170, 165], [1290, 160], [1300, 250], [1180, 255]], '#2e282c', '#9a3a1a');
  { const [x, z] = I(1235, 205); house(x, z, 90, 70, 0, '#2a2226'); house(x, z, 40, 40, 0, '#5a1a1a'); }
  for (let i = 0; i < 18; i++) { const [x, z] = I(1100 + (i % 6) * 45, 140 + Math.floor(i / 6) * 60); if (Math.hypot(x - I(1235, 205)[0], z - I(1235, 205)[1]) > 140) house(x, z, 20, 16, 0, '#3a3236'); }
  /* the Ruins: broken walls on their plateau, the harpies' tower */
  { let s = 5; const rr = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    for (let i = 0; i < 60; i++) { const [x, z] = I(1180 + rr() * 300, 420 + rr() * 220); const [px, py] = P(x, z); cx.save(); cx.translate(px, py); cx.rotate(rr() * 3); cx.fillStyle = '#8a8478'; cx.fillRect(-S(14), -2.5, S(28), 5); cx.restore(); } }
  { const [a, b] = PI(1210, 455); cx.fillStyle = '#5e584e'; cx.beginPath(); cx.arc(a, b, 10, 0, 7); cx.fill(); cx.fillStyle = '#8a8478'; cx.beginPath(); cx.arc(a - 2, b - 2, 5, 0, 7); cx.fill(); }
  /* the Naga's stilt village and walkways in the Swamp */
  village(1350, 800, 12, 30, '#5a5030', 23);
  cx.strokeStyle = '#8a6a40'; cx.lineWidth = 2; for (const [a1, b1, a2, b2] of [[1290, 800, 1410, 800], [1350, 760, 1350, 860], [1300, 840, 1400, 870]]) { const [p1, q1] = PI(a1, b1), [p2, q2] = PI(a2, b2); cx.beginPath(); cx.moveTo(p1, q1); cx.lineTo(p2, q2); cx.stroke(); }
  /* the Old Cemetery: rows of graves, the mausoleum */
  for (let i = 0; i < 120; i++) { const [px, py] = PI(990 + (i % 15) * 8, 790 + Math.floor(i / 15) * 9); cx.fillStyle = '#c8c4b8'; cx.fillRect(px - 1.5, py - 2.5, 3, 5); }
  { const [x, z] = I(1060, 760); house(x, z, 34, 26, 0, '#6a6a72'); house(x, z, 14, 14, 0, '#8a8a94'); }
  /* Genesis: an empty building ground with stakes, one road from Blockshire */
  { const [a, b] = PI(680, 765), r = S(110 * K); cx.setLineDash([6, 5]); cx.strokeStyle = 'rgba(90,60,20,.9)'; cx.lineWidth = 2.5; cx.beginPath(); cx.arc(a, b, r, 0, 7); cx.stroke(); cx.setLineDash([]);
    for (let i = 0; i < 16; i++) { const t = i / 16 * 6.283; cx.fillStyle = '#6a4626'; cx.fillRect(a + Math.cos(t) * r - 2, b + Math.sin(t) * r - 2, 4, 4); } }

  /* dungeons (each zone's third part); the Mausoleum's is the last, with the rift to the underworld */
  door(330, 625, 'Piratenschiff'); door(205, 760, 'Räuberhöhle'); door(640, 470, 'Goblin-Stollen'); door(415, 205, 'Hügelgrab');
  door(870, 115, 'Trollhöhle'); door(1235, 340, 'Labyrinth'); door(985, 520, 'Wurzelhöhle'); door(1210, 470, 'Harpyienturm');
  door(1430, 880, 'Versunkener Tempel'); door(1060, 735, 'Mausoleum', '↓ Unterwelt-Riss · Endboss');

  /* names, as on the draft */
  label('Westmeer', 70, 600, 26, { italic: true, color: '#1d3a60' }); label('Südmeer', 640, 990, 26, { italic: true, color: '#1d3a60' });
  label('Greenwood', 205, 715, 20, { italic: true }); label('Saltwind', 440, 590, 15); label('Trollhort', 815, 52, 14, { color: '#5a3a10' });
  label('Spieler bauen die Stadt später selbst', 680, 770, 13, { italic: true, color: '#5a3a10' });
  banner(1, 'Blockshire', 'auf der Klippe', 300, 845);
  banner(2, 'Beach', 'Mermaid Cove', 255, 485);
  banner(0, 'River', 'Goblin Village', 590, 368);
  banner(3, 'Valley', 'Centauren Grove', 478, 190);
  banner(4, 'Highland', 'Troll Clifftop', 815, 182);
  banner(5, 'Forest', 'Unicorn Glade', 1005, 410);
  banner(6, 'Mountains', 'Minotauren Fortress', 1345, 60);
  banner(7, 'Ruins', 'Harpy Nest', 1335, 455);
  banner(8, 'Swamp', 'Naga Tribe', 1340, 730);
  banner(9, 'Old Cemetery', 'Mausoleum', 1030, 690);
  banner(0, 'Genesis', 'Bauplatz der Spieler', 680, 700);

  /* frame */
  const vg = cx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.72);
  vg.addColorStop(0, 'rgba(120,90,40,0)'); vg.addColorStop(1, 'rgba(70,48,18,.5)'); cx.fillStyle = vg; cx.fillRect(0, 0, W, H);
  cx.strokeStyle = '#3a2610'; cx.lineWidth = 12; cx.strokeRect(6, 6, W - 12, H - 12); cx.strokeStyle = '#c9a04a'; cx.lineWidth = 2; cx.strokeRect(16, 16, W - 32, H - 32);
  cx.fillStyle = 'rgba(250,240,215,.94)'; cx.strokeStyle = '#6a4a20'; cx.lineWidth = 2; cx.beginPath(); cx.roundRect(30, 28, 560, 84, 8); cx.fill(); cx.stroke();
  cx.fillStyle = '#3a2610'; cx.textAlign = 'left'; cx.textBaseline = 'top'; cx.font = 'bold 32px "DejaVu Serif"'; cx.fillText('LiteWorldsQuest', 48, 38);
  cx.font = 'italic 15px "DejaVu Serif"'; cx.fillText('die ganze Welt nach deinem Entwurf — ohne Bewohner', 50, 82);
  const ox = 110, oy = H - 140;
  cx.save(); cx.translate(ox, oy); for (let i = 0; i < 8; i++) { cx.rotate(Math.PI / 4); cx.fillStyle = i % 2 ? '#c9a04a' : '#3a2610'; cx.beginPath(); cx.moveTo(0, -(i % 2 ? 36 : 58)); cx.lineTo(8, 0); cx.lineTo(-8, 0); cx.fill(); } cx.restore();
  cx.fillStyle = '#fff8e6'; cx.beginPath(); cx.arc(ox, oy, 9, 0, 7); cx.fill();
  cx.font = 'bold 19px "DejaVu Serif"'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillStyle = '#3a2610'; cx.strokeStyle = 'rgba(255,248,230,.9)'; cx.lineWidth = 4;
  for (const [t, a, b] of [['N', 0, -74], ['S', 0, 74], ['W', -74, 0], ['O', 74, 0]]) { cx.strokeText(t, ox + a, oy + b); cx.fillText(t, ox + a, oy + b); }
  const len = S(500), bx = W - len - 130, by = H - 52;
  cx.fillStyle = 'rgba(250,240,215,.92)'; cx.fillRect(bx - 12, by - 26, len + 92, 44);
  cx.fillStyle = '#3a2610'; cx.fillRect(bx, by, len, 7); cx.fillStyle = '#fff8e6'; cx.fillRect(bx + len / 2, by + 1, len / 2 - 1, 5);
  cx.font = '14px "DejaVu Sans"'; cx.textAlign = 'left'; cx.fillStyle = '#3a2610'; cx.fillText('500 m', bx + len + 8, by + 4); cx.fillText('0', bx - 3, by - 12);
  cx.fillStyle = 'rgba(250,240,215,.92)'; cx.fillRect(250, H - 78, 760, 50);
  cx.fillStyle = '#3a2610'; cx.font = '14px "DejaVu Sans"'; cx.fillText('helle Straße mit Nummern = der Weg in Spielreihenfolge (1 → 9, Ende am Friedhof)', 262, H - 60);
  cx.fillText('Bogentor = Dungeon · ◆ = Trollhort · gestrichelt = Bauplatz Genesis', 262, H - 40);
  window.DONE = true;
})();
