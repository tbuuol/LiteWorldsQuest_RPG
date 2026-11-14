// The trees of content/core/flora, placed as content. Two rings:
//   near  real trees (ez-tree: branches with bark, leaf cards, wind), instanced per variant, refilled as one walks;
//   far   impostors: a picture of each variant, rendered once at load from the real tree, always facing the camera.
// How far each ring reaches and how dense the forest is follow the quality level.

import * as THREE from 'three';
import { Tree } from '../vendor/ez-tree/index.js';
import { TreePreset } from '../vendor/ez-tree/presets/index.js';

// what each kind of the content is drawn as: presets, the height in metres, leaf tint and share of leaves
const KINDS = {
  pine:  { presets: ['Pine Medium', 'Pine Large'], height: 17, leaves: 0.9 },
  oak:   { presets: ['Oak Medium', 'Oak Large'], height: 13, leaves: 0.95 },
  fey:   { presets: ['Aspen Medium', 'Aspen Large'], height: 11, tint: 0xf3a8e2, leaves: 1.0 },
  swamp: { presets: ['Ash Large'], height: 12, tint: 0x9aa36a, leaves: 0.85, droop: true },
  dead:  { presets: ['Oak Medium'], height: 10, leaves: 0 },
  palm:  { presets: ['Ash Medium'], height: 9, tint: 0xb9d77a, leaves: 0.8 },
};
const NEAR_CAP = 900;     // most real trees of one variant drawn at once

function makeVariant(kind, preset, seed) {
  const k = KINDS[kind];
  const t = new Tree();
  const json = JSON.parse(JSON.stringify(TreePreset[preset]));
  json.seed = seed;
  if (k.tint) json.leaves.tint = k.tint;
  // light enough for an integrated GPU (tbuuol's box: about 1.4 M triangles at once is the limit): fewer rings and
  // sections on the branches, fewer but larger leaf cards, one card per leaf instead of a cross
  for (const lvl in json.branch.sections) json.branch.sections[lvl] = Math.max(1, Math.round(json.branch.sections[lvl] * 0.55));
  for (const lvl in json.branch.segments) json.branch.segments[lvl] = Math.max(3, Math.round(json.branch.segments[lvl] * 0.6));
  json.leaves.count = Math.max(0, Math.round((json.leaves.count || 1) * k.leaves * 0.4));
  json.leaves.size = (json.leaves.size || 2.5) * 1.55;
  json.leaves.billboard = 'single';
  if (k.droop) json.branch.force.strength = -0.03;
  t.loadFromJson(json);
  t.generate();
  t.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(t);
  return { tree: t, height: bb.max.y - bb.min.y, width: Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z), base: bb.min.y,
           branches: t.branchesMesh, leaves: t.leavesMesh, leafless: json.leaves.count === 0 };
}

// a picture of the tree from the side, with alpha, lit like the world
function impostorTexture(renderer, v) {
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
  return { texture: rt.texture, w, h };
}

function impostorMaterial(tex) {
  return new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), map: { value: tex } },
    fog: true, side: THREE.DoubleSide,
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 at = instanceMatrix[3].xyz; float sc = length(instanceMatrix[0].xyz);
        vec2 d = normalize(cameraPosition.xz - at.xz + vec2(1e-4));
        vec3 right = vec3(d.y, 0.0, -d.x);
        vec3 p = at + right * position.x * sc + vec3(0.0, position.y * sc, 0.0);
        vec4 mvPosition = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform sampler2D map; varying vec2 vUv;
      void main() {
        vec4 c = texture2D(map, vUv);
        if (c.a < 0.5) discard;
        gl_FragColor = vec4(c.rgb / max(c.a, 0.001), 1.0);
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

  // the variants: a real tree and its impostor
  const variants = [], byKind = {};
  for (const kind of kinds) {
    const k = KINDS[kind] || KINDS.oak;
    byKind[kind] = [];
    const list = k.presets.length > 1 ? k.presets.map((p, i) => [p, 11 + i * 4231]) : [[k.presets[0], 11], [k.presets[0], 4242]];
    for (const [preset, seed] of list) {
      say(`Growing the forest… (${kind})`);
      await new Promise(r => setTimeout(r, 0));   // let the page breathe between trees
      const v = makeVariant(kind, preset, seed);
      const imp = impostorTexture(renderer, v);
      const unit = k.height / v.height;           // instance scale 1 = the kind's height
      const nb = new THREE.InstancedMesh(v.branches.geometry, v.branches.material, NEAR_CAP);
      const nl = v.leafless ? null : new THREE.InstancedMesh(v.leaves.geometry, v.leaves.material, NEAR_CAP);
      if (nl) {   // leaf shadows cut out like the leaves, not as squares
        nl.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: v.leaves.material.map, alphaTest: v.leaves.material.alphaTest });
      }
      for (const m of [nb, nl]) if (m) { m.count = 0; m.frustumCulled = false; m.castShadow = true; m.receiveShadow = m === nb; scene.add(m); }   // leaves receive no shadows: costly on alpha-tested cards
      const quad = new THREE.PlaneGeometry(imp.w * unit, imp.h * unit); quad.translate(0, imp.h * unit / 2 + v.base * unit, 0);
      const rec = { kind, unit, nb, nl, quad, mat: impostorMaterial(imp.texture), far: null, n: 0, f: 0, total: 0 };
      variants.push(rec); byKind[kind].push(rec);
    }
  }
  // every tree once: where, how big, which variant
  const trees = [];
  for (let i = 0; i < raw.byteLength / 6; i++) {
    const x = raw.getInt16(i * 6, true) / 10, z = raw.getInt16(i * 6 + 2, true) / 10;
    const s = raw.getUint8(i * 6 + 4) / 50, kind = kinds[raw.getUint8(i * 6 + 5)];
    const list = byKind[kind]; if (!list) continue;
    const h = (i * 2654435761) >>> 0, v = list[h % list.length];
    v.total++;
    trees.push({ x, y: ground.height(x, z) - 0.2, z, s: Math.max(0.6, Math.min(1.5, s)) * (0.85 + (h % 100) / 330),
                 r: (h % 6283) / 1000, v, keep: ((h >>> 10) % 1000) / 1000 });
  }
  for (const rec of variants) {
    rec.far = new THREE.InstancedMesh(rec.quad, rec.mat, Math.max(1, rec.total));
    rec.far.count = 0; rec.far.frustumCulled = false; scene.add(rec.far);
  }

  let nearDist = 120, farDist = 600, density = 1, shadows = true, lastX = 1e9, lastZ = 1e9, time = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), sc = new THREE.Vector3();
  function refill(px, pz) {
    for (const rec of variants) { rec.n = 0; rec.f = 0; }
    const n2 = nearDist * nearDist, f2 = farDist * farDist;
    for (const t of trees) {
      if (t.keep > density) continue;
      const dx = t.x - px, dz = t.z - pz, d2 = dx * dx + dz * dz;
      if (d2 > f2) continue;
      const rec = t.v;
      p.set(t.x, t.y, t.z);
      if (d2 < n2 && rec.n < NEAR_CAP) {
        q.setFromAxisAngle(up, t.r); sc.setScalar(t.s * rec.unit); m4.compose(p, q, sc);
        rec.nb.setMatrixAt(rec.n, m4); if (rec.nl) rec.nl.setMatrixAt(rec.n, m4);
        rec.n++;
      } else {
        q.identity(); sc.setScalar(t.s); m4.compose(p, q, sc);
        rec.far.setMatrixAt(rec.f++, m4);
      }
    }
    for (const rec of variants) {
      rec.nb.count = rec.n; rec.nb.instanceMatrix.needsUpdate = true; rec.nb.castShadow = shadows;
      if (rec.nl) { rec.nl.count = rec.n; rec.nl.instanceMatrix.needsUpdate = true; rec.nl.castShadow = shadows; }
      rec.far.count = rec.f; rec.far.instanceMatrix.needsUpdate = true;
    }
  }
  return {
    count: trees.length,
    configure(o) { nearDist = o.near; farDist = o.dist; density = o.density; shadows = o.shadows; lastX = 1e9; },
    update(px, pz, dt = 0) {
      time += dt;
      for (const rec of variants) {
        const sh = rec.nl && rec.nl.material.userData.shader;
        if (sh) sh.uniforms.uTime.value = time;
      }
      if (Math.hypot(px - lastX, pz - lastZ) < 6) return;
      lastX = px; lastZ = pz;
      refill(px, pz);
    },
    stats() { let n = 0, f = 0; for (const r of variants) { n += r.n; f += r.f; } return { near: n, far: f }; },
  };
}
