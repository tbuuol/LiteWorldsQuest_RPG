// Places of content/core/places (villages, camps): what stands there, built from its parts with the CC0 building
// materials of content/core/assets/building. Nordic huts (stone footing, log walls, steep thatch, plank gables, lit
// windows, chimney), a palisade with its gate, the well, the fire with its light, the forge and the props. The paths
// are painted into the ground as earth. Solids (baked by tools/bake/places.py) are what one cannot walk through.

import * as THREE from 'three';

const WALL = 0.32, WALL_H = 2.7, DOOR = 1.3;

async function material(base, name, meters, extra = {}) {
  const L = new THREE.TextureLoader();
  const [c, n] = await Promise.all([L.loadAsync(`${base}/${name}-color.webp`), L.loadAsync(`${base}/${name}-normal.webp`)]);
  for (const t of [c, n]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; }
  c.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map: c, normalMap: n, roughness: 0.92, metalness: 0, ...extra });
  m.userData.meters = meters;   // one repeat of the texture covers this many metres
  return m;
}

// a box whose UVs are in metres / the material's repeat, so every size shows the texture at the same scale
function box(w, h, d, m) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, k = 1 / (m.userData.meters || 1);
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];   // px nx py ny pz nz
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const j = f * 4 + i; uv.setXY(j, uv.getX(j) * dims[f][0] * k, uv.getY(j) * dims[f][1] * k);
  }
  const mesh = new THREE.Mesh(g, m); mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
function cyl(r0, r1, h, m, seg = 12) {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg, 1);
  const uv = g.attributes.uv, k = 1 / (m.userData.meters || 1);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * Math.max(r0, r1) * k, uv.getY(i) * h * k);
  const mesh = new THREE.Mesh(g, m); mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
const at = (o, x, y, z, ry = 0) => { o.position.set(x, y, z); o.rotation.y = ry; return o; };

function hut(h, M, lights) {
  const g = new THREE.Group(), [w, d] = h.size, hw = w / 2, hd = d / 2;
  // footing
  g.add(at(box(w + 0.35, 0.55, d + 0.35, M.stone), 0, 0.1, 0));
  // log walls (back, sides, and the front either side of the door) and a lintel over the door
  const t = WALL, y = 0.38 + WALL_H / 2;
  g.add(at(box(w, WALL_H, t, M.walls), 0, y, hd - t / 2));
  g.add(at(box(t, WALL_H, d, M.walls), -hw + t / 2, y, 0));
  g.add(at(box(t, WALL_H, d, M.walls), hw - t / 2, y, 0));
  const side = (hw - DOOR / 2);
  g.add(at(box(side, WALL_H, t, M.walls), -hw + side / 2, y, -hd + t / 2));
  g.add(at(box(side, WALL_H, t, M.walls), hw - side / 2, y, -hd + t / 2));
  g.add(at(box(DOOR, WALL_H - 2.1, t, M.walls), 0, 0.38 + 2.1 + (WALL_H - 2.1) / 2, -hd + t / 2));
  // the door, a little open, and its frame
  const door = box(DOOR - 0.12, 2.05, 0.08, M.planks); door.position.set(-DOOR / 2 + 0.06, 0.38 + 1.03, 0); door.geometry.translate((DOOR - 0.12) / 2, 0, 0);
  const hinge = new THREE.Group(); hinge.position.set(0, 0, -hd + 0.05); hinge.add(door); hinge.rotation.y = -0.5; g.add(hinge);
  // windows: a dark frame, warm light inside when lit, shutters open
  const glow = new THREE.MeshStandardMaterial({ color: 0x241a10, emissive: h.lit ? 0xffa64a : 0x000000, emissiveIntensity: h.lit ? 1.4 : 0 });
  for (const sx of [-1, 1]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.55), glow);
    win.position.set(sx * (hw + 0.005), 0.38 + 1.55, 0); win.rotation.y = sx * Math.PI / 2; g.add(win);
    for (const s of [-1, 1]) {
      const sh = box(0.38, 0.6, 0.05, M.planks); sh.position.set(sx * (hw + 0.04), 0.38 + 1.55, s * 0.58); sh.rotation.y = sx * Math.PI / 2 + s * 0.25; g.add(sh);
    }
  }
  if (h.lit) { const l = new THREE.PointLight(0xffa04a, 6, 9, 2); l.position.set(0, 1.8, 0); g.add(l); lights.push(l); }
  // floor
  g.add(at(box(w - 2 * t, 0.06, d - 2 * t, M.planks), 0, 0.4, 0));
  // steep thatched roof with overhang, plank gables
  const pitch = 0.82, over = 0.45, rise = (hw + over) * Math.tan(pitch), slope = (hw + over) / Math.cos(pitch);
  const top = 0.38 + WALL_H;
  for (const s of [-1, 1]) {
    const r = box(slope, 0.32, d + 2 * over, M.thatch);
    r.position.set(s * (hw + over) / 2, top + rise / 2 - 0.15, 0); r.rotation.z = -s * pitch; g.add(r);
  }
  for (const s of [-1, 1]) {   // gable triangles
    const shape = new THREE.Shape([new THREE.Vector2(-hw, 0), new THREE.Vector2(hw, 0), new THREE.Vector2(0, hw * Math.tan(pitch))]);
    const gg = new THREE.ShapeGeometry(shape); const uv = gg.attributes.uv; const p = gg.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / M.planks.userData.meters, p.getY(i) / M.planks.userData.meters);
    const gm = new THREE.Mesh(gg, M.planks); gm.position.set(0, top, s * (hd - 0.02)); if (s < 0) gm.rotation.y = Math.PI;
    gm.material.side = THREE.DoubleSide; gm.castShadow = true; g.add(gm);
  }
  if (h.chimney) g.add(at(box(0.7, 2.2, 0.7, M.stone), hw * 0.45, top + rise * 0.55, hd * 0.35));
  return g;
}

function palisade(f, ground, M, group) {
  const [x0, z0, x1, z1] = f.rect, [g0, g1] = f.gate || [0, 0];
  const pts = [];
  const line = (ax, az, bx, bz) => { const n = Math.round(Math.hypot(bx - ax, bz - az) / 0.42); for (let i = 0; i <= n; i++) pts.push([ax + (bx - ax) * i / n, az + (bz - az) * i / n]); };
  line(x0, z0, x1, z0); line(x1, z0, x1, z1); line(x1, z1, g1 + 0.6, z1); line(g0 - 0.6, z1, x0, z1); line(x0, z1, x0, z0);
  const log = new THREE.CylinderGeometry(0.17, 0.2, 3.2, 8, 1); log.translate(0, 1.6, 0);
  const tip = new THREE.ConeGeometry(0.17, 0.45, 8); tip.translate(0, 3.42, 0);
  const geo = (() => { const a = log.toNonIndexed(), b = tip.toNonIndexed(); const m = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'uv']) { const A = a.attributes[k].array, B = b.attributes[k].array; const c = new Float32Array(A.length + B.length); c.set(A); c.set(B, A.length); m.setAttribute(k, new THREE.BufferAttribute(c, a.attributes[k].itemSize)); } return m; })();
  const im = new THREE.InstancedMesh(geo, M.bark, pts.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  pts.forEach(([x, z], i) => {
    e.set((Math.sin(i * 12.9) * 0.04), i * 1.7, Math.cos(i * 7.3) * 0.04); q.setFromEuler(e);
    m4.compose(new THREE.Vector3(x, ground.height(x, z) - 0.25, z), q, new THREE.Vector3(1, 0.9 + (Math.sin(i * 3.1) + 1) * 0.06, 1));
    im.setMatrixAt(i, m4);
  });
  im.castShadow = im.receiveShadow = true; group.add(im);
  // gate posts and the two leaves, open
  for (const gx of [g0 - 0.3, g1 + 0.3]) group.add(at(cyl(0.24, 0.22, 3.8, M.bark), gx, ground.height(gx, z1) + 1.6, z1));
  for (const [gx, s] of [[g0, 1], [g1, -1]]) {
    const leaf = box((g1 - g0) / 2 - 0.1, 2.4, 0.12, M.planks); leaf.geometry.translate(s * ((g1 - g0) / 4 - 0.05), 0, 0);
    leaf.position.set(gx, ground.height(gx, z1) + 1.25, z1); leaf.rotation.y = s * 1.3; group.add(leaf);
  }
}

function prop(p, M) {
  const g = new THREE.Group();
  switch (p.kind) {
    case 'bench': g.add(at(box(1.8, 0.08, 0.4, M.planks), 0, 0.45, 0)); for (const s of [-0.7, 0.7]) g.add(at(box(0.08, 0.45, 0.36, M.planks), s, 0.22, 0)); break;
    case 'crate': g.add(at(box(0.8, 0.8, 0.8, M.planks), 0, 0.4, 0)); break;
    case 'barrel': { const b = cyl(0.33, 0.33, 0.95, M.planks, 14); b.position.y = 0.48; g.add(b);
      for (const y of [0.2, 0.76]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.025, 6, 16), new THREE.MeshStandardMaterial({ color: 0x2b2b2e, metalness: 0.6, roughness: 0.5 })); ring.rotation.x = Math.PI / 2; ring.position.y = y; g.add(ring); } break; }
    case 'logpile': for (let r = 0; r < 3; r++) for (let i = 0; i < 4 - r; i++) { const l = cyl(0.18, 0.18, 2.6, M.bark, 8); l.rotation.z = Math.PI / 2; l.position.set(0, 0.18 + r * 0.31, (i - (3 - r) / 2) * 0.37); g.add(l); } break;
    case 'stump': g.add(at(cyl(0.38, 0.3, 0.6, M.bark), 0, 0.3, 0)); break;
    case 'haystack': { const h = new THREE.Mesh(new THREE.SphereGeometry(1.1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.thatch); h.scale.set(1, 1.2, 1); h.castShadow = h.receiveShadow = true; g.add(h); break; }
    case 'cart': g.add(at(box(2.0, 0.5, 1.2, M.planks), 0, 0.75, 0));
      for (const s of [-1, 1]) { const wh = cyl(0.45, 0.45, 0.1, M.planks, 16); wh.rotation.x = Math.PI / 2; wh.position.set(0.3, 0.45, s * 0.65); g.add(wh); } break;
    case 'lamppost': g.add(at(cyl(0.08, 0.06, 2.6, M.bark), 0, 1.3, 0));
      { // a short arm with a small iron lantern hanging from it: dark frame, warm glass inside
        g.add(at(box(0.5, 0.05, 0.05, M.bark), 0.22, 2.55, 0));
        const iron = new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.6, metalness: 0.6 });
        const glow = new THREE.MeshStandardMaterial({ color: 0x221508, emissive: 0xffa848, emissiveIntensity: 1.6 });
        g.add(at(new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.08, 4), iron), 0.42, 2.36, 0));
        g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.1), glow), 0.42, 2.25, 0));
        g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.02, 0.13), iron), 0.42, 2.18, 0));
        g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.12), iron), 0.42, 2.46, 0)); } break;
    default: return null;
  }
  return g;
}

function campfire(M, lights, group, x, y, z) {
  const g = new THREE.Group(); g.position.set(x, y, z);
  for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.17, 0), M.stone); s.position.set(Math.cos(a) * 0.75, 0.1, Math.sin(a) * 0.75); s.castShadow = true; g.add(s); }
  for (let i = 0; i < 4; i++) { const l = cyl(0.07, 0.07, 1.0, M.bark, 6); l.rotation.set(0.9, i * 1.57, 0); l.position.y = 0.3; g.add(l); }
  // flames: a few additive sprites that flicker; embers rise
  const flameTex = (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 128; const x2 = c.getContext('2d');
    const gr = x2.createRadialGradient(32, 96, 2, 32, 80, 60); gr.addColorStop(0, 'rgba(255,240,180,1)'); gr.addColorStop(0.3, 'rgba(255,150,40,0.85)'); gr.addColorStop(1, 'rgba(255,60,0,0)');
    x2.fillStyle = gr; x2.beginPath(); x2.ellipse(32, 80, 26, 48, 0, 0, Math.PI * 2); x2.fill(); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const flames = [];
  for (let i = 0; i < 5; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: true }));
    sp.scale.set(0.7, 1.2, 1); sp.position.set((i - 2) * 0.12, 0.65, Math.sin(i) * 0.1); g.add(sp); flames.push(sp);
  }
  const light = new THREE.PointLight(0xff8a3a, 18, 16, 2); light.position.y = 1.0; light.castShadow = false; g.add(light); lights.push(light);
  group.add(g);
  return t => {
    flames.forEach((f, i) => { const k = 0.85 + Math.sin(t * 9 + i * 2.1) * 0.12 + Math.sin(t * 23 + i) * 0.05; f.scale.set(0.6 * k, 1.15 * k, 1); f.position.y = 0.6 + 0.05 * Math.sin(t * 7 + i); });
    light.intensity = 16 + Math.sin(t * 11) * 2.5 + Math.sin(t * 27) * 1.2;
  };
}

export async function loadPlaces(contentBase, ground, scene, say = () => {}) {
  say('Raising Blockshire…');
  const list = ['blockshire'];
  const B = `${contentBase}/core/assets/building`;
  const [timber, planks, thatch, stone, bark] = await Promise.all([
    material(B, 'timber', 1.6, { color: new THREE.Color(1.55, 1.42, 1.25) }), material(B, 'planks', 1.4, { color: new THREE.Color(1.5, 1.38, 1.2) }),
    material(B, 'thatch', 2.0, { roughness: 1, color: new THREE.Color(1.9, 1.55, 1.0) }),
    material(B, 'stone', 1.6, { color: new THREE.Color(1.35, 1.32, 1.28) }), material(B, 'bark', 1.2, { color: new THREE.Color(1.35, 1.3, 1.2) })]);
  const M = { timber, planks, thatch, stone, bark, walls: planks };
  const group = new THREE.Group(); scene.add(group);
  const lights = [], tickers = [], solids = [], npcs = [];
  const bare = [];   // where no grass grows: [cx, cz, hx, hz, deg] boxes and [cx, cz, r] discs
  for (const id of list) {
    const p = await (await fetch(`${contentBase}/core/places/${id}.json`)).json();
    const [ox, oz] = p.origin || [0, 0];
    ground.paintEarth && ground.paintEarth(p.paths, ox, oz);
    for (const h of p.huts || []) {
      const x = ox + h.pos[0], z = oz + h.pos[1];
      bare.push([x, z, h.size[0] / 2 + 0.25, h.size[1] / 2 + 0.25, h.rot || 0]);
      const o = hut(h, M, lights); o.position.set(x, ground.height(x, z) - 0.05, z); o.rotation.y = THREE.MathUtils.degToRad(h.rot || 0); group.add(o);
    }
    if (p.fence) palisade({ ...p.fence, rect: [p.fence.rect[0] + ox, p.fence.rect[1] + oz, p.fence.rect[2] + ox, p.fence.rect[3] + oz], gate: [p.fence.gate[0] + ox, p.fence.gate[1] + ox] }, ground, M, group);
    if (p.well) {
      const [x, z] = [ox + p.well.pos[0], oz + p.well.pos[1]], y = ground.height(x, z);
      bare.push([x, z, 1.05]);
      const ring = cyl(0.95, 0.95, 0.85, stone, 16); ring.position.set(x, y + 0.42, z); group.add(ring);
      const water = new THREE.Mesh(new THREE.CircleGeometry(0.8, 16), new THREE.MeshStandardMaterial({ color: 0x0c1a20, roughness: 0.1 })); water.rotation.x = -Math.PI / 2; water.position.set(x, y + 0.6, z); group.add(water);
      for (const s of [-1, 1]) group.add(at(cyl(0.08, 0.08, 2.3, bark, 6), x + s * 0.85, y + 1.15, z));
      const roof = box(2.2, 0.12, 1.4, planks); roof.position.set(x, y + 2.35, z); roof.rotation.x = 0.0; group.add(roof);
    }
    if (p.forge) {
      const [x, z] = [ox + p.forge.pos[0], oz + p.forge.pos[1]], y = ground.height(x, z);
      bare.push([x, z, 1.25, 0.85, p.forge.rot || 0]);
      const f = new THREE.Group(); f.position.set(x, y, z); f.rotation.y = THREE.MathUtils.degToRad(p.forge.rot || 0);
      f.add(at(box(2.2, 1.0, 1.4, stone), 0, 0.5, 0));
      const coals = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.8), new THREE.MeshStandardMaterial({ color: 0x1a0a05, emissive: 0xff4a10, emissiveIntensity: 1.6 })); coals.position.y = 1.02; f.add(coals);
      const fl = new THREE.PointLight(0xff6a20, 6, 7, 2); fl.position.y = 1.4; f.add(fl); lights.push(fl);
      f.add(at(box(0.45, 0.35, 0.25, new THREE.MeshStandardMaterial({ color: 0x2a2a2e, metalness: 0.8, roughness: 0.4 })), 1.6, 0.75, 0));
      group.add(f);
    }
    if (p.fire) { const [x, z] = [ox + p.fire.pos[0], oz + p.fire.pos[1]]; bare.push([x, z, 1.15]); tickers.push(campfire(M, lights, group, x, ground.height(x, z), z)); }
    for (const pr of p.props || []) {
      const o = prop(pr, M); if (!o) continue;
      const [x, z] = [ox + pr.pos[0], oz + pr.pos[1]];
      o.position.set(x, ground.height(x, z), z); o.rotation.y = THREE.MathUtils.degToRad(pr.rot || 0); group.add(o);
      const SOLID = { barrel: [0.4, 0.4], crate: [0.5, 0.5], cart: [1.05, 0.75], haystack: [1.1, 1.1], logpile: [1.45, 0.65] };
      if (SOLID[pr.kind]) bare.push([x, z, ...SOLID[pr.kind], pr.rot || 0]);
      if (pr.kind === 'lamppost') { const l = new THREE.PointLight(0xffb050, 4, 10, 2); const r = (pr.rot || 0) * Math.PI / 180; l.position.set(x + 0.42 * Math.cos(r), ground.height(x, z) + 2.2, z - 0.42 * Math.sin(r)); group.add(l); lights.push(l); }
    }
    for (const s of p.solids || []) solids.push([s[0] + ox, s[1] + oz, s[2], s[3], s[4], s[5]]);
    for (const n of (p.npcs || []).concat(p.guards || [])) npcs.push({ ...n, x: ox + n.pos[0], z: oz + n.pos[1] });
  }
  group.traverse(o => { if (o.isMesh) { o.matrixAutoUpdate = true; } });
  return {
    solids, npcs, mask: grassMask(bare),
    update(t) { for (const f of tickers) f(t); },
  };
}

/** A texture of where no grass grows (25 cm a texel) over everything the places marked bare. */
function grassMask(bare, res = 0.25) {
  if (!bare.length) return null;
  const ext = s => s.length === 3 ? s[2] : Math.hypot(s[2], s[3]);
  const x0 = Math.min(...bare.map(s => s[0] - ext(s))) - 1, x1 = Math.max(...bare.map(s => s[0] + ext(s))) + 1;
  const z0 = Math.min(...bare.map(s => s[1] - ext(s))) - 1, z1 = Math.max(...bare.map(s => s[1] + ext(s))) + 1;
  const w = Math.ceil((x1 - x0) / res), h = Math.ceil((z1 - z0) / res), data = new Uint8Array(w * h);
  for (const s of bare) {
    const r = ext(s), i0 = Math.max(0, Math.floor((s[0] - r - x0) / res)), i1 = Math.min(w - 1, Math.ceil((s[0] + r - x0) / res));
    const j0 = Math.max(0, Math.floor((s[1] - r - z0) / res)), j1 = Math.min(h - 1, Math.ceil((s[1] + r - z0) / res));
    const a = THREE.MathUtils.degToRad(s[4] || 0), c = Math.cos(a), sn = Math.sin(a);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = x0 + (i + 0.5) * res - s[0], dz = z0 + (j + 0.5) * res - s[1];
      const inside = s.length === 3 ? dx * dx + dz * dz <= s[2] * s[2]
        : Math.abs(dx * c - dz * sn) <= s[2] && Math.abs(dx * sn + dz * c) <= s[3];
      if (inside) data[j * w + i] = 255;
    }
  }
  return { data, w, h, x0, z0, res };
}

/** Push a circle (the player) out of every solid it overlaps; returns the corrected [x, z]. */
export function collide(solids, x, z, r = 0.32) {
  for (const [cx, cz, hx, hz, deg] of solids) {
    const a = THREE.MathUtils.degToRad(deg), c = Math.cos(a), s = Math.sin(a);
    const dx = x - cx, dz = z - cz;
    const lx = dx * c - dz * s, lz = dx * s + dz * c;               // into the box's frame (inverse of rotation.y)
    const px = Math.max(-hx, Math.min(hx, lx)), pz = Math.max(-hz, Math.min(hz, lz));
    const ex = lx - px, ez = lz - pz, d = Math.hypot(ex, ez);
    if (d >= r) continue;
    let nx, nz;
    if (d > 1e-6) { nx = px + ex / d * r; nz = pz + ez / d * r; }
    else { const ox = hx - Math.abs(lx), oz = hz - Math.abs(lz);       // inside: out the nearest side
      if (ox < oz) { nx = Math.sign(lx || 1) * (hx + r); nz = lz; } else { nx = lx; nz = Math.sign(lz || 1) * (hz + r); } }
    x = cx + nx * c + nz * s; z = cz - nx * s + nz * c;              // back to the world
  }
  return [x, z];
}
