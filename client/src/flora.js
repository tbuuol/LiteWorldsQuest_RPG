// The trees of content/core/flora, placed as content. Three levels of detail (LOD), chosen by what the camera
// really sees, not only by distance:
//   L0  the real tree (ez-tree: branches with bark, leaf cards, wind), for the first trees one sees;
//   L1  the same tree, lighter (fewer branch rings and sides, half the leaf cards, larger), for trees mostly hidden
//       behind one other crown, small on screen, or just outside the view (they still cast shadows into it);
//   L2  impostors: a picture of each variant, rendered once at load from the real tree, always facing the camera;
//       for trees hidden behind two crowns or more, tiny on screen, or beyond the near ring.
// The choice works front to back over a coarse coverage map of the screen: each crown, once drawn, covers its part
// of the map, and a tree behind it gets the level of the part of it that is still free. How far the near ring
// reaches and how dense the forest is follow the quality level.

import * as THREE from 'three';
import { Tree } from '../vendor/ez-tree/index.js';
import { TreePreset } from '../vendor/ez-tree/presets/index.js';
import { wind } from './wind.js';
import { treeSeasonGLSL } from './seasons.js';

// the season for every tree material and impostor: year fraction and how much snow lies (see seasons.js)
export const seasonU = { uYear: { value: 0 }, uSnow: { value: 0 } };
// a built-in material (already moved by the wind) follows the season too:
//   'leaves'  deciduous leaves: thin out as the tree drops them (and back in spring), take their autumn colour
//   'cut'     the same thinning only (the leaves' depth pass and shadow)
//   'snow'    a breath of snow on bark in winter
//   'needles' flecks of snow in conifer needles
export function seasonPatch(mat, mode) {
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '';
  mat.onBeforeCompile = (sh) => {
    prev(sh);
    Object.assign(sh.uniforms, seasonU);
    sh.vertexShader = 'uniform float uYear;\nvarying vec4 vSeas; varying vec3 vLeafP;\n' + treeSeasonGLSL + sh.vertexShader.replace(
      'gl_Position = projectionMatrix * mvPosition;',
      'gl_Position = projectionMatrix * mvPosition;\n      { float th = treeHash(windRoot.xz); vSeas = vec4(treeSeason(uYear, th), th, 0.0); vLeafP = transformed; }');
    let f = 'uniform float uYear, uSnow;\nvarying vec4 vSeas; varying vec3 vLeafP;\n' + treeSeasonGLSL +
      'float sHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }\n' + sh.fragmentShader;
    if (mode === 'leaves' || mode === 'cut') {
      // a bare tree drops its leaves bunch by bunch (pieces of a third of a metre), not all at once
      f = f.replace('#include <alphatest_fragment>', 'if (vSeas.x < 0.999 && sHash(floor(vLeafP * 3.0)) > vSeas.x) discard;\n#include <alphatest_fragment>');
    }
    if (mode === 'leaves') {
      f = f.replace('#include <color_fragment>', `#include <color_fragment>
        { float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
          float a = vSeas.y * (0.75 + 0.25 * sHash(floor(vLeafP * 2.0) + 5.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, autumnColour(vSeas.z) * lum * 3.4, a);
          diffuseColor.rgb *= mix(vec3(1.0), vec3(1.15, 1.2, 0.85), smoothstep(0.25, 0.0, uYear) * step(uYear, 0.25)); }`);
    }
    if (mode === 'snow') {   // bark: only a cold breath of snow
      f = f.replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.95), uSnow * 0.12);`);
    }
    if (mode === 'needles' || mode === 'leaves') {   // needles and leaves: fine flecks of snow caught in them
      f = f.replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.95), uSnow * 0.5 * smoothstep(0.35, 0.75, sHash(floor(vLeafP * 14.0) + 9.0)));`);
    }
    sh.fragmentShader = f;
  };
  mat.customProgramCacheKey = () => prevKey + ':season:' + mode;
  mat.needsUpdate = true;
  return mat;
}

// how much the trees bend (metres per metre height squared, at gust strength 1) and how far leaves flutter
const BEND = 0.0022, FLUTTER = 0.07;

// what each kind of the content is drawn as: presets, the height in metres, leaf tint and share of leaves
const KINDS = {
  pine:  { presets: ['Pine Medium', 'Pine Large'], height: 17, leaves: 0.9 },
  oak:   { presets: ['Oak Medium', 'Oak Large'], height: 13, leaves: 0.95 },
  fey:   { presets: ['Aspen Medium', 'Aspen Large'], height: 11, tint: 0xf3a8e2, leaves: 1.0 },
  swamp: { presets: ['Ash Large'], height: 12, tint: 0x9aa36a, leaves: 0.85, droop: true },
  dead:  { presets: ['Oak Medium'], height: 10, leaves: 0 },
  palm:  { presets: ['Ash Medium'], height: 9, tint: 0xb9d77a, leaves: 0.8 },
};
const NEAR_CAP = 900;     // most real trees of one variant and level drawn at once
// how light each real level is against the preset: branch rings, branch sides, leaf cards, leaf size
const DETAIL = [
  { sections: 0.55, segments: 0.6, leaves: 0.4, size: 1.55 },   // L0 (light enough for an integrated GPU already)
  { sections: 0.28, segments: 0.4, leaves: 0.2, size: 2.1 },    // L1: about the same leaf area in half the cards
];
// the coverage map: bins across and up the screen
const BW = 96, BH = 40;
const SHADOW_RING = 22;   // trees just outside the view this close still cast shadows into it (as L1)

function makeVariant(kind, preset, seed, lod = 0) {
  const k = KINDS[kind], D = DETAIL[lod];
  const t = new Tree();
  const json = JSON.parse(JSON.stringify(TreePreset[preset]));
  json.seed = seed;
  if (k.tint) json.leaves.tint = k.tint;
  // light enough for an integrated GPU (tbuuol's box: about 1.4 M triangles at once is the limit): fewer rings and
  // sections on the branches, fewer but larger leaf cards, one card per leaf instead of a cross
  for (const lvl in json.branch.sections) json.branch.sections[lvl] = Math.max(1, Math.round(json.branch.sections[lvl] * D.sections));
  for (const lvl in json.branch.segments) json.branch.segments[lvl] = Math.max(3, Math.round(json.branch.segments[lvl] * D.segments));
  json.leaves.count = Math.max(0, Math.round((json.leaves.count || 1) * k.leaves * D.leaves));
  if (k.leaves > 0) json.leaves.count = Math.max(1, json.leaves.count);
  json.leaves.size = (json.leaves.size || 2.5) * D.size;
  json.leaves.billboard = 'single';
  if (k.droop) json.branch.force.strength = -0.03;
  t.loadFromJson(json);
  t.generate();
  t.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(t);
  return { tree: t, height: bb.max.y - bb.min.y, width: Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z), base: bb.min.y,
           branches: t.branchesMesh, leaves: t.leavesMesh, leafless: k.leaves === 0 };
}

// Leaves are the forest's cost: many alpha-tested cards behind each other, each lit in full (overdraw). So they are drawn
// twice: first only their depth (cheap, with the same wind), then lit, only where they are the front leaf (depth
// test less-or-equal against the first pass, which is pushed back a hair so both passes agree). Every leaf pixel on
// the screen is then lit once.
// (also used for the ferns and bushes of clutter.js, with their own wind numbers)
export function alphaDepthPass(leafMat, bend = BEND, flutter = FLUTTER) {
  const pre = new THREE.MeshBasicMaterial({ map: leafMat.map, alphaTest: leafMat.alphaTest, side: THREE.DoubleSide, colorWrite: false,
                                            polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 4 });
  wind.patch(pre, bend, flutter);   // the same wind as the lit leaves, to the bit
  leafMat.depthWrite = false;
  leafMat.depthFunc = THREE.LessEqualDepth;
  return pre;
}

const tris = g => (g.index ? g.index.count : g.attributes.position.count) / 3;

// a picture of the tree from the side, with alpha, lit like the world
function impostorTexture(renderer, v, bare = false) {
  if (bare && v.leaves) v.leaves.visible = false;
  const W = 256, H = 512, aspect = W / H;
  const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xc4d8f0, 0x5c5a3c, 2.0));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6); sun.position.set(0.4, 1, 0.8); scene.add(sun);
  scene.add(v.tree);
  const h = v.height * 1.04, w = h * aspect;
  const cam = new THREE.OrthographicCamera(-w / 2, w / 2, v.base + h, v.base, -1000, 1000);
  cam.position.set(0, 0, 200); cam.lookAt(0, 0, 0); cam.updateProjectionMatrix();
  const old = renderer.getRenderTarget(), oldAlpha = renderer.getClearAlpha(), oldTone = renderer.toneMapping;
  const oldColor = new THREE.Color(); renderer.getClearColor(oldColor);
  renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.toneMapping = THREE.NoToneMapping;
  renderer.clear(); renderer.render(scene, cam);
  renderer.setRenderTarget(old); renderer.setClearColor(oldColor, oldAlpha); renderer.toneMapping = oldTone;
  scene.remove(v.tree);
  if (v.leaves) v.leaves.visible = true;
  return { texture: rt.texture, w, h };
}

// the impostors were drawn once in daylight: they are tinted by the light there is now (dusk, moonlight)
const impostorTint = { value: new THREE.Color(1, 1, 1) };
function impostorMaterial(tex, bareTex, deciduous) {
  return new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), map: { value: tex }, mapBare: { value: bareTex }, uTint: impostorTint,
                uDecid: { value: deciduous ? 1 : 0 }, ...seasonU, ...wind.uniforms },
    fog: true, side: THREE.DoubleSide,
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>
      varying vec2 vUv; varying vec4 vSeas;
      uniform float uYear;
      ${wind.glsl}
      ${treeSeasonGLSL}
      void main() {
        vUv = uv;
        vec3 at = instanceMatrix[3].xyz; float sc = length(instanceMatrix[0].xyz);
        float th = treeHash(at.xz); vSeas = vec4(treeSeason(uYear, th), th, 0.0);   // the same as the real tree
        vec2 d = normalize(cameraPosition.xz - at.xz + vec2(1e-4));
        vec3 right = vec3(d.y, 0.0, -d.x);
        vec3 p = at + right * position.x * sc + vec3(0.0, position.y * sc, 0.0);
        p += windOffset(at, p, ${BEND}, 0.0);   // the picture leans with the same gust as the real trees
        vec4 mvPosition = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform sampler2D map, mapBare; uniform vec3 uTint; uniform float uDecid, uSnow; varying vec2 vUv; varying vec4 vSeas;
      ${treeSeasonGLSL}
      void main() {
        vec4 c = texture2D(map, vUv);
        if (uDecid > 0.5) {
          // the season as on the real trees: leaves (what the bare picture lacks) coloured, thinned, gone
          vec4 b = texture2D(mapBare, vUv);
          float leafy = clamp(c.a - b.a, 0.0, 1.0);
          vec3 lc = c.rgb / max(c.a, 0.001);
          float lum = dot(lc, vec3(0.3, 0.59, 0.11));
          lc = mix(lc, autumnColour(vSeas.z) * lum * 2.7, vSeas.y * leafy);
          float keep = vSeas.x > 0.999 ? 1.0 : step(fract(sin(dot(floor(vUv * vec2(24.0, 48.0)), vec2(12.9898, 78.233))) * 43758.5453), vSeas.x);
          c = mix(b, vec4(lc * c.a, c.a), keep);
        }
        if (c.a < 0.5) discard;
        vec3 col = c.rgb / max(c.a, 0.001);
        col = mix(col, vec3(0.86, 0.9, 0.95), uSnow * 0.4 * smoothstep(0.3, 0.9, vUv.y));
        gl_FragColor = vec4(col * uTint, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

export async function loadFlora(contentBase, ground, scene, renderer, say = () => {}) {
  const meta = await (await fetch(`${contentBase}/core/flora/flora.json`)).json();
  const raw = new DataView(await (await fetch(`${contentBase}/core/flora/${meta.trees.file}`)).arrayBuffer());
  const kinds = meta.trees.kinds;

  // the variants: a real tree in two weights and its impostor
  const variants = [], byKind = {};
  const instanced = (geo, mat, cap) => { const m = new THREE.InstancedMesh(geo, mat, cap); m.count = 0; m.frustumCulled = false; scene.add(m); return m; };
  for (const kind of kinds) {
    const k = KINDS[kind] || KINDS.oak;
    byKind[kind] = [];
    const list = k.presets.length > 1 ? k.presets.map((p, i) => [p, 11 + i * 4231]) : [[k.presets[0], 11], [k.presets[0], 4242]];
    for (const [preset, seed] of list) {
      say(`Growing the forest… (${kind})`);
      await new Promise(r => setTimeout(r, 0));   // let the page breathe between trees
      const v = makeVariant(kind, preset, seed, 0);
      const v1 = makeVariant(kind, preset, seed, 1);
      const imp = impostorTexture(renderer, v), impBare = impostorTexture(renderer, v, true);
      const deciduous = kind !== 'pine' && !v.leafless;
      const unit = k.height / v.height;           // instance scale 1 = the kind's height
      // both real levels share the L0 materials (one shader, one wind); only the shapes differ
      // the one wind for branches, leaves and their shadows (ez-tree's own sway, leaves only, is replaced)
      seasonPatch(wind.patch(v.branches.material, BEND), 'snow');
      if (!v.leafless) seasonPatch(wind.patch(v.leaves.material, BEND, FLUTTER), deciduous ? 'leaves' : 'needles');
      const branchDepth = wind.patch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), BEND);
      const pre = v.leafless ? null : alphaDepthPass(v.leaves.material);
      if (pre && deciduous) seasonPatch(pre, 'cut');
      const lv = [v, v1].map((w) => {
        const b = instanced(w.branches.geometry, v.branches.material, NEAR_CAP);
        const l = v.leafless ? null : instanced(w.leaves.geometry, v.leaves.material, NEAR_CAP);
        b.castShadow = true; b.receiveShadow = true; b.customDepthMaterial = branchDepth;
        if (l) {   // leaf shadows cut out like the leaves, not as squares; leaves receive none (costly on alpha cards)
          l.customDepthMaterial = wind.patch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: v.leaves.material.map, alphaTest: v.leaves.material.alphaTest }), BEND, FLUTTER);
          if (deciduous) seasonPatch(l.customDepthMaterial, 'cut');   // bare trees cast only their branches' shadow
          l.castShadow = true;
          const d = instanced(w.leaves.geometry, pre, NEAR_CAP);
          d.instanceMatrix = l.instanceMatrix; d.renderOrder = -10; d.castShadow = false; d.receiveShadow = false;
          l.pre = d;
        }
        return { b, l, n: 0, tris: tris(w.branches.geometry) + (l ? tris(w.leaves.geometry) : 0) };
      });
      const quad = new THREE.PlaneGeometry(imp.w * unit, imp.h * unit); quad.translate(0, imp.h * unit / 2 + v.base * unit, 0);
      const rec = { kind, unit, lv, leafless: v.leafless, quad, mat: impostorMaterial(imp.texture, impBare.texture, deciduous), far: null, f: 0, inner: null, i: 0, total: 0,
                    // the crown as the coverage map sees it, at instance scale 1: half width, bottom and top
                    crownR: v.width * unit * 0.5, crownLo: (v.base + v.height * 0.3) * unit, crownHi: (v.base + v.height) * unit };
      variants.push(rec); byKind[kind].push(rec);
    }
  }
  // every tree once: where, how big, which variant; both instance matrices made once here, copied when drawn
  const trees = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), sc = new THREE.Vector3();
  for (let i = 0; i < raw.byteLength / 6; i++) {
    const x = raw.getInt16(i * 6, true) / 10, z = raw.getInt16(i * 6 + 2, true) / 10;
    const s0 = raw.getUint8(i * 6 + 4) / 50, kind = kinds[raw.getUint8(i * 6 + 5)];
    const list = byKind[kind]; if (!list) continue;
    const h = (i * 2654435761) >>> 0, v = list[h % list.length];
    v.total++;
    const s = Math.max(0.6, Math.min(1.5, s0)) * (0.85 + (h % 100) / 330), y = ground.height(x, z) - 0.2;
    const t = { x, y, z, s, v, keep: ((h >>> 10) % 1000) / 1000, lod: 2, mn: new Float32Array(16), mf: new Float32Array(16) };
    p.set(x, y, z);
    q.setFromAxisAngle(up, (h % 6283) / 1000); sc.setScalar(s * v.unit); m4.compose(p, q, sc); m4.toArray(t.mn);
    q.identity(); sc.setScalar(s); m4.compose(p, q, sc); m4.toArray(t.mf);
    trees.push(t);
  }
  for (const rec of variants) {
    // impostors in two sets: beyond the near ring (laid again only every few metres), and inside it (the hidden ones,
    // with the levels)
    rec.far = instanced(rec.quad, rec.mat, Math.max(1, rec.total));
    rec.inner = instanced(rec.quad, rec.mat, NEAR_CAP);
  }

  let nearDist = 120, farDist = 600, density = 1, shadows = true, leafShadows = true, time = 0, dirty = true;
  const cov = new Uint8Array(BW * BH);
  const last = { x: 1e9, y: 0, z: 0, dx: 0, dy: 0, dz: 0, at: -1e9, fx: 1e9, fz: 0 };
  let ring = [];   // the trees of the near ring, by the last time the far set was laid
  const vp = new THREE.Matrix4(), dir = new THREE.Vector3(), e = vp.elements;
  const cand = [];
  let shown = [0, 0, 0];

  // where a world point lands: [ndc x, ndc y, depth w] (w <= 0: behind the camera)
  function proj(x, y, z, out) {
    const w = e[3] * x + e[7] * y + e[11] * z + e[15];
    out[0] = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
    out[1] = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
    out[2] = w;
  }
  const A = [0, 0, 0], B = [0, 0, 0];

  function put(t, lod) {
    const rec = t.v;
    if (lod < 2) {
      const L = rec.lv[lod];
      if (L.n < NEAR_CAP) {
        L.b.instanceMatrix.array.set(t.mn, L.n * 16);
        if (L.l) L.l.instanceMatrix.array.set(t.mn, L.n * 16);
        L.n++; t.lod = lod; shown[lod]++;
        return;
      }
    }
    if (rec.i < NEAR_CAP) rec.inner.instanceMatrix.array.set(t.mf, rec.i++ * 16);
    t.lod = 2; shown[2]++;
  }
  // the far set and the list of near-ring trees; only when the camera moved some metres (or the settings changed)
  function layFar(cx, cz) {
    last.fx = cx; last.fz = cz;
    const n2 = (nearDist + 8) ** 2, f2 = farDist * farDist;   // the ring reaches a little further, as the camera moves on
    for (const rec of variants) rec.f = 0;
    ring = [];
    for (const t of trees) {
      if (t.keep > density) continue;
      const dx = t.x - cx, dz = t.z - cz, d2 = dx * dx + dz * dz;
      if (d2 > f2) continue;
      if (d2 < n2) { ring.push(t); continue; }
      t.v.far.instanceMatrix.array.set(t.mf, t.v.f++ * 16);
    }
    for (const rec of variants) { rec.far.count = rec.f; rec.far.instanceMatrix.needsUpdate = true; rec.far.visible = rec.f > 0; }
  }

  function refill(camera) {
    for (const rec of variants) { rec.i = 0; for (const L of rec.lv) L.n = 0; }
    shown = [0, 0, 0];
    cov.fill(0);
    vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const cx = camera.position.x, cz = camera.position.z;
    if (Math.hypot(cx - last.fx, cz - last.fz) > 6) layFar(cx, cz);
    const n2 = nearDist * nearDist;
    cand.length = 0;
    for (const t of ring) {
      const dx = t.x - cx, dz = t.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= n2) { put(t, 2); continue; }
      t.d2 = d2; cand.push(t);
    }
    cand.sort((a, b) => a.d2 - b.d2);   // front to back: the coverage map fills from the front, the GPU draws so too
    for (const t of cand) {
      const rec = t.v, r = rec.crownR * t.s, lo = t.y + rec.crownLo * t.s, hi = t.y + rec.crownHi * t.s;
      const d = Math.sqrt(t.d2);
      if (d < r + 1.5) { put(t, 0); continue; }   // standing under it
      // the crown as a box on the screen: its top and bottom at the centre, widened by its radius
      proj(t.x, hi, t.z, A); proj(t.x, lo, t.z, B);
      if (A[2] <= 0.5 || B[2] <= 0.5) { put(t, d < SHADOW_RING ? 1 : 2); continue; }   // behind the camera
      // half width in ndc: the radius seen side-on at that depth (the projection's x scale over w)
      const hw = r * Math.hypot(e[0], e[8]) / Math.min(A[2], B[2]);
      let x0 = Math.min(A[0], B[0]) - hw, x1 = Math.max(A[0], B[0]) + hw, y0 = Math.min(A[1], B[1]), y1 = Math.max(A[1], B[1]);
      if (x1 < -1.1 || x0 > 1.1 || y1 < -1.1 || y0 > 1.1) { put(t, d < SHADOW_RING ? 1 : 2); continue; }   // outside the view
      // into bins
      const bx0 = Math.max(0, Math.floor((x0 + 1) * 0.5 * BW)), bx1 = Math.min(BW - 1, Math.floor((x1 + 1) * 0.5 * BW));
      const by0 = Math.max(0, Math.floor((y0 + 1) * 0.5 * BH)), by1 = Math.min(BH - 1, Math.floor((y1 + 1) * 0.5 * BH));
      const size = (y1 - y0) * 0.5 * BH;   // how tall on screen, in bins
      let all = 0, free0 = 0, free1 = 0;
      for (let by = by0; by <= by1; by++) for (let bx = bx0, o = by * BW + bx0; bx <= bx1; bx++, o++) {
        all++; const c = cov[o]; if (c === 0) free0++; if (c <= 1) free1++;
      }
      // the level of what is still free of it; a little stickiness so trees do not flicker between levels
      const keep0 = t.lod === 0 ? 0.2 : 0.32, keep1 = t.lod <= 1 ? 0.2 : 0.32;
      let lod = all === 0 ? 2 : free0 >= keep0 * all ? 0 : free1 >= keep1 * all ? 1 : 2;
      if (size < 7) lod = Math.max(lod, 1);   // small on screen: the details would not show
      if (size < 2.5) lod = 2;
      put(t, lod);
      if (rec.leafless) continue;   // bare branches hide nothing
      // the crown covers its inner part (leaf cards have gaps at the rim)
      const ix0 = x0 + (x1 - x0) * 0.15, ix1 = x1 - (x1 - x0) * 0.15, iy0 = y0 + (y1 - y0) * 0.1, iy1 = y1 - (y1 - y0) * 0.05;
      const cx0 = Math.max(0, Math.ceil((ix0 + 1) * 0.5 * BW)), cx1 = Math.min(BW - 1, Math.floor((ix1 + 1) * 0.5 * BW) - 1);
      const cy0 = Math.max(0, Math.ceil((iy0 + 1) * 0.5 * BH)), cy1 = Math.min(BH - 1, Math.floor((iy1 + 1) * 0.5 * BH) - 1);
      for (let by = cy0; by <= cy1; by++) for (let bx = cx0, o = by * BW + cx0; bx <= cx1; bx++, o++) if (cov[o] < 255) cov[o]++;
    }
    for (const rec of variants) {
      for (const L of rec.lv) {
        L.b.count = L.n; L.b.instanceMatrix.needsUpdate = true; L.b.castShadow = shadows; L.b.visible = L.n > 0;
        if (L.l) { L.l.count = L.l.pre.count = L.n; L.l.instanceMatrix.needsUpdate = true; L.l.castShadow = shadows && leafShadows; L.l.visible = L.l.pre.visible = L.n > 0; }
      }
      rec.inner.count = rec.i; rec.inner.instanceMatrix.needsUpdate = true; rec.inner.visible = rec.i > 0;   // empty: not even a draw call
    }
  }
  return {
    count: trees.length,
    /** the light now relative to the noon it was drawn in (the impostors' tint) */
    setLight(c) { impostorTint.value.copy(c); },
    /** the season: year fraction and how much snow lies (0..1) */
    setSeason(yf, snow) { seasonU.uYear.value = yf; seasonU.uSnow.value = snow; },
    configure(o) { nearDist = o.near; farDist = o.dist; density = o.density; shadows = o.shadows; leafShadows = o.leafShadows !== false; dirty = true; last.fx = 1e9; },
    // camera: the one the world is drawn with (its matrices up to date); the levels follow what it sees
    update(camera, dt = 0, now = performance.now(), force = false) {
      time += dt;
      camera.updateMatrixWorld();
      camera.getWorldDirection(dir);
      const P = camera.position;
      const moved = Math.hypot(P.x - last.x, P.y - last.y, P.z - last.z), turned = dir.x * last.dx + dir.y * last.dy + dir.z * last.dz;
      // look again when the camera moved or turned enough, at most ten times a second
      if (!force && !dirty && ((moved < 0.75 && turned > 0.9986) || now - last.at < 100)) return;
      dirty = false;
      Object.assign(last, { x: P.x, y: P.y, z: P.z, dx: dir.x, dy: dir.y, dz: dir.z, at: now });
      refill(camera);
    },
    stats() { return { full: shown[0], light: shown[1], far: shown[2] + variants.reduce((a, r) => a + r.f, 0),
      tris: variants.reduce((a, r) => a + r.lv[0].n * r.lv[0].tris + r.lv[1].n * r.lv[1].tris + (r.f + r.i) * 2, 0) }; },
    // every mesh shown for a moment, so the shaders compile behind the curtain (empty ones are hidden otherwise)
    showAll() { for (const r of variants) { r.far.visible = r.inner.visible = true; for (const L of r.lv) { L.b.visible = true; if (L.l) L.l.visible = L.l.pre.visible = true; } } dirty = true; },
    // (dev) the meshes by level, to switch parts off while measuring
    parts() { return { l0: variants.flatMap(r => [r.lv[0].b, r.lv[0].l]).filter(Boolean), l1: variants.flatMap(r => [r.lv[1].b, r.lv[1].l]).filter(Boolean),
      leaves: variants.flatMap(r => r.lv.map(L => L.l)).filter(Boolean), branches: variants.flatMap(r => r.lv.map(L => L.b)), far: variants.map(r => r.far) }; },
    // (dev) the triangles of one tree per level, per variant
    levels() { return variants.map(r => [r.kind, r.lv[0].tris, r.lv[1].tris]); },
  };
}
