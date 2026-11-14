// The trees of content/core/flora: placed as content, drawn instanced in 128 m cells; how far and how many follow the
// quality level. The shapes are built here for now (one per kind); real models from the content's assets replace
// them later without anything else changing.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const CELL = 128;

function colorize(g, base, vary, seed) {
  const n = g.attributes.position.count, c = new Float32Array(n * 3), col = new THREE.Color();
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < n; i++) {
    col.set(base).offsetHSL((rnd() - 0.5) * vary, (rnd() - 0.5) * vary, (rnd() - 0.5) * vary * 1.5);
    col.toArray(c, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

function jitter(g, amount, seed) {
  const p = g.attributes.position;
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + rnd() * amount, p.getY(i) + rnd() * amount, p.getZ(i) + rnd() * amount);
  g.computeVertexNormals();
  return g;
}

function trunk(h, r0, r1, color, seed) {
  const g = new THREE.CylinderGeometry(r1, r0, h, 7, 3);
  g.translate(0, h / 2, 0);
  return colorize(jitter(g.toNonIndexed(), r0 * 0.25, seed), color, 0.08, seed);
}

function blob(r, x, y, z, color, seed, detail = 1) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  g.scale(1, 0.82, 1); g.translate(x, y, z);
  return colorize(jitter(g, r * 0.32, seed), color, 0.12, seed);
}

const SHAPES = {
  pine: () => {
    const parts = [trunk(3.2, 0.32, 0.18, 0x4a3524, 3)];
    for (let i = 0; i < 4; i++) {
      const g = new THREE.ConeGeometry(2.6 - i * 0.5, 3.4 - i * 0.3, 9, 2);
      g.translate(0, 3.0 + i * 1.75, 0);
      parts.push(colorize(jitter(g.toNonIndexed(), 0.35, 11 + i), 0x2f5a35, 0.1, 11 + i));
    }
    return mergeGeometries(parts);
  },
  oak: () => mergeGeometries([trunk(3.4, 0.45, 0.28, 0x4d3a28, 5),
    blob(2.6, 0, 5.2, 0, 0x4f7a34, 21, 2), blob(1.9, 1.6, 4.4, 0.6, 0x5a8238, 22), blob(1.9, -1.4, 4.6, -0.8, 0x4a7230, 23),
    blob(1.6, 0.3, 6.6, -1.1, 0x5f8a3c, 24)]),
  palm: () => {
    const parts = [trunk(6.5, 0.26, 0.18, 0x7a6448, 7)];
    for (let i = 0; i < 7; i++) {
      const g = new THREE.PlaneGeometry(0.9, 3.6, 1, 4);
      g.translate(0, 1.8, 0); g.rotateX(-1.05); g.rotateY(i * Math.PI * 2 / 7); g.translate(0, 6.4, 0);
      parts.push(colorize(g.toNonIndexed(), 0x4f7a2b, 0.1, 31 + i));
    }
    return mergeGeometries(parts);
  },
  dead: () => {
    const parts = [trunk(4.5, 0.3, 0.12, 0x3b3330, 9)];
    for (let i = 0; i < 5; i++) {
      const g = trunk(2.0, 0.1, 0.03, 0x3b3330, 40 + i);
      g.rotateZ(0.9); g.rotateY(i * 1.3); g.translate(0, 2.4 + i * 0.4, 0);
      parts.push(g);
    }
    return mergeGeometries(parts);
  },
  swamp: () => mergeGeometries([trunk(3.0, 0.5, 0.3, 0x3a3226, 13),
    blob(2.8, 0, 4.4, 0, 0x4b5a2c, 51, 1), blob(2.0, 1.2, 3.4, 1.0, 0x55622f, 52), blob(2.0, -1.4, 3.2, -0.6, 0x47552a, 53)]),
  fey: () => mergeGeometries([trunk(3.0, 0.3, 0.2, 0xd8d2c6, 15),
    blob(2.2, 0, 4.6, 0, 0xd890c8, 61, 2), blob(1.5, 1.3, 3.9, 0.4, 0xe3a6d6, 62), blob(1.5, -1.1, 4.0, -0.7, 0xcf84bf, 63)]),
};

export async function loadFlora(contentBase, ground, scene) {
  const meta = await (await fetch(`${contentBase}/core/flora/flora.json`)).json();
  const raw = new DataView(await (await fetch(`${contentBase}/core/flora/${meta.trees.file}`)).arrayBuffer());
  const kinds = meta.trees.kinds;
  const geos = kinds.map(k => (SHAPES[k] || SHAPES.oak)());
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, flatShading: false });
  // trees into cells, shuffled so that "the first n" is an even thinning
  const cells = new Map();
  const [x0, z0] = ground.meta.extent;
  for (let i = 0; i < raw.byteLength / 6; i++) {
    const x = raw.getInt16(i * 6, true) / 10, z = raw.getInt16(i * 6 + 2, true) / 10;
    const s = raw.getUint8(i * 6 + 4) / 50, k = raw.getUint8(i * 6 + 5);
    const key = `${Math.floor((x - x0) / CELL)},${Math.floor((z - z0) / CELL)}`;
    if (!cells.has(key)) cells.set(key, { cx: 0, cz: 0, list: kinds.map(() => []) });
    cells.get(key).list[k].push([x, ground.height(x, z) - 0.15, z, s, (i * 2654435761) % 6283 / 1000]);
  }
  const group = new THREE.Group();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), sc = new THREE.Vector3();
  for (const [key, c] of cells) {
    const [ix, iz] = key.split(',').map(Number);
    c.cx = x0 + (ix + 0.5) * CELL; c.cz = z0 + (iz + 0.5) * CELL;
    c.meshes = c.list.map((list, k) => {
      if (!list.length) return null;
      for (let i = list.length - 1; i > 0; i--) { const j = (i * 7919) % (i + 1); [list[i], list[j]] = [list[j], list[i]]; }
      const im = new THREE.InstancedMesh(geos[k], mat, list.length);
      list.forEach(([x, y, z, s, r], i) => {
        q.setFromAxisAngle(up, r); v.set(x, y, z); sc.setScalar(Math.max(0.5, s));
        im.setMatrixAt(i, m4.compose(v, q, sc));
      });
      im.computeBoundingSphere();
      im.castShadow = true; im.receiveShadow = true;
      im.userData.total = list.length;
      group.add(im);
      return im;
    }).filter(Boolean);
  }
  scene.add(group);
  let dist = 400, density = 1, shadows = true;
  return {
    count: raw.byteLength / 6,
    configure(o) { dist = o.dist; density = o.density; shadows = o.shadows; },
    update(px, pz) {
      for (const c of cells.values()) {
        const d = Math.hypot(c.cx - px, c.cz - pz) - CELL * 0.7, on = d < dist;
        for (const m of c.meshes) {
          m.visible = on;
          if (!on) continue;
          // thinner far away, and as the quality asks
          const fade = d < dist * 0.5 ? 1 : 1 - (d - dist * 0.5) / (dist * 0.5) * 0.6;
          m.count = Math.max(1, Math.round(m.userData.total * density * fade));
          m.castShadow = shadows && d < 160;
        }
      }
    },
  };
}
