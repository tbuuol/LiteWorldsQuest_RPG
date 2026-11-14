// Other players, as the house sends them: drawn 120 ms behind and moved smoothly between the samples.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const DELAY = 120;
const FIGURE_NEAR = 70;     // closer than this a baked figure is drawn and moved; farther the mixer rests
const loader = new GLTFLoader();
const figures = new Map();  // figure id -> Promise<gltf>

function loadFigure(base, id) {
  if (!figures.has(id)) {
    figures.set(id, loader.loadAsync(`${base}/core/people/${id}.glb`).then(g => {
      g.scene.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = true; o.frustumCulled = false;   // skinned: the bounds move with the bones
        const m = o.material;
        if (m.transparent || m.alphaTest > 0) { m.transparent = false; m.alphaTest = 0.45; m.alphaToCoverage = true; m.side = THREE.DoubleSide; }
        m.envMapIntensity = 0.6;
      });
      return g;
    }).catch(e => { console.warn('figure', id, e); return null; }));
  }
  return figures.get(id);
}

function figure(hue) {
  const g = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue, 0.45, 0.38), roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9b28f, roughness: 0.7 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.75, 4, 10), cloth); body.position.y = 1.05;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), skin); head.position.y = 1.68;
  const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.55, 4, 8), leather); legs.position.y = 0.45;
  for (const m of [body, head, legs]) { m.castShadow = true; g.add(m); }
  return g;
}

export function createRemotes(scene, camera, hudEl, contentBase) {
  const all = new Map();   // id -> {obj, tag, samples, label}
  const v = new THREE.Vector3();
  return {
    spawn(m) {
      if (all.has(m.id)) return;
      const hue = ((m.id * 0.618034) % 1);
      const obj = figure(hue);
      scene.add(obj);
      const label = document.createElement('div'); label.className = 'nametag'; label.textContent = m.name || (m.tag ? '@' + m.tag : 'guest');
      hudEl.appendChild(label);
      const r = { obj, tag: m.tag, name: m.name, npc: m.kind === 'npc', samples: [], label, mixer: null, acts: null, cur: null, talkUntil: 0 };
      all.set(m.id, r);
      if (m.figure && contentBase) loadFigure(contentBase, m.figure).then(g => {
        if (!g || all.get(m.id) !== r) return;
        const body = cloneSkinned(g.scene);
        while (r.obj.children.length) r.obj.remove(r.obj.children[0]);
        r.obj.add(body);
        r.mixer = new THREE.AnimationMixer(body);
        r.acts = {};
        for (const clip of g.animations) r.acts[clip.name] = r.mixer.clipAction(clip);
        r.mixer.setTime(Math.random() * 3);   // not all in step
      });
    },
    despawn(m) {
      const r = all.get(m.id); if (!r) return;
      scene.remove(r.obj); r.label.remove(); all.delete(m.id);
    },
    snap(list) {
      const t = performance.now();
      for (const e of list) {
        const r = all.get(e.id); if (!r) continue;
        r.samples.push({ t, x: e.x, y: e.y, z: e.z, yaw: e.yaw, anim: e.anim || 0 });
        if (r.samples.length > 30) r.samples.splice(0, r.samples.length - 30);
      }
    },
    /** a villager speaks: it gestures for a while */
    talking(id, ms = 5000) { const r = all.get(id); if (r) r.talkUntil = performance.now() + ms; },
    update(now, dt = 0.016) {
      const t = now - DELAY;
      for (const r of all.values()) {
        const s = r.samples; if (!s.length) continue;
        let a = s[0], b = s[s.length - 1];
        for (let i = 0; i < s.length - 1; i++) if (s[i].t <= t && s[i + 1].t >= t) { a = s[i]; b = s[i + 1]; break; }
        const k = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 1;
        r.obj.position.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
        let dy = b.yaw - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        r.obj.rotation.y = a.yaw + dy * k;
        if (r.mixer) {
          const near = camera.position.distanceTo(r.obj.position) < FIGURE_NEAR;
          r.obj.visible = near;
          if (near) {
            const mode = b.anim & 7, want = mode === 2 ? 'run' : mode === 1 ? 'walk' : now < r.talkUntil ? 'talk' : 'idle';
            if (want !== r.cur && r.acts[want]) {
              const next = r.acts[want].reset().play();
              if (r.cur && r.acts[r.cur]) r.acts[r.cur].crossFadeTo(next, 0.3, false);
              r.cur = want;
            }
            r.mixer.update(dt);
          }
        }
        v.copy(r.obj.position); v.y += 2.05; v.project(camera);
        const vis = v.z < 1 && camera.position.distanceTo(r.obj.position) < 25;
        r.label.style.display = vis ? '' : 'none';
        if (vis) { r.label.style.left = `${(v.x + 1) / 2 * innerWidth}px`; r.label.style.top = `${(1 - v.y) / 2 * innerHeight}px`; }
      }
    },
    /** the nearest villager within d metres of (x, z): {id, name} or null */
    nearestNpc(x, z, d) {
      let best = null;
      for (const [id, r] of all) {
        if (!r.npc || !r.samples.length) continue;
        const e = Math.hypot(r.obj.position.x - x, r.obj.position.z - z);
        if (e < d) { d = e; best = { id, name: r.name }; }
      }
      return best;
    },
    get count() { return all.size; },
  };
}
