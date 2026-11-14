// The own player: first person, mouse and keyboard (and a simple touch layout). Moves at once (prediction) and tells
// the house 15 times a second where it is; if the house disagrees (FIX), the player is put where the house says.

const WALK = 4.0, RUN = 6.8, JUMP = 5.0, GRAVITY = 14, EYE = 1.65, SEND_HZ = 15;

export function createPlayer(camera, dom, ground, net) {
  const pos = { x: 0, y: 0, z: 0 }, keys = {};
  let yaw = 0, pitch = 0, vy = 0, onGround = true, lastSend = 0, lastSent = '', locked = false, typing = false;
  const touch = { move: null, look: null, mx: 0, mz: 0 };

  addEventListener('keydown', e => { if (!typing) keys[e.code] = true; });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  dom.addEventListener('click', () => { if (!locked && !typing && matchMedia('(pointer:fine)').matches) dom.requestPointerLock(); });
  document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === dom; });
  addEventListener('mousemove', e => {
    if (!locked) return;
    yaw -= e.movementX * 0.0022;
    pitch = Math.max(-1.45, Math.min(1.45, pitch - e.movementY * 0.0022));
  });
  // touch: left half moves, right half looks
  dom.addEventListener('touchstart', e => {
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth / 2 && !touch.move) touch.move = { id: t.identifier, x: t.clientX, y: t.clientY };
      else if (!touch.look) touch.look = { id: t.identifier, x: t.clientX, y: t.clientY };
    }
  }, { passive: true });
  dom.addEventListener('touchmove', e => {
    for (const t of e.changedTouches) {
      if (touch.move && t.identifier === touch.move.id) {
        touch.mx = Math.max(-1, Math.min(1, (t.clientX - touch.move.x) / 60));
        touch.mz = Math.max(-1, Math.min(1, (t.clientY - touch.move.y) / 60));
      } else if (touch.look && t.identifier === touch.look.id) {
        yaw -= (t.clientX - touch.look.x) * 0.005;
        pitch = Math.max(-1.45, Math.min(1.45, pitch - (t.clientY - touch.look.y) * 0.005));
        touch.look.x = t.clientX; touch.look.y = t.clientY;
      }
    }
  }, { passive: true });
  dom.addEventListener('touchend', e => {
    for (const t of e.changedTouches) {
      if (touch.move && t.identifier === touch.move.id) { touch.move = null; touch.mx = touch.mz = 0; }
      if (touch.look && t.identifier === touch.look.id) touch.look = null;
    }
  }, { passive: true });

  function update(dt, now) {
    let fx = 0, fz = 0;
    if (keys.KeyW || keys.ArrowUp) fz -= 1;
    if (keys.KeyS || keys.ArrowDown) fz += 1;
    if (keys.KeyA || keys.ArrowLeft) fx -= 1;
    if (keys.KeyD || keys.ArrowRight) fx += 1;
    fx += touch.mx; fz += touch.mz;
    const len = Math.hypot(fx, fz), run = keys.ShiftLeft || keys.ShiftRight || len > 1.6;
    let moving = false;
    if (len > 0.05) {
      const sp = (run ? RUN : WALK) * Math.min(1, len) / len;
      const s = Math.sin(yaw), c = Math.cos(yaw);
      const nx = pos.x + (fx * c + fz * s) * sp * dt, nz = pos.z + (-fx * s + fz * c) * sp * dt;
      if (ground.inside(nx, nz)) { pos.x = nx; pos.z = nz; moving = true; }
    }
    if (keys.Space && onGround) { vy = JUMP; onGround = false; }
    const floor = ground.height(pos.x, pos.z);
    vy -= GRAVITY * dt;
    pos.y += vy * dt;
    if (pos.y <= floor) { pos.y = floor; vy = 0; onGround = true; }
    else if (onGround && pos.y - floor < 0.6 && vy <= 0) pos.y = floor; // walking down a slope stays on it
    else onGround = false;

    camera.position.set(pos.x, pos.y + EYE, pos.z);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');

    if (now - lastSend >= 1000 / SEND_HZ) {
      const flags = (run ? 1 : 0) | (onGround ? 0 : 8);
      const key = `${pos.x.toFixed(2)},${pos.y.toFixed(2)},${pos.z.toFixed(2)},${yaw.toFixed(3)},${pitch.toFixed(3)},${flags}`;
      if (key !== lastSent || now - lastSend > 1000) {
        net.move(pos.x, pos.y, pos.z, yaw, pitch, flags);
        lastSent = key; lastSend = now;
      }
    }
    return moving;
  }

  return {
    pos,
    get yaw() { return yaw; },
    place(x, y, z, yw) { pos.x = x; pos.y = y; pos.z = z; if (yw !== undefined) yaw = yw; vy = 0; },
    fix(x, y, z) { pos.x = x; pos.y = y; pos.z = z; vy = 0; },
    setTyping(t) { typing = t; if (t) for (const k in keys) keys[k] = false; },
    update,
  };
}
