// The ground, drawn from the baked data (content/core/world): height tiles with levels of detail, and the land kinds
// blended into seven PBR materials (content/core/assets/ground). The same heights the house walks on: height(x, z)
// splits each 2 m cell along the same diagonal as the house does (server/src/ground.rs).

import * as THREE from 'three';

const TILE = 64;                                  // metres per tile
const SKIRT = Number(new URLSearchParams(location.search).get('skirt') ?? 4);   // a tile's skirt against cracks (m)
const MATS = ['grass', 'forest', 'dirt', 'moss', 'rock', 'road', 'sand'];
// how each land kind (ground.json "kinds") is made of the materials
const MIX = {
  green: { grass: 0.75, forest: 0.25 }, valley: { forest: 0.6, grass: 0.4 }, fey: { grass: 0.55, moss: 0.45 },
  troll: { rock: 0.55, dirt: 0.45 }, ruins: { dirt: 0.5, moss: 0.5 }, cemetery: { dirt: 0.6, moss: 0.4 },
  swamp: { moss: 0.65, dirt: 0.35 }, mountain: { rock: 0.75, forest: 0.25 },
};

async function bytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

async function textureArray(base, kind, size) {
  const data = new Uint8Array(size * size * 4 * MATS.length);
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d', { willReadFrequently: true });
  for (let i = 0; i < MATS.length; i++) {
    const r = await fetch(`${base}/${MATS[i]}_${kind}.webp`);
    const bmp = await createImageBitmap(await r.blob());
    g.drawImage(bmp, 0, 0, size, size);
    data.set(g.getImageData(0, 0, size, size).data, i * size * size * 4);
  }
  const t = new THREE.DataArrayTexture(data, size, size, MATS.length);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}

export async function loadGround(contentBase, say) {
  const dir = `${contentBase}/core/world`;
  say('Loading the land…');
  const meta = await (await fetch(`${dir}/ground.json`)).json();
  const [hb, lb] = await Promise.all([bytes(`${dir}/ground.bin`), bytes(`${dir}/land.bin`)]);
  const { nx, nz, step, base } = meta, [x0, z0, x1, z1] = meta.extent;
  const H = new Float32Array(nx * nz);
  for (let i = 0; i < nx * nz; i++) H[i] = base + (hb[i * 2] | (hb[i * 2 + 1] << 8)) / 100;
  const at = (ix, iz) => H[Math.min(nz - 1, Math.max(0, iz)) * nx + Math.min(nx - 1, Math.max(0, ix))];

  function height(x, z) {
    const fx = Math.min(nx - 1, Math.max(0, (x - x0) / step)), fz = Math.min(nz - 1, Math.max(0, (z - z0) / step));
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const a = at(ix, iz), b = at(ix + 1, iz), c = at(ix, iz + 1), d = at(ix + 1, iz + 1);
    return tx >= tz ? a + (b - a) * tx + (d - b) * tz : a + (d - c) * tx + (c - a) * tz;
  }
  const inside = (x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1;

  // material weights per sample, two RGBA textures (grass forest dirt moss | rock road sand -)
  say('Painting the land…');
  const kinds = meta.kinds, W0 = new Uint8Array(nx * nz * 4), W1 = new Uint8Array(nx * nz * 4);
  const idx = Object.fromEntries(MATS.map((m, i) => [m, i]));
  const w = new Float32Array(8);
  for (let i = 0; i < nx * nz; i++) {
    w.fill(0);
    const mix = MIX[kinds[lb[i * 2]]] || MIX.green;
    for (const m in mix) w[idx[m]] += mix[m];
    const road = lb[i * 2 + 1] / 255;
    if (road > 0) { for (let k = 0; k < 7; k++) w[k] *= 1 - road; w[idx.road] += road; }
    const h = H[i], sand = Math.max(0, Math.min(1, (meta.sea + 1.6 - h) / 1.2));
    if (sand > 0) { for (let k = 0; k < 7; k++) w[k] *= 1 - sand; w[idx.sand] += sand; }
    for (let k = 0; k < 4; k++) { W0[i * 4 + k] = Math.round(w[k] * 255); W1[i * 4 + k] = Math.round(w[k + 4] * 255); }
  }
  // occlusion baked from the heights: hollows, gullies and valley floors get less sky (alpha of the second weights)
  say('Shading the hollows…');
  const blur = (src, r) => {   // separable box blur, twice (close to a gaussian)
    let a = Float32Array.from(src), b = new Float32Array(src.length);
    for (let pass = 0; pass < 2; pass++) {
      for (let z = 0; z < nz; z++) { let acc = 0; const row = z * nx;
        for (let x = -r; x <= r; x++) acc += a[row + Math.min(nx - 1, Math.max(0, x))];
        for (let x = 0; x < nx; x++) { b[row + x] = acc / (2 * r + 1);
          acc += a[row + Math.min(nx - 1, x + r + 1)] - a[row + Math.max(0, x - r)]; } }
      for (let x = 0; x < nx; x++) { let acc = 0;
        for (let z = -r; z <= r; z++) acc += b[Math.min(nz - 1, Math.max(0, z)) * nx + x];
        for (let z = 0; z < nz; z++) { a[z * nx + x] = acc / (2 * r + 1);
          acc += b[Math.min(nz - 1, z + r + 1) * nx + x] - b[Math.max(0, z - r) * nx + x]; } }
    }
    return a;
  };
  const near = blur(H, 4), wide = blur(H, 24);
  for (let i = 0; i < nx * nz; i++) {
    const cav = Math.max(0, near[i] - H[i]) * 0.35 + Math.max(0, wide[i] - H[i]) * 0.035;
    W1[i * 4 + 3] = Math.round(255 * Math.max(0.35, 1 - Math.min(1, cav) * 0.65));
  }
  const wtex = d => { const t = new THREE.DataTexture(d, nx, nz); t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t; };

  say('Loading the materials…');
  const texBase = `${contentBase}/core/assets/ground`;
  const [colors, normals] = await Promise.all([textureArray(texBase, 'color', 1024), textureArray(texBase, 'normal', 1024)]);

  const uniforms = {
    tColors: { value: colors }, tNormals: { value: normals }, tW0: { value: wtex(W0) }, tW1: { value: wtex(W1) },
    uExt: { value: new THREE.Vector4(x0, z0, x1 - x0, z1 - z0) }, uTile: { value: 1 / 4.5 },
  };
  const material = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
  material.defines = { DETAIL: 1 };
  material.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        precision highp sampler2DArray;
        uniform sampler2DArray tColors, tNormals; uniform sampler2D tW0, tW1; uniform vec4 uExt; uniform float uTile;
        varying vec3 vWP; varying vec3 vWN;
        float gW[7];
        vec3 s2l(vec3 c) { return pow(c, vec3(2.2)); }
        vec4 layer(sampler2DArray t, vec2 uv, int i) {
          vec4 a = texture(t, vec3(uv, float(i)));
        #if DETAIL > 0
          vec4 b = texture(t, vec3(uv * 0.23 + vec2(0.37, 0.71), float(i)));   // a second, larger scale breaks the tiling
          a = mix(a, b, 0.35);
        #endif
          return a;
        }`)
      .replace('#include <map_fragment>', `
        vec2 wuv = (vWP.xz - uExt.xy) / uExt.zw;
        vec4 w0 = texture(tW0, wuv), w1 = texture(tW1, wuv);
        float slope = 1.0 - clamp(normalize(vWN).y, 0.0, 1.0);
        // rock on steep ground, and more of it the higher one gets; snow above ~210 m where it can lie
        float rockSlope = clamp(smoothstep(0.17, 0.40, slope) + smoothstep(120.0, 260.0, vWP.y) * 0.55, 0.0, 1.0);
        float snow = smoothstep(195.0, 235.0, vWP.y + (w0.r - 0.5) * 20.0) * (1.0 - smoothstep(0.30, 0.55, slope));
        gW[0] = w0.r; gW[1] = w0.g; gW[2] = w0.b; gW[3] = w0.a; gW[4] = w1.r; gW[5] = w1.g; gW[6] = w1.b;
        for (int i = 0; i < 7; i++) gW[i] *= (1.0 - rockSlope);
        gW[4] += rockSlope;
        float sum = 0.0; for (int i = 0; i < 7; i++) sum += gW[i];
        vec2 tuv = vWP.xz * uTile;
        // rock is seen from the side on steep ground: projected from three directions, not stretched from above
        vec3 an = abs(normalize(vWN)); an = pow(an, vec3(4.0)); an /= (an.x + an.y + an.z);
        vec3 col = vec3(0.0);
        for (int i = 0; i < 7; i++) {
          float k = gW[i] / max(sum, 1e-3); if (k <= 0.01) continue;
          if (i == 4) col += k * (s2l(layer(tColors, vWP.zy * uTile, 4).rgb) * an.x + s2l(layer(tColors, tuv, 4).rgb) * an.y + s2l(layer(tColors, vWP.xy * uTile, 4).rgb) * an.z);
          else col += s2l(layer(tColors, tuv, i).rgb) * k;
        }
        col *= mix(vec3(1.0), vec3(0.86, 0.92, 0.78), gW[0] / max(sum, 1e-3));   // grass: muted, towards olive
        float lum = dot(col, vec3(0.3, 0.6, 0.1));
        col = mix(col, vec3(0.80, 0.84, 0.90) * (0.82 + lum * 0.6), snow);
        col *= w1.a;                                                                // hollows: less sky
        diffuseColor.rgb *= col;`)
      .replace('#include <normal_fragment_maps>', `
        {
          vec3 tn = vec3(0.0);
          for (int i = 0; i < 7; i++) { float k = gW[i] / max(sum, 1e-3); if (k > 0.01) tn += (layer(tNormals, tuv, i).xyz * 2.0 - 1.0) * k; }
          vec3 N = normalize(vWN), T = normalize(vec3(1.0, 0.0, 0.0) - N * N.x), B = cross(T, N);
          vec3 wn = normalize(T * tn.x * 1.1 - B * tn.y * 1.1 + N * max(tn.z, 0.2));
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        }`);
  };

  // one tile at a level of detail (step 2, 4, 8 or 16 m), with a skirt against cracks between levels
  function buildTile(tx, tz, lod) {
    const s = step << lod, n = TILE / s + 1, ox = x0 + tx * TILE, oz = z0 + tz * TILE;
    const pos = [], nor = [], ind = [];
    const sample = (x, z) => height(x, z);
    const normalAt = (x, z) => {
      const e = Math.max(step, s / 2);
      const nxv = sample(x - e, z) - sample(x + e, z), nzv = sample(x, z - e) - sample(x, z + e);
      const l = Math.hypot(nxv, 2 * e, nzv); return [nxv / l, 2 * e / l, nzv / l];
    };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = Math.min(x1, ox + i * s), z = Math.min(z1, oz + j * s);
      pos.push(x, sample(x, z), z); nor.push(...normalAt(x, z));
    }
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      ind.push(a, d, b, a, c, d);
    }
    // skirt: the edge's vertices again, 4 m lower, joined to the edge
    const edge = [];
    for (let i = 0; i < n; i++) edge.push(i);
    for (let j = 1; j < n; j++) edge.push(j * n + n - 1);
    for (let i = n - 2; i >= 0; i--) edge.push((n - 1) * n + i);
    for (let j = n - 2; j > 0; j--) edge.push(j * n);
    edge.push(0);
    const first = pos.length / 3;
    for (const v of edge) { pos.push(pos[v * 3], pos[v * 3 + 1] - SKIRT, pos[v * 3 + 2]); nor.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]); }
    for (let k = 0; k < edge.length - 1; k++) {
      const a = edge[k], b = edge[k + 1], c = first + k, d = first + k + 1;
      ind.push(a, b, c, b, d, c, a, c, b, b, c, d);   // both sides: a skirt is seen from wherever the crack is
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(ind);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    return m;
  }

  const group = new THREE.Group();
  const TX = Math.ceil((x1 - x0) / TILE), TZ = Math.ceil((z1 - z0) / TILE);
  const tiles = new Map();   // "tx,tz" -> {lod, mesh}
  let viewDist = 600, detail = 1, building = 0;

  // the sea and the rivers: water.js

  function lodFor(d) { return d < 260 ? 0 : d < 520 ? 1 : d < 950 ? 2 : 3; }

  // tiles near the player at the right detail, others dropped; a few new tiles per frame, so walking never stutters
  function update(px, pz, budget = 4) {
    building = 0;
    const r = Math.ceil(viewDist / TILE), ctx = Math.floor((px - x0) / TILE), ctz = Math.floor((pz - z0) / TILE);
    const want = new Map();
    for (let tz = ctz - r; tz <= ctz + r; tz++) for (let tx = ctx - r; tx <= ctx + r; tx++) {
      if (tx < 0 || tz < 0 || tx >= TX || tz >= TZ) continue;
      const cx = x0 + (tx + 0.5) * TILE, cz = z0 + (tz + 0.5) * TILE, d = Math.hypot(cx - px, cz - pz) - TILE * 0.7;
      if (d > viewDist) continue;
      want.set(`${tx},${tz}`, [tx, tz, lodFor(Math.max(0, d)), d]);
    }
    for (const [k, t] of tiles) if (!want.has(k)) { group.remove(t.mesh); t.mesh.geometry.dispose(); tiles.delete(k); }
    const todo = [...want.values()].filter(([tx, tz, lod]) => { const t = tiles.get(`${tx},${tz}`); return !t || t.lod !== lod; })
      .sort((a, b) => a[3] - b[3]);
    for (const [tx, tz, lod] of todo) {
      if (building >= budget) break;
      const k = `${tx},${tz}`, old = tiles.get(k);
      const mesh = buildTile(tx, tz, lod);
      mesh.updateMatrix();
      group.add(mesh);
      if (old) { group.remove(old.mesh); old.mesh.geometry.dispose(); }
      tiles.set(k, { lod, mesh });
      building++;
    }
    return todo.length - building;   // tiles still to build
  }

  // a place's paths and square become trodden earth (the dirt material), softly edged
  const W0tex = uniforms.tW0.value, W1tex = uniforms.tW1.value;
  function paintEarth(paths, ox = 0, oz = 0) {
    if (!paths) return;
    const shapes = [];
    for (const [cx, cz, r] of paths.circles || []) shapes.push(p => Math.hypot(p[0] - cx - ox, p[1] - cz - oz) - r);
    for (const [ax, az, bx, bz, w] of paths.strips || []) shapes.push(p => {
      const vx = bx - ax, vz = bz - az, L = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - ax - ox) * vx + (p[1] - az - oz) * vz) / L));
      return Math.hypot(p[0] - ax - ox - vx * t, p[1] - az - oz - vz * t) - w / 2;
    });
    let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
    for (const [cx, cz, r] of paths.circles || []) { minx = Math.min(minx, cx - r); maxx = Math.max(maxx, cx + r); minz = Math.min(minz, cz - r); maxz = Math.max(maxz, cz + r); }
    for (const [ax, az, bx, bz, w] of paths.strips || []) { minx = Math.min(minx, ax - w, bx - w); maxx = Math.max(maxx, ax + w, bx + w); minz = Math.min(minz, az - w, bz - w); maxz = Math.max(maxz, az + w, bz + w); }
    const i0 = Math.max(0, Math.floor((minx + ox - 3 - x0) / step)), i1 = Math.min(nx - 1, Math.ceil((maxx + ox + 3 - x0) / step));
    const j0 = Math.max(0, Math.floor((minz + oz - 3 - z0) / step)), j1 = Math.min(nz - 1, Math.ceil((maxz + oz + 3 - z0) / step));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const p = [x0 + i * step, z0 + j * step];
      let d = Infinity; for (const f of shapes) d = Math.min(d, f(p));
      const k = Math.max(0, Math.min(1, 0.5 - d / 1.6));
      if (k <= 0) continue;
      const n = j * nx + i;
      for (let c = 0; c < 4; c++) { W0[n * 4 + c] = Math.round(W0[n * 4 + c] * (1 - k)); if (c < 3) W1[n * 4 + c] = Math.round(W1[n * 4 + c] * (1 - k)); }
      W0[n * 4 + 2] = Math.min(255, W0[n * 4 + 2] + Math.round(255 * k));
    }
    W0tex.needsUpdate = true; W1tex.needsUpdate = true;
  }
  // for the grass: the heights as a texture (read in its vertex shader) and where grass grows
  const heightTex = new THREE.DataTexture(H, nx, nz, THREE.RedFormat, THREE.FloatType);
  heightTex.needsUpdate = true;
  return {
    group, height, inside, meta, update, paintEarth, heightTex, weights: uniforms.tW0.value, weights2: uniforms.tW1.value,
    setViewDist(d) { viewDist = d; },
    setDetail(on) { const v = on ? 1 : 0; if (v !== detail) { detail = v; material.defines.DETAIL = v; material.needsUpdate = true; } },
    get tileCount() { return tiles.size; },
  };
}
