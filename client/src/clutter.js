// Ground clutter of content/core/flora (clutter.bin, placed by tools/bake/clutter.py): stones, boulders, ferns,
// bushes, dead wood. Drawn near the player as instances, refilled as one walks; boulders reach further than ferns.
// Rocks are shaped here (noise on a sphere) and wear the ground's rock texture with moss on top; the fern is a CC0
// model; bushes come from the tree generator; logs are bark-covered trunks.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Tree } from '../vendor/ez-tree/index.js';
import { TreePreset } from '../vendor/ez-tree/presets/index.js';

const CELL = 64;
// how far each kind is drawn at quality scale 1, and how many of a variant at most
const REACH = { stone: 55, boulder: 260, fern: 34, bush: 70, log: 60, cliff: 240 };
const CAP = { stone: 3000, boulder: 1500, fern: 6000, bush: 1500, log: 400, cliff: 1400 };

function hash3(x, y, z, s) { const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + s * 19.3) * 43758.5453; return v - Math.floor(v); }
function vnoise(x, y, z, s) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t, h = (a, b, c) => hash3(ix + a, iy + b, iz + c, s);
  return L(L(L(h(0, 0, 0), h(1, 0, 0), u), L(h(0, 1, 0), h(1, 1, 0), u), v), L(L(h(0, 0, 1), h(1, 0, 1), u), L(h(0, 1, 1), h(1, 1, 1), u), v), w);
}

// a rock: a sphere pushed by layered noise, a flat-ish bottom, wider than high; box-projected UVs
function rockGeometry(seed, detail = 4, shape = [1.25, 0.72, 1]) {
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, detail));
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = vnoise(v.x * 1.3, v.y * 1.3, v.z * 1.3, seed) * 0.55 + vnoise(v.x * 3.1, v.y * 3.1, v.z * 3.1, seed + 1) * 0.3
            + vnoise(v.x * 7.0, v.y * 7.0, v.z * 7.0, seed + 2) * 0.15;
    v.multiplyScalar(0.72 + n * 0.55);
    v.y = v.y < -0.15 ? -0.15 + (v.y + 0.15) * 0.25 : v.y;   // sits on the ground
    v.x *= shape[0]; v.y *= shape[1]; v.z *= shape[2];
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const [a, b] = ay >= ax && ay >= az ? [p.getX(i), p.getZ(i)] : ax >= az ? [p.getZ(i), p.getY(i)] : [p.getX(i), p.getY(i)];
    uv[i * 2] = a * 0.6; uv[i * 2 + 1] = b * 0.6;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.translate(0, 0.08, 0);
  return g;
}

async function tex(url, srgb) {
  const t = await new THREE.TextureLoader().loadAsync(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function bushVariant(preset, seed) {
  const t = new Tree();
  const json = JSON.parse(JSON.stringify(TreePreset[preset]));
  json.seed = seed;
  for (const l in json.branch.sections) json.branch.sections[l] = Math.max(1, Math.round(json.branch.sections[l] * 0.5));
  for (const l in json.branch.segments) json.branch.segments[l] = Math.max(3, Math.round(json.branch.segments[l] * 0.6));
  json.leaves.count = Math.max(1, Math.round(json.leaves.count * 0.45)); json.leaves.size *= 1.4; json.leaves.billboard = 'single';
  t.loadFromJson(json); t.generate();
  const bb = new THREE.Box3().setFromObject(t);
  return { parts: [[t.branchesMesh.geometry, t.branchesMesh.material], [t.leavesMesh.geometry, t.leavesMesh.material]], unit: 1 / (bb.max.y - bb.min.y) };
}

export async function loadClutter(contentBase, ground, scene, say = () => {}) {
  say('Scattering stones and ferns…');
  const meta = await (await fetch(`${contentBase}/core/flora/flora.json`)).json();
  const c = meta.clutter; if (!c) return { configure() {}, update() {}, stats: () => ({}) };
  const raw = new DataView(await (await fetch(`${contentBase}/core/flora/${c.file}`)).arrayBuffer());
  const G = `${contentBase}/core/assets/ground`;
  const [rockC, rockN, mossC] = await Promise.all([tex(`${G}/rock_color.webp`, true), tex(`${G}/rock_normal.webp`), tex(`${G}/moss_color.webp`, true)]);

  // rock material: the ground's rock, moss where the top faces the sky
  const rockMat = new THREE.MeshStandardMaterial({ map: rockC, normalMap: rockN, roughness: 0.95 });
  rockMat.onBeforeCompile = sh => {
    sh.uniforms.tMoss = { value: mossC };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vUp;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvUp = normalize(mat3(modelMatrix) * objectNormal).y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D tMoss; varying float vUp;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float moss = smoothstep(0.45, 0.8, vUp);
        diffuseColor.rgb = mix(diffuseColor.rgb * vec3(0.9, 0.92, 0.95), texture2D(tMoss, vMapUv * 1.7).rgb * vec3(0.8, 0.9, 0.7), moss * 0.85);`);
  };
  const variants = { stone: [], boulder: [], fern: [], bush: [], log: [], cliff: [] };
  // real rocks (Poly Haven CC0, simplified by tools/bake/rocks.py); the shaped ones stay as a fallback
  const rocks = {};
  const loader = new GLTFLoader();
  // (rock_face_01/02 are open surface scans: hollow from behind, not for free-standing rocks)
  await Promise.all(['rock_07', 'rock_09'].map(async n => {
    try {
      const gl = await loader.loadAsync(`${contentBase}/core/assets/rocks/${n}/${n}.gltf`);
      let mesh = null; gl.scene.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
      mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox, size = bb.getSize(new THREE.Vector3());
      mesh.material.roughness = 1; mesh.material.color.setScalar(1.35);   // the scans are dark; lifted to sit with the ground's rock
      rocks[n] = { geo: mesh.geometry, mat: mesh.material, maxDim: Math.max(size.x, size.y, size.z), height: size.y };
    } catch (e) { console.warn('rock', n, e); }
  }));
  const real = (n, by) => rocks[n] && { parts: [[rocks[n].geo, rocks[n].mat]], unit: 1 / (by === 'height' ? rocks[n].height : rocks[n].maxDim) };
  for (const [kind, list, by, tilt] of [['stone', ['rock_07', 'rock_09'], 'max']]) {
    for (const n of list) { const v = real(n, by); if (v) { if (tilt) v.tilt = tilt; variants[kind].push(v); } }
  }
  for (const s of [3, 7, 11]) {   // boulders and rock faces: shaped here (and stones, if the models are missing)
    const g = rockGeometry(s);
    if (!variants.stone.length) variants.stone.push({ parts: [[g, rockMat]], unit: 1 });
    variants.boulder.push({ parts: [[g, rockMat]], unit: 1 });
    variants.cliff.push({ parts: [[rockGeometry(s + 20, 3, [1.35, 1.45, 0.5]), rockMat]], unit: 1, tilt: 0.42 });
  }
  // fern (Poly Haven fern_02, CC0)
  try {
    const gl = await new GLTFLoader().loadAsync(`${contentBase}/core/assets/plants/fern_02/fern_02_1k.gltf`);
    const parts = [];
    gl.scene.updateMatrixWorld(true);
    gl.scene.traverse(o => { if (o.isMesh) { const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); parts.push([g, o.material]); } });
    const bb = new THREE.Box3().setFromObject(gl.scene);
    for (const [, m] of parts) { m.side = THREE.DoubleSide; if (m.alphaTest === 0) m.alphaTest = 0.5; }
    variants.fern.push({ parts, unit: 1 / Math.max(0.01, bb.max.y - bb.min.y) });
  } catch (e) { console.warn('fern', e); }
  // bushes
  variants.bush.push(bushVariant('Bush 1', 5), bushVariant('Bush 2', 9));
  // a fallen log: a bark-covered trunk lying on its side
  const [barkC, barkN] = await Promise.all([tex(new URL('../vendor/ez-tree/assets/bark/oak_color_1k.jpg', import.meta.url).href, true),
                                            tex(new URL('../vendor/ez-tree/assets/bark/oak_normal_1k.jpg', import.meta.url).href)]);
  barkC.repeat.set(2, 3); barkN.repeat.set(2, 3);
  const logG = new THREE.CylinderGeometry(0.22, 0.28, 4.5, 10, 4); logG.rotateZ(Math.PI / 2); logG.translate(0, 0.2, 0);
  variants.log.push({ parts: [[logG, new THREE.MeshStandardMaterial({ map: barkC, normalMap: barkN, roughness: 0.95, color: 0x8a8070 })]], unit: 1 });

  // instanced meshes per variant and part
  const all = [];
  for (const kind of c.kinds) for (const v of variants[kind] || []) {
    v.meshes = v.parts.map(([g, m]) => {
      const im = new THREE.InstancedMesh(g, m, CAP[kind]);
      im.count = 0; im.frustumCulled = false; im.castShadow = kind === 'boulder' || kind === 'bush' || kind === 'cliff'; im.receiveShadow = true;
      if (m.alphaTest > 0 && m.map) im.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: m.map, alphaTest: m.alphaTest });
      scene.add(im); return im;
    });
    v.kind = kind; all.push(v);
  }
  // the records into 64 m cells
  const [x0, z0] = ground.meta.extent, cells = new Map();
  const n = raw.byteLength / 7;
  for (let i = 0; i < n; i++) {
    const x = raw.getInt16(i * 7, true) / 10, z = raw.getInt16(i * 7 + 2, true) / 10;
    const s = raw.getUint8(i * 7 + 4) / 20, kind = c.kinds[raw.getUint8(i * 7 + 5)], r = raw.getUint8(i * 7 + 6) / 256 * Math.PI * 2;
    const vs = variants[kind]; if (!vs || !vs.length) continue;
    const key = Math.floor((x - x0) / CELL) + ',' + Math.floor((z - z0) / CELL);
    if (!cells.has(key)) cells.set(key, []);
    const y = ground.height(x, z) - (kind === 'cliff' ? s * 0.45 : kind === 'boulder' ? s * 0.18 : kind === 'stone' ? s * 0.1 : 0.02);
    cells.get(key).push({ x, y, z, s, r, v: vs[i % vs.length], kind });
  }

  let scale = 1, lastX = 1e9, lastZ = 1e9, time = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), tq = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3(1, 0, 0), p = new THREE.Vector3(), sc = new THREE.Vector3();
  function refill(px, pz) {
    for (const v of all) v.n = 0;
    const reach = Math.max(...Object.values(REACH)) * scale, cr = Math.ceil(reach / CELL);
    const cx = Math.floor((px - x0) / CELL), cz = Math.floor((pz - z0) / CELL);
    for (let j = cz - cr; j <= cz + cr; j++) for (let i = cx - cr; i <= cx + cr; i++) {
      const list = cells.get(i + ',' + j); if (!list) continue;
      for (const o of list) {
        const R = REACH[o.kind] * scale, dx = o.x - px, dz = o.z - pz;
        if (dx * dx + dz * dz > R * R) continue;
        const v = o.v; if (v.n >= CAP[o.kind]) continue;
        q.setFromAxisAngle(up, o.r); if (v.tilt) q.multiply(tq.setFromAxisAngle(side, v.tilt)); p.set(o.x, o.y, o.z); sc.setScalar(o.s * v.unit);
        m4.compose(p, q, sc);
        for (const im of v.meshes) im.setMatrixAt(v.n, m4);
        v.n++;
      }
    }
    for (const v of all) for (const im of v.meshes) { im.count = v.n; im.instanceMatrix.needsUpdate = true; }
  }
  return {
    configure(s) { scale = s; lastX = 1e9; for (const v of all) for (const im of v.meshes) im.visible = s > 0; },
    update(px, pz, dt = 0) {
      time += dt;
      for (const v of all) for (const im of v.meshes) { const sh = im.material.userData && im.material.userData.shader; if (sh && sh.uniforms.uTime) sh.uniforms.uTime.value = time; }
      if (scale <= 0 || Math.hypot(px - lastX, pz - lastZ) < 4) return;
      lastX = px; lastZ = pz; refill(px, pz);
    },
    stats() { let n = 0; for (const v of all) n += v.n || 0; return n; },
  };
}
