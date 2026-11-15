// The own body, seen from its eyes: the same figure the others see (figure.js, picked by the own id), without its
// head (the camera is there), a little behind the eyes so looking down shows chest, arms, legs and feet, not the
// inside of the neck. It walks, runs and jumps as the player does.

import { loadFigure, createBody, playerFigure } from './figure.js';

const BACK = 0.16;   // metres the body stands behind the eyes

export function createSelf(scene, contentBase) {
  let body = null, want = null, head = null, loading = Promise.resolve();
  return {
    /** the own id is known (welcome): put on the figure the others see */
    set(id) {
      const fig = playerFigure(id);
      if (fig === want || !contentBase) return;
      want = fig;
      loading = loadFigure(contentBase, fig).then(g => {
        if (!g || want !== fig) return;
        if (body) scene.remove(body.obj);
        body = createBody(g, { yawBase: Math.PI });
        // no head from inside: the head bone (hair, eyes, brows, lashes hang on it) shrunk away
        head = null;
        body.body.traverse(o => { if (o.isBone && o.name === 'head') head = o; });
        scene.add(body.obj);
      });
    },
    /** resolves when the own figure is in the scene */
    ready() { return loading; },
    /** pos: the player's feet; yaw: where it looks; state: {mode, air} (player.js) */
    update(pos, yaw, state, dt, visible = true) {
      if (!body) return;
      body.obj.visible = visible;
      if (!visible) return;
      body.update(pos, yaw, state, dt);
      body.obj.position.x += Math.sin(yaw) * BACK;
      body.obj.position.z += Math.cos(yaw) * BACK;
      // after the mixer: shrink the head every frame (the clips set its scale back to 1)
      if (head) head.scale.setScalar(0.001);
    },
  };
}
