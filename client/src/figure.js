// Baked people (content/core/people/<id>.glb, tools/bake/people.py): loading, and moving them like people move.
//
// The body turns toward where it goes, not where its owner looks (walking sideways or backwards: the legs turn,
// backwards the walk runs in reverse); the clip follows the speed (walk, jog, sprint) and plays as fast as the
// feet must go over the ground, so they do not slide; in the air it jumps.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
const cache = new Map();   // figure id -> Promise<gltf | null>

/** speed (m/s) at which each clip's feet keep pace with the ground */
const NATURAL = { walk: 1.45, run: 3.1, sprint: 5.6 };
export const PLAYER_FIGURES = ['player_m1', 'player_f1', 'player_m2', 'player_f2', 'player_m3', 'player_f3'];
export const playerFigure = id => PLAYER_FIGURES[Math.abs(Math.floor(id * 2654435761) >>> 0) % PLAYER_FIGURES.length];

export function loadFigure(base, id) {
  if (!cache.has(id)) {
    cache.set(id, loader.loadAsync(`${base}/core/people/${id}.glb`).then(g => {
      const hair = [];
      g.scene.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = true; o.frustumCulled = false;   // skinned: the bounds move with the bones
        const m = o.material;
        m.envMapIntensity = 0.6;
        if (m.transparent || m.alphaTest > 0) hair.push(o);
      });
      // hair (and brows, lashes): cards with soft edges. A hard cut alone leaves them ragged and wild; two passes:
      // the dense middle solid (writes depth, casts shadow), then the soft fringe blended over it
      for (const o of hair) {
        const m = o.material;
        m.transparent = false; m.alphaTest = 0.62; m.alphaToCoverage = false; m.side = THREE.DoubleSide; m.depthWrite = true;
        const soft = m.clone();
        soft.transparent = true; soft.alphaTest = 0.08; soft.depthWrite = false; soft.side = THREE.FrontSide;
        const fringe = new THREE.SkinnedMesh(o.geometry, soft);
        fringe.bind(o.skeleton, o.bindMatrix);
        fringe.castShadow = false; fringe.frustumCulled = false; fringe.renderOrder = 2;
        fringe.name = o.name + '_fringe';
        o.parent.add(fringe);
      }
      return g;
    }).catch(e => { console.warn('figure', id, e); return null; }));
  }
  return cache.get(id);
}

/** wrap an angle to -PI..PI */
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * A figure in the scene: obj (a Group placed and turned by its owner via place()), moved by update().
 * yawBase: the yaw at which the figure faces its owner's "forward" (players look along -Z: PI; villagers 0).
 */
export function createBody(gltf, { yawBase = 0 } = {}) {
  const obj = new THREE.Group();
  const body = cloneSkinned(gltf.scene);
  obj.add(body);
  const mixer = new THREE.AnimationMixer(body);
  const acts = {};
  for (const clip of gltf.animations) acts[clip.name] = mixer.clipAction(clip);
  mixer.setTime(Math.random() * 3);
  let cur = null, bodyYaw = null;
  const last = new THREE.Vector3(), vel = new THREE.Vector3();
  let have = false;
  const v = new THREE.Vector3();   // the measured velocity, smoothed (positions come in steps)

  function play(name, scale) {
    const a = acts[name] || acts.idle;
    if (!a) return;
    if (name !== cur) {
      a.reset().play();
      if (cur && acts[cur]) acts[cur].crossFadeTo(a, 0.22, false);
      cur = name;
    }
    a.timeScale = scale;
  }

  return {
    obj, body, mixer,
    /**
     * pos: where it stands; look: its owner's yaw (as sent); state: {mode: 0 stand / 1 walk / 2 run, air, talk};
     * speed and direction are measured from the positions it is given
     */
    update(pos, look, state, dt) {
      if (have && dt > 0) vel.set((pos.x - last.x) / dt, 0, (pos.z - last.z) / dt);
      v.lerp(vel, Math.min(1, dt * 8));
      last.copy(pos); have = true;
      obj.position.copy(pos);
      const speed = Math.hypot(v.x, v.z);
      const face = look + yawBase;
      let want = face, clip = state.talk ? 'talk' : 'idle', scale = 1;
      if (state.air) {
        clip = 'jump';
      } else if (speed > 0.35 && state.mode !== 0) {
        const go = Math.atan2(v.x, v.z);          // the way it moves, as a figure's yaw
        const back = Math.abs(wrap(go - face)) > 1.75;        // more than ~100 degrees off: walking backwards
        want = back ? go + Math.PI : go;
        clip = speed < 2.4 ? 'walk' : speed < 4.8 ? 'run' : 'sprint';
        if (!acts[clip]) clip = clip === 'sprint' ? 'run' : 'walk';
        scale = Math.min(1.6, Math.max(0.7, speed / NATURAL[clip])) * (back ? -1 : 1);
      }
      if (bodyYaw === null) bodyYaw = want;
      bodyYaw += wrap(want - bodyYaw) * Math.min(1, dt * 9);
      obj.rotation.y = bodyYaw;
      play(clip, scale);
      mixer.update(dt);
    },
  };
}
