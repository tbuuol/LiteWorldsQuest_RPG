// The own body, seen from its eyes: the same person the others see (figure.js, by the own id or the chosen look),
// playing the first-person clips (fp_*: trunk upright, head steady). The camera rides the head: it sits at the eyes
// of the animated body (its bob damped), so body and view always agree. The trunk turns to where one looks while the
// legs go where one walks; looking down bends neck and upper back a little, as a body does. The head itself (and the
// hair, eyes, brows on it) is not drawn from inside; its shadow is, the whole body's.

import * as THREE from 'three';
import { personFor, createBody } from './figure.js';

const EYES_UP = 0.075, EYES_FWD = 0.11;   // the eyes from the head bone's root: up, and forward along the look
const BOB = 6;                            // how quickly the camera follows the head up and down (1/s): damps the bob
const NEAR = 0.05;

/** a share (0..1) per vertex of the head bone, and a material of its own that does not draw it (shadows still do) */
function headless(mesh) {
  const g = mesh.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, bones = mesh.skeleton.bones;
  if (!si || !sw) return;
  const head = new Float32Array(si.count);
  let any = false;
  for (let i = 0; i < si.count; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (bones[si.getComponent(i, k)]?.name === 'DEF-head') w += sw.getComponent(i, k);
    head[i] = w; if (w > 0.35) any = true;
  }
  if (!any) return;
  const geo = g.clone();   // the others' copies keep theirs
  geo.setAttribute('fpHead', new THREE.BufferAttribute(head, 1));
  mesh.geometry = geo;
  const mat = mesh.material.clone();
  const prev = mesh.material.onBeforeCompile, prevKey = mesh.material.customProgramCacheKey?.() || '';
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.vertexShader = 'attribute float fpHead;\nvarying float vFpHead;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFpHead = fpHead;');
    sh.fragmentShader = 'varying float vFpHead;\n' +
      sh.fragmentShader.replace('void main() {', 'void main() {\nif (vFpHead > 0.35) discard;');
  };
  mat.customProgramCacheKey = () => 'fp-headless' + prevKey;
  mesh.material = mat;
}

export function createSelf(scene, contentBase, camera = null) {
  let body = null, want = null, loading = Promise.resolve();
  let bones = null, eyeY = null;
  const q = new THREE.Quaternion(), qp = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3();
  const head = new THREE.Vector3();

  /** turn a bone by a world-space rotation (about its own head) */
  function turn(bone, axis, angle) {
    if (!bone || !angle) return;
    bone.parent.getWorldQuaternion(qp);
    q.setFromAxisAngle(axis, angle);
    const d = qp.clone().invert().multiply(q).multiply(qp);   // the world turn in the bone's parent space
    bone.quaternion.premultiply(d);
    bone.updateMatrixWorld(true);
  }

  return {
    /** the own id is known (welcome), and the look if one was chosen: put on the person the others see */
    set(id, look = null) {
      const key = JSON.stringify([id, look]);
      if (key === want || !contentBase) return;
      want = key;
      loading = personFor(contentBase, { id, look }).then(g => {
        if (!g || want !== key) return;
        if (body) scene.remove(body.obj);
        body = createBody(g, { yawBase: Math.PI, own: true, fp: true });
        const meshes = [];
        body.body.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
        for (const m of meshes) headless(m);
        bones = {};
        body.body.traverse(o => { if (o.isBone) bones[o.name] = o; });
        scene.add(body.obj);
        if (camera) { camera.near = NEAR; camera.updateProjectionMatrix(); }
      });
    },
    /** resolves when the own body is in the scene */
    ready() { return loading; },
    /**
     * pos: the player's feet; yaw, pitch: where it looks; state: {mode, air} (player.js).
     * Puts the camera at the body's eyes (once it has a body).
     */
    update(pos, yaw, state, dt, visible = true, pitch = 0) {
      if (!body) return;
      body.obj.visible = visible;
      if (!visible) return;
      body.update(pos, yaw, state, dt);
      body.obj.updateMatrixWorld(true);
      // the trunk to the look: the legs face the way they walk, the spine takes up the rest (a third each)
      const face = yaw + Math.PI;
      let twist = Math.atan2(Math.sin(face - body.obj.rotation.y), Math.cos(face - body.obj.rotation.y));
      twist = Math.max(-1.6, Math.min(1.6, twist));
      for (const n of ['DEF-spine001', 'DEF-spine002', 'DEF-spine003']) turn(bones[n], up, twist / 3);
      // looking down (or up) bends the upper back and neck a little
      side.set(-Math.cos(yaw), 0, Math.sin(yaw));   // the left of where it looks: turning about it bends forward
      const bend = Math.max(-0.5, Math.min(0.6, -pitch)) * 0.35;
      turn(bones['DEF-spine003'], side, bend * 0.5);
      turn(bones['DEF-neck'], side, bend);
      // the eyes: in front of the head bone along the look, a little up; following its bob only slowly
      if (camera && bones['DEF-head']) {
        bones['DEF-head'].getWorldPosition(head);
        const y = head.y + EYES_UP;
        eyeY = eyeY === null || Math.abs(y - eyeY) > 0.5 ? y : eyeY + (y - eyeY) * Math.min(1, dt * BOB);
        camera.position.set(head.x - Math.sin(yaw) * EYES_FWD, eyeY, head.z - Math.cos(yaw) * EYES_FWD);
      }
    },
  };
}
