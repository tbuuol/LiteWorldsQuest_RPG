// People in the world: who they are (a look), put together from the standard people (standard.js), and moving
// like people move.
//
// The body turns toward where it goes, not where its owner looks (walking sideways or backwards: the legs turn,
// backwards the walk runs in reverse); the clip follows the speed (walk, jog, sprint) and plays as fast as the
// feet must go over the ground, so they do not slide; in the air it jumps.

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { buildStandard, standardCatalogue, diceStandard, standardForNpc, checkStandard } from './standard.js';

/** speed (m/s) at which each clip's feet keep pace with the ground */
const NATURAL = { walk: 1.45, run: 3.1, sprint: 5.6, side_walk: 0.5, side_run: 1.93 };

/**
 * The look of whoever the house names (the standard people, standard.js): a player by the look it chose (m.look),
 * else a first one rolled from its id; a villager as its place describes it, else rolled from its seed.
 */
export async function recipeFor(base, m, npc = null) {
  const cat = await standardCatalogue(base);
  if (npc) return npc.body || npc.look ? standardForNpc(cat, npc) : diceStandard(cat, npc.seed ?? npc.id, { outfit: 'peasant' });
  return (m.look && checkStandard(cat, m.look)) || diceStandard(cat, m.id);
}

/** a person ready for createBody(), or null if it could not be made */
export async function personFor(base, m, npc = null) {
  try {
    return await buildStandard(base, await recipeFor(base, m, npc));
  } catch (e) {
    console.warn('person', m.id, e);
    return null;
  }
}

/** wrap an angle to -PI..PI */
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * A figure in the scene: obj (a Group placed and turned by its owner via place()), moved by update().
 * yawBase: the yaw at which the figure faces its owner's "forward" (players look along -Z: PI; villagers 0).
 * own: the person is already its own (personFor), not to be copied; fp: play the first-person clips (the own body).
 */
export function createBody(gltf, { yawBase = 0, own = false, fp = false, faceLook = false } = {}) {
  const obj = new THREE.Group();
  const body = own ? gltf.scene : cloneSkinned(gltf.scene);   // a person from personFor() is already its own
  obj.add(body);
  const mixer = new THREE.AnimationMixer(body);
  const acts = {};
  for (const clip of gltf.animations) acts[clip.name] = mixer.clipAction(clip);
  mixer.setTime(Math.random() * 3);
  let cur = null, bodyYaw = null;
  const last = new THREE.Vector3(), vel = new THREE.Vector3();
  let have = false;
  const v = new THREE.Vector3();   // the measured velocity, smoothed (positions come in steps)
  const bones = {};
  body.traverse(o => { if (o.isBone) bones[o.name] = o; });

  function play(name, scale) {
    if (fp && acts['fp_' + name]) name = 'fp_' + name;   // the own body: its first-person variant
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
    obj, body, mixer, bones,
    /**
     * pos: where it stands; look: its owner's yaw (as sent); state: {mode: 0 stand / 1 walk / 2 run, air, talk};
     * speed and direction are measured from the positions it is given.
     * faceLook (players): the body faces where it looks, legs too, always; going sideways it sidesteps (slow) or
     * shuffles (fast) to that side (tools/bake/strafe.py), backwards the walk runs in reverse. Else (villagers): the
     * body turns into the way it goes.
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
        const go = Math.atan2(v.x, v.z);                       // the way it moves, as a figure's yaw
        const rel = wrap(go - face);
        const back = Math.abs(rel) > 1.75;                     // more than ~100 degrees off: walking backwards
        // sideways (more than ~37 degrees off ahead and behind): a sidestep to the side it goes (rel < 0: its right)
        const side = faceLook && Math.abs(Math.sin(rel)) > 0.6 && acts.side_walk_r;
        if (!faceLook) want = back ? go + Math.PI : go;
        if (side) {
          clip = (speed < 1.6 ? 'side_walk_' : 'side_run_') + (rel < 0 ? 'r' : 'l');
          scale = Math.min(2.0, Math.max(0.7, speed / NATURAL[clip.slice(0, -2)]));
        } else {
          clip = speed < 2.4 ? 'walk' : speed < 4.8 ? 'run' : 'sprint';
          if (!acts[clip]) clip = clip === 'sprint' ? 'run' : 'walk';
          scale = Math.min(1.6, Math.max(0.7, speed / NATURAL[clip])) * (back ? -1 : 1);
        }
      }
      if (bodyYaw === null) bodyYaw = want;
      bodyYaw += wrap(want - bodyYaw) * Math.min(1, dt * (faceLook ? 25 : 9));
      obj.rotation.y = bodyYaw;
      play(clip, scale);
      mixer.update(dt);
    },
  };
}
