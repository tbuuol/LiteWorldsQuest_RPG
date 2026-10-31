/* LiteWorldsQuest terrain: the whole world's ground (tbuuol 2026-10-29, design/map-world-v2.png), the same function
   the map is painted with (design/mapgen/world2.js), so the map and the game can never disagree.
     const T = terrain.create({pads, decks})
     T.height(x, z)    the ground, and a ship's decks where they are (what creatures stand on)
     T.floor(x, z)     the ground alone, exact (what the ground mesh is made of, at its 2 m grid's points)
     T.ground(x, z)    the ground as the mesh draws it, between those points too (what is walked on and stood on)
     T.walk(x, z)      the ground and the bridges
     T.weights(x,z,h)  how much of each kind of land is here: {green, valley, troll, fey, ruins, cemetery, swamp, mountain}
     T.road(x, z)      0..1, how much of a road is here
     T.trees(x0, z0, x1, z1)   the trees of a rectangle, the same for everybody: [[x, z, scale, kind], ...]
     T.EXT             [x0, z0, x1, z1], the world's rectangle;  T.SEA the sea's level;  T.I(ix, iy) the draft's pixel -> metres
   Metres, x east, z south (north is -z), Blockshire's middle at (0, 0). The draft's pixels are 2 m each.
   pads: [{at: [x, z], r, y}] flat ground for a settlement (its things stand on y);  decks: [{rect, y, aft, quarter}];
   walls: [{pts}] a city wall's ring (no trees on its line). */
(function (G) {
  'use strict';
  const K = 2, I = (ix, iy) => [(ix - 300) * K, (iy - 790) * K];
  const SEA = -0.35;
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
  const px = list => list.map(p => I(p[0], p[1]));

  /* the coast, traced off the draft */
  const LAND = px([[0, 0], [1536, 0], [1536, 1024], [905, 1024], [890, 975], [860, 940], [780, 905], [700, 885], [610, 895], [520, 875],
    [450, 885], [400, 870], [330, 905], [250, 895], [140, 905], [70, 870], [45, 800], [75, 720], [150, 695], [260, 685], [360, 665],
    [415, 615], [410, 545], [350, 490], [260, 462], [185, 448], [140, 400], [85, 345], [40, 300], [0, 280]]);
  /* the one river, and its second arm round the Goblin Village (an island: only the bridge goes there) */
  const RIVER = px([[615, 0], [596, 80], [598, 160], [648, 245], [688, 318], [645, 372], [552, 382], [468, 418], [452, 478], [502, 526],
                    [600, 548], [700, 572], [782, 632], [848, 690], [888, 778], [880, 880], [872, 960]]);
  const ARM = px([[645, 372], [690, 405], [702, 450], [680, 505], [640, 540], [600, 548]]);
  const WATERS = [[RIVER, 5, 10], [ARM, 5, 6]];   /* [line, half width at its start, at its end] */
  /* the road from Blockshire to the beach keeps well inland (tbuuol 2026-10-31: it ran through the sea) and comes to
     Saltwind from the land side */
  const ROUTE = px([[300, 790], [332, 738], [380, 700], [428, 668], [458, 628], [452, 590], [432, 562], [436, 528], [422, 505], [392, 462], [362, 420], [345, 370], [395, 300], [470, 255],
                    [560, 225], [612, 205], [680, 225], [745, 280], [790, 330], [850, 395], [930, 470], [1010, 430], [1080, 360], [1150, 300], [1210, 270]]);
  const ROADS = [{ pts: ROUTE, w: 6 }].concat([
    [[930, 470], [1060, 500], [1180, 520], [1290, 540]], [[1290, 540], [1320, 620], [1340, 700], [1350, 790]],
    [[1350, 790], [1260, 800], [1170, 790], [1080, 780]], [[745, 280], [790, 230], [760, 175], [800, 135], [780, 100], [815, 75]],
    [[458, 628], [478, 570], [502, 526], [560, 470], [590, 425]], [[300, 790], [400, 800], [520, 790], [640, 775], [680, 765]],
    [[392, 462], [350, 474], [310, 470], [282, 464]]   /* down to the Pirate Ship's dock (2026-10-31) */
  ].map((p, i) => ({ pts: px(p), w: [5, 4, 4, 3, 3, 5, 3][i] })));
  const EXT = [...I(0, 0), ...I(1536, 1024)];

  function create(opts) {
    opts = opts || {};
    const pads = opts.pads || [], decks = opts.decks || [], walls = (opts.walls || []).map(w => w.pts.concat([w.pts[0]]));
    function coast(x, z) {   /* signed metres to the shore: + on land */
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
    function floor(x, z) {
      const c = coast(x, z);
      let h;
      if (c < 0) h = -0.5 - 9 * Math.min(1, -c / 70);
      else {
        h = 8 + 4 * Math.sin(x * 0.005 + 1) * Math.cos(z * 0.006) + 3 * fbm(x * 0.03, z * 0.03);
        const v = near(x, z, 470, 240, 170); h = h * (1 - v) + (4 + 1.5 * fbm(x * 0.02, z * 0.02)) * v;   /* the Valley */
        h += 135 * Math.pow(near(x, z, 815, 75, 300), 1.5) * (0.85 + 0.25 * ridged(x * 0.012, z * 0.012));   /* the Trollberg */
        const [mcx, mcz] = I(1250, 150), mwx = x + 160 * fbm(x * 0.003, z * 0.003), mwz = z + 160 * fbm(z * 0.003 + 4, x * 0.003);
        const mt = smooth(1.35 - Math.hypot((mwx - mcx) / 1.3, mwz - mcz) / (330 * K));                      /* the Mountains */
        h += mt * (70 + 190 * Math.pow(ridged(x * 0.008 + 5, z * 0.008) / 1.9, 1.8));
        const fort = near(x, z, 1225, 215, 105); h = h * (1 - fort) + (95 + 4 * fbm(x * 0.05, z * 0.05)) * fort;   /* the fortress' shelf */
        h += Math.pow(smooth((I(0, 70)[1] + 90 * fbm(x * 0.004, 3) - z) / 160), 1.4) * (40 + 90 * Math.pow(ridged(x * 0.009, z * 0.01) / 1.9, 1.5)) * (1 - near(x, z, 600, 20, 70));
        const [rx, rz] = I(1320, 520), rp = smooth((1 - Math.hypot((x - rx) / 1.2, z - rz) / (175 * K) + 0.2 * fbm(x * 0.006, z * 0.006)) * 6);
        h += 32 * rp + 6 * rp * fbm(x * 0.05, z * 0.05);                                                       /* the Ruins */
        h += 7 * near(x, z, 1040, 790, 150);                                                                   /* the Cemetery */
        const sw = near(x, z, 1390, 850, 260); h = h * (1 - sw) + (0.15 + 0.7 * fbm(x * 0.03, z * 0.03)) * sw;  /* the Swamp */
        const gen = near(x, z, 680, 765, 130); h = h * (1 - gen) + 6 * gen;                                     /* Genesis' ground */
        const cliffy = Math.max(near(x, z, 220, 860, 260), near(x, z, 60, 330, 160));
        const cl = c < 10 ? -1 + (h + 1) * Math.pow(c / 10, 0.35) : h, be = Math.min(h, 0.35 + c * 0.04 + Math.max(0, c - 40) * 4);
        h = be + (cl - be) * cliffy;
      }
      /* the settlements' flat ground (Blockshire on its cliff, Saltwind by the water): a pad, faded out over its rim */
      for (const p of pads) {
        if (p.landOnly && c < 0) continue;   /* Saltwind's ground stops at the water */
        const d = Math.hypot(x - p.at[0], z - p.at[1]), k = 1 - smooth((d - p.r) / (p.rim || 30));
        if (k > 0) h = h * (1 - k) + p.y * k;
      }
      /* the river and its arm: a deep bed, a steep bank of 3 m to a strip just above the water, then the land (the
         first world's 14 m of gentle bank let you walk down into the water and climb out again and again). Each cuts
         the land as it was, and the lowest cut wins: the arm's bank used to fill the river back up where the two
         meet, two dams across it (tbuuol 2026-10-31: "Stellen an denen der Fluss unterbrochen ist") */
      let cut = null;
      for (const [R, w0, w1] of WATERS) {
        const [d, t] = segDist(x, z, R), w = w0 + (w1 - w0) * t;
        if (d >= w + 18) continue;
        const edge = 0.15;
        let k;
        if (d < w) k = -2.6;
        else if (d < w + 3) k = -2.6 + (edge + 2.6) * smooth((d - w) / 3);
        else k = edge + (Math.max(h, edge) - edge) * smooth((d - w - 3) / 15);
        cut = cut == null ? k : Math.min(cut, k);
      }
      if (cut != null) h = cut;
      return h;
    }
    /* THE GROUND AS IT IS DRAWN (tbuuol 2026-10-31: "map und Collider sollten 1:1 gleich sein"): the land's mesh is
       floor() on a 2 m grid, two triangles a square (three.js' PlaneGeometry: the diagonal from the square's south-west
       corner to its north-east one), so walking reads the very same triangles. floor() between the grid's points was
       up to 8 m off the mesh on a cliff: steps nobody could see. */
    const GRID = 2, nodes = new Map();
    function node(ix, iz) {
      const k = ix * 65536 + iz; let h = nodes.get(k);
      if (h === undefined) { if (nodes.size > 250000) nodes.clear(); h = floor(ix * GRID, iz * GRID); nodes.set(k, h); }
      return h;
    }
    function ground(x, z) {
      const ix = Math.floor(x / GRID), iz = Math.floor(z / GRID), u = x / GRID - ix, v = z / GRID - iz;
      if (u + v <= 1) { const a = node(ix, iz); return a + (node(ix + 1, iz) - a) * u + (node(ix, iz + 1) - a) * v; }
      const c = node(ix + 1, iz + 1); return c + (node(ix, iz + 1) - c) * (1 - u) + (node(ix + 1, iz) - c) * (1 - v);
    }
    /* metres from the river's or the arm's water (- in it): the far land paints the river from it */
    function river(x, z) {
      let best = 1e9;
      for (const [R, w0, w1] of WATERS) { const [d, t] = segDist(x, z, R); best = Math.min(best, d - (w0 + (w1 - w0) * t)); }
      return best;
    }
    /* BRIDGES: wherever a road crosses the river, a wooden deck from bank to bank (it is walked; the ground under it
       stays the river's) */
    const bridges = [];
    for (const r of ROADS) for (let i = 0; i < r.pts.length - 1; i++) for (const [R, w0, w1] of WATERS) for (let j = 0; j < R.length - 1; j++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], [cx, cz] = R[j], [dx, dz] = R[j + 1];
      const den = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx); if (Math.abs(den) < 1e-9) continue;
      const u = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / den, v = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / den;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      const mx = ax + (bx - ax) * u, mz = az + (bz - az) * u, L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
      const w = w0 + (w1 - w0) * ((j + v) / (R.length - 1));
      let half = w + 4;
      while (half < w + 30 && (floor(mx - ux * half, mz - uz * half) < 0.4 || floor(mx + ux * half, mz + uz * half) < 0.4)) half += 1;
      const A = [mx - ux * half, mz - uz * half], B = [mx + ux * half, mz + uz * half];
      if (bridges.some(o => Math.hypot((o.a[0] + o.b[0]) / 2 - mx, (o.a[1] + o.b[1]) / 2 - mz) < 15)) continue;   /* one bridge a crossing (where two bends of the river meet the road) */
      bridges.push({ a: A, b: B, ya: floor(A[0], A[1]), yb: floor(B[0], B[1]), w: Math.max(4, r.w) });
    }
    function deckAt(br, x, z) {   /* the bridge's deck here, or null: a gentle arch from bank to bank, well above the water */
      const [ax, az] = br.a, [bx, bz] = br.b, vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz;
      const t = ((x - ax) * vx + (z - az) * vz) / L2; if (t < 0 || t > 1) return null;
      if (Math.abs((x - ax) * vz - (z - az) * vx) / Math.sqrt(L2) > br.w / 2) return null;
      return Math.max(br.ya + (br.yb - br.ya) * t + 0.9 * Math.sin(Math.PI * t), SEA + 1.1 * Math.sin(Math.PI * t) + 0.2 * (1 - Math.abs(2 * t - 1)));
    }
    /* what is walked on: the ground, and the bridges over it */
    function walk(x, z) {
      const f = ground(x, z);
      for (const br of bridges) { const y = deckAt(br, x, z); if (y != null && y > f) return y; }
      return f;
    }
    function height(x, z) {   /* what creatures stand on: the ground, bridges and ships' decks */
      for (const d of decks) {
        const r = d.rect; if (x < r[0] || x > r[2] || z < r[1] || z > r[3]) continue;
        return d.aftAt != null && (d.aftSign > 0 ? (d.axis === 'z' ? z : x) >= d.aftAt : (d.axis === 'z' ? z : x) <= d.aftAt) ? d.quarter : d.y;
      }
      return walk(x, z);
    }
    function weights(x, z, h) {
      const wx = x + 120 * fbm(x * 0.003 + 3, z * 0.003), wz = z + 120 * fbm(z * 0.003, x * 0.003 + 7);
      const w = { valley: near(wx, wz, 470, 240, 200), troll: near(wx, wz, 815, 120, 260) * smooth((h - 15) / 30),
                  fey: near(wx, wz, 935, 470, 230), ruins: near(wx, wz, 1320, 520, 200), cemetery: near(wx, wz, 1040, 800, 170),
                  swamp: near(wx, wz, 1390, 850, 270), mountain: smooth((h - 70) / 40) };
      let rest = 1; for (const k in w) rest -= w[k]; w.green = Math.max(0.05, rest);
      return w;
    }
    function road(x, z) {
      let k = 0;
      for (const r of ROADS) { const d = segDist(x, z, r.pts)[0]; k = Math.max(k, 1 - smooth((d - r.w * 0.5) / 1.5)); }
      return k;
    }
    function nearRoad(x, z, m) { return ROADS.some(r => segDist(x, z, r.pts)[0] < r.w * 0.5 + m); }
    /* the trees of a rectangle: from a seed that is the rectangle's own, so every page grows the same ones */
    const KEEP_CLEAR = [[300, 790, 40], [400, 560, 32], [590, 425, 30], [470, 250, 22], [815, 75, 35], [1220, 205, 150], [1320, 520, 120],
                        [1060, 780, 70], [1350, 800, 40], [680, 765, 95], [930, 478, 22]].map(c => [...I(c[0], c[1]), c[2] * K]);
    function trees(x0, z0, x1, z1) {
      let a = (Math.round(x0) * 73856093) ^ (Math.round(z0) * 19349663);
      const rnd = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const out = [], n = Math.round((x1 - x0) * (z1 - z0) / 26);
      for (let i = 0; i < n; i++) {
        const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0), r1 = rnd(), r2 = rnd(), r3 = rnd();
        const h = floor(x, z);
        if (h < 0.8 || h > 100) continue;
        const w = weights(x, z, h); let b = 'green', v = 0; for (const k in w) if (w[k] > v) { v = w[k]; b = k; }
        const gw = near(x, z, 250, 720, 230);
        let dens = { green: 0.1 + 0.75 * gw, valley: 0.08, troll: 0.22, fey: 0.95, ruins: 0.08, cemetery: 0.22, swamp: 0.4, mountain: 0.1 }[b];
        const grove = smooth(0.2 + 1.6 * fbm(x * 0.006 + 11, z * 0.006 + 5));
        dens = b === 'fey' || gw > 0.4 ? dens * smooth(0.55 + 1.3 * fbm(x * 0.004 + 11, z * 0.004 + 5)) : dens * (0.3 + 2.2 * grove);
        if (h > 70) dens *= Math.max(0, 1 - (h - 70) / 25);
        if (r1 > dens * 0.42) continue;   /* (a tree per ~60 m² in a dense wood) */
        if (KEEP_CLEAR.some(c => Math.hypot(x - c[0], z - c[1]) < c[2]) || pads.some(p => Math.hypot(x - p.at[0], z - p.at[1]) < p.r + 6) || nearRoad(x, z, 3) || walls.some(w => segDist(x, z, w)[0] < 9)) continue;
        if (Math.abs(floor(x + 2, z) - floor(x - 2, z)) + Math.abs(floor(x, z + 2) - floor(x, z - 2)) > 3.5) continue;   /* not on a cliff */
        const bay = coast(x, z) < 60 && z > I(0, 440)[1] && z < I(0, 690)[1] && x < I(440, 0)[0];
        out.push([x, z, 0.8 + r2 * 0.6, bay ? 'palm' : b === 'fey' ? 'fey' : b === 'swamp' ? 'swamp' : b === 'cemetery' ? 'dead' : h > 40 || r3 < 0.5 ? 'pine' : 'oak']);
      }
      return out;
    }
    return { height, floor, ground, river, walk, deckAt, bridges, weights, road, nearRoad, trees, coast, EXT, SEA, I, ROADS, RIVER, ARM };
  }

  const terrain = { api: 1, create, I, EXT, SEA };
  if (G.LWQ && G.LWQ.define) G.LWQ.define('terrain', { api: 1, v: 3 }, () => terrain);
  if (typeof module !== 'undefined') module.exports = terrain;
})(typeof globalThis !== 'undefined' ? globalThis : this);
