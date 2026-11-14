// Other players, as the house sends them: drawn 120 ms behind and moved smoothly between the samples.

import * as THREE from 'three';

const DELAY = 120;

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

export function createRemotes(scene, camera, hudEl) {
  const all = new Map();   // id -> {obj, tag, samples, label}
  const v = new THREE.Vector3();
  return {
    spawn(m) {
      if (all.has(m.id)) return;
      const hue = ((m.id * 0.618034) % 1);
      const obj = figure(hue);
      scene.add(obj);
      const label = document.createElement('div'); label.className = 'nametag'; label.textContent = m.tag ? '@' + m.tag : 'guest';
      hudEl.appendChild(label);
      all.set(m.id, { obj, tag: m.tag, samples: [], label });
    },
    despawn(m) {
      const r = all.get(m.id); if (!r) return;
      scene.remove(r.obj); r.label.remove(); all.delete(m.id);
    },
    snap(list) {
      const t = performance.now();
      for (const e of list) {
        const r = all.get(e.id); if (!r) continue;
        r.samples.push({ t, x: e.x, y: e.y, z: e.z, yaw: e.yaw });
        if (r.samples.length > 30) r.samples.splice(0, r.samples.length - 30);
      }
    },
    update(now) {
      const t = now - DELAY;
      for (const r of all.values()) {
        const s = r.samples; if (!s.length) continue;
        let a = s[0], b = s[s.length - 1];
        for (let i = 0; i < s.length - 1; i++) if (s[i].t <= t && s[i + 1].t >= t) { a = s[i]; b = s[i + 1]; break; }
        const k = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 1;
        r.obj.position.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
        let dy = b.yaw - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        r.obj.rotation.y = a.yaw + dy * k;
        v.copy(r.obj.position); v.y += 2.05; v.project(camera);
        const vis = v.z < 1 && camera.position.distanceTo(r.obj.position) < 60;
        r.label.style.display = vis ? '' : 'none';
        if (vis) { r.label.style.left = `${(v.x + 1) / 2 * innerWidth}px`; r.label.style.top = `${(1 - v.y) / 2 * innerHeight}px`; }
      }
    },
    get count() { return all.size; },
  };
}
