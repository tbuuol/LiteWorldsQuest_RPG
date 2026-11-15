// Other players and the villagers, as the house sends them: drawn 120 ms behind and moved smoothly between the
// samples. Everyone is a baked figure (figure.js): villagers their own, players one of the player figures, picked by
// their id (the same on every screen); the capsule only until the figure has loaded.

import * as THREE from 'three';
import { loadFigure, createBody, playerFigure } from './figure.js';

const DELAY = 120;
const FIGURE_NEAR = 70;     // closer than this a baked figure is drawn and moved; farther the mixer rests

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
  const all = new Map();   // id -> {obj, tag, samples, label, body}
  const v = new THREE.Vector3(), p = new THREE.Vector3();
  return {
    spawn(m) {
      if (all.has(m.id)) return;
      const hue = ((m.id * 0.618034) % 1);
      const obj = figure(hue);
      scene.add(obj);
      const label = document.createElement('div'); label.className = 'nametag'; label.textContent = m.name || (m.tag ? '@' + m.tag : 'guest');
      hudEl.appendChild(label);
      const npc = m.kind === 'npc';
      const r = { obj, tag: m.tag, name: m.name, npc, samples: [], label, body: null, talkUntil: 0 };
      all.set(m.id, r);
      const fig = m.figure || (npc ? null : playerFigure(m.id));
      if (fig && contentBase) loadFigure(contentBase, fig).then(g => {
        if (!g || all.get(m.id) !== r) return;
        // villagers' yaw faces them (atan2(dx, dz)); a player's yaw is where its camera looks (-Z): turned round
        r.body = createBody(g, { yawBase: npc ? 0 : Math.PI });
        r.body.obj.position.copy(r.obj.position);
        scene.remove(r.obj);
        r.obj = r.body.obj;
        scene.add(r.obj);
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
        p.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
        let dy = b.yaw - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        const yaw = a.yaw + dy * k;
        if (r.body) {
          const near = camera.position.distanceTo(p) < FIGURE_NEAR;
          r.obj.visible = near;
          if (near) r.body.update(p, yaw, { mode: b.anim & 7, air: (b.anim & 8) !== 0, talk: now < r.talkUntil }, dt);
          else r.obj.position.copy(p);
        } else {
          r.obj.position.copy(p);
          r.obj.rotation.y = yaw;
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
