/* LiteWorldsQuest art module: everything that is drawn, made by code, with no picture files.
   Textures are painted on canvases when the game starts; the world is laid out from a seed, so every player sees
   the same village. A builder takes a level's description of a thing and returns what the engine needs:
     art.setup(THREE, renderer, scene, env)            -> {update(dt, t)}       sky, sun, light, fog, ground
     art.hut(ctx, def)    -> {door}                     a log hut with a thatched roof, a door that swings, a room inside
     art.campfire(ctx, def), art.forest(ctx, def), art.fence(ctx, def), art.paths(ctx, def), art.prop(ctx, def),
     art.well(ctx, def) -> {use: mesh}, art.grass(ctx, def)
     art.character(ctx, look) -> {group, animate(dt, speed), emote(name), hold(name), setName(text), holdItem(right, left)}   our own figure
     art.creature(ctx, {kind: 'boar'|'wolf'|'spider', color, scale}) -> the same, for a beast (and barY)
   ctx = {THREE, scene, rng, solid(min, max, on), usable(mesh, data), every(fn(dt, t))}
   Units are metres; y is up; a thing whose "rot" is 0 faces -z (towards the camp's north). */
(function (G) {
  'use strict';
  const art = { api: 1 };

  /* --- a seeded random, so the village is the same for everyone -------------------------------------- */
  art.rng = function (seed) {
    let a = seed >>> 0;
    const r = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    r.range = (lo, hi) => lo + (hi - lo) * r();
    r.pick = list => list[Math.floor(r() * list.length)];
    return r;
  };

  /* --- painted textures -------------------------------------------------------------------------------- */
  let T = null;   /* THREE, set by setup */
  const cache = {};
  function canvas(n) { const c = document.createElement('canvas'); c.width = c.height = n; return [c, c.getContext('2d')]; }
  function tex(c, repeat) {
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4;
    if (repeat) t.repeat.set(repeat[0], repeat[1]);
    return t;
  }
  const shade = (hex, k) => { const n = parseInt(hex.slice(1), 16); const f = v => Math.max(0, Math.min(255, Math.round(v * k))); return 'rgb(' + f(n >> 16) + ',' + f((n >> 8) & 255) + ',' + f(n & 255) + ')'; };
  function speckle(x, n, size, rnd, colors, alpha) {
    for (let i = 0; i < n; i++) { x.globalAlpha = alpha * (0.4 + rnd() * 0.6); x.fillStyle = rnd.pick(colors); x.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 2, 1 + rnd() * 2); }
    x.globalAlpha = 1;
  }
  /* HAND-PAINTED, like the old WoW (tbuuol 2026-10-27: an own style, a bit round, the 2004 look): big soft blots of
     colour instead of fine noise, the light painted in from above (a bright upper edge, a dark seam below), strong
     saturated mid tones. Everything is drawn so it tiles: a blot near an edge is drawn again on the far side. */
  function wrap(size, x0, y0, r, draw) {
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
      const x = x0 + dx, y = y0 + dy;
      if (x + r < 0 || y + r < 0 || x - r > size || y - r > size) continue;
      draw(x, y);
    }
  }
  function blots(x, size, rnd, n, colors, r0, r1, alpha) {   /* soft round patches: the painter's broad strokes */
    for (let i = 0; i < n; i++) {
      const r = rnd.range(r0, r1), col = rnd.pick(colors), a = alpha * rnd.range(0.6, 1);
      wrap(size, rnd() * size, rnd() * size, r, (px, py) => {
        const g = x.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
        x.globalAlpha = a; x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2);
      });
    }
    x.globalAlpha = 1;
  }
  function strokes(x, size, rnd, n, colors, len0, len1, w0, w1, alpha, angle, jitter) {   /* short brush strokes */
    x.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const L = rnd.range(len0, len1), a = (angle || 0) + rnd.range(-(jitter || 0), jitter || 0), col = rnd.pick(colors), w = rnd.range(w0, w1), al = alpha * rnd.range(0.5, 1);
      wrap(size, rnd() * size, rnd() * size, L, (px, py) => {
        x.globalAlpha = al; x.strokeStyle = col; x.lineWidth = w;
        x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.sin(a) * L, py - Math.cos(a) * L); x.stroke();
      });
    }
    x.globalAlpha = 1;
  }
  function poly(x, cx, cy, r, sides, rnd, squash) {
    x.beginPath();
    for (let k = 0; k < sides; k++) { const an = k / sides * Math.PI * 2, rr = r * rnd.range(0.78, 1.08); x.lineTo(cx + Math.cos(an) * rr, cy + Math.sin(an) * rr * (squash || 1)); }
    x.closePath();
  }
  const painters = {
    ground(rnd) {   /* the world's ground (2026-10-29): painted, nearly white; the land's colour is in its vertices */
      const [c, x] = canvas(256); x.fillStyle = '#e4e0d6'; x.fillRect(0, 0, 256, 256);
      blots(x, 256, rnd, 70, ['#f2efe7', '#d4cfc2', '#ebe7dc', '#c9c3b4', '#faf8f2'], 22, 64, 0.4);
      blots(x, 256, rnd, 200, ['#efebe2', '#cdc7b8', '#f6f3ec'], 5, 13, 0.32);
      strokes(x, 256, rnd, 380, ['#ffffff', '#f4f1ea', '#fbf9f4'], 3, 7, 1.2, 2.2, 0.5, 0, 0.5);
      strokes(x, 256, rnd, 160, ['#b8b2a2', '#c4bead'], 3, 6, 1.2, 2, 0.45, 0, 0.5);
      return c;
    },
    grass(rnd) {
      const [c, x] = canvas(256); x.fillStyle = '#5b8c2c'; x.fillRect(0, 0, 256, 256);
      blots(x, 256, rnd, 70, ['#6fa335', '#4c7e24', '#80b343', '#5f9030', '#93bd4c', '#467520'], 22, 64, 0.38);
      blots(x, 256, rnd, 220, ['#78ab3c', '#4a7a23', '#8cbc4a', '#a3c95a'], 5, 13, 0.32);
      strokes(x, 256, rnd, 420, ['#9fcb5b', '#86b847', '#b2d76a'], 3, 7, 1.2, 2.2, 0.55, 0, 0.5);   /* painted blades, lit */
      strokes(x, 256, rnd, 160, ['#3d6b1c', '#4a7a23'], 3, 6, 1.2, 2, 0.45, 0, 0.5);
      return c;
    },
    dirt(rnd) {
      const [c, x] = canvas(256); x.fillStyle = '#8c6741'; x.fillRect(0, 0, 256, 256);
      blots(x, 256, rnd, 60, ['#9d7650', '#7a5534', '#a6805a', '#86603b', '#6c4b2d'], 18, 55, 0.4);
      strokes(x, 256, rnd, 140, ['#6a4a2c', '#b08a62'], 6, 16, 1, 2, 0.3, Math.PI / 2, 0.25);
      for (let i = 0; i < 70; i++) {   /* pebbles: a shadow below, the stone, a lit top */
        const px = rnd() * 256, py = rnd() * 256, r = rnd.range(2, 5.5);
        wrap(256, px, py, r + 3, (qx, qy) => {
          x.fillStyle = 'rgba(60,40,22,.55)'; x.beginPath(); x.ellipse(qx + 1, qy + 1.6, r * 1.1, r * 0.8, 0, 0, 7); x.fill();
          x.fillStyle = rnd.pick(['#a8957a', '#9a8a74', '#b5a184']); x.beginPath(); x.ellipse(qx, qy, r, r * 0.75, 0, 0, 7); x.fill();
          x.fillStyle = 'rgba(235,222,195,.6)'; x.beginPath(); x.ellipse(qx - r * 0.2, qy - r * 0.3, r * 0.55, r * 0.3, 0, 0, 7); x.fill();
        });
      }
      return c;
    },
    logs(rnd) {   /* horizontal logs, as a log cabin's wall: each one round, lit on top, dark in the seam below */
      const [c, x] = canvas(256), band = 32;
      for (let y = 0; y < 256; y += band) {
        const k = rnd.range(0.85, 1.1), g = x.createLinearGradient(0, y, 0, y + band);
        g.addColorStop(0, '#2a170b'); g.addColorStop(0.1, shade('#b07a43', k)); g.addColorStop(0.3, shade('#9a6a3a', k));
        g.addColorStop(0.7, shade('#74492a', k)); g.addColorStop(0.92, '#3a2212'); g.addColorStop(1, '#1e1006');
        x.fillStyle = g; x.fillRect(0, y, 256, band);
        x.lineCap = 'round';
        for (let i = 0; i < 18; i++) {   /* bark lines along the log, a lighter line above each dark one */
          const yy = y + rnd.range(6, band - 7), x0 = rnd() * 256, L = rnd.range(30, 110), w = rnd.range(1, 2.2);
          x.strokeStyle = 'rgba(45,25,10,.45)'; x.lineWidth = w; x.beginPath(); x.moveTo(x0, yy); x.lineTo(x0 + L, yy + rnd.range(-1.5, 1.5)); x.stroke();
          x.strokeStyle = 'rgba(210,160,100,.25)'; x.lineWidth = 1; x.beginPath(); x.moveTo(x0, yy - 1.5); x.lineTo(x0 + L * 0.8, yy - 1.5); x.stroke();
        }
        x.fillStyle = 'rgba(255,215,150,.18)'; x.fillRect(0, y + 4, 256, 2);   /* the lit ridge */
      }
      return c;
    },
    planks(rnd) {
      const [c, x] = canvas(256), w = 32;
      for (let i = 0; i < 8; i++) {
        const base = shade('#a8784a', rnd.range(0.8, 1.1));
        x.fillStyle = base; x.fillRect(i * w, 0, w, 256);
        const g = x.createLinearGradient(i * w, 0, i * w + w, 0);
        g.addColorStop(0, 'rgba(255,220,160,.28)'); g.addColorStop(0.18, 'rgba(255,220,160,0)'); g.addColorStop(0.8, 'rgba(40,20,5,0)'); g.addColorStop(1, 'rgba(40,20,5,.4)');
        x.fillStyle = g; x.fillRect(i * w, 0, w, 256);
        x.lineCap = 'round';
        for (let k = 0; k < 8; k++) {   /* long grain, painted */
          x.strokeStyle = 'rgba(70,40,18,' + rnd.range(0.18, 0.4) + ')'; x.lineWidth = rnd.range(1, 2); x.beginPath();
          const xx = i * w + rnd.range(5, w - 5); x.moveTo(xx, 0); x.bezierCurveTo(xx + rnd.range(-4, 4), 85, xx + rnd.range(-4, 4), 170, xx, 256); x.stroke();
        }
        x.fillStyle = '#2b170a'; x.fillRect(i * w + w - 2, 0, 2, 256);   /* the gap */
        const cut = rnd.range(30, 220); x.fillStyle = '#2b170a'; x.fillRect(i * w, cut, w, 2); x.fillStyle = 'rgba(255,220,160,.3)'; x.fillRect(i * w, cut + 2, w - 2, 1);
        if (rnd() < 0.6) {   /* a knot */
          const ky = rnd.range(20, 236), kx = i * w + rnd.range(9, w - 9);
          x.fillStyle = 'rgba(60,32,12,.7)'; x.beginPath(); x.ellipse(kx, ky, 3.5, 5, 0, 0, 7); x.fill();
          x.fillStyle = shade('#a8784a', 1.15); x.beginPath(); x.ellipse(kx - 0.6, ky - 1, 1.6, 2.4, 0, 0, 7); x.fill();
        }
        x.fillStyle = 'rgba(30,15,5,.6)'; x.beginPath(); x.arc(i * w + 6, cut + 9, 1.6, 0, 7); x.arc(i * w + w - 8, cut + 9, 1.6, 0, 7); x.fill();
      }
      return c;
    },
    thatch(rnd) {
      const [c, x] = canvas(256); x.fillStyle = '#9c7838'; x.fillRect(0, 0, 256, 256);
      for (let row = 0; row < 256; row += 32) {
        const g = x.createLinearGradient(0, row, 0, row + 32);
        g.addColorStop(0, '#e6c374'); g.addColorStop(0.35, '#c39a4f'); g.addColorStop(0.8, '#8f6a30'); g.addColorStop(1, '#4a3313');
        x.fillStyle = g; x.fillRect(0, row, 256, 32);
        x.lineCap = 'round';
        for (let i = 0; i < 150; i++) {   /* straw, combed downwards */
          const px = rnd() * 256, py = row + rnd.range(-2, 8), L = rnd.range(14, 28);
          x.strokeStyle = rnd.pick(['#f2d488', '#d8b265', '#b8913f', '#8a6528']); x.globalAlpha = rnd.range(0.45, 0.9); x.lineWidth = rnd.range(1, 2.2);
          x.beginPath(); x.moveTo(px, py); x.lineTo(px + rnd.range(-2.5, 2.5), py + L); x.stroke();
        }
        x.globalAlpha = 1;
        x.fillStyle = 'rgba(50,32,10,.55)'; x.fillRect(0, row + 29, 256, 3);   /* the shadow under each row's lip */
      }
      return c;
    },
    stone(rnd) {   /* fieldstones in dark mortar: each stone lit from the top left, shaded bottom right */
      const [c, x] = canvas(256); x.fillStyle = '#433f39'; x.fillRect(0, 0, 256, 256);
      const cell = 64;
      for (let gy = 0; gy < 256; gy += cell) for (let gx = 0; gx < 256; gx += cell) {
        const cx0 = gx + cell / 2 + rnd.range(-5, 5) + ((gy / cell) % 2) * cell / 2, cy0 = gy + cell / 2 + rnd.range(-4, 4), r = rnd.range(27, 33);
        const base = rnd.pick(['#9c968b', '#a39a8a', '#8f8d88', '#a8a092', '#948a7c']), sq = rnd.range(0.7, 0.95), seed = rnd() * 1e6;
        wrap(256, cx0, cy0, r + 4, (px, py) => {
          const rr = art.rng(seed);
          x.fillStyle = 'rgba(20,18,15,.7)'; poly(x, px + 2, py + 2.5, r, 8, rr, sq); x.fill();
          const r2 = art.rng(seed); poly(x, px, py, r, 8, r2, sq); x.fillStyle = base; x.fill();
          x.save(); const r3 = art.rng(seed); poly(x, px, py, r, 8, r3, sq); x.clip();
          const g = x.createLinearGradient(px - r, py - r, px + r, py + r);
          g.addColorStop(0, 'rgba(255,248,230,.55)'); g.addColorStop(0.45, 'rgba(255,248,230,0)'); g.addColorStop(0.7, 'rgba(30,25,20,0)'); g.addColorStop(1, 'rgba(30,25,20,.5)');
          x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2);
          x.restore();
        });
      }
      blots(x, 256, rnd, 40, ['#7d8a5a', '#6a6f4a'], 4, 10, 0.25);   /* a little moss */
      return c;
    },
    sand(rnd) {   /* the beach (Etappe zone 2): warm sand, ripples drawn by the wind, a few shells and pebbles */
      const [c, x] = canvas(256); x.fillStyle = '#e2c98f'; x.fillRect(0, 0, 256, 256);
      blots(x, 256, rnd, 70, ['#ecd6a0', '#d4b77c', '#f2e0b0', '#d9bf88', '#c9a96c'], 20, 60, 0.35);
      strokes(x, 256, rnd, 260, ['#c8a86e', '#f6e7bf'], 8, 22, 1, 2, 0.35, Math.PI / 2, 0.15);   /* ripples */
      for (let i = 0; i < 40; i++) {
        const px = rnd() * 256, py = rnd() * 256, r = rnd.range(1.5, 3.5);
        wrap(256, px, py, r + 2, (qx, qy) => {
          x.fillStyle = 'rgba(120,90,50,.35)'; x.beginPath(); x.ellipse(qx + 0.8, qy + 1.2, r, r * 0.7, 0, 0, 7); x.fill();
          x.fillStyle = rnd.pick(['#f7efe0', '#e8c8b8', '#d8d0c0', '#b8b0a0']); x.beginPath(); x.ellipse(qx, qy, r, r * 0.7, 0, 0, 7); x.fill();
        });
      }
      return c;
    },
    cloth(rnd) {
      const [c, x] = canvas(64); x.fillStyle = '#fff'; x.fillRect(0, 0, 64, 64);
      for (let i = 0; i < 64; i += 4) { x.fillStyle = 'rgba(0,0,0,.06)'; x.fillRect(i, 0, 2, 64); x.fillRect(0, i, 64, 2); }
      return c;
    },
    leaves(rnd) {   /* a canopy: dark depths, mid clumps, lit clumps on top, a few bright leaves */
      const [c, x] = canvas(128); x.fillStyle = '#2e5a1c'; x.fillRect(0, 0, 128, 128);
      blots(x, 128, rnd, 40, ['#22461a', '#2a5320'], 10, 22, 0.7);
      for (const [n, cols, r0, r1, a] of [[90, ['#3f7a28', '#4a8a2e', '#3a7024'], 5, 10, 0.85], [70, ['#64a23c', '#73b246', '#5c9a36'], 3, 7, 0.85], [40, ['#9ccf5e', '#b2dc70'], 1.5, 3.5, 0.8]]) {
        for (let i = 0; i < n; i++) {
          const r = rnd.range(r0, r1), col = rnd.pick(cols);
          wrap(128, rnd() * 128, rnd() * 128, r, (px, py) => { x.globalAlpha = a; x.fillStyle = col; x.beginPath(); x.ellipse(px, py, r, r * 0.8, rnd() * 3, 0, 7); x.fill(); });
        }
      }
      x.globalAlpha = 1; return c;
    },
    bark(rnd) {
      const [c, x] = canvas(64); x.fillStyle = '#5c3f27'; x.fillRect(0, 0, 64, 64);
      blots(x, 64, rnd, 12, ['#6d4b30', '#4a3120'], 6, 14, 0.5);
      x.lineCap = 'round';
      for (let i = 0; i < 26; i++) {
        const px = rnd() * 64;
        x.strokeStyle = 'rgba(35,22,12,.75)'; x.lineWidth = rnd.range(1.5, 3); x.beginPath(); x.moveTo(px, -4); x.bezierCurveTo(px + rnd.range(-4, 4), 20, px + rnd.range(-4, 4), 44, px, 68); x.stroke();
        x.strokeStyle = 'rgba(160,118,80,.45)'; x.lineWidth = 1; x.beginPath(); x.moveTo(px + 2, -4); x.lineTo(px + 2, 68); x.stroke();
      }
      return c;
    }
  };
  art.paint = name => painters[name] ? painters[name](art.rng(name.length * 977 + name.charCodeAt(0))) : null;   /* for previews and tests */
  /* one material per painted texture, made once; `bump` gives the surface depth in the light without a second picture */
  /* REAL TEXTURES (the Hybrid tier, 2026-10-21): where the game ships a photographed surface (Poly Haven, CC0) the
     material shows it with its normal map; the painted canvas stands in until the file has arrived, or for good
     where there is none. [real name, how many times finer than the painted one it repeats, turned a quarter] */
  const REAL = { grass: ['grass', 2], dirt: ['dirt', 1.5], logs: ['timber', 1, true], planks: ['planks', 1], thatch: ['thatch', 1],
                 stone: ['stone', 1], bark: ['bark', 1] };
  let assetURL = null;
  const pictures = {};
  art.useAssets = fn => { assetURL = fn; };
  function picture(name, part) {   /* one download per file, however many materials use it */
    const key = name + '.' + part;
    if (!pictures[key]) pictures[key] = new Promise(res => new T.TextureLoader().load(assetURL('tex.' + key), res, undefined, () => res(null)));
    return pictures[key];
  }
  function dressReal(m, real, repeat) {
    const [name, finer, turn] = real, rep = repeat ? [repeat[0] * finer, repeat[1] * finer] : [finer, finer];
    const own = (t, srgb) => { const c = t.clone(); c.wrapS = c.wrapT = T.RepeatWrapping; c.repeat.set(rep[0], rep[1]); c.anisotropy = 8;
      if (turn) c.rotation = Math.PI / 2; c.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace; c.needsUpdate = true; return c; };
    picture(name, 'color').then(t => { if (!t) return; m.map = own(t, true); m.bumpMap = null; m.needsUpdate = true; });
    picture(name, 'normal').then(t => { if (!t) return; m.normalMap = own(t, false); m.normalScale.set(1, 1); m.needsUpdate = true; });
  }
  function mat(name, opts) {
    const key = name + JSON.stringify(opts || {});
    if (cache[key]) return cache[key];
    const c = cache['c:' + name] || (cache['c:' + name] = painters[name](art.rng(name.length * 977 + name.charCodeAt(0))));
    const t = tex(c, opts && opts.repeat);
    /* the painted look carries its own light, so no bump and no photographed surface: those only where a level asks
       for them (opts.real, the real-world levels) */
    const m = new T.MeshStandardMaterial(Object.assign({ map: t, roughness: 1, metalness: 0 }, (opts && opts.m) || {}));
    if (assetURL && REAL[name] && opts && opts.real) dressReal(m, REAL[name], opts && opts.repeat);
    return (cache[key] = m);
  }
  art.mat = mat;
  const plain = (color, extra) => new T.MeshStandardMaterial(Object.assign({ color, roughness: 0.9, metalness: 0 }, extra || {}));
  function mesh(geo, material, shadow) {
    const m = new T.Mesh(geo, material);
    if (shadow !== false) { m.castShadow = true; m.receiveShadow = true; }
    return m;
  }
  /* a box UV'd in metres, so a texture keeps its size whatever the box's */
  function boxM(w, h, d, scale) {
    const g = new T.BoxGeometry(w, h, d), uv = g.attributes.uv, pos = g.attributes.position, nor = g.attributes.normal, s = scale || 1;
    for (let i = 0; i < uv.count; i++) {
      const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i));
      const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
      if (ny > 0.5) uv.setXY(i, px / s, pz / s); else if (nx > 0.5) uv.setXY(i, pz / s, py / s); else uv.setXY(i, px / s, py / s);
    }
    return g;
  }

  /* --- sky, light, ground ------------------------------------------------------------------------------ */
  /* THE HILLS: flat where the village is, rolling beyond. One function for the ground mesh, the forest, the creatures
     and walking (Etappe 3: the land outside the fence can be walked) */
  art.heightAt = function (flat) {
    flat = flat || 30;
    return (x, z) => { const d = Math.hypot(x, z), k = Math.max(0, Math.min(1, (d - flat) / 40)); return k * k * (Math.sin(x * 0.05) * 4 + Math.cos(z * 0.043) * 5 + Math.sin((x + z) * 0.11) * 1.5 + 3); };
  };
  /* THE GROUND OF A LEVEL: the village's hills (above), or a COAST (env.terrain 'coast', the Beach): the sea floor
     falling away north of env.shore, flat sand, and hills inland south of env.inland */
  /* the ground itself, under the water and the ships: the world without its decks (a ship's part is walked, not grown) */
  art.floorAt = function (env) {
    env = env || {};
    return env.terrain === 'world' ? art.terrainAt(Object.assign({}, env, { parts: (env.parts || []).filter(p => !p.over) })) : art.terrainAt(env);
  };
  art.terrainAt = function (env) {
    env = env || {};
    if (env.terrain === 'world') return worldTerrain(env);
    const [ox, oz] = env.at || [0, 0];   /* a zone's ground, moved to where it lies in the world */
    if (ox || oz) { const f = art.terrainAt(Object.assign({}, env, { at: null })); return (x, z) => f(x - ox, z - oz); }
    if (env.terrain === 'ship') {   /* the pirate ship's level: its decks over the open sea (env.ship as art.ship's def) */
      const sh = env.ship || {}, L = sh.length || 30, W = sh.beam || 8, D = sh.deck != null ? sh.deck : 1, AFT = L / 2 - 8, [px, pz] = sh.pos || [0, 0];
      const flip = ((sh.rot || 0) % 360 + 360) % 360 === 180 ? -1 : 1;   /* turned round: the quarterdeck at the other end */
      return (x, z) => { const lx = (x - px) * flip, lz = (z - pz) * flip; return Math.abs(lx) <= W / 2 && Math.abs(lz) <= L / 2 ? (lz >= AFT ? D + 2.1 : D) : -8; };
    }
    if (env.terrain !== 'coast') return art.heightAt(env.flat || 30);
    const shore = env.shore != null ? env.shore : -18, inland = env.inland != null ? env.inland : 45;
    return (x, z) => {
      let y = z < shore ? Math.max(-7, (z - shore) * 0.13) : Math.min(0.25, (z - shore) * 0.03) + Math.sin(x * 0.11) * Math.cos(z * 0.13) * 0.12 * Math.min(1, Math.max(0, (z - shore - 4) / 8));
      if (z > inland) { const k = Math.min(1, (z - inland) / 40); y += k * k * (Math.sin(x * 0.05) * 4 + Math.cos(z * 0.043) * 5 + 7); }
      return y;
    };
  };
  /* ONE WORLD (tbuuol 2026-10-28: "eine zusammenhängende Welt"): the zones' grounds side by side. env.parts: each a
     zone's terrain ({terrain, at, ...} as above) over a rect [x0, z0, x1, z1], faded into its neighbours over its band
     (metres inside the rect); a part with over: true (a ship's decks) is the ground wherever it is. env.passes: a valley
     cut through the hills between two points ({a, b, w: flat half-width, fall: metres to the hills, y: [ya, yb]}). */
  function worldTerrain(env) {
    const parts = (env.parts || []).map(p => ({ p, f: art.terrainAt(p), r: p.rect, band: p.band || 0.001 }));
    const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
    const passes = env.passes || [];
    return (x, z) => {
      let sum = 0, h = 0, best = null, bestIn = -1e9;
      for (const q of parts) {
        const r = q.r, inside = Math.min(x - r[0], r[2] - x, z - r[1], r[3] - z);
        if (q.p.over) { if (inside >= 0) return q.f(x, z); continue; }
        if (inside > bestIn) { bestIn = inside; best = q; }
        const w = smooth(inside / q.band);
        if (w > 0) { sum += w; h += w * q.f(x, z); }
      }
      h = sum > 0 ? h / sum : best ? best.f(x, z) : 0;
      for (const ps of passes) {
        const [ax, az] = ps.a, [bx, bz] = ps.b, vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2)), d = Math.hypot(x - ax - vx * t, z - az - vz * t);
        const k = 1 - smooth((d - (ps.w || 5)) / (ps.fall || 10));
        if (k > 0) { const y = ps.y ? ps.y[0] + (ps.y[1] - ps.y[0]) * t : 0; h += (y + Math.sin(x * 0.13) * Math.cos(z * 0.11) * 0.15 - h) * k; }
      }
      return h;
    };
  }
  /* what stays round the eye however far you walk (the horizon's ridges), moved by setup's update */
  let followers = [];
  art.setup = function (THREE, renderer, scene, env) {
    followers = [];
    T = THREE; env = env || {};
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = env.exposure || 1.05;
    const top = new THREE.Color(env.skyTop || '#4f86c6'), bottom = new THREE.Color(env.skyBottom || '#f3c99a');
    const sunDir = new THREE.Vector3().fromArray(env.sunDir || [-0.6, 0.35, -0.7]).normalize();
    const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: top }, bottom: { value: bottom }, sun: { value: sunDir }, sunColor: { value: new THREE.Color(env.sunColor || '#ffd9a0') } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; uniform vec3 sun; uniform vec3 sunColor; varying vec3 vDir;' +
        'void main(){ float h = clamp(vDir.y * 1.6 + 0.12, 0.0, 1.0); vec3 c = mix(bottom, top, pow(h, 0.7));' +
        ' float s = max(dot(vDir, sun), 0.0); c += sunColor * (pow(s, 900.0) * 3.0 + pow(s, 12.0) * 0.35);' +
        ' gl_FragColor = vec4(c, 1.0); }'
    }));
    sky.renderOrder = -1; sky.userData.keep = true; scene.add(sky);
    scene.fog = new THREE.Fog(env.fogColor || '#e2c7a4', (env.fog || [30, 140])[0], (env.fog || [30, 140])[1]);
    const hemi = new THREE.HemisphereLight(env.hemiSky || '#bcd4f0', env.hemiGround || '#5a4a32', env.hemi || 0.75); scene.add(hemi);
    const sunL = new THREE.DirectionalLight(env.sunColor || '#ffd9a0', env.sun || 2.2);
    sunL.position.copy(sunDir).multiplyScalar(60); sunL.castShadow = true;
    sunL.shadow.mapSize.set(2048, 2048); const sc = sunL.shadow.camera; sc.left = sc.bottom = -38; sc.right = sc.top = 38; sc.near = 1; sc.far = 160;
    sunL.shadow.bias = -0.0004; sunL.shadow.normalBias = 0.03;
    scene.add(sunL); scene.add(sunL.target);
    /* the ground: grass everywhere, rolling hills beyond the fence (flat where people walk) */
    const size = env.grounds ? 0 : env.ground === 0 ? 0 : env.ground || 260, seg = 96, rnd = art.rng(7);
    /* the world's grounds: one rect each, grass or sand, on one 4 m grid so neighbours meet without a crack */
    for (const gd of env.grounds || []) {
      const [x0, z0, x1, z1] = gd.rect, w = x1 - x0, d = z1 - z0, hill = art.floorAt(env);
      const g = new THREE.PlaneGeometry(w, d, Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(d / 4))); g.rotateX(-Math.PI / 2);
      g.translate(x0 + w / 2, 0, z0 + d / 2);
      const pos = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < pos.count; i++) { pos.setY(i, hill(pos.getX(i), pos.getZ(i)) - 0.001); uv.setXY(i, pos.getX(i) / 6, -pos.getZ(i) / 6); }
      g.computeVertexNormals();
      const ground = mesh(g, mat(gd.mat || 'grass', { repeat: [1, 1] }), false); ground.receiveShadow = true; scene.add(ground);
    }
    if (size) {
    const g = new THREE.PlaneGeometry(size, size, seg, seg); g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position, hill = art.terrainAt(env);
    for (let i = 0; i < pos.count; i++) pos.setY(i, hill(pos.getX(i), pos.getZ(i)) - 0.001);
    g.computeVertexNormals();
    const ground = mesh(g, mat(env.groundMat || 'grass', { repeat: [size / 6, size / 6] }), false); ground.receiveShadow = true; scene.add(ground);
    }
    /* clouds: soft puffs drifting slowly */
    /* clouds: wide, soft banks of many puffs, light on top and grey beneath, drifting slowly */
    const [cc, cx] = canvas(256);
    for (let i = 0; i < 26; i++) {
      const px = rnd.range(30, 226), py = rnd.range(80, 170), r = rnd.range(18, 46), gr = cx.createRadialGradient(px, py, 2, px, py, r);
      gr.addColorStop(0, 'rgba(250,246,240,.55)'); gr.addColorStop(1, 'rgba(250,246,240,0)'); cx.fillStyle = gr; cx.fillRect(0, 0, 256, 256);
    }
    const shadeG = cx.createLinearGradient(0, 80, 0, 200); shadeG.addColorStop(0, 'rgba(255,255,255,0)'); shadeG.addColorStop(1, 'rgba(120,124,136,.55)');
    cx.globalCompositeOperation = 'source-atop'; cx.fillStyle = shadeG; cx.fillRect(0, 0, 256, 256); cx.globalCompositeOperation = 'source-over';
    const cloudMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cc), fog: false, depthWrite: false, opacity: 0.6 });
    const clouds = [];
    for (let i = 0; i < 12; i++) {
      const s = new THREE.Sprite(cloudMat); const r = rnd.range(120, 260), a = rnd() * Math.PI * 2;
      s.position.set(Math.cos(a) * r, rnd.range(70, 110), Math.sin(a) * r); const w = rnd.range(110, 190); s.scale.set(w, w * 0.5, 1);
      scene.add(s); clouds.push(s);
    }
    return {
      sun: sunL,
      update(dt, t, eye) {
        for (const s of clouds) { s.position.x += dt * 0.8; if (s.position.x > 240) s.position.x = -240; }
        if (eye) for (const f of followers) { f.position.x = eye.x; f.position.z = eye.z; }
        if (eye) { sky.position.copy(eye); sunL.target.position.set(eye.x, 0, eye.z); sunL.position.copy(sunDir).multiplyScalar(60).add(sunL.target.position); }
      }
    };
  };

  /* --- a hut ------------------------------------------------------------------------------------------- */
  /* walls of logs on a stone footing, a thatched gable roof that overhangs, a plank floor, windows with shutters, a
     door that swings in, a chimney if asked, and a room inside (bed, table, stool, barrel, shelf, rug). Rotations are
     0, 90, 180 or 270, so every wall stays a box the engine can collide with. */
  art.hut = function (ctx, def) {
    const W = def.size[0], D = def.size[1], H = def.height || 2.6, th = 0.22, rot = ((def.rot || 0) % 360 + 360) % 360;
    const grp = new T.Group(), logs = mat('logs', { m: { bumpScale: 1.4 } }), stone = mat('stone'), planks = mat('planks');
    const cx = def.pos[0], cz = def.pos[1];
    const local = (x, z) => { /* local (door side = -z) to world */
      const r = rot * Math.PI / 180, c = Math.round(Math.cos(r)), s = Math.round(Math.sin(r));
      return [cx + x * c + z * s, cz - x * s + z * c];
    };
    const solidL = (x0, y0, z0, x1, y1, z1, on) => {   /* a local box, as a world box */
      const a = local(x0, z0), b = local(x1, z1);
      ctx.solid([Math.min(a[0], b[0]), y0, Math.min(a[1], b[1])], [Math.max(a[0], b[0]), y1, Math.max(a[1], b[1])], on);
    };
    const add = (m, x, y, z) => { m.position.set(x, y, z); grp.add(m); return m; };
    /* footing and floor */
    add(mesh(boxM(W + 0.3, 0.3, D + 0.3, 1.5), stone), 0, 0.15, 0);
    add(mesh(boxM(W - 0.1, 0.05, D - 0.1, 2), planks), 0, 0.31, 0);
    ctx.solid(...(() => { const a = local(-W / 2 - 0.15, -D / 2 - 0.15), b = local(W / 2 + 0.15, D / 2 + 0.15); return [[Math.min(a[0], b[0]), 0, Math.min(a[1], b[1])], [Math.max(a[0], b[0]), 0.33, Math.max(a[1], b[1])]]; })());
    /* walls: back, left, right whole; front with a door gap */
    const wall = (w, h, d, x, y, z) => { const m = add(mesh(boxM(w, h, d, 2.2), logs), x, y, z); return m; };
    const y0 = 0.33, wy = y0 + H / 2;
    wall(W, H, th, 0, wy, D / 2 - th / 2); solidL(-W / 2, y0, D / 2 - th, W / 2, y0 + H, D / 2);
    wall(th, H, D, -W / 2 + th / 2, wy, 0); solidL(-W / 2, y0, -D / 2, -W / 2 + th, y0 + H, D / 2);
    wall(th, H, D, W / 2 - th / 2, wy, 0); solidL(W / 2 - th, y0, -D / 2, W / 2, y0 + H, D / 2);
    const dw = 1.1, dh = 2.05, side = (W - dw) / 2;
    wall(side, H, th, -W / 2 + side / 2, wy, -D / 2 + th / 2); solidL(-W / 2, y0, -D / 2, -dw / 2, y0 + H, -D / 2 + th);
    wall(side, H, th, W / 2 - side / 2, wy, -D / 2 + th / 2); solidL(dw / 2, y0, -D / 2, W / 2, y0 + H, -D / 2 + th);
    wall(dw, H - dh, th, 0, y0 + dh + (H - dh) / 2, -D / 2 + th / 2);
    /* corner posts, as notched log ends */
    const postM = mat('bark');
    for (const [px, pz] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]]) add(mesh(new T.CylinderGeometry(0.16, 0.18, H + 0.1, 8), postM), px, wy, pz);
    /* windows: dark glass in a frame, with open shutters */
    const frameM = plain('#3b2814'), glassM = new T.MeshStandardMaterial({ color: '#2a3a44', roughness: 0.2, metalness: 0.1, emissive: '#ffb45a', emissiveIntensity: def.lit ? 0.5 : 0.05 });
    const shutterM = plain(def.trim || '#5b7a3a');
    const windowAt = (x, z, along) => {   /* along: 'x' for a wall facing z, 'z' for one facing x */
      const g = new T.Group(), out = along === 'x' ? 0 : 1;
      const fr = mesh(new T.BoxGeometry(along === 'x' ? 0.9 : th + 0.06, 0.8, along === 'x' ? th + 0.06 : 0.9), frameM); g.add(fr);
      const gl = mesh(new T.BoxGeometry(along === 'x' ? 0.72 : th + 0.08, 0.62, along === 'x' ? th + 0.08 : 0.72), glassM, false); g.add(gl);
      for (const sgn of [-1, 1]) {
        const sh = mesh(new T.BoxGeometry(along === 'x' ? 0.42 : 0.04, 0.78, along === 'x' ? 0.04 : 0.42), shutterM);
        if (along === 'x') sh.position.set(sgn * 0.68, 0, (z > 0 ? 1 : -1) * (th / 2 + 0.04)); else sh.position.set((x > 0 ? 1 : -1) * (th / 2 + 0.04), 0, sgn * 0.68);
        g.add(sh);
      }
      g.position.set(x, y0 + 1.45, z); grp.add(g); void out;
    };
    windowAt(-W / 2 + th / 2, 0, 'z'); windowAt(W / 2 - th / 2, 0, 'z');
    if (W > 4.2) { windowAt(-W / 2 + side / 2, -D / 2 + th / 2, 'x'); windowAt(W / 2 - side / 2, -D / 2 + th / 2, 'x'); }
    /* the roof: two thatched slopes and log gables */
    /* each slope runs from the ridge through the top of its wall and on past it by the overhang */
    const over = 0.45, rise = def.roofRise || 1.6, half = D / 2 + over, k = rise / (D / 2), slope = half * Math.hypot(1, k), ang = Math.atan(k);
    const thatch = mat('thatch', { repeat: [W / 1.5, slope / 1.5], m: { bumpScale: 2.2, side: T.DoubleSide } });
    for (const sgn of [-1, 1]) {
      const r = mesh(new T.BoxGeometry(W + over * 2, 0.18, slope), thatch);
      r.position.set(0, y0 + H + rise - k * half / 2 + 0.09, sgn * half / 2); r.rotation.x = sgn * ang; grp.add(r);
    }
    const ridge = mesh(new T.CylinderGeometry(0.14, 0.14, W + over * 2 + 0.1, 8), postM); ridge.rotation.z = Math.PI / 2; add(ridge, 0, y0 + H + rise + 0.05, 0);
    const gableShape = new T.Shape(); gableShape.moveTo(-D / 2, 0); gableShape.lineTo(D / 2, 0); gableShape.lineTo(0, rise); gableShape.closePath();
    const gableGeo = new T.ExtrudeGeometry(gableShape, { depth: th, bevelEnabled: false });
    for (const sgn of [-1, 1]) { const gm = mesh(gableGeo, logs); gm.rotation.y = Math.PI / 2; gm.position.set(sgn * (W / 2) - (sgn > 0 ? th : 0), y0 + H, 0); grp.add(gm); }
    if (def.chimney) {
      add(mesh(boxM(0.6, H + rise + 0.8, 0.6, 1), stone), W / 2 - 0.6, y0 + (H + rise + 0.8) / 2, D / 4);
      solidL(W / 2 - 0.9, y0, D / 4 - 0.3, W / 2 - 0.3, y0 + H, D / 4 + 0.3);
    }
    /* inside */
    const wood = plain('#7a5232'), dark = plain('#4b3220');
    const inside = def.inside || ['bed', 'table', 'barrel'];
    if (inside.indexOf('rug') >= 0) add(mesh(new T.BoxGeometry(Math.min(2.2, W - 1), 0.02, Math.min(1.6, D - 1.2)), mat('cloth', { m: { color: def.rug || '#8e3b2e', bumpScale: 0.3 } }), false), 0, 0.345, 0.1);
    if (inside.indexOf('bed') >= 0) {
      const bx = -W / 2 + 0.75, bz = D / 2 - 1.2;
      add(mesh(new T.BoxGeometry(1.0, 0.4, 2.0), wood), bx, 0.53, bz);
      add(mesh(new T.BoxGeometry(0.9, 0.14, 1.85), mat('cloth', { m: { color: def.blanket || '#3f5f8f', bumpScale: 0.3 } })), bx, 0.8, bz + 0.05);
      add(mesh(new T.BoxGeometry(0.6, 0.12, 0.35), plain('#e8e0d0')), bx, 0.9, bz + 0.75);
      solidL(bx - 0.5, 0.33, bz - 1, bx + 0.5, 0.85, bz + 1);
    }
    if (inside.indexOf('table') >= 0) {
      const tx = W / 2 - 1.0, tz = D / 2 - 1.1;
      add(mesh(new T.BoxGeometry(1.0, 0.07, 0.8), wood), tx, 1.1, tz);
      for (const [lx, lz] of [[-0.42, -0.32], [0.42, -0.32], [-0.42, 0.32], [0.42, 0.32]]) add(mesh(new T.BoxGeometry(0.07, 0.75, 0.07), dark), tx + lx, 0.7, tz + lz);
      add(mesh(new T.CylinderGeometry(0.2, 0.2, 0.05, 10), wood), tx - 0.2, 0.75, tz - 0.75);
      add(mesh(new T.CylinderGeometry(0.06, 0.05, 0.16, 8), plain('#c9c2b0')), tx + 0.2, 1.22, tz);   /* a mug */
      solidL(tx - 0.5, 0.33, tz - 0.4, tx + 0.5, 1.14, tz + 0.4);
    }
    if (inside.indexOf('barrel') >= 0) {
      const b = art.barrel(); b.position.set(W / 2 - 0.55, 0.33, -D / 2 + 0.75); grp.add(b);
      solidL(W / 2 - 0.9, 0.33, -D / 2 + 0.4, W / 2 - 0.2, 1.2, -D / 2 + 1.1);
    }
    if (inside.indexOf('shelf') >= 0) {
      const sx = -W / 2 + 0.25;
      for (const hy of [1.0, 1.6]) add(mesh(new T.BoxGeometry(0.3, 0.05, 1.4), wood), sx, hy, -0.3);
      for (let i = 0; i < 4; i++) add(mesh(new T.CylinderGeometry(0.07, 0.07, 0.22, 8), plain(['#7b3b2a', '#3a5a7b', '#6b6b3a', '#c2a05a'][i])), sx, 1.14, -0.8 + i * 0.32);
    }
    /* the door: hinged on its left, swings inwards */
    const pivot = new T.Group(); pivot.userData.keep = true; const hingeL = local(-dw / 2, -D / 2 + th / 2);
    pivot.position.set(-dw / 2, y0, -D / 2 + th / 2); grp.add(pivot);
    const panel = mesh(boxM(dw - 0.04, dh - 0.02, 0.08, 1), mat('planks', { m: { color: def.doorColor || '#c8a27a' } }));
    panel.position.set(dw / 2, dh / 2, 0); pivot.add(panel);
    const knob = mesh(new T.SphereGeometry(0.05, 8, 6), plain('#2c2c2c', { metalness: 0.6, roughness: 0.4 })); knob.position.set(dw - 0.16, dh / 2, -0.07); pivot.add(knob);
    void hingeL;
    /* a lived-in hut has a warm light inside (one light per lit hut: lights cost on every pixel they reach) */
    if (def.lit) { const l = new T.PointLight('#ffb36b', 9, 7, 1.5); l.position.set(0, y0 + H - 0.5, 0.3); grp.add(l); }
    /* a lantern by the door */
    if (def.lantern !== false) {
      const lan = art.lantern(); lan.position.set(dw / 2 + 0.4, y0 + 2.0, -D / 2 - 0.12); grp.add(lan);
    }
    grp.position.set(cx, 0, cz); grp.rotation.y = rot * Math.PI / 180; ctx.scene.add(grp);
    /* the door's closed box, in world space, for the engine (off while open) */
    const a = local(-dw / 2, -D / 2), b = local(dw / 2, -D / 2 + th);
    return { group: grp, door: def.door ? { id: def.door.id, label: def.door.label || 'Door', opens: def.door.opens || 'hand', key: def.door.key,
             pivot, panel, swing: -1.7, box: { min: [Math.min(a[0], b[0]), y0, Math.min(a[1], b[1])], max: [Math.max(a[0], b[0]), y0 + dh, Math.max(a[1], b[1])] } } : null };
  };

  art.barrel = function () {
    const g = new T.Group(), body = mesh(new T.CylinderGeometry(0.3, 0.3, 0.8, 14), mat('planks', { m: { color: '#a57a50' } }));
    body.position.y = 0.4; g.add(body);
    const hoop = plain('#3a3a3a', { metalness: 0.5, roughness: 0.5 });
    for (const y of [0.12, 0.4, 0.68]) { const h = mesh(new T.TorusGeometry(0.31, 0.02, 6, 18), hoop); h.rotation.x = Math.PI / 2; h.position.y = y; g.add(h); }
    return g;
  };
  let lanternM = null;   /* one pair of materials for every lantern, so a street of them joins into two draw calls */
  art.lantern = function () {
    lanternM = lanternM || { metal: plain('#2d2a26', { metalness: 0.6, roughness: 0.5 }), glow: new T.MeshStandardMaterial({ color: '#ffcf7a', emissive: '#ffb347', emissiveIntensity: 2.2 }) };
    const g = new T.Group(), metal = lanternM.metal;
    const glow = mesh(new T.BoxGeometry(0.16, 0.22, 0.16), lanternM.glow, false);
    g.add(glow); const cap = mesh(new T.ConeGeometry(0.15, 0.12, 4), metal); cap.position.y = 0.17; cap.rotation.y = Math.PI / 4; g.add(cap);
    const base = mesh(new T.BoxGeometry(0.18, 0.04, 0.18), metal); base.position.y = -0.13; g.add(base);
    return g;
  };

  /* --- the campfire -------------------------------------------------------------------------------------- */
  /* a ring of stones, crossed logs, glowing embers, flames, sparks and smoke as particles, and a light that flickers */
  /* --- the sea (zone 2) ----------------------------------------------------------------------------------- */
  /* one big sheet at def.y: deep blue far out, turquoise in the shallows and foam where it meets the sand (by the depth
     of the ground under each point), rocked by slow waves in the vertex shader */
  art.water = function (ctx, def) {
    const size = def.size || 360, seg = 120, y0 = def.y != null ? def.y : -0.35, height = ctx.floor || ctx.height || (() => -5);
    const g = new T.PlaneGeometry(size, size, seg, seg); g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
    const deep = new T.Color(def.deep || '#1f5f9a'), shallow = new T.Color(def.shallow || '#3fc2c0'), foam = new T.Color('#f4fbf6'), c = new T.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + (def.pos ? def.pos[0] : 0), z = pos.getZ(i) + (def.pos ? def.pos[1] : 0), d = y0 - height(x, z);
      c.copy(shallow).lerp(deep, Math.max(0, Math.min(1, d / 3.5)));
      if (d < 0.35) c.lerp(foam, Math.max(0, 1 - d / 0.35) * 0.85);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    const time = { value: 0 };
    const m = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, transparent: true, opacity: 0.86 });
    m.onBeforeCompile = sh => {
      sh.uniforms.uTime = time;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n transformed.y += sin(position.x * 0.35 + uTime * 1.1) * 0.06 + cos(position.z * 0.27 + uTime * 0.8) * 0.06;');
    };
    const w = new T.Mesh(g, m); w.position.set(def.pos ? def.pos[0] : 0, y0, def.pos ? def.pos[1] : 0); w.receiveShadow = true; w.renderOrder = 2;
    ctx.scene.add(w);
    ctx.every((dt, t) => { time.value = t; });
    return w;
  };
  /* a dock: planks on posts, from one point to another along x or z, walkable (its deck is solid) */
  art.dock = function (ctx, def) {
    const [x0, z0] = def.from, [x1, z1] = def.to, w = def.width || 2.4, y = def.y != null ? def.y : 0.35, alongZ = Math.abs(z1 - z0) >= Math.abs(x1 - x0);
    const len = alongZ ? Math.abs(z1 - z0) : Math.abs(x1 - x0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, g = new T.Group();
    const deck = mesh(boxM(alongZ ? w : len, 0.16, alongZ ? len : w, 1), mat('planks', { m: { color: '#c9a274' } })); deck.position.set(0, y - 0.08, 0); g.add(deck);
    const postM = mat('bark');
    for (let k = 0; k <= len; k += 2.5) for (const side of [-1, 1]) {
      const p = mesh(new T.CylinderGeometry(0.12, 0.14, 4, 7), postM), along = -len / 2 + k;
      p.position.set(alongZ ? side * (w / 2 - 0.1) : along, y - 2, alongZ ? along : side * (w / 2 - 0.1)); g.add(p);
    }
    g.position.set(cx, 0, cz); ctx.scene.add(g);
    ctx.solid([cx - (alongZ ? w : len) / 2, y - 0.4, cz - (alongZ ? len : w) / 2], [cx + (alongZ ? w : len) / 2, y, cz + (alongZ ? len : w) / 2]);
    return g;
  };

  /* --- a pirate ship (zone 2's dungeon, and offshore at the Beach) -------------------------------------------- */
  /* bow towards -z (rot 0; 90/180/270 turn it), deck at def.deck. The hull widens from a pointed bow to a square stern
     and narrows below the deck; a rail all round; at the stern a raised quarterdeck with stairs either side, the
     captain's cabin under it and the wheel on it; two masts with yards, billowing sails and a black flag; cannons
     along both sides. def.walk: the deck, the quarterdeck, the stairs and the rails are solid. Returns {deck, aft}. */
  art.ship = function (ctx, def) {
    const L = def.length || 30, W = def.beam || 8, D = def.deck != null ? def.deck : 1.6, rot = ((def.rot || 0) % 360 + 360) % 360;
    const [px, pz] = def.pos || [0, 0], g = new T.Group(), AFT = L / 2 - 8, Q = 2.1;   /* quarterdeck from AFT to the stern, Q high */
    const half = z => z > -L / 2 + 8 ? W / 2 : Math.max(0.15, W / 2 * Math.sqrt(Math.max(0, (z + L / 2) / 8)));
    const shape = new T.Shape(); shape.moveTo(-W / 2, L / 2);   /* the shape's y is the ship's z */
    for (let z = L / 2; z >= -L / 2; z -= 1) shape.lineTo(-half(z), z);
    for (let z = -L / 2; z <= L / 2; z += 1) shape.lineTo(half(z), z);
    const hull = new T.ExtrudeGeometry(shape, { depth: 3.6, bevelEnabled: false, curveSegments: 1 });
    hull.rotateX(Math.PI / 2);   /* y -> z, and extruded downwards */
    const hp = hull.attributes.position;
    for (let i = 0; i < hp.count; i++) { const y = hp.getY(i), k = Math.min(1, -y / 3.6); hp.setX(i, hp.getX(i) * (1 - 0.38 * k * k)); }
    hull.computeVertexNormals();
    const hullM = mat('planks', { m: { color: '#6a4026' } }), deckM = mat('planks', { m: { color: '#b88a5a' } }), dark = plain('#2a1a10');
    const hm = mesh(hull, hullM); hm.position.y = D; g.add(hm);
    const band = mesh(hull.clone(), plain('#b8902f')); band.scale.set(1.012, 0.08, 1.004); band.position.y = D - 0.35; g.add(band);   /* a gilded band */
    const deck = new T.ShapeGeometry(shape); deck.rotateX(Math.PI / 2);
    const dm = mesh(deck, mat('planks', { m: { color: '#b88a5a', side: T.DoubleSide } })); dm.position.y = D + 0.01; g.add(dm);
    /* the rail */
    const railM = mat('planks', { m: { color: '#5a3520' } });
    const rails = [];
    /* def.gaps: [[z0, z1, side]] open in the rail, where a gangplank comes aboard (side -1 port, +1 starboard) */
    const gap = (z, sx) => (def.gaps || []).some(gp => gp[2] === sx && z >= gp[0] && z < gp[1]);
    for (let z = -L / 2 + 1; z < L / 2; z += 1) for (const sx of [-1, 1]) {
      if (gap(z, sx)) continue;
      const za = z, zb = z + 1, xa = sx * half(za), xb = sx * half(zb), len = Math.hypot(xb - xa, zb - za);
      const r = mesh(new T.BoxGeometry(0.14, 0.9, len + 0.04), railM); r.position.set((xa + xb) / 2, D + (za >= AFT ? Q : 0) + 0.45, (za + zb) / 2);
      r.rotation.y = Math.atan2(xb - xa, zb - za); g.add(r); rails.push([xa, za, xb, zb]);
    }
    const stern = mesh(new T.BoxGeometry(W, 0.9, 0.14), railM); stern.position.set(0, D + Q + 0.45, L / 2 - 0.07); g.add(stern);
    /* quarterdeck, its front wall with the cabin door, stairs at both sides */
    const qd = mesh(boxM(W, 0.2, L / 2 - AFT, 1), deckM); qd.position.set(0, D + Q - 0.1, (AFT + L / 2) / 2); g.add(qd);
    const front = mesh(boxM(W - 3.2, Q, 0.2, 1), hullM); front.position.set(0, D + Q / 2, AFT); g.add(front);
    const door = mesh(new T.BoxGeometry(1.1, 1.8, 0.05), dark); door.position.set(0, D + 0.9, AFT - 0.12); g.add(door);
    for (const sx of [-1, 1]) for (let k = 0; k < 5; k++) {
      const st = mesh(boxM(1.4, Q * (k + 1) / 5, 0.5, 1), deckM); st.position.set(sx * (W / 2 - 0.85), D + Q * (k + 1) / 10, AFT - 2.4 + k * 0.5); g.add(st);
    }
    /* the wheel */
    const wheel = new T.Group(); wheel.position.set(0, D + Q + 1.0, AFT + 2.2); g.add(wheel);
    wheel.add(mesh(new T.TorusGeometry(0.45, 0.05, 6, 16), plain('#6b4a2e')));
    for (let i = 0; i < 8; i++) { const sp = mesh(new T.CylinderGeometry(0.025, 0.025, 1.15, 5), plain('#6b4a2e')); sp.rotation.z = i * Math.PI / 8; wheel.add(sp); }
    const post = mesh(new T.BoxGeometry(0.2, 1.0, 0.2), railM); post.position.set(0, D + Q + 0.5, AFT + 2.4); g.add(post);
    /* masts, yards, sails, the flag */
    const sailM = mat('cloth', { m: { color: def.sails || '#d9cfb4', side: T.DoubleSide } });
    for (const [mz, mh] of [[-4, 15], [4.5, 13]]) {
      const mast = mesh(new T.CylinderGeometry(0.18, 0.26, mh, 8), mat('bark', { m: { color: '#8a6040' } })); mast.position.set(0, D + mh / 2, mz); g.add(mast);
      for (const [yy, ww] of [[mh * 0.55, W * 1.2], [mh * 0.85, W * 0.9]]) {
        const yard = mesh(new T.CylinderGeometry(0.09, 0.09, ww, 6), mat('bark', { m: { color: '#8a6040' } })); yard.rotation.z = Math.PI / 2; yard.position.set(0, D + yy, mz - 0.2); g.add(yard);
        const sg = new T.PlaneGeometry(ww * 0.92, mh * 0.27, 8, 4), sp2 = sg.attributes.position;
        for (let i = 0; i < sp2.count; i++) { const u = sp2.getX(i) / (ww * 0.46), v = sp2.getY(i) / (mh * 0.135); sp2.setZ(i, -0.9 * (1 - u * u) * (1 - 0.3 * v * v)); }   /* billowing */
        sg.computeVertexNormals();
        const sail = mesh(sg, sailM); sail.position.set(0, D + yy - mh * 0.14, mz - 0.25); g.add(sail);
      }
      if (mz < 0) {   /* the black flag with a skull */
        const [fc, fx] = canvas(128); fc.height = 80; fx.fillStyle = '#111'; fx.fillRect(0, 0, 128, 80);
        fx.fillStyle = '#eee'; fx.beginPath(); fx.arc(64, 34, 16, 0, 7); fx.fill(); fx.fillRect(56, 44, 16, 10);
        fx.fillStyle = '#111'; fx.beginPath(); fx.arc(58, 33, 4, 0, 7); fx.arc(70, 33, 4, 0, 7); fx.fill();
        fx.strokeStyle = '#eee'; fx.lineWidth = 6; fx.beginPath(); fx.moveTo(34, 58); fx.lineTo(94, 74); fx.moveTo(94, 58); fx.lineTo(34, 74); fx.stroke();
        const ft = new T.CanvasTexture(fc); ft.colorSpace = T.SRGBColorSpace;
        const flag = new T.Mesh(new T.PlaneGeometry(1.8, 1.1), new T.MeshStandardMaterial({ map: ft, side: T.DoubleSide, roughness: 1 }));
        flag.position.set(0.95, D + mh + 0.4, mz); flag.rotation.y = Math.PI / 2; g.add(flag);
        ctx.every((dt, t) => { flag.rotation.y = Math.PI / 2 + Math.sin(t * 2.2) * 0.12; });
      }
    }
    /* cannons along both sides */
    for (const sx of [-1, 1]) for (const cz of [-6, -2, 2]) {
      const c = new T.Group(); c.position.set(sx * (half(cz) - 0.8), D + 0.35, cz); c.rotation.z = sx * Math.PI / 2; g.add(c);
      c.add(mesh(new T.CylinderGeometry(0.16, 0.22, 1.3, 10), plain('#2b2b2e', { metalness: 0.7, roughness: 0.4 })));
      const cart = mesh(new T.BoxGeometry(0.5, 0.35, 0.6), plain('#5a3520')); cart.position.set(sx * 0.05, -0.15, 0); cart.rotation.z = -c.rotation.z; c.add(cart);
    }
    g.position.set(px, 0, pz); g.rotation.y = -rot * Math.PI / 180; if (def.list) g.rotation.z = def.list;   /* a wreck lies over */
    ctx.scene.add(g);
    /* solid where it is walked (the dungeon): in the level's frame, for rot 0 or 180 */
    if (def.walk) {
      /* the ship's own frame to the level's (the group turns by -rot): a quarter turn keeps every box a box */
      const turn = (x, z) => rot === 90 ? [-z, x] : rot === 180 ? [-x, -z] : rot === 270 ? [z, -x] : [x, z];
      const S = (x0, y0, z0, x1, y1, z1) => { const [ax, az] = turn(x0, z0), [bx, bz] = turn(x1, z1);
        ctx.solid([px + Math.min(ax, bx), y0, pz + Math.min(az, bz)], [px + Math.max(ax, bx), y1, pz + Math.max(az, bz)]); };
      for (let z = -L / 2; z < AFT; z += 1) { const w = half(z + 0.5); S(-w, D - 1, z, w, D, z + 1); }
      S(-W / 2, D + Q - 1, AFT, W / 2, D + Q, L / 2);                      /* the quarterdeck */
      S(-W / 2 + 1.6, D, AFT - 0.1, W / 2 - 1.6, D + Q, AFT + 0.1);        /* its front wall (the stairs left free) */
      for (const sx of [-1, 1]) for (let k = 0; k < 5; k++) { const x0 = sx * (W / 2 - 1.55), x1 = sx * (W / 2 - 0.15); S(x0, D, AFT - 2.65 + k * 0.5, x1, D + Q * (k + 1) / 5, AFT - 2.15 + k * 0.5); }
      for (const [xa, za, xb, zb] of rails) { const yb = D + (za >= AFT ? Q : 0); S(Math.min(xa, xb) - 0.08, yb, za, Math.max(xa, xb) + 0.08, yb + 1.1, zb); }
      S(-W / 2, D + Q, L / 2 - 0.15, W / 2, D + Q + 1.1, L / 2);
      for (const mz of [-4, 4.5]) S(-0.3, D, mz - 0.3, 0.3, D + 12, mz + 0.3);
    }
    return { group: g, deck: D, aft: AFT, quarter: D + Q };
  };

  art.campfire = function (ctx, def) {
    const g = new T.Group(), [x0, z0] = def.pos, rnd = art.rng(42);
    const stone = mat('stone');
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2, s = mesh(new T.DodecahedronGeometry(rnd.range(0.18, 0.26), 0), stone);
      s.position.set(Math.cos(a) * 0.85, 0.12, Math.sin(a) * 0.85); s.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3); s.scale.y = 0.7; g.add(s);
    }
    const bark = mat('bark');
    for (let i = 0; i < 5; i++) {
      const l = mesh(new T.CylinderGeometry(0.08, 0.09, 1.1, 7), bark); const a = i / 5 * Math.PI * 2;
      l.position.set(Math.cos(a) * 0.18, 0.28, Math.sin(a) * 0.18); l.rotation.z = Math.cos(a) * 1.0; l.rotation.x = Math.sin(a) * 1.0; g.add(l);
    }
    const bed = mesh(new T.CylinderGeometry(0.55, 0.6, 0.06, 16), new T.MeshStandardMaterial({ color: '#2a1a10', emissive: '#ff4a10', emissiveIntensity: 0.9 }), false);
    bed.position.y = 0.04; bed.userData.keep = true; g.add(bed);
    g.position.set(x0, 0, z0); ctx.scene.add(g);
    ctx.solid([x0 - 1.05, 0, z0 - 1.05], [x0 + 1.05, 0.5, z0 + 1.05]);
    const light = new T.PointLight('#ff8a3a', 25, 18, 1.6); light.position.set(x0, 1.2, z0); ctx.scene.add(light);
    /* particles: one soft dot, three systems */
    const [c, x] = canvas(64); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64); const dot = new T.CanvasTexture(c);
    function system(n, size, additive, life, spawn) {
      const geo = new T.BufferGeometry(), p = new Float32Array(n * 3), col = new Float32Array(n * 3);
      geo.setAttribute('position', new T.BufferAttribute(p, 3)); geo.setAttribute('color', new T.BufferAttribute(col, 3));
      const m = new T.PointsMaterial({ size, map: dot, transparent: true, depthWrite: false, vertexColors: true,
        blending: additive ? T.AdditiveBlending : T.NormalBlending, opacity: additive ? 1 : 0.35 });
      const pts = new T.Points(geo, m); pts.frustumCulled = false; ctx.scene.add(pts);
      const age = new Float32Array(n), vel = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { age[i] = rnd() * life; spawn(i, p, vel); }
      return { n, p, col, age, vel, life, geo, spawn };
    }
    const flames = system(90, 0.55, true, 0.9, (i, p, v) => { const a = rnd() * 6.3, r = rnd() * 0.32; p[i * 3] = x0 + Math.cos(a) * r; p[i * 3 + 1] = 0.15; p[i * 3 + 2] = z0 + Math.sin(a) * r; v[i * 3] = (rnd() - 0.5) * 0.2; v[i * 3 + 1] = rnd.range(0.8, 1.6); v[i * 3 + 2] = (rnd() - 0.5) * 0.2; });
    const sparks = system(30, 0.08, true, 2.2, (i, p, v) => { p[i * 3] = x0 + (rnd() - 0.5) * 0.4; p[i * 3 + 1] = 0.4; p[i * 3 + 2] = z0 + (rnd() - 0.5) * 0.4; v[i * 3] = (rnd() - 0.5) * 0.6; v[i * 3 + 1] = rnd.range(1.2, 2.6); v[i * 3 + 2] = (rnd() - 0.5) * 0.6; });
    const smoke = system(40, 1.6, false, 5, (i, p, v) => { p[i * 3] = x0 + (rnd() - 0.5) * 0.3; p[i * 3 + 1] = 1.2; p[i * 3 + 2] = z0 + (rnd() - 0.5) * 0.3; v[i * 3] = rnd.range(0.05, 0.3); v[i * 3 + 1] = rnd.range(0.5, 0.9); v[i * 3 + 2] = (rnd() - 0.5) * 0.15; });
    const step = (S, dt, color) => {
      for (let i = 0; i < S.n; i++) {
        S.age[i] += dt;
        if (S.age[i] > S.life) { S.age[i] = 0; S.spawn(i, S.p, S.vel); }
        const k = S.age[i] / S.life;
        S.p[i * 3] += S.vel[i * 3] * dt; S.p[i * 3 + 1] += S.vel[i * 3 + 1] * dt; S.p[i * 3 + 2] += S.vel[i * 3 + 2] * dt;
        color(i, k, S.col);
      }
      S.geo.attributes.position.needsUpdate = true; S.geo.attributes.color.needsUpdate = true;
    };
    ctx.every((dt, t) => {
      step(flames, dt, (i, k, c) => { const f = 1 - k; c[i * 3] = 1.0 * f + 0.2; c[i * 3 + 1] = 0.55 * f * f; c[i * 3 + 2] = 0.12 * f * f * f; /* drawn in toward the middle as it rises */
        flames.p[i * 3] += (x0 - flames.p[i * 3]) * dt * 1.6; flames.p[i * 3 + 2] += (z0 - flames.p[i * 3 + 2]) * dt * 1.6; });
      step(sparks, dt, (i, k, c) => { const f = Math.max(0, 1 - k); c[i * 3] = f; c[i * 3 + 1] = 0.6 * f; c[i * 3 + 2] = 0.2 * f; });
      step(smoke, dt, (i, k, c) => { const f = Math.sin(Math.min(1, k) * Math.PI) * 0.6; c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = f; });
      light.intensity = 22 + Math.sin(t * 13) * 3 + Math.sin(t * 7.3 + 1) * 4 + Math.sin(t * 23.1) * 2;
      bed.material.emissiveIntensity = 0.8 + Math.sin(t * 5) * 0.15;
    });
    return { light };
  };

  /* --- trees ------------------------------------------------------------------------------------------------ */
  /* pines and round leafy trees, all instanced (one draw call per part however many there are) */
  /* trees, instanced (one draw call per part however many): list = [[x, z, scale, 'pine'|'oak'], ...], height(x, z)
     the ground under each */
  /* a few geometries into one (positions, normals, uvs; all indexed or not) */
  function merge(geos) {
    const P = [], N = [], U = [], I = []; let base = 0;
    for (const g0 of geos) {
      const g = g0.index ? g0 : g0; const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
      for (let i = 0; i < pos.count; i++) { P.push(pos.getX(i), pos.getY(i), pos.getZ(i)); N.push(nor.getX(i), nor.getY(i), nor.getZ(i)); U.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0); }
      if (g.index) for (let i = 0; i < g.index.count; i++) I.push(base + g.index.getX(i)); else for (let i = 0; i < pos.count; i++) I.push(base + i);
      base += pos.count;
    }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.Float32BufferAttribute(P, 3)); out.setAttribute('normal', new T.Float32BufferAttribute(N, 3)); out.setAttribute('uv', new T.Float32BufferAttribute(U, 2)); out.setIndex(I);
    return out;
  }
  let palmGeo = null;
  function palmGeos() {   /* a leaning, curving trunk and a crown of drooping fronds, made once */
    if (palmGeo) return palmGeo;
    const curve = new T.CatmullRomCurve3([new T.Vector3(0, 0, 0), new T.Vector3(0.25, 1.6, 0), new T.Vector3(0.75, 3.2, 0), new T.Vector3(1.4, 4.6, 0)]);
    const trunk = new T.TubeGeometry(curve, 10, 0.17, 7, false);
    const fronds = [];
    for (let i = 0; i < 8; i++) {
      const f = new T.PlaneGeometry(0.75, 2.8, 1, 6), p = f.attributes.position;
      for (let k = 0; k < p.count; k++) { const yy = p.getY(k) + 1.4; p.setXYZ(k, p.getX(k) * (1 - yy / 3.2), -0.12 * yy * yy, yy); }   /* tapering, drooping */
      f.computeVertexNormals(); f.rotateY(i / 8 * Math.PI * 2 + 0.2); f.translate(1.4, 4.6, 0); fronds.push(f);
    }
    return (palmGeo = { trunk, crown: merge(fronds), coco: new T.SphereGeometry(0.14, 7, 5) });
  }
  const TREEGEO = {};
  /* A TREE FAR OFF (the world, 2026-10-29): a few dozen triangles, coloured in its vertices -- one draw call a kind */
  const FARTREE = {};
  function farTree(kind) {
    if (FARTREE[kind]) return FARTREE[kind];
    const C = { pine: ['#3d5a34', '#6a4a2e'], oak: ['#4f7a34', '#6a4a2e'], palm: ['#6a9a40', '#9a7a50'], fey: ['#58c8b0', '#bfeee0'], swamp: ['#6a7a40', '#5a4a30'], dead: ['#6a6258', '#6a6258'] }[kind] || ['#4f7a34', '#6a4a2e'];
    const parts = [];
    const add = (geo, col, y) => { geo.translate(0, y, 0); const n = geo.attributes.position.count, cc = new T.Color(col), a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { const k = 0.8 + 0.4 * Math.max(0, geo.attributes.position.getY(i) - y) / 3; a[i * 3] = cc.r * k; a[i * 3 + 1] = cc.g * k; a[i * 3 + 2] = cc.b * k; }
      geo.setAttribute('color', new T.BufferAttribute(a, 3)); parts.push(geo); };
    add(new T.CylinderGeometry(0.15, 0.3, kind === 'pine' ? 2 : 2.6, 5), C[1], kind === 'pine' ? 1 : 1.3);
    if (kind === 'pine') add(new T.ConeGeometry(1.7, 5.2, 7), C[0], 4.0);
    else if (kind === 'palm') add(new T.ConeGeometry(2.2, 1.0, 7), C[0], 4.6);
    else if (kind !== 'dead') add(new T.IcosahedronGeometry(2.1, 0), C[0], 3.6);
    const g = mergeColoured(parts);
    return (FARTREE[kind] = g);
  }
  function mergeColoured(geos) {
    const P = [], N = [], Cc = [], I = []; let base = 0;
    for (const g0 of geos) { const g = g0.index ? g0.toNonIndexed() : g0; g.computeVertexNormals();
      const pos = g.attributes.position, nor = g.attributes.normal, col = g.attributes.color || g0.attributes.color;
      for (let i = 0; i < pos.count; i++) { P.push(pos.getX(i), pos.getY(i), pos.getZ(i)); N.push(nor.getX(i), nor.getY(i), nor.getZ(i)); Cc.push(col.getX(i % col.count), col.getY(i % col.count), col.getZ(i % col.count)); I.push(base + i); }
      base += pos.count; }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.Float32BufferAttribute(P, 3)); out.setAttribute('normal', new T.Float32BufferAttribute(N, 3)); out.setAttribute('color', new T.Float32BufferAttribute(Cc, 3)); out.setIndex(I);
    return out;
  }
  let farTreeM = null;
  art.farTrees = function (ctx, list, height) {
    farTreeM = farTreeM || new T.MeshLambertMaterial({ vertexColors: true });
    const group = new T.Group(), M = new T.Matrix4(), Q = new T.Quaternion(), S = new T.Vector3(), P = new T.Vector3(), up = new T.Vector3(0, 1, 0);
    const by = {}; for (const t of list) (by[t[3] || 'pine'] = by[t[3] || 'pine'] || []).push(t);
    for (const kind in by) {
      const items = by[kind], im = new T.InstancedMesh(farTree(kind), farTreeM, items.length);
      items.forEach((t, i) => { P.set(t[0], height(t[0], t[1]), t[1]); Q.setFromAxisAngle(up, (t[0] * 13.7 + t[1] * 7.1) % 6.28); S.set(t[2], t[2], t[2]); M.compose(P, Q, S); im.setMatrixAt(i, M); });
      im.computeBoundingSphere(); group.add(im);
    }
    ctx.scene.add(group); return group;
  };
  art.trees = function (ctx, list, height) {
    const pines = list.filter(t => (t[3] || 'pine') === 'pine'), oaks = list.filter(t => t[3] === 'oak'), palms = list.filter(t => t[3] === 'palm');
    const M = new T.Matrix4(), Q = new T.Quaternion(), S = new T.Vector3(), P = new T.Vector3(), up = new T.Vector3(0, 1, 0);
    const group = new T.Group(); ctx.scene.add(group);   /* all of them in one group: a stretch of land takes its trees away with it */
    function instanced(geo, material, items, place) {
      if (!items.length) return null;
      const im = new T.InstancedMesh(geo, material, items.length); im.castShadow = true; im.receiveShadow = true;
      items.forEach((it, i) => { place(it, P, S); Q.setFromAxisAngle(up, (it[0] * 13.7 + it[1] * 7.1) % 6.28); M.compose(P, Q, S); im.setMatrixAt(i, M); });
      group.add(im); return im;
    }
    /* the world's other woods: the Unicorn Forest's glowing teal, the Swamp's drab crowns, the Cemetery's dead trees */
    const g = TREEGEO;
    g.trunk = g.trunk || new T.CylinderGeometry(0.24, 0.5, 2.6, 8); g.crown = g.crown || new T.IcosahedronGeometry(1.6, 2);
    for (const [kind, col, tint] of [['fey', '#7fe8d2', '#bfeee0'], ['swamp', '#8a9a5a', '#a09a70']]) {
      const these = list.filter(t => t[3] === kind); if (!these.length) continue;
      instanced(g.trunk, mat('bark', { m: { color: tint } }), these, (t, p, s) => { p.set(t[0], height(t[0], t[1]) + 1.3 * t[2], t[1]); s.set(t[2], t[2] * 1.2, t[2]); });
      for (const [dx, dy, dz, k] of [[0, 3.6, 0, 1.15], [0.9, 3.0, 0.5, 0.8], [-0.8, 3.1, -0.5, 0.85]]) {
        instanced(g.crown, mat('leaves', { m: { color: col, emissive: kind === 'fey' ? '#0a3a30' : '#000000' } }), these, (t, p, s) => { p.set(t[0] + dx * t[2], height(t[0], t[1]) + dy * t[2], t[1] + dz * t[2]); s.set(t[2] * k, t[2] * k * 0.8, t[2] * k); });
      }
    }
    const dead = list.filter(t => t[3] === 'dead');
    if (dead.length) {
      g.branch = g.branch || new T.CylinderGeometry(0.05, 0.1, 1.6, 5);
      instanced(g.trunk, mat('bark', { m: { color: '#7a7268' } }), dead, (t, p, s) => { p.set(t[0], height(t[0], t[1]) + 1.3 * t[2], t[1]); s.set(t[2] * 0.7, t[2] * 1.3, t[2] * 0.7); });
      for (const [ax, ay, rz] of [[0.4, 2.6, -0.8], [-0.4, 2.9, 0.9], [0.1, 3.3, 0.2]]) {
        const geo = g.branch.clone(); geo.rotateZ(rz); geo.translate(ax, 0, 0);
        instanced(geo, mat('bark', { m: { color: '#6a6258' } }), dead, (t, p, s) => { p.set(t[0], height(t[0], t[1]) + ay * t[2], t[1]); s.set(t[2], t[2], t[2]); });
      }
    }
    const bark = mat('bark'), leaves = mat('leaves'), pineLeaves = mat('leaves', { m: { color: '#a9c7a0' } });
    instanced(new T.CylinderGeometry(0.12, 0.24, 3.4, 7), bark, pines, (t, p, s) => { p.set(t[0], height(t[0], t[1]) + 1.7 * t[2], t[1]); s.set(t[2], t[2], t[2]); });
    for (const [y, r, h] of [[2.3, 1.7, 2.0], [3.2, 1.45, 1.9], [4.1, 1.15, 1.7], [4.9, 0.85, 1.5], [5.6, 0.55, 1.3]]) {
      instanced(new T.ConeGeometry(r, h, 9, 1, true), pineLeaves, pines, (t, p, s) => { p.set(t[0], height(t[0], t[1]) + y * t[2], t[1]); s.set(t[2], t[2], t[2]); });
    }
    /* oaks as the old WoW drew them: a thick trunk flaring at the foot, a big round crown of soft clumps */
    if (palms.length) {
      const pg = palmGeos(), frondM = mat('leaves', { m: { side: T.DoubleSide, color: '#cfe6a0' } });
      instanced(pg.trunk, mat('bark', { m: { color: '#c9a070' } }), palms, (t, p, s) => { p.set(t[0], height(t[0], t[1]) - 0.1, t[1]); s.set(t[2], t[2], t[2]); });
      instanced(pg.crown, frondM, palms, (t, p, s) => { p.set(t[0], height(t[0], t[1]) - 0.1, t[1]); s.set(t[2], t[2], t[2]); });
    }
    instanced(new T.CylinderGeometry(0.24, 0.5, 2.6, 8), bark, oaks, (t, p, s) => { p.set(t[0], height(t[0], t[1]) + 1.3 * t[2], t[1]); s.set(t[2], t[2], t[2]); });
    const crown = TREEGEO.oakCrown || (TREEGEO.oakCrown = new T.IcosahedronGeometry(1.6, 1));
    for (const [dx, dy, dz, k] of [[0, 3.4, 0, 1.1], [1.0, 2.9, 0.4, 0.8], [-0.9, 3.0, -0.5, 0.85], [0.2, 4.2, -0.2, 0.75], [-0.3, 2.8, 1.0, 0.7]]) {
      instanced(crown, leaves, oaks, (t, p, s) => { p.set(t[0] + dx * t[2], height(t[0], t[1]) + dy * t[2], t[1] + dz * t[2]); s.set(t[2] * k, t[2] * k * 0.85, t[2] * k); });
    }
    return group;
  };

  /* THE WHOLE WORLD'S LAND (tbuuol 2026-10-29: the map, 3 x 2 km): it cannot all be drawn at once, so it is built in
     128 m squares round the eye -- ground, sea and river, trees -- and taken down again behind; beyond them one coarse
     mesh of the whole world keeps the mountains on the horizon. TR is a terrain (the terrain module). o.radius: how far
     the near land reaches (a PC further than a phone). Returns {update(eye), solids(x, z), count()}. */
  art.land = function (ctx, TR, o) {
    o = o || {};
    const CH = o.chunk || 128, STEP = o.step || 2, R = o.radius || 320, SEA = TR.SEA, N = CH / STEP + 1, NEAR = o.near || 150;
    const hexC = h => new T.Color(h);
    const COL = { green: [hexC('#86b95a'), hexC('#4f7c36')], valley: [hexC('#a2c862'), hexC('#6f9a40')], troll: [hexC('#a49058'), hexC('#7a6a44')],
                  fey: [hexC('#5aa88a'), hexC('#2f6f5a')], ruins: [hexC('#9a967e'), hexC('#706c5c')], cemetery: [hexC('#7c876c'), hexC('#5a6452')],
                  swamp: [hexC('#727c44'), hexC('#4f5832')], mountain: [hexC('#8f8a80'), hexC('#6e6a64')] };
    const SAND = hexC('#e2cf98'), ROCK = hexC('#87827a'), SNOW = hexC('#f1f3f6'), DIRT = hexC('#a8845a'), tmp = new T.Color(), acc = new T.Color();
    function colour(x, z, h, slope, out) {
      const w = TR.weights(x, z, h), t = Math.min(1, Math.max(0, (h - 2) / 40)); let tw = 0; acc.setRGB(0, 0, 0);
      for (const k in w) { if (!w[k]) continue; tmp.copy(COL[k][0]).lerp(COL[k][1], t); acc.r += tmp.r * w[k]; acc.g += tmp.g * w[k]; acc.b += tmp.b * w[k]; tw += w[k]; }
      out.setRGB(acc.r / tw, acc.g / tw, acc.b / tw);
      if (h < 0.9 && TR.coast(x, z) < 50 && w.swamp < 0.5) out.lerp(SAND, Math.min(1, (0.9 - h) * 2));
      const rd = TR.road(x, z); if (rd > 0) out.lerp(DIRT, rd * 0.85);
      if (slope > 0.75) out.lerp(ROCK, Math.min(1, (slope - 0.75) * 1.5));
      if (h > 150) out.lerp(SNOW, Math.min(1, (h - 150) / 15));
      return out;
    }
    const groundM = mat('ground', { m: { vertexColors: true } });
    const time = { value: 0 };
    const waterM = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, transparent: true, opacity: 0.88 });   /* matte: no blinding sun on it */
    waterM.onBeforeCompile = sh => {
      sh.uniforms.uTime = time;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n vec4 wp = modelMatrix * vec4(position, 1.0); transformed.y += sin(wp.x * 0.35 + uTime * 1.1) * 0.05 + cos(wp.z * 0.27 + uTime * 0.8) * 0.05;');
    };
    ctx.every((dt, t) => { time.value = t; });
    const DEEP = hexC('#1d5f9c'), SHALLOW = hexC('#3fc2c0'), FOAM = hexC('#f4fbf6');
    const chunks = new Map(), key = (i, j) => i + ',' + j;
    function build(i, j) {
      const x0 = i * CH, z0 = j * CH, group = new T.Group(), H = new Float32Array(N * N);
      for (let b = 0; b < N; b++) for (let a = 0; a < N; a++) H[b * N + a] = TR.floor(x0 + a * STEP, z0 + b * STEP);
      /* the ground */
      const g = new T.PlaneGeometry(CH, CH, N - 1, N - 1); g.rotateX(-Math.PI / 2); g.translate(x0 + CH / 2, 0, z0 + CH / 2);
      const pos = g.attributes.position, uv = g.attributes.uv, col = new Float32Array(pos.count * 3), c = new T.Color();
      let low = 1e9;
      for (let n = 0; n < pos.count; n++) {
        const a = Math.round((pos.getX(n) - x0) / STEP), b = Math.round((pos.getZ(n) - z0) / STEP), h = H[b * N + a];
        const hx = H[b * N + Math.min(N - 1, a + 1)] - H[b * N + Math.max(0, a - 1)], hz = H[Math.min(N - 1, b + 1) * N + a] - H[Math.max(0, b - 1) * N + a];
        pos.setY(n, h); uv.setXY(n, pos.getX(n) / 6, -pos.getZ(n) / 6); low = Math.min(low, h);
        colour(pos.getX(n), pos.getZ(n), h, Math.hypot(hx, hz) / (2 * STEP), c); col[n * 3] = c.r; col[n * 3 + 1] = c.g; col[n * 3 + 2] = c.b;
      }
      g.setAttribute('color', new T.BufferAttribute(col, 3)); g.computeVertexNormals();
      const ground = new T.Mesh(g, groundM); ground.receiveShadow = true; group.add(ground);
      /* the sea and the river: the water's level everywhere the ground is below it */
      if (low < SEA) {
        const M2 = CH / 4 + 1, wg = new T.PlaneGeometry(CH, CH, M2 - 1, M2 - 1); wg.rotateX(-Math.PI / 2); wg.translate(x0 + CH / 2, SEA, z0 + CH / 2);
        const wp = wg.attributes.position, wc = new Float32Array(wp.count * 3);
        for (let n = 0; n < wp.count; n++) {
          const d = SEA - TR.floor(wp.getX(n), wp.getZ(n));
          c.copy(SHALLOW).lerp(DEEP, Math.max(0, Math.min(1, d / 3.5))); if (d < 0.15) c.lerp(FOAM, Math.max(0, 1 - d / 0.15) * 0.45);   /* a thin line of foam */
          wc[n * 3] = c.r; wc[n * 3 + 1] = c.g; wc[n * 3 + 2] = c.b;
        }
        wg.setAttribute('color', new T.BufferAttribute(wc, 3));
        const water = new T.Mesh(wg, waterM); water.renderOrder = 2; water.receiveShadow = true; group.add(water);
      }
      /* the trees (full near the eye, a few triangles further off), and their trunks in the way */
      const list = TR.trees(x0, z0, x0 + CH, z0 + CH), solids = [];
      for (const t of list) { const y = (TR.ground || TR.floor)(t[0], t[1]); solids.push({ min: [t[0] - 0.35, y - 1, t[1] - 0.35], max: [t[0] + 0.35, y + 3, t[1] + 0.35], on: () => true }); }
      ctx.scene.add(group);
      return { group, solids, i, j, list, trees: null, near: null };
    }
    function treesFor(ch, near) {   /* (re)dress a square's trees for how far it is */
      if (ch.near === near) return;
      if (ch.trees) { ch.group.remove(ch.trees); free(ch.trees); }
      ch.near = near;
      ch.trees = !ch.list.length ? null : near ? art.trees(Object.assign({}, ctx, { scene: ch.group }), ch.list, TR.ground || TR.floor) : art.farTrees(Object.assign({}, ctx, { scene: ch.group }), ch.list, TR.ground || TR.floor);
    }
    function free(group) {   /* a square's meshes off the graphics card; the tree shapes made once are kept */
      const shared = new Set(Object.values(TREEGEO).concat(Object.values(FARTREE), palmGeo ? [palmGeo.trunk, palmGeo.crown, palmGeo.coco] : []));
      group.traverse(m => { if (m.geometry && !shared.has(m.geometry)) m.geometry.dispose(); if (m.isInstancedMesh) m.dispose(); });
    }
    function drop(ch) { ctx.scene.remove(ch.group); free(ch.group); }
    /* the far land: the whole world, coarse, drawn only beyond the near squares (and through no fog: the mountains far off) */
    const [ex0, ez0, ex1, ez1] = TR.EXT, FS = 12, fw = Math.round((ex1 - ex0) / FS), fd = Math.round((ez1 - ez0) / FS);
    const fg = new T.PlaneGeometry(ex1 - ex0, ez1 - ez0, fw, fd); fg.rotateX(-Math.PI / 2); fg.translate((ex0 + ex1) / 2, 0, (ez0 + ez1) / 2);
    { const fp = fg.attributes.position, fc = new Float32Array(fp.count * 3), c = new T.Color();
      for (let n = 0; n < fp.count; n++) {
        const x = fp.getX(n), z = fp.getZ(n), h = TR.floor(x, z);
        /* the river wider than it is, so a grid this coarse never drops it (it was patchy far off: 2026-10-31) */
        if (h < SEA || (TR.river && TR.river(x, z) < FS * 0.6)) { fp.setY(n, SEA - 0.6); c.copy(DEEP); } else { fp.setY(n, h - 2.5); colour(x, z, h, 0, c); }
        fc[n * 3] = c.r; fc[n * 3 + 1] = c.g; fc[n * 3 + 2] = c.b;
      }
      fg.setAttribute('color', new T.BufferAttribute(fc, 3)); fg.computeVertexNormals(); }
    /* only where the near land is all fog (the fog ends at R), in the fog's own colour: no seam, no slanted planes */
    const eyeU = { value: new T.Vector3() }, inner = { value: R - 4 }, haze = { value: new T.Color(o.haze || '#bcd5dc') };
    const farM = new T.MeshLambertMaterial({ vertexColors: true, fog: false });
    farM.onBeforeCompile = sh => {
      sh.uniforms.uEye = eyeU; sh.uniforms.uInner = inner; sh.uniforms.uHaze = haze;
      sh.vertexShader = 'varying vec3 vWorld;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'uniform vec3 uEye; uniform float uInner; uniform vec3 uHaze; varying vec3 vWorld;\n' + sh.fragmentShader
        .replace('void main() {', 'void main() {\n if (distance(vWorld.xz, uEye.xz) < uInner) discard;')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n float d = distance(vWorld.xz, uEye.xz), far = smoothstep(uInner, uInner + 1600.0, d);\n gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, max(0.55 + 0.3 * far, 1.0 - smoothstep(uInner, uInner + 60.0, d)));');
    };
    const far = new T.Mesh(fg, farM); far.userData.keep = true; ctx.scene.add(far);
    /* the bridges: planks along an arch, rails, posts down into the river */
    for (const br of TR.bridges || []) {
      const [ax, az] = br.a, [bx, bz] = br.b, L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L, n = Math.max(8, Math.round(L / 1.2));
      const g = new T.Group(), plank = mat('planks', { m: { color: '#c9a274' } }), dark = mat('bark', { m: { color: '#8a6440' } });
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n, xa = ax + (bx - ax) * t0, za = az + (bz - az) * t0, xb = ax + (bx - ax) * t1, zb = az + (bz - az) * t1;
        const ya = TR.deckAt(br, xa + ux * 0.01, za + uz * 0.01), yb = TR.deckAt(br, xb - ux * 0.01, zb - uz * 0.01), seg = Math.hypot(xb - xa, zb - za, (yb || 0) - (ya || 0));
        const p = mesh(boxM(br.w, 0.18, seg + 0.05, 1), plank); p.position.set((xa + xb) / 2, (ya + yb) / 2 - 0.09, (za + zb) / 2);
        p.rotation.order = 'YXZ'; p.rotation.y = Math.atan2(ux, uz); p.rotation.x = -Math.atan2(yb - ya, Math.hypot(xb - xa, zb - za)); g.add(p);
        for (const side of [-1, 1]) {
          const rx = -uz * side * (br.w / 2 - 0.1), rz = ux * side * (br.w / 2 - 0.1);
          const rail = mesh(boxM(0.12, 0.12, seg + 0.05, 1), dark); rail.position.set((xa + xb) / 2 + rx, (ya + yb) / 2 + 0.85, (za + zb) / 2 + rz);
          rail.rotation.order = 'YXZ'; rail.rotation.y = p.rotation.y; rail.rotation.x = p.rotation.x; g.add(rail);
          if (k % 2 === 0) { const post = mesh(new T.CylinderGeometry(0.08, 0.1, 1.0, 6), dark); post.position.set(xa + rx, ya + 0.4, za + rz); g.add(post); }
          if (k % 4 === 2 && ya > TR.floor(xa, za) + 1.5) { const pile = mesh(new T.CylinderGeometry(0.16, 0.2, ya + 3.5, 7), dark); pile.position.set(xa + rx, (ya - 3.5) / 2, za + rz); g.add(pile); }
        }
      }
      g.userData.keep = true; ctx.scene.add(g);
    }
    let pending = [], buildMs = 0;
    return {
      buildMs: () => Math.round(buildMs),
      /* each frame: what is near is built (one square a frame, the nearest first), what is far is taken down */
      update(eye) {
        eyeU.value.copy(eye);
        const ci = Math.floor(eye.x / CH), cj = Math.floor(eye.z / CH), rr = Math.ceil(R / CH) + 1, want = new Set();
        pending = [];
        for (let dj = -rr; dj <= rr; dj++) for (let di = -rr; di <= rr; di++) {
          const i = ci + di, j = cj + dj, cxm = i * CH + CH / 2, czm = j * CH + CH / 2, d = Math.hypot(cxm - eye.x, czm - eye.z);
          if (d > R + CH * 0.71 || cxm < ex0 - CH || cxm > ex1 + CH || czm < ez0 - CH || czm > ez1 + CH) continue;
          want.add(key(i, j)); if (!chunks.has(key(i, j))) pending.push([d, i, j]);
        }
        for (const [k, ch] of Array.from(chunks)) if (!want.has(k) && Math.hypot(ch.i * CH + CH / 2 - eye.x, ch.j * CH + CH / 2 - eye.z) > R + CH * 1.3) { drop(ch); chunks.delete(k); }
        pending.sort((a, b) => a[0] - b[0]);
        if (pending.length) { const [, i, j] = pending[0], t0 = performance.now(); chunks.set(key(i, j), build(i, j)); buildMs = performance.now() - t0; }
        /* full trees within NEAR of the eye, far trees beyond (one square changed a frame, so walking does not stutter) */
        for (const ch of chunks.values()) {
          const near = Math.hypot(ch.i * CH + CH / 2 - eye.x, ch.j * CH + CH / 2 - eye.z) < NEAR;
          if (ch.near !== near) { treesFor(ch, near); break; }
        }
      },
      /* the trunks near a point, for walking */
      solids(x, z) {
        const out = [], i0 = Math.floor((x - 4) / CH), i1 = Math.floor((x + 4) / CH), j0 = Math.floor((z - 4) / CH), j1 = Math.floor((z + 4) / CH);
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const ch = chunks.get(key(i, j)); if (ch) for (const b of ch.solids) out.push(b); }
        return out;
      },
      ready: () => pending.length === 0,
      count: () => chunks.size
    };
  };

  art.forest = function (ctx, def) {
    const rnd = art.rng(def.seed || 11), list = (def.trees || []).slice(), [ox, oz] = def.at || [0, 0];   /* at: the ring's middle */
    const inner = def.inner || 26, outer = def.outer || 90, n = def.count || 160;
    const clear = def.clear || [];   /* [x0, z0, x1, z1] boxes kept free of trees: a field, a road */
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, r = inner + Math.pow(rnd(), 0.8) * (outer - inner);
      /* which kinds grow here, by weight (def.kinds, e.g. {"palm": 1} on the Beach) */
      const kinds = def.kinds || { pine: 0.62, oak: 0.38 }, sum = Object.values(kinds).reduce((x, y) => x + y, 0);
      let pickK = rnd() * sum, kind = 'pine'; for (const k in kinds) { pickK -= kinds[k]; if (pickK <= 0) { kind = k; break; } }
      const t = [ox + Math.cos(a) * r, oz + Math.sin(a) * r, rnd.range(0.8, 1.5), kind];
      const ht = (ctx.floor || ctx.height) ? (ctx.floor || ctx.height)(t[0], t[1]) : 1;   /* the ground, not a ship's deck */
      if (ht > 0.05 && !clear.some(b => t[0] > b[0] && t[0] < b[2] && t[1] > b[1] && t[1] < b[3])) list.push(t);   /* nothing grows in the sea */
    }
    const height = ctx.floor || ctx.height || art.heightAt(def.flat || 30);
    art.trees(ctx, list, height);
    /* every trunk stands in the way: the forest can be walked now (Etappe 3) */
    for (const t of list) { const y = height(t[0], t[1]); ctx.solid([t[0] - 0.35, y - 1, t[1] - 0.35], [t[0] + 0.35, y + 3, t[1] + 0.35]); }
    /* the horizon: two ridges all the way round, the far one paler, higher and snowy; each fades into the haze at its
       foot (vertex colours), crags from a seeded wobble, no lighting: at that distance a mountain is a silhouette */
    const haze = new T.Color(def.haze || '#c9c3b6');
    const ridge = (radius, height, rough, colour, snow, seed) => {
      const r = art.rng(seed), N = 260, P = [], C = [], idx = [], ph = [r() * 6, r() * 6, r() * 6, r() * 6], top = new T.Color(colour), white = new T.Color('#b9c1c9');
      for (let i = 0; i <= N; i++) {
        const a = i / N * Math.PI * 2;
        let h = height * (0.55 + 0.25 * Math.sin(a * 3 + ph[0]) + 0.14 * Math.sin(a * 7 + ph[1]) + 0.07 * Math.sin(a * 17 + ph[2]) + 0.04 * Math.sin(a * 41 + ph[3]));
        h = Math.max(6, h + (r() - 0.5) * rough);
        if (def.openSea && Math.sin(a) < -0.15) h = -12;   /* the Beach: no mountains beyond the sea */
        const x = Math.cos(a) * radius, z = Math.sin(a) * radius, tc = snow && h > height * 0.8 ? white : top;
        P.push(x, -10, z, x, h, z); C.push(haze.r, haze.g, haze.b, tc.r, tc.g, tc.b);
      }
      for (let i = 0; i < N; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.setAttribute('color', new T.Float32BufferAttribute(C, 3)); g.setIndex(idx);
      const m = new T.Mesh(g, new T.MeshBasicMaterial({ vertexColors: true, fog: false, side: T.DoubleSide })); m.userData.keep = true; ctx.scene.add(m);
      followers.push(m);   /* the horizon walks with you */
    };
    if (def.ridges !== false) {
      ridge(250, 95, 10, def.farHills || '#7d98ad', true, 22);
      ridge(175, 48, 7, def.nearHills || '#4f7a4e', false, 21);
    }
    /* boulders: the same rock, bent once from a seed, scattered and half sunk; the near ones block the way */
    const rg = new T.DodecahedronGeometry(1, 1), rp = rg.attributes.position, rr = art.rng(77);
    for (let i = 0; i < rp.count; i++) { const k = 0.8 + rr() * 0.35; rp.setXYZ(i, rp.getX(i) * k, rp.getY(i) * k * 0.75, rp.getZ(i) * k); }
    rg.computeVertexNormals();
    const rocks = [];
    for (let i = 0; i < (def.rocks || 70); i++) {
      const a = rnd() * Math.PI * 2, d = rnd.range(22, 80), sc = rnd.range(0.4, 1.8);
      const rx = ox + Math.cos(a) * d, rz = oz + Math.sin(a) * d;
      if (height(rx, rz) < 0.05) continue;   /* not in the sea */
      if ((def.clear || []).some(b => rx > b[0] && rx < b[2] && rz > b[1] && rz < b[3])) continue;
      rocks.push([rx, rz, sc]);
    }
    const im = new T.InstancedMesh(rg, mat('stone', { m: { color: '#a29c92' } }), rocks.length), M = new T.Matrix4(), Q = new T.Quaternion(), V = new T.Vector3(), S = new T.Vector3();
    rocks.forEach((rk, i) => { V.set(rk[0], height(rk[0], rk[1]) + rk[2] * 0.15, rk[1]); Q.setFromEuler(new T.Euler(rnd() * 0.4, rnd() * 6.3, rnd() * 0.4)); S.set(rk[2], rk[2], rk[2]); M.compose(V, Q, S); im.setMatrixAt(i, M);
      const ry = height(rk[0], rk[1]); ctx.solid([rk[0] - rk[2] * 0.8, ry - 1, rk[1] - rk[2] * 0.8], [rk[0] + rk[2] * 0.8, ry + rk[2] * 0.8, rk[1] + rk[2] * 0.8]); });
    im.castShadow = im.receiveShadow = true; ctx.scene.add(im);
  };

  /* grass tufts and flowers, instanced, kept off the paths */
  art.grass = function (ctx, def) {
    /* tufts of real blades (five thin bent triangles each), instanced, bending in a wind that moves across the camp:
       the shader leans each blade by how high up it is, on a wave that depends on where the tuft stands */
    const rnd = art.rng(def.seed || 5);
    const geo = new T.BufferGeometry(), P = [], N = [], C = [];
    for (let i = 0; i < 7; i++) {
      const a = rnd() * Math.PI * 2, r = rnd() * 0.2, x = Math.cos(a) * r, z = Math.sin(a) * r, h = rnd.range(0.14, 0.34), w = 0.018, lean = rnd.range(-0.08, 0.08), dir = rnd() * Math.PI;
      const dx = Math.cos(dir) * w, dz = Math.sin(dir) * w, tip = [x + Math.cos(dir + 1.57) * lean, h, z + Math.sin(dir + 1.57) * lean];
      const tint = rnd.range(0.75, 1.1);
      for (const v of [[x - dx, 0, z - dz], [x + dx, 0, z + dz], tip]) { const up2 = v[1] > 0; P.push(...v); N.push(0, 1, 0);
        C.push((up2 ? 0.42 : 0.2) * tint, (up2 ? 0.5 : 0.27) * tint, (up2 ? 0.22 : 0.1) * tint); }
    }
    geo.setAttribute('position', new T.Float32BufferAttribute(P, 3)); geo.setAttribute('normal', new T.Float32BufferAttribute(N, 3)); geo.setAttribute('color', new T.Float32BufferAttribute(C, 3));
    const time = { value: 0 };
    const m = new T.MeshStandardMaterial({ vertexColors: true, side: T.DoubleSide, roughness: 0.9 });
    m.onBeforeCompile = sh => {
      sh.uniforms.uTime = time;
      /* a blade is lit as the ground under it, from either side (a two-sided material would turn its back black) */
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize(vNormal);');
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wpos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float sway = sin(uTime * 1.7 + wpos.x * 0.35 + wpos.z * 0.22) * 0.6 + sin(uTime * 3.1 + wpos.x * 1.3) * 0.25;
        float k = position.y * position.y * 1.6;
        transformed.x += sway * k * 0.35; transformed.z += sway * k * 0.18;`);
    };
    const avoid = def.avoid || [], ok = (px, pz) => avoid.every(a => Math.hypot(px - a[0], pz - a[1]) > a[2]);
    const spots = []; for (let i = 0; spots.length < (def.count || 900) * 4 && i < 80000; i++) { const px = rnd.range(-def.size, def.size), pz = rnd.range(-def.size, def.size); if (ok(px, pz)) spots.push([px, pz]); }
    const im = new T.InstancedMesh(geo, m, spots.length), M = new T.Matrix4(), Q = new T.Quaternion(), V = new T.Vector3(), S = new T.Vector3(), up = new T.Vector3(0, 1, 0);
    spots.forEach((sp, i) => { const k = rnd.range(0.7, 1.4); V.set(sp[0], 0, sp[1]); Q.setFromAxisAngle(up, rnd() * 6.28); S.set(k, k * rnd.range(0.8, 1.3), k); M.compose(V, Q, S); im.setMatrixAt(i, M); });
    im.receiveShadow = true; ctx.scene.add(im);
    ctx.every((dt, t) => { time.value = t; });
    const fl = new T.InstancedMesh(new T.IcosahedronGeometry(0.04, 0), plain('#fff'), 90), col = new T.Color();
    for (let i = 0; i < 90; i++) { const sp = rnd.pick(spots); V.set(sp[0] + rnd.range(-0.2, 0.2), rnd.range(0.25, 0.4), sp[1] + rnd.range(-0.2, 0.2)); S.set(1, 1, 1); M.compose(V, Q.identity(), S); fl.setMatrixAt(i, M); fl.setColorAt(i, col.set(rnd.pick(['#d8c27a', '#c9b7d6', '#e8e2d0', '#b9a06a']))); }
    ctx.scene.add(fl);
  };

  /* --- fence, paths, props, the well --------------------------------------------------------------------------- */
  art.fence = function (ctx, def) {
    const [x0, z0, x1, z1] = def.rect, gate = def.gate || null, wood = mat('bark'), rail = mat('planks', { m: { color: '#b08a60' } });
    const seg = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 2.4));
      for (let i = 0; i <= n; i++) { const p = mesh(new T.CylinderGeometry(0.09, 0.11, 1.5, 6), wood); p.position.set(ax + (bx - ax) * i / n, 0.75, az + (bz - az) * i / n); ctx.scene.add(p); }
      for (const y of [0.5, 1.05]) {
        const r = mesh(new T.BoxGeometry(len, 0.1, 0.06), rail); r.position.set((ax + bx) / 2, y, (az + bz) / 2); r.rotation.y = -Math.atan2(bz - az, bx - ax); ctx.scene.add(r);
      }
      ctx.solid([Math.min(ax, bx) - 0.1, 0, Math.min(az, bz) - 0.1], [Math.max(ax, bx) + 0.1, 1.6, Math.max(az, bz) + 0.1]);
    };
    let door = null;
    if (gate) { seg(x0, z1, gate[0], z1); seg(gate[1], z1, x1, z1);
      /* the gate: two wings, each on a hinge at its post, that swing outwards; and an arch with the camp's name.
         With an id it is a door the engine opens and closes (shared, like a hut's); without one it stays shut. */
      const gw = (gate[1] - gate[0]) / 2, pivots = [], wings = [];
      for (const sgn of [-1, 1]) {
        const pivot = new T.Group(); pivot.position.set(sgn < 0 ? gate[0] : gate[1], 0, z1); pivot.userData.keep = true; ctx.scene.add(pivot);
        const w = mesh(boxM(gw - 0.05, 1.3, 0.08, 1), mat('planks', { m: { color: '#a9835a' } })); w.position.set(-sgn * gw / 2, 0.75, 0); pivot.add(w);
        pivots.push({ p: pivot, swing: sgn < 0 ? -1.65 : 1.65 }); wings.push(w);
      }
      const box = { min: [gate[0], 0, z1 - 0.1], max: [gate[1], 1.6, z1 + 0.1] };
      if (def.gateId) door = { id: def.gateId, label: def.gateLabel || 'Gate', opens: 'hand', open: def.gateOpen !== false, wings, pivots, box };
      else ctx.solid(box.min, box.max);
      for (const gx of gate) { const p = mesh(new T.CylinderGeometry(0.16, 0.18, 4, 8), wood); p.position.set(gx, 2, z1); ctx.scene.add(p); }
      const beam = mesh(new T.BoxGeometry(gate[1] - gate[0] + 0.8, 0.3, 0.3), wood); beam.position.set((gate[0] + gate[1]) / 2, 3.8, z1); ctx.scene.add(beam);
      if (def.sign) {
        const [c, x] = canvas(512); c.height = 128; x.fillStyle = '#6b4a2b'; x.fillRect(0, 0, 512, 128); x.strokeStyle = '#3b2814'; x.lineWidth = 10; x.strokeRect(5, 5, 502, 118);
        x.font = 'bold 72px Georgia, serif'; x.textAlign = 'center'; x.fillStyle = '#f3e3c3'; x.fillText(def.sign, 256, 90);
        const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
        const s = mesh(new T.BoxGeometry(3.2, 0.8, 0.08), [plain('#6b4a2b'), plain('#6b4a2b'), plain('#6b4a2b'), plain('#6b4a2b'), new T.MeshStandardMaterial({ map: t, roughness: 0.8 }), new T.MeshStandardMaterial({ map: t, roughness: 0.8 })]);
        s.position.set((gate[0] + gate[1]) / 2, 3.2, z1 + 0.2); ctx.scene.add(s);
        /* (a box's back face already reads the right way round from behind: no flip) */
      }
    } else seg(x0, z1, x1, z1);
    seg(x0, z0, x1, z0); seg(x0, z0, x0, z1); seg(x1, z0, x1, z1);
    return { door };
  };
  art.paths = function (ctx, def) {   /* def.paved: cobbles (Genesis) instead of the camp's dirt */
    const dirt = def.paved ? mat('cobble', { repeat: [1, 1], m: { polygonOffset: true, polygonOffsetFactor: -2 } })
                           : mat('dirt', { repeat: [1, 1], m: { bumpScale: 1.5, polygonOffset: true, polygonOffsetFactor: -2 } });
    for (const p of def.circles || []) {
      const g = new T.CircleGeometry(p[2], 40); g.rotateX(-Math.PI / 2);
      const uv = g.attributes.uv, pos = g.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 4, pos.getZ(i) / 4);
      const m = mesh(g, dirt, false); m.receiveShadow = true; m.position.set(p[0], 0.012, p[1]); ctx.scene.add(m);
    }
    for (const s of def.strips || []) {
      const [ax, az, bx, bz, w] = s, len = Math.hypot(bx - ax, bz - az);
      const g = new T.PlaneGeometry(w, len); g.rotateX(-Math.PI / 2);
      const uv = g.attributes.uv, pos = g.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 4, pos.getZ(i) / 4);
      const m = mesh(g, dirt, false); m.receiveShadow = true; m.position.set((ax + bx) / 2, 0.01, (az + bz) / 2); m.rotation.y = Math.atan2(bx - ax, bz - az); ctx.scene.add(m);
    }
  };
  /* --- GENESIS, the city players build (tbuuol 2026-11-07) ------------------------------------------------------ */
  /* cobbles for the city's streets and its plaza (art.paths with def.paved) */
  painters.cobble = function (rnd) {
    const [c, x] = canvas(256); x.fillStyle = '#6f6a62'; x.fillRect(0, 0, 256, 256);
    for (let row = 0; row < 256; row += 32) {
      const off = (row / 32) % 2 ? 16 : 0;
      for (let col = -32; col < 288; col += 32) {
        x.fillStyle = shade('#a39c90', rnd.range(0.78, 1.12));
        const w = 28 + rnd.range(-3, 2), h = 27 + rnd.range(-3, 2);
        x.beginPath(); x.roundRect(col + off + 2, row + 2, w, h, 7); x.fill();
        x.fillStyle = 'rgba(255,255,255,.08)'; x.beginPath(); x.roundRect(col + off + 5, row + 4, w - 10, 6, 3); x.fill();
      }
    }
    return c;
  };
  /* A HALL: Genesis' town hall and the adventurers' guild. A stone ground floor with a wide open doorway, a plastered
     upper floor under a tiled gable roof, steps up to the door, a carved sign over it, two banners and two lanterns,
     and inside a counter where its keeper stands. def: {pos, size: [w, d], rot (0/90/180/270; the door is on the local
     -z side, as a hut's), sign, banner, height}. Its parts are joined by material: a handful of draw calls. */
  art.hall = function (ctx, def) {
    const W = def.size[0], D = def.size[1], H1 = def.height || 4.4, H2 = 3.3, P0 = 0.5, th = 0.6;
    const rot = ((def.rot || 0) % 360 + 360) % 360, cx = def.pos[0], cz = def.pos[1];
    const grp = new T.Group(), stone = mat('stone', { m: { bumpScale: 1.4 } }), planks = mat('planks'), plaster = mat('plaster');
    const beam = plain('#4a3424'), tiles = mat('rooftiles', { m: { color: def.roof || '#ffffff' } });
    const local = (x, z) => { const r = rot * Math.PI / 180, c = Math.round(Math.cos(r)), s = Math.round(Math.sin(r)); return [cx + x * c + z * s, cz - x * s + z * c]; };
    const solidL = (x0, y0, z0, x1, y1, z1) => { const a = local(x0, z0), b = local(x1, z1); ctx.solid([Math.min(a[0], b[0]), y0, Math.min(a[1], b[1])], [Math.max(a[0], b[0]), y1, Math.max(a[1], b[1])]); };
    const add = (m, x, y, z) => { m.position.set(x, y, z); grp.add(m); return m; };
    /* plinth, floor, two steps to the door */
    add(mesh(boxM(W + 0.6, P0, D + 0.6, 2), stone), 0, P0 / 2, 0);
    add(mesh(boxM(W - 2 * th, 0.04, D - 2 * th, 2), planks), 0, P0 + 0.02, 0);
    solidL(-W / 2 - 0.3, 0, -D / 2 - 0.3, W / 2 + 0.3, P0, D / 2 + 0.3);
    const dw = 3.2, dh = 3.4;
    add(mesh(boxM(dw + 2.4, 0.25, 1.2, 2), stone), 0, 0.125, -D / 2 - 0.3 - 0.6);   /* a step: 0.25, then the plinth's 0.5 */
    solidL(-(dw + 2.4) / 2, 0, -D / 2 - 1.5, (dw + 2.4) / 2, 0.25, -D / 2 - 0.3);
    /* the ground floor in stone: back and sides whole, the front with the doorway */
    const y0 = P0, wy = y0 + H1 / 2;
    add(mesh(boxM(W, H1, th, 2), stone), 0, wy, D / 2 - th / 2); solidL(-W / 2, y0, D / 2 - th, W / 2, y0 + H1, D / 2);
    add(mesh(boxM(th, H1, D, 2), stone), -W / 2 + th / 2, wy, 0); solidL(-W / 2, y0, -D / 2, -W / 2 + th, y0 + H1, D / 2);
    add(mesh(boxM(th, H1, D, 2), stone), W / 2 - th / 2, wy, 0); solidL(W / 2 - th, y0, -D / 2, W / 2, y0 + H1, D / 2);
    const side = (W - dw) / 2;
    add(mesh(boxM(side, H1, th, 2), stone), -W / 2 + side / 2, wy, -D / 2 + th / 2); solidL(-W / 2, y0, -D / 2, -dw / 2, y0 + H1, -D / 2 + th);
    add(mesh(boxM(side, H1, th, 2), stone), W / 2 - side / 2, wy, -D / 2 + th / 2); solidL(dw / 2, y0, -D / 2, W / 2, y0 + H1, -D / 2 + th);
    add(mesh(boxM(dw, H1 - dh, th, 2), stone), 0, y0 + dh + (H1 - dh) / 2, -D / 2 + th / 2);
    /* windows of the ground floor: dark panes in light frames, two each side of the door and along the sides */
    const pane = plain('#26323a', { roughness: 0.3, metalness: 0.2 }), frame = plain('#e6dccb');
    const win = (x, z, turn) => {
      const f = add(mesh(new T.BoxGeometry(1.5, 2.0, 0.14), frame), x, y0 + 2.2, z); const p = add(mesh(new T.BoxGeometry(1.2, 1.7, 0.16), pane), x, y0 + 2.2, z);
      if (turn) { f.rotation.y = p.rotation.y = Math.PI / 2; }
    };
    for (let x = dw / 2 + 2.2; x < W / 2 - 1.5; x += 3.6) { win(x, -D / 2 - 0.02); win(-x, -D / 2 - 0.02); }
    for (let z = -D / 2 + 3; z < D / 2 - 2; z += 4) { win(-W / 2 - 0.02, z, true); win(W / 2 + 0.02, z, true); }
    /* a beam between the floors, the upper floor in plaster (its texture has the windows), corner posts */
    add(mesh(boxM(W + 0.3, 0.35, D + 0.3, 1), beam), 0, y0 + H1 + 0.17, 0);
    const y1 = y0 + H1 + 0.35;
    const up = (w, d, x, z) => add(mesh(boxM(w, H2, d, 3), plaster), x, y1 + H2 / 2, z);
    up(W, 0.3, 0, -D / 2 + 0.15); up(W, 0.3, 0, D / 2 - 0.15); up(0.3, D, -W / 2 + 0.15, 0); up(0.3, D, W / 2 - 0.15, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(mesh(new T.BoxGeometry(0.4, H2, 0.4), beam), sx * (W / 2 - 0.05), y1 + H2 / 2, sz * (D / 2 - 0.05));
    add(mesh(boxM(W - 0.6, 0.2, D - 0.6, 2), planks), 0, y1 - 0.1, 0);   /* the ceiling seen from inside */
    /* the gable roof, its ridge along the width; the two gables in plaster */
    const rise = Math.min(4.5, D * 0.36), half = D / 2 + 0.8, slope = Math.hypot(half, rise), a = Math.atan2(rise, half), yt = y1 + H2;
    for (const s of [-1, 1]) { const r = add(mesh(boxM(W + 1.6, 0.3, slope, 3), tiles), 0, yt + rise / 2, s * half / 2); r.rotation.x = s * a; }
    const tri = new T.Shape([new T.Vector2(-D / 2, 0), new T.Vector2(D / 2, 0), new T.Vector2(0, rise * (D / 2) / half)]);
    for (const s of [-1, 1]) { const g = mesh(new T.ShapeGeometry(tri), plaster); g.rotation.y = Math.PI / 2; g.material = plain('#efe7d8', { side: T.DoubleSide }); add(g, s * (W / 2 - 0.1), yt, 0); }
    add(mesh(boxM(W + 1.8, 0.3, 0.4, 1), beam), 0, yt + rise + 0.05, 0);
    /* inside: a counter across the back, shelves behind it, a long rug to the door */
    add(mesh(boxM(Math.min(9, W * 0.45), 1.1, 0.9, 1), planks), 0, y0 + 0.55, D / 2 - 3.2); solidL(-Math.min(9, W * 0.45) / 2, y0, D / 2 - 3.65, Math.min(9, W * 0.45) / 2, y0 + 1.1, D / 2 - 2.75);
    for (const sx of [-1, 1]) add(mesh(boxM(3.2, 2.4, 0.5, 1), planks), sx * 3.2, y0 + 1.2, D / 2 - th - 0.3);
    add(mesh(new T.BoxGeometry(2.2, 0.03, D - 5.5), plain(def.banner || '#7a2a2a')), 0, y0 + 0.06, -1.6);
    joinByMaterial(grp);
    /* the sign over the door, the banners, the lanterns: kept apart (their own looks) */
    const [sc, sx2] = canvas(512); sc.height = 96;
    sx2.fillStyle = '#3a2616'; sx2.fillRect(0, 0, 512, 96); sx2.strokeStyle = '#c8a050'; sx2.lineWidth = 6; sx2.strokeRect(6, 6, 500, 84);
    sx2.fillStyle = '#e8c870'; sx2.font = 'bold 48px Georgia,serif'; sx2.textAlign = 'center'; sx2.textBaseline = 'middle'; sx2.fillText(def.sign || '', 256, 50);
    const st = new T.CanvasTexture(sc); st.colorSpace = T.SRGBColorSpace; st.anisotropy = 4;
    const sw = Math.min(W - 2, 8.5);
    add(new T.Mesh(new T.PlaneGeometry(sw, sw * 96 / 512), new T.MeshStandardMaterial({ map: st, roughness: 0.8 })), 0, y1 + 0.9, -D / 2 - 0.08).rotation.y = Math.PI;
    const cloth = new T.MeshStandardMaterial({ color: def.banner || '#7a2a2a', roughness: 0.95, side: T.DoubleSide });
    for (const sx of [-1, 1]) {
      const b = add(new T.Mesh(new T.PlaneGeometry(1.1, 2.6), cloth), sx * (dw / 2 + 0.9), y0 + H1 - 1.5, -D / 2 - 0.06); b.rotation.y = Math.PI;
      const l = art.lantern(); add(l, sx * (dw / 2 + 0.35), y0 + 2.6, -D / 2 - 0.3);
    }
    grp.rotation.y = rot * Math.PI / 180; grp.position.set(cx, 0, cz);
    ctx.scene.add(grp);
    return { group: grp };
  };
  /* THE FOUNTAIN in the middle of the plaza: a round basin on a step, a column with two bowls, water falling from
     each into the next and rippling in the basin. def: {pos, r} */
  art.fountain = function (ctx, def) {
    const [x, z] = def.pos, R = def.r || 6, g = new T.Group(), stone = mat('stone', { m: { bumpScale: 1.2 } });
    const ring = (r0, r1, h, y) => { const m = mesh(new T.CylinderGeometry(r1, r0, h, 48, 1, true), stone); m.position.y = y; g.add(m); return m; };
    const step = mesh(new T.CylinderGeometry(R + 0.7, R + 0.9, 0.3, 48), stone); step.position.y = 0.15; g.add(step);
    ring(R, R, 0.85, 0.72); ring(R - 0.4, R - 0.4, 0.85, 0.72).material = stone;
    const rim = mesh(new T.RingGeometry(R - 0.4, R + 0.02, 48), stone); rim.rotation.x = -Math.PI / 2; rim.position.y = 1.15; g.add(rim);
    const col = mesh(new T.CylinderGeometry(0.45, 0.6, 3.4, 16), stone); col.position.y = 1.7; g.add(col);
    const bowl = (r, y) => { const b = mesh(new T.CylinderGeometry(r, r * 0.35, 0.45, 32), stone); b.position.y = y; g.add(b); return b; };
    bowl(1.9, 2.3); bowl(0.9, 3.5);
    const fin = mesh(new T.SphereGeometry(0.28, 14, 10), stone); fin.position.y = 4.0; g.add(fin);
    joinByMaterial(g);
    /* the water: a surface that ripples, and veils falling from the bowls */
    const [wc, wx] = canvas(128); wx.fillStyle = '#2f6f8a'; wx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 26; i++) { wx.strokeStyle = 'rgba(200,235,250,' + (0.12 + Math.random() * 0.2) + ')'; wx.lineWidth = 2; wx.beginPath(); wx.arc(Math.random() * 128, Math.random() * 128, 6 + Math.random() * 22, 0, Math.PI * 2); wx.stroke(); }
    const wt = new T.CanvasTexture(wc); wt.wrapS = wt.wrapT = T.RepeatWrapping; wt.repeat.set(2, 2); wt.colorSpace = T.SRGBColorSpace;
    const water = new T.Mesh(new T.CircleGeometry(R - 0.4, 48), new T.MeshStandardMaterial({ map: wt, roughness: 0.12, metalness: 0.25, transparent: true, opacity: 0.92 }));
    water.rotation.x = -Math.PI / 2; water.position.y = 0.95; water.userData.keep = true; g.add(water);
    const [fc, fx] = canvas(64); fx.clearRect(0, 0, 64, 64);
    for (let i = 0; i < 40; i++) { fx.fillStyle = 'rgba(225,245,255,' + (0.25 + Math.random() * 0.5) + ')'; fx.fillRect(Math.random() * 64, Math.random() * 64, 1.5, 6 + Math.random() * 14); }
    const ft = new T.CanvasTexture(fc); ft.wrapS = ft.wrapT = T.RepeatWrapping; ft.repeat.set(6, 1);
    const veilM = new T.MeshBasicMaterial({ map: ft, transparent: true, opacity: 0.75, depthWrite: false, side: T.DoubleSide });
    const veil = (r0, r1, y0, y1) => { const v = new T.Mesh(new T.CylinderGeometry(r1, r0, y1 - y0, 32, 1, true), veilM); v.position.y = (y0 + y1) / 2; v.userData.keep = true; g.add(v); };
    veil(2.3, 1.9, 1.0, 2.5); veil(1.1, 0.9, 2.5, 3.7);
    g.position.set(x, 0, z); ctx.scene.add(g);
    ctx.every(dt => { wt.offset.x += dt * 0.02; wt.offset.y += dt * 0.013; ft.offset.y += dt * 0.9; });
    /* walking: an octagon of three boxes round the basin */
    const a = R * 0.96, b = R * 0.42;
    ctx.solid([x - a, 0, z - b], [x + a, 1.15, z + b]); ctx.solid([x - b, 0, z - a], [x + b, 1.15, z + a]); ctx.solid([x - R * 0.72, 0, z - R * 0.72], [x + R * 0.72, 1.15, z + R * 0.72]);
    return { group: g };
  };
  /* THE PLOTS of Genesis, marked out on the ground: a pale stone kerb round each, and at one corner a post whose cap
     says its kind (house blue, workshop red, shop gold). def: [{id, kind, rect: [x0, z0, x1, z1]}]. A few draw calls
     for all of them. */
  art.plots = function (ctx, list) {
    const g = new T.Group(), kerb = plain('#d8d0c0'), wood = plain('#5a4230');
    const caps = { house: plain('#4f8cc8'), workshop: plain('#c0563e'), shop: plain('#e0a83a') };
    const strip = (ax, az, bx, bz) => { const len = Math.hypot(bx - ax, bz - az), m = new T.Mesh(new T.BoxGeometry(0.3, 0.06, len), kerb);
      m.position.set((ax + bx) / 2, 0.03, (az + bz) / 2); m.rotation.y = Math.atan2(bx - ax, bz - az); m.receiveShadow = true; g.add(m); };
    const seen = new Set();
    for (const p of list) {
      const [x0, z0, x1, z1] = p.rect;
      for (const [ax, az, bx, bz] of [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]]) {
        const k = [Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)].join();
        if (!seen.has(k)) { seen.add(k); strip(ax, az, bx, bz); }   /* a shared edge once */
      }
      const post = new T.Mesh(new T.CylinderGeometry(0.07, 0.09, 1.1, 6), wood); post.position.set(x0 + 0.35, 0.55, z0 + 0.35); g.add(post);
      const cap = new T.Mesh(new T.BoxGeometry(0.3, 0.22, 0.3), caps[p.kind] || caps.house); cap.position.set(x0 + 0.35, 1.2, z0 + 0.35); g.add(cap);
    }
    joinByMaterial(g);
    ctx.scene.add(g);
    return { group: g };
  };
  /* A CITY WALL (tbuuol 2026-10-31: a wall round Genesis, "damit wir schonmal einen Eindruck davon haben wo die Stadt
     mal stehen wird und wie groß sie werden kann" -- "vergiss nicht ein hübsches Stadttor an der Straße"): a stone ring
     on the land's ground in pieces of up to 4 m, battlements on its outer edge, a round tower with a slate cone at
     every corner, and a gatehouse wherever a road comes through (two tall towers, an arch, the doors standing open,
     banners). def: {pts: [[x, z], ...] the ring, h, th: thickness, gate: the opening's width}. Few draw calls: each
     material's pieces are one mesh. Returns {segs: [{a, b, r, top}]} for the walking (a piece is a line with a
     thickness, so a slanted wall stops you where it is drawn, not at a box round it). */
  art.cityWall = function (ctx, TR, def) {
    const H = def.h || 7, TH = def.th || 2.4, GW = def.gate || 9, TR_R = 3.2, GT_R = 3.6, P = def.pts, n = P.length;
    const ground = (x, z) => TR.walk(x, z);
    const parts = { stone: [], arch: [], roof: [], wood: [], cloth: [], gold: [] }, segs = [];
    const m4 = new T.Matrix4(), qq = new T.Quaternion(), UP = new T.Vector3(0, 1, 0), at = new T.Vector3(), sc = new T.Vector3();
    const put = (list, geo, x, y, z, yaw) => { qq.setFromAxisAngle(UP, yaw || 0); m4.compose(at.set(x, y, z), qq, sc.set(1, 1, 1)); list.push(geo.applyMatrix4(m4)); };
    const cx = P.reduce((a, p) => a + p[0], 0) / n, cz = P.reduce((a, p) => a + p[1], 0) / n;
    /* where the roads come through */
    const gates = [];
    for (const r of TR.ROADS || []) for (let i = 0; i < r.pts.length - 1; i++) for (let j = 0; j < n; j++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], [qx, qz] = P[j], [wx, wz] = P[(j + 1) % n];
      const den = (bx - ax) * (wz - qz) - (bz - az) * (wx - qx); if (Math.abs(den) < 1e-9) continue;
      const u = ((qx - ax) * (wz - qz) - (qz - az) * (wx - qx)) / den, v = ((qx - ax) * (bz - az) - (qz - az) * (bx - ax)) / den;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      const L = Math.hypot(wx - qx, wz - qz), d = [(wx - qx) / L, (wz - qz) / L];
      let nr = [d[1], -d[0]]; const gx = qx + (wx - qx) * v, gz = qz + (wz - qz) * v;
      if (nr[0] * (gx - cx) + nr[1] * (gz - cz) < 0) nr = [-nr[0], -nr[1]];   /* outward */
      gates.push({ x: gx, z: gz, d, nr });
    }
    const nearGate = (x, z, m) => gates.some(g => Math.hypot(x - g.x, z - g.z) < m);
    function tower(x, z, r, rise) {
      const g = Math.min(ground(x, z), ground(x + r, z), ground(x - r, z), ground(x, z + r), ground(x, z - r)), lo = g - 1.5, top = ground(x, z) + H + rise;
      put(parts.stone, new T.CylinderGeometry(r, r * 1.1, top - lo, 16), x, (top + lo) / 2, z);
      put(parts.stone, new T.CylinderGeometry(r + 0.35, r + 0.35, 0.5, 16), x, top - 0.25, z);   /* a lip under the battlements */
      for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; put(parts.stone, new T.BoxGeometry(1.1, 1.1, 0.55), x + Math.sin(a) * (r + 0.05), top + 0.55, z + Math.cos(a) * (r + 0.05), a); }
      put(parts.roof, new T.ConeGeometry(r + 0.7, r * 1.6, 16), x, top + 1.1 + r * 0.8, z);
      segs.push({ a: [x, z], b: [x, z], r, top });
    }
    /* the ring */
    for (let j = 0; j < n; j++) {
      const [qx, qz] = P[j], [wx, wz] = P[(j + 1) % n], L = Math.hypot(wx - qx, wz - qz), d = [(wx - qx) / L, (wz - qz) / L];
      let nr = [d[1], -d[0]]; if (nr[0] * ((qx + wx) / 2 - cx) + nr[1] * ((qz + wz) / 2 - cz) < 0) nr = [-nr[0], -nr[1]];
      const k = Math.max(1, Math.ceil(L / 4)), yaw = Math.atan2(d[0], d[1]);
      for (let i = 0; i < k; i++) {
        const x0 = qx + (wx - qx) * i / k, z0 = qz + (wz - qz) * i / k, x1 = qx + (wx - qx) * (i + 1) / k, z1 = qz + (wz - qz) * (i + 1) / k;
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        if (nearGate(mx, mz, GW / 2 + GT_R)) continue;
        const g0 = ground(x0, z0), g1 = ground(x1, z1), gm = ground(mx, mz), lo = Math.min(g0, g1, gm) - 1.5, top = (g0 + g1) / 2 + H, len = Math.hypot(x1 - x0, z1 - z0);
        put(parts.stone, new T.BoxGeometry(TH, top - lo, len + 0.08), mx, (top + lo) / 2, mz, yaw);
        put(parts.stone, new T.BoxGeometry(TH + 0.5, 0.35, len + 0.08), mx, top - 0.6, mz, yaw);   /* a moulding under the battlements */
        const mm = Math.max(1, Math.round(len / 2));
        for (let t = 0; t < mm; t++) {   /* merlons on the outer edge, with a lower parapet on the inner */
          const f = (t + 0.5) / mm, px = x0 + (x1 - x0) * f, pz = z0 + (z1 - z0) * f;
          put(parts.stone, new T.BoxGeometry(0.6, 1.1, 1.0), px + nr[0] * (TH / 2 - 0.3), top + 0.55, pz + nr[1] * (TH / 2 - 0.3), yaw);
        }
        put(parts.stone, new T.BoxGeometry(0.4, 0.6, len + 0.08), mx - nr[0] * (TH / 2 - 0.2), top + 0.3, mz - nr[1] * (TH / 2 - 0.2), yaw);
        segs.push({ a: [x0, z0], b: [x1, z1], r: TH / 2, top: top + 1.1 });
      }
      if (!nearGate(qx, qz, GW / 2 + GT_R + 4)) tower(qx, qz, TR_R, 2.5);
    }
    /* the gatehouses */
    for (const G of gates) {
      const gg = ground(G.x, G.z), yaw = Math.atan2(G.d[0], G.d[1]), half = GW / 2, depth = TH + 1.4, spring = gg + 1.6, crown = spring + half;
      for (const s of [-1, 1]) tower(G.x + G.d[0] * s * (half + GT_R - 0.2), G.z + G.d[1] * s * (half + GT_R - 0.2), GT_R, 5);
      const lt = gg + H + 1.5;   /* the bridge over the arch, with its battlements */
      put(parts.stone, new T.BoxGeometry(depth, lt - crown, GW + 1), G.x, (lt + crown) / 2, G.z, yaw);
      for (let t = 0; t < 5; t++) {
        const f = (t + 0.5) / 5 - 0.5;
        for (const side of [1, -1]) put(parts.stone, new T.BoxGeometry(0.6, 1.1, 1.0), G.x + G.d[0] * f * GW + G.nr[0] * side * (depth / 2 - 0.3), lt + 0.55, G.z + G.d[1] * f * GW + G.nr[1] * side * (depth / 2 - 0.3), yaw);
      }
      const arch = new T.CylinderGeometry(half, half, depth, 20, 1, true, Math.PI / 2, Math.PI); arch.rotateX(Math.PI / 2);   /* the vault's underside */
      put(parts.arch, arch, G.x, spring, G.z, yaw + Math.PI / 2);
      for (let k = 0; k < 6; k++) {   /* the spandrels: stone between the arch's curve and the bridge */
        const a0 = k / 6 * Math.PI / 2, a1 = (k + 1) / 6 * Math.PI / 2, y0 = spring + half * Math.sin(a0), y1 = crown, w = half - half * Math.cos(a1);
        for (const s of [-1, 1]) { const off = (half - w / 2) * s; put(parts.stone, new T.BoxGeometry(depth, y1 - y0, w + 0.02), G.x + G.d[0] * off, (y0 + y1) / 2, G.z + G.d[1] * off, yaw); }
      }
      for (const s of [-1, 1]) {   /* the doors, swung open against the passage's sides, inside */
        const hx = G.x + G.d[0] * s * (half - 0.2) - G.nr[0] * (depth / 2 + 0.1), hz = G.z + G.d[1] * s * (half - 0.2) - G.nr[1] * (depth / 2 + 0.1);
        const ex = hx - G.nr[0] * half, ez = hz - G.nr[1] * half, gy = ground((hx + ex) / 2, (hz + ez) / 2);
        put(parts.wood, new T.BoxGeometry(0.25, 5.2, half), (hx + ex) / 2, gy + 2.6, (hz + ez) / 2, yaw + Math.PI / 2);
        for (const yy of [1.2, 4.0]) put(parts.gold, new T.BoxGeometry(0.3, 0.16, half - 0.3), (hx + ex) / 2, gy + yy, (hz + ez) / 2, yaw + Math.PI / 2);
        segs.push({ a: [hx, hz], b: [ex, ez], r: 0.15, top: gy + 5.2 });
        /* a banner on each tower, outside: red with a golden sun */
        const tx = G.x + G.d[0] * s * (half + GT_R - 0.2) + G.nr[0] * (GT_R + 0.12), tz = G.z + G.d[1] * s * (half + GT_R - 0.2) + G.nr[1] * (GT_R + 0.12), ty = gg + H - 1.2;
        put(parts.cloth, new T.BoxGeometry(0.08, 4.2, 1.7), tx, ty, tz, yaw);
        put(parts.gold, new T.CylinderGeometry(0.45, 0.45, 0.1, 12).rotateZ(Math.PI / 2), tx + G.nr[0] * 0.06, ty + 0.6, tz + G.nr[1] * 0.06, yaw);
        put(parts.gold, new T.BoxGeometry(0.18, 0.18, 1.9), tx, ty + 2.15, tz, yaw);   /* its pole */
      }
    }
    /* each material's pieces as one mesh; the stone's texture laid by where it is, so it never stretches */
    function join(list) {
      let N = 0; const gs = list.map(g => { const h = g.index ? g.toNonIndexed() : g; N += h.attributes.position.count; return h; });
      const Pp = new Float32Array(N * 3), Nn = new Float32Array(N * 3), U = new Float32Array(N * 2); let o = 0;
      for (const g of gs) {
        const p = g.attributes.position, nn = g.attributes.normal;
        for (let i = 0; i < p.count; i++, o++) {
          const x = p.getX(i), y = p.getY(i), z = p.getZ(i), nx = nn.getX(i), ny = nn.getY(i), nz = nn.getZ(i);
          Pp[o * 3] = x; Pp[o * 3 + 1] = y; Pp[o * 3 + 2] = z; Nn[o * 3] = nx; Nn[o * 3 + 1] = ny; Nn[o * 3 + 2] = nz;
          if (Math.abs(ny) > 0.7) { U[o * 2] = x / 3; U[o * 2 + 1] = z / 3; } else { U[o * 2] = (Math.abs(nx) > Math.abs(nz) ? z : x) / 3; U[o * 2 + 1] = y / 3; }
        }
        g.dispose();
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(Pp, 3)); geo.setAttribute('normal', new T.BufferAttribute(Nn, 3)); geo.setAttribute('uv', new T.BufferAttribute(U, 2));
      return geo;
    }
    const stone = mat('stone', { m: { color: '#c9c0b0' } }), group = new T.Group();
    const looks = { stone, arch: Object.assign(stone.clone(), { side: T.DoubleSide }), roof: plain('#3e5f93', { roughness: 0.7 }),
                    wood: mat('planks', { m: { color: '#8a5e3a' } }), cloth: plain('#a3201f', { side: T.DoubleSide }), gold: plain('#d9b44a', { metalness: 0.5, roughness: 0.45 }) };
    for (const k in parts) if (parts[k].length) { const m = new T.Mesh(join(parts[k]), looks[k]); m.castShadow = k !== 'cloth'; m.receiveShadow = true; group.add(m); }
    group.userData.keep = true; ctx.scene.add(group);
    return { segs, gates: gates.map(g => [g.x, g.z]), group };
  };
  /* A THING TO GATHER (tbuuol 2026-10-23: wood, ore and plants around Blockshire): an oak to fell, a boulder with
     copper and iron in it, a patch of herbs. Returns {use: the mesh the crosshair finds, set(spent)}: spent, the oak
     is a stump, the boulder a dull stone, the herbs gone, until it grows back. */
  /* a group's meshes of one material made one (position, normal, uv): a thing of fifteen parts drawn in three calls */
  function joinByMaterial(group) {
    const by = new Map();
    for (const m of group.children.slice()) {
      if (!m.isMesh || m.isInstancedMesh) continue;
      m.updateMatrix();
      const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrix);
      if (!by.has(m.material)) by.set(m.material, { geos: [], shadow: m.castShadow });
      by.get(m.material).geos.push(g); group.remove(m); m.geometry.dispose();
    }
    for (const [material, { geos, shadow }] of by) {
      let n = 0; for (const g of geos) n += g.attributes.position.count;
      const coloured = geos.some(g => g.attributes.color);   /* painted light (litFromAbove): kept, white where a part had none */
      const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2), C = coloured ? new Float32Array(n * 3).fill(1) : null; let at = 0;
      for (const g of geos) {
        const c = g.attributes.position.count;
        P.set(g.attributes.position.array.subarray(0, c * 3), at * 3);
        if (g.attributes.normal) N.set(g.attributes.normal.array.subarray(0, c * 3), at * 3);
        if (g.attributes.uv) U.set(g.attributes.uv.array.subarray(0, c * 2), at * 2);
        if (C && g.attributes.color) C.set(g.attributes.color.array.subarray(0, c * 3), at * 3);
        at += c; g.dispose();
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(P, 3)); geo.setAttribute('normal', new T.BufferAttribute(N, 3)); geo.setAttribute('uv', new T.BufferAttribute(U, 2));
      if (C) geo.setAttribute('color', new T.BufferAttribute(C, 3));
      const m = new T.Mesh(geo, material); m.castShadow = shadow; m.receiveShadow = true; group.add(m);
    }
  }
  art.resource = function (ctx, def) {   /* def.y: the ground it stands on (out in the world's land; 0 in a place) */
    const [x, z] = def.pos, y0 = def.y || 0, g = new T.Group(), rnd = art.rng(Math.round(x * 31 + z * 17)), full = new T.Group(), left = new T.Group();
    g.add(full, left);
    let use;
    if (def.kind === 'tree') {
      const bark = mat('bark'), trunk = mesh(new T.CylinderGeometry(0.32, 0.42, 3.2, 10), bark); trunk.position.y = 1.6; full.add(trunk);
      const leaf = plain('#3f6b2a'), leaf2 = plain('#4f7d33');
      for (let i = 0; i < 5; i++) { const b = mesh(new T.IcosahedronGeometry(1.15 + rnd() * 0.4, 1), i % 2 ? leaf : leaf2); b.position.set((rnd() - 0.5) * 1.6, 3.4 + rnd() * 1.1, (rnd() - 0.5) * 1.6); full.add(b); }
      const stump = mesh(new T.CylinderGeometry(0.34, 0.42, 0.45, 10), bark); stump.position.y = 0.22; left.add(stump);
      const ring = mesh(new T.CylinderGeometry(0.3, 0.3, 0.02, 10), plain('#c9a27a')); ring.position.y = 0.46; left.add(ring);
      use = mesh(new T.CylinderGeometry(0.6, 0.6, 2.4, 8), new T.MeshBasicMaterial({ visible: false })); use.position.y = 1.2;
      ctx.solid([x - 0.45, y0, z - 0.45], [x + 0.45, y0 + 3, z + 0.45]);
    } else if (def.kind === 'rock') {
      const geo = new T.DodecahedronGeometry(0.9, 1), p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) { const k = 0.85 + rnd() * 0.3; p.setXYZ(i, p.getX(i) * k * 1.2, p.getY(i) * k * 0.8, p.getZ(i) * k); }
      geo.computeVertexNormals();
      const stone = mesh(geo, mat('stone', { m: { color: '#9a958c' } })); stone.position.y = 0.55; g.add(stone);
      const copper = plain('#c87533', { metalness: 0.6, roughness: 0.35 }), iron = plain('#7d8590', { metalness: 0.7, roughness: 0.3 });
      for (let i = 0; i < 9; i++) {   /* veins: bits of ore in the stone's skin */
        const a = rnd() * Math.PI * 2, h = rnd() * 0.6, v = mesh(new T.BoxGeometry(0.16, 0.12, 0.08), i % 3 ? copper : iron);
        v.position.set(Math.cos(a) * 0.95, 0.35 + h, Math.sin(a) * 0.75); v.lookAt(0, 0.6, 0); full.add(v);
      }
      use = mesh(new T.SphereGeometry(1.1, 8, 6), new T.MeshBasicMaterial({ visible: false })); use.position.y = 0.6;
      ctx.solid([x - 0.9, y0, z - 0.75], [x + 0.9, y0 + 1.1, z + 0.75]);
    } else {
      const leaf = plain('#5d8c3a'), flower = plain('#d9c2f0'), flax = plain('#7fa3d9');
      for (let i = 0; i < 7; i++) { const b = mesh(new T.IcosahedronGeometry(0.22 + rnd() * 0.12, 0), leaf); b.position.set((rnd() - 0.5) * 0.9, 0.2, (rnd() - 0.5) * 0.9); full.add(b); }
      for (let i = 0; i < 6; i++) { const f = mesh(new T.SphereGeometry(0.06, 6, 4), i % 2 ? flower : flax); f.position.set((rnd() - 0.5) * 0.8, 0.42, (rnd() - 0.5) * 0.8); full.add(f); }
      const dirt = mesh(new T.CylinderGeometry(0.55, 0.6, 0.04, 12), plain('#5a4632')); dirt.position.y = 0.02; left.add(dirt);
      use = mesh(new T.SphereGeometry(0.7, 8, 6), new T.MeshBasicMaterial({ visible: false })); use.position.y = 0.3;
    }
    joinByMaterial(full); joinByMaterial(left);
    g.add(use);
    g.position.set(x, y0, z); g.rotation.y = rnd() * Math.PI * 2; g.userData.keep = true; ctx.scene.add(g);
    left.visible = false;
    return { use, group: g, set(spent) { full.visible = !spent; left.visible = !!spent; } };
  };
  /* THE FORGE (tbuuol 2026-10-23: "a smithy in Blockshire where the craft menu opens"): a stone hearth with glowing
     coals and a flickering light, a chimney, an anvil on a block, a workbench. Returns {use}: the crosshair finds it. */
  art.forge = function (ctx, def) {
    const [x, z] = def.pos, g = new T.Group(), stone = mat('stone', { m: { color: '#8f877c' } }), bark = mat('bark');
    const hearth = mesh(boxM(2.2, 1.1, 1.6, 1), stone); hearth.position.set(0, 0.55, -0.4); g.add(hearth);
    const coals = mesh(new T.BoxGeometry(1.4, 0.12, 0.9), new T.MeshStandardMaterial({ color: '#ff6a1a', emissive: '#ff4a00', emissiveIntensity: 2.4 }), false);
    coals.position.set(0, 1.14, -0.35); g.add(coals);
    const hood = mesh(new T.CylinderGeometry(0.35, 1.0, 0.9, 4), stone); hood.position.set(0, 1.95, -0.5); hood.rotation.y = Math.PI / 4; g.add(hood);
    const chimney = mesh(boxM(0.55, 2.4, 0.55, 1), stone); chimney.position.set(0, 3.5, -0.5); g.add(chimney);
    const glow = new T.PointLight('#ff7a2a', 2.2, 7, 1.6); glow.position.set(0, 1.6, 0.2); g.add(glow);
    const block = mesh(new T.CylinderGeometry(0.32, 0.38, 0.55, 10), bark); block.position.set(1.7, 0.27, 0.6); g.add(block);
    const iron = plain('#3b3d42', { metalness: 0.75, roughness: 0.4 });
    const anvil = mesh(new T.BoxGeometry(0.62, 0.18, 0.26), iron); anvil.position.set(1.7, 0.66, 0.6); g.add(anvil);
    const horn = mesh(new T.ConeGeometry(0.12, 0.3, 8), iron); horn.rotation.z = -Math.PI / 2; horn.position.set(2.15, 0.68, 0.6); g.add(horn);
    const waist = mesh(new T.BoxGeometry(0.3, 0.16, 0.2), iron); waist.position.set(1.7, 0.5, 0.6); g.add(waist);
    const bench = mesh(boxM(1.6, 0.12, 0.7, 1), mat('planks')); bench.position.set(-1.9, 0.85, 0.5); g.add(bench);
    for (const lx of [-2.55, -1.25]) for (const lz of [0.25, 0.75]) { const leg = mesh(new T.BoxGeometry(0.1, 0.8, 0.1), bark); leg.position.set(lx, 0.4, lz); g.add(leg); }
    const hammer = mesh(new T.BoxGeometry(0.16, 0.08, 0.08), iron); hammer.position.set(-1.7, 0.95, 0.5); g.add(hammer);
    const use = mesh(new T.BoxGeometry(5, 2.2, 2.4), new T.MeshBasicMaterial({ visible: false })); use.position.set(0, 1.1, 0.1); g.add(use);
    g.position.set(x, 0, z); g.rotation.y = (def.rot || 0) * Math.PI / 180; g.userData.keep = true; ctx.scene.add(g);
    g.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(hearth); ctx.solid([box.min.x, 0, box.min.z], [box.max.x, 1.1, box.max.z]);
    let t = 0; ctx.every(dt => { t += dt; glow.intensity = 2.0 + Math.sin(t * 11) * 0.25 + Math.sin(t * 23) * 0.15; });
    return { use };
  };
  art.prop = function (ctx, def) {
    const [x, z] = def.pos, r = (def.rot || 0) * Math.PI / 180, g = new T.Group();
    let box = null;
    if (def.kind === 'crate') { const c = mesh(boxM(0.9, 0.9, 0.9, 0.9), mat('planks', { m: { color: '#c09060' } })); c.position.y = 0.45; g.add(c); box = [0.45, 0.9]; }
    else if (def.kind === 'barrel') { g.add(art.barrel()); box = [0.32, 0.8]; }
    else if (def.kind === 'logpile') {
      const bark = mat('bark'); let i = 0;
      for (const [row, n] of [[0, 4], [1, 3], [2, 2]]) for (let k = 0; k < n; k++) { const l = mesh(new T.CylinderGeometry(0.18, 0.18, 2, 9), bark); l.rotation.z = Math.PI / 2; l.position.set(0, 0.18 + row * 0.32, (k - (n - 1) / 2) * 0.37); g.add(l); i++; }
      box = [1.0, 0.9];
    }
    else if (def.kind === 'haystack') { const h = mesh(new T.CylinderGeometry(0.7, 1.1, 1.4, 12), mat('thatch', { m: { bumpScale: 2 } })); h.position.y = 0.7; g.add(h); const tp = mesh(new T.ConeGeometry(0.72, 0.6, 12), mat('thatch')); tp.position.y = 1.7; g.add(tp); box = [0.85, 1.4]; }
    else if (def.kind === 'bench') {
      const bark = mat('bark'), seat = mesh(new T.CylinderGeometry(0.22, 0.22, 2.0, 9), bark); seat.rotation.z = Math.PI / 2; seat.position.y = 0.32; seat.scale.z = 0.8; g.add(seat);
      box = [0.95, 0.5];
    }
    else if (def.kind === 'stump') { const s = mesh(new T.CylinderGeometry(0.35, 0.42, 0.5, 10), mat('bark')); s.position.y = 0.25; g.add(s); const top = mesh(new T.CylinderGeometry(0.34, 0.34, 0.02, 12), plain('#c8a070')); top.position.y = 0.51; g.add(top);
      if (def.axe) { const h = mesh(new T.CylinderGeometry(0.025, 0.025, 0.7, 6), plain('#7a5230')); h.position.set(0.1, 0.75, 0); h.rotation.z = 0.5; g.add(h); const b = mesh(new T.BoxGeometry(0.06, 0.18, 0.22), plain('#8a8f95', { metalness: 0.7, roughness: 0.35 })); b.position.set(-0.05, 0.52, 0); g.add(b); }
      box = [0.4, 0.5]; }
    else if (def.kind === 'lamppost') { const p = mesh(new T.CylinderGeometry(0.06, 0.08, 2.4, 6), mat('bark')); p.position.y = 1.2; g.add(p); const l = art.lantern(); l.position.y = 2.5; g.add(l); box = [0.15, 2.4]; }
    else if (def.kind === 'cart') {
      const wood = mat('planks', { m: { color: '#a5774c' } });
      const bed = mesh(boxM(1.4, 0.15, 2.2, 1), wood); bed.position.y = 0.75; g.add(bed);
      for (const sx of [-0.7, 0.7]) { const s = mesh(boxM(0.08, 0.45, 2.2, 1), wood); s.position.set(sx, 1.0, 0); g.add(s); }
      for (const sx of [-0.78, 0.78]) { const w = mesh(new T.TorusGeometry(0.42, 0.06, 6, 14), plain('#4a3220')); w.rotation.y = Math.PI / 2; w.position.set(sx, 0.45, 0.4); g.add(w); }
      const pole = mesh(new T.CylinderGeometry(0.04, 0.04, 1.8, 6), plain('#7a5230')); pole.rotation.x = 1.35; pole.position.set(0, 0.55, -1.8); g.add(pole);
      for (let i = 0; i < 4; i++) { const c = mesh(new T.CylinderGeometry(0.12, 0.12, 0.3, 8), plain(['#d35400', '#27ae60', '#c0392b', '#f39c12'][i])); c.position.set(-0.35 + i * 0.23, 0.98, -0.3 + (i % 2) * 0.4); g.add(c); }
      box = [0.9, 1.3, 1.2];
    }
    g.position.set(x, 0, z); g.rotation.y = r; ctx.scene.add(g);
    if (box && def.solid !== false) { const hx = box[0], hz = box[2] || box[0]; const ex = Math.abs(Math.cos(r)) * hx + Math.abs(Math.sin(r)) * hz, ez = Math.abs(Math.sin(r)) * hx + Math.abs(Math.cos(r)) * hz; ctx.solid([x - ex, 0, z - ez], [x + ex, box[1], z + ez]); }
    return g;
  };
  art.well = function (ctx, def) {
    const [x, z] = def.pos, g = new T.Group(), stone = mat('stone', { m: { bumpScale: 1.5 } }), wood = mat('bark');
    const ring = mesh(new T.CylinderGeometry(1.0, 1.05, 0.9, 20, 1, true), stone); ring.position.y = 0.45; g.add(ring);
    const inner = mesh(new T.CylinderGeometry(0.82, 0.82, 0.9, 20, 1, true), stone); inner.position.y = 0.45; inner.material = stone; g.add(inner);
    const rim = mesh(new T.TorusGeometry(0.92, 0.12, 8, 24), stone); rim.rotation.x = Math.PI / 2; rim.position.y = 0.9; g.add(rim);
    const water = mesh(new T.CircleGeometry(0.82, 24), new T.MeshStandardMaterial({ color: '#1f4d5a', roughness: 0.1, metalness: 0.3, emissive: '#0a2a33' }), false); water.rotation.x = -Math.PI / 2; water.position.y = 0.35; g.add(water);
    for (const sx of [-0.95, 0.95]) { const p = mesh(new T.CylinderGeometry(0.08, 0.08, 1.9, 6), wood); p.position.set(sx, 1.4, 0); g.add(p); }
    const roof = mesh(new T.ConeGeometry(1.5, 0.9, 4), mat('thatch', { m: { bumpScale: 2 } })); roof.position.y = 2.65; roof.rotation.y = Math.PI / 4; g.add(roof);
    const axle = mesh(new T.CylinderGeometry(0.06, 0.06, 1.9, 6), wood); axle.rotation.z = Math.PI / 2; axle.position.y = 1.85; g.add(axle);
    const bucket = mesh(new T.CylinderGeometry(0.16, 0.13, 0.25, 10), mat('planks', { m: { color: '#a5774c' } })); bucket.position.set(0.2, 1.35, 0); g.add(bucket);
    const glow = mesh(new T.SphereGeometry(0.12, 12, 8), new T.MeshBasicMaterial({ color: '#8fd3ff' }), false); glow.position.set(0, 1.2, 0); glow.userData.keep = true; g.add(glow);
    g.position.set(x, 0, z); ctx.scene.add(g);
    ctx.solid([x - 1.1, 0, z - 1.1], [x + 1.1, 1.0, z + 1.1]);
    let pulse = 0; ctx.every((dt, t) => { pulse += dt; glow.scale.setScalar(1 + Math.sin(t * 2.5) * 0.15); });
    /* the whole well is one easy thing to aim at */
    const hit = new T.Mesh(new T.CylinderGeometry(1.15, 1.15, 2.8, 12), new T.MeshBasicMaterial({ visible: false }));
    hit.position.set(x, 1.4, z); ctx.scene.add(hit);
    return { use: hit, also: [], glow };
  };

  /* --- a portal to another level ------------------------------------------------------------------------------ */
  /* An arch of stone around a surface that swirls and glows (bright enough to bloom); it faces `face` ([x, z]) or
     its rotation. The engine sends whoever walks through it to def.to. Returns {x, z, label}. */
  art.portal = function (ctx, def) {
    const [x, z] = def.pos, g = new T.Group(), stone = mat('stone', { m: { color: '#b8b2a8' } });
    const W = 2.4, H = 3.4;
    for (const sx of [-1, 1]) {
      const pil = mesh(boxM(0.6, H, 0.7, 1), stone); pil.position.set(sx * (W / 2 + 0.3), H / 2, 0); g.add(pil);
      const cap = mesh(boxM(0.8, 0.25, 0.9, 1), stone); cap.position.set(sx * (W / 2 + 0.3), H + 0.12, 0); g.add(cap);
    }
    const lintel = mesh(boxM(W + 1.6, 0.55, 0.8, 1), stone); lintel.position.set(0, H + 0.5, 0); g.add(lintel);
    const step = mesh(boxM(W + 1.8, 0.2, 1.6, 1), stone); step.position.set(0, 0.1, 0); g.add(step);
    const time = { value: 0 };
    const veil = new T.Mesh(new T.PlaneGeometry(W, H), new T.ShaderMaterial({
      uniforms: { t: time, tint: { value: new T.Color(def.color || '#7fc8ff') } }, transparent: true, depthWrite: false, side: T.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float t; uniform vec3 tint; varying vec2 vUv;
        void main(){
          vec2 p = (vUv - 0.5) * vec2(1.0, 1.4); float r = length(p), a = atan(p.y, p.x);
          float swirl = sin(a * 5.0 + r * 18.0 - t * 3.0) * 0.5 + 0.5;
          float ring = smoothstep(0.75, 0.2, r);
          float glow = ring * (0.55 + swirl * 0.6) + smoothstep(0.25, 0.0, r) * 0.8;
          float edge = smoothstep(0.5, 0.42, abs(vUv.x - 0.5)) * smoothstep(0.5, 0.45, abs(vUv.y - 0.5));
          gl_FragColor = vec4(tint * glow * 2.4, clamp(glow, 0.0, 1.0) * edge * 0.9); }`
    }));
    veil.position.set(0, H / 2 + 0.2, 0); veil.userData.keep = true; g.add(veil);
    if (def.label) {   /* a carved plate on the lintel */
      const [c, x2] = canvas(512); c.height = 96; x2.fillStyle = '#3d362e'; x2.fillRect(0, 0, 512, 96);
      x2.font = 'bold 54px Georgia, serif'; x2.textAlign = 'center'; x2.fillStyle = '#e9dcc0'; x2.fillText(def.label, 256, 66);
      const tx = new T.CanvasTexture(c); tx.colorSpace = T.SRGBColorSpace;
      const plate = new T.Mesh(new T.PlaneGeometry(W + 0.8, 0.42), new T.MeshStandardMaterial({ map: tx, roughness: 0.9 }));
      plate.position.set(0, H + 0.5, 0.41); g.add(plate);
      const back = plate.clone(); back.rotation.y = Math.PI; back.position.z = -0.41; g.add(back);
    }
    const yaw = def.face ? Math.atan2(def.face[0] - x, def.face[1] - z) : (def.rot || 0) * Math.PI / 180;
    g.position.set(x, def.y || 0, z); g.rotation.y = yaw; ctx.scene.add(g);
    const c2 = Math.cos(yaw), s2 = Math.sin(yaw);
    for (const sx of [-1, 1]) {   /* the pillars block; the opening does not */
      const px = x + sx * (W / 2 + 0.3) * c2, pz = z - sx * (W / 2 + 0.3) * s2;
      ctx.solid([px - 0.45, def.y || 0, pz - 0.45], [px + 0.45, (def.y || 0) + H + 0.8, pz + 0.45]);
    }
    ctx.every((dt, t) => { time.value = t; });
    return { x, z, y: def.y || 0, to: def.to, label: def.label };
  };

  /* --- fewer draw calls: what never moves, merged by material --------------------------------------------- */
  /* Called once the level is built. Every plain mesh that does not move (no door, person, pickup, sky: those carry
     userData.keep, or sit under something that does) is baked into world space and joined with the others that share
     its material, so a village of a few hundred parts is drawn in a few dozen calls, in its shadow pass too. */
  art.freeze = function (scene) {
    scene.updateMatrixWorld(true);
    const kept = o => { for (let p = o; p; p = p.parent) if (p.userData && p.userData.keep) return true; return false; };
    const buckets = new Map();
    scene.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material) || !o.visible || o.material.visible === false || kept(o)) return;
      const key = o.material.uuid + (o.castShadow ? 's' : '-') + (o.receiveShadow ? 'r' : '-');
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(o);
    });
    let joined = 0, calls = 0;
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      const geos = list.map(o => { const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()); g.applyMatrix4(o.matrixWorld); return g; });
      const n = geos.reduce((s2, g) => s2 + g.attributes.position.count, 0), colour = geos.every(g => g.attributes.color);
      const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2), C = colour ? new Float32Array(n * 3) : null;
      let at = 0;
      for (const g of geos) {
        const c = g.attributes.position.count;
        P.set(g.attributes.position.array.subarray(0, c * 3), at * 3);
        if (g.attributes.normal) N.set(g.attributes.normal.array.subarray(0, c * 3), at * 3);
        if (g.attributes.uv) U.set(g.attributes.uv.array.subarray(0, c * 2), at * 2);
        if (C) C.set(g.attributes.color.array.subarray(0, c * 3), at * 3);
        at += c; g.dispose();
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(P, 3)); geo.setAttribute('normal', new T.BufferAttribute(N, 3)); geo.setAttribute('uv', new T.BufferAttribute(U, 2));
      if (C) geo.setAttribute('color', new T.BufferAttribute(C, 3));
      geo.computeBoundingSphere();
      const m = new T.Mesh(geo, list[0].material); m.castShadow = list[0].castShadow; m.receiveShadow = list[0].receiveShadow;
      scene.add(m);
      for (const o of list) o.parent.remove(o);
      joined += list.length; calls++;
    }
    return { joined, calls };
  };

  /* --- after the scene: bloom, a film tone, a warm grade, a vignette (shader code, no library) ---------------- */
  /* The scene is drawn into a high-range picture; whatever is brighter than white (fire, lanterns, the sun) is
     blurred down and up four levels and laid back over it as a glow; then one pass does the tone mapping (ACES), a
     little more colour, a warm tint, a soft S-curve, the vignette and a dither against banding in the sky. */
  art.post = function (renderer, scene, camera, opts) {
    if (!renderer.capabilities.isWebGL2) return null;
    opts = opts || {};
    const RT = ms => new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType, samples: ms || 0, depthBuffer: !!ms });
    const main = RT(2), down = [RT(), RT(), RT(), RT()], up = [RT(), RT(), RT()];
    const qscene = new T.Scene(), cam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1), quad = new T.Mesh(new T.PlaneGeometry(2, 2));
    quad.frustumCulled = false; qscene.add(quad);
    const V = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
    const shader = (uniforms, body) => new T.ShaderMaterial({ uniforms, vertexShader: V, fragmentShader: body, depthTest: false, depthWrite: false });
    const DOWN = shader({ src: { value: null }, texel: { value: new T.Vector2() }, threshold: { value: 0 } },
      'uniform sampler2D src; uniform vec2 texel; uniform float threshold; varying vec2 vUv;' +
      'vec3 tap(vec2 o){ return texture2D(src, vUv + o * texel).rgb; }' +
      'void main(){ vec3 c = tap(vec2(0.0)) * 0.5 + (tap(vec2(-1.0,-1.0)) + tap(vec2(1.0,-1.0)) + tap(vec2(-1.0,1.0)) + tap(vec2(1.0,1.0))) * 0.125;' +
      ' if (threshold > 0.0) { float l = max(c.r, max(c.g, c.b)); c *= clamp((l - threshold) / max(l, 1e-4), 0.0, 1.0); }' +
      ' gl_FragColor = vec4(c, 1.0); }');
    const UP = shader({ src: { value: null }, base: { value: null }, texel: { value: new T.Vector2() } },
      'uniform sampler2D src; uniform sampler2D base; uniform vec2 texel; varying vec2 vUv;' +
      'vec3 tap(vec2 o){ return texture2D(src, vUv + o * texel).rgb; }' +
      'void main(){ vec3 c = (tap(vec2(-1.0,-1.0)) + tap(vec2(1.0,-1.0)) + tap(vec2(-1.0,1.0)) + tap(vec2(1.0,1.0))) * 0.25;' +
      ' gl_FragColor = vec4(c + texture2D(base, vUv).rgb, 1.0); }');
    const FINAL = shader({ scene: { value: null }, bloom: { value: null }, strength: { value: opts.bloom == null ? 0.5 : opts.bloom },
                           exposure: { value: opts.exposure || 1 }, time: { value: 0 } },
      `uniform sampler2D scene; uniform sampler2D bloom; uniform float strength; uniform float exposure; uniform float time; varying vec2 vUv;
       vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
       vec3 srgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
       float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
       void main(){
         vec3 c = texture2D(scene, vUv).rgb + texture2D(bloom, vUv).rgb * strength;
         c = aces(c * exposure * 0.92);
         float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
         c = clamp(mix(vec3(l), c, 1.14), 0.0, 1.0);                 /* the old WoW: rich colour (tbuuol 2026-10-27) */
         c = mix(c * vec3(0.92, 0.97, 1.08), c * vec3(1.04, 1.01, 0.94), smoothstep(0.1, 0.7, l));   /* cool shadows, warm light */
         c = mix(c, c * c * (3.0 - 2.0 * c), 0.2);
         vec2 d = vUv - 0.5; c *= 1.0 - dot(d, d) * 0.35;
         c = srgb(clamp(c, 0.0, 1.0)) + (hash(vUv * 1000.0 + time) - 0.5) / 255.0;
         gl_FragColor = vec4(c, 1.0); }`);
    let W = 1, H = 1;
    const pass = (material, target) => { quad.material = material; renderer.setRenderTarget(target); renderer.render(qscene, cam); };
    return {
      resize(w, h) {
        const pr = renderer.getPixelRatio(); W = Math.max(1, Math.round(w * pr)); H = Math.max(1, Math.round(h * pr)); main.setSize(W, H);
        let lw = W, lh = H;
        for (let i = 0; i < down.length; i++) { lw = Math.max(1, lw >> 1); lh = Math.max(1, lh >> 1); down[i].setSize(lw, lh); if (i < up.length) up[i].setSize(lw, lh); }
      },
      render(t) {
        renderer.setRenderTarget(main); renderer.render(scene, camera);
        let src = main;
        for (let i = 0; i < down.length; i++) {
          DOWN.uniforms.src.value = src.texture; DOWN.uniforms.texel.value.set(1 / src.width, 1 / src.height); DOWN.uniforms.threshold.value = i ? 0 : 1.0;
          pass(DOWN, down[i]); src = down[i];
        }
        for (let i = down.length - 2; i >= 0; i--) {
          UP.uniforms.src.value = src.texture; UP.uniforms.base.value = down[i].texture; UP.uniforms.texel.value.set(0.5 / src.width, 0.5 / src.height);
          pass(UP, up[i]); src = up[i];
        }
        FINAL.uniforms.scene.value = main.texture; FINAL.uniforms.bloom.value = src.texture; FINAL.uniforms.time.value = (t || 0) % 100;
        pass(FINAL, null);
      },
      /* a zone left through a portal: its targets and shaders off the graphics card */
      dispose() { for (const r of [main].concat(down, up)) r.dispose(); for (const m of [DOWN, UP, FINAL]) m.dispose(); quad.geometry.dispose(); }
    };
  };

  /* --- people ------------------------------------------------------------------------------------------------ */
  /* OUR OWN FIGURE (tbuuol 2026-10-27: an own style, a bit round, like the old WoW): made by code, no model file.
     Broad round shoulders, big hands and boots, a head a little large, a painted face; every part is lit from above
     by its vertex colours (bright on top, darker below), as the old hand-painted figures were. Arms and legs bend at
     elbows and knees; walking, running, breathing, a sword swing, a cast, nodding, shaking the head, bending down and
     falling are all moved by code. look: {skin, shirt, pants, hair, eyes, beard, hood, hat, helm, apron, gloves, boots,
     build: 'slim', hairStyle: 'short'|'long'|'bun'|'bald', scale, tint}. */
  const bodyMats = {};
  function bodyMat(color, tint, map) {   /* one material per colour; the vertex colours carry the light */
    const key = color + '|' + (tint || '') + (map ? '|' + map.uuid : '');
    if (bodyMats[key]) return bodyMats[key];
    const c = new T.Color(color); if (tint) c.multiply(new T.Color(tint));
    return (bodyMats[key] = new T.MeshStandardMaterial({ color: c, map: map || null, vertexColors: true, roughness: 0.85, metalness: 0 }));
  }
  function litFromAbove(geo, lo, hi) {   /* painted light: the top of a part bright, its underside dark */
    const pos = geo.attributes.position; let y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { const k = (pos.getY(i) - y0) / Math.max(1e-6, y1 - y0), v = (lo || 0.8) + ((hi || 1.1) - (lo || 0.8)) * k; col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v; }
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    return geo;
  }
  const faces = {};
  function faceTexture(skin, eyes, brows, soft, patch) {   /* the face, painted where a sphere's front (-z) is: u 0.75; soft: a woman's */
    const key = skin + eyes + brows + (soft ? 's' : '') + (patch ? 'p' : '');
    if (faces[key]) return faces[key];
    const [c, x] = canvas(256); c.height = 128;
    x.fillStyle = skin; x.fillRect(0, 0, 256, 128);
    const cx = 192;
    x.fillStyle = shade(skin.length === 7 ? skin : '#e0b18c', 1.08); x.beginPath(); x.ellipse(cx, 70, 30, 20, 0, 0, 7); x.fill();   /* lit cheeks */
    for (const sx of [-1, 1]) {
      const ex = cx + sx * 15;
      x.fillStyle = '#fbf6ec'; x.beginPath(); x.ellipse(ex, 58, 8, 5.5, 0, 0, 7); x.fill();
      x.fillStyle = eyes; x.beginPath(); x.arc(ex - sx * 1, 58.5, 4, 0, 7); x.fill();
      x.fillStyle = '#111'; x.beginPath(); x.arc(ex - sx * 1, 58.5, 2, 0, 7); x.fill();
      x.fillStyle = '#fff'; x.beginPath(); x.arc(ex - sx * 1 - 1.3, 57, 1.1, 0, 7); x.fill();
      x.strokeStyle = 'rgba(40,20,10,.75)'; x.lineWidth = 1.6; x.beginPath(); x.ellipse(ex, 58, 8, 5.5, 0, Math.PI * 1.05, Math.PI * 1.95); x.stroke();
      if (soft) {   /* thin arched brows, lashes */
        x.strokeStyle = brows; x.lineWidth = 2.2; x.lineCap = 'round'; x.beginPath(); x.moveTo(ex - sx * 9, 49); x.quadraticCurveTo(ex, 44, ex + sx * 8, 48); x.stroke();
        x.strokeStyle = '#1a0f08'; x.lineWidth = 2.6; x.beginPath(); x.ellipse(ex, 58, 8, 5.5, 0, Math.PI * 1.1, Math.PI * 1.9); x.stroke();
      } else { x.strokeStyle = brows; x.lineWidth = 4; x.lineCap = 'round'; x.beginPath(); x.moveTo(ex - sx * 9, 49 + 1.5); x.lineTo(ex + sx * 6, 47.5); x.stroke(); }
    }
    if (soft) { x.fillStyle = '#b5524a'; x.beginPath(); x.ellipse(cx, 85, 7, 2.8, 0, 0, 7); x.fill(); x.fillStyle = 'rgba(255,200,190,.5)'; x.beginPath(); x.ellipse(cx, 84, 3.5, 1, 0, 0, 7); x.fill();
                x.fillStyle = 'rgba(220,110,100,.22)'; x.beginPath(); x.arc(cx - 20, 72, 6, 0, 7); x.arc(cx + 20, 72, 6, 0, 7); x.fill(); }
    else { x.strokeStyle = 'rgba(110,45,35,.85)'; x.lineWidth = 2.5; x.lineCap = 'round'; x.beginPath(); x.moveTo(cx - 9, 84); x.quadraticCurveTo(cx, 87.5, cx + 9, 84); x.stroke(); }
    x.fillStyle = 'rgba(120,60,40,.25)'; x.beginPath(); x.ellipse(cx, 76, 6, 3, 0, 0, 7); x.fill();   /* under the nose */
    if (patch) {   /* a pirate's eyepatch over the left eye, its string round the head */
      x.fillStyle = '#141010'; x.beginPath(); x.ellipse(cx + 15, 58, 10, 8, 0, 0, 7); x.fill();
      x.strokeStyle = '#141010'; x.lineWidth = 2; x.beginPath(); x.moveTo(cx - 40, 44); x.lineTo(cx + 40, 66); x.stroke();
    }
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
    return (faces[key] = t);
  }
  art.character = function (ctx, look) {
    look = look || {};
    const skin = look.skin || '#e0b18c', shirt = look.shirt || '#3e6fa8', pants = look.pants || '#4a3b2a', hair = look.hair || '#4a2f1b';
    const tint = look.tint || null, slim = look.build === 'slim', style = look.bald ? 'bald' : (look.hairStyle || (slim ? 'long' : 'short'));
    const M = col => bodyMat(col, tint);
    const g = new T.Group(), s = look.scale || 0.9;
    const part = (geo, col, parent, x, y, z, map) => {
      const m = mesh(litFromAbove(geo), map ? bodyMat(col, tint, map) : M(col)); m.position.set(x || 0, y || 0, z || 0); parent.add(m); return m;
    };
    const joint = (parent, x, y, z) => { const j = new T.Group(); j.position.set(x, y, z); parent.add(j); return j; };
    const cap = (r, len) => new T.CapsuleGeometry(r, len, 3, 8);
    const HIP = 0.89, sw = slim ? 0.86 : 1;   /* shoulder width */
    /* hips and legs */
    const hips = joint(g, 0, HIP, 0);
    part(new T.SphereGeometry(0.19, 10, 8), pants, hips, 0, 0, 0).scale.set(1.15 * sw, 0.72, 0.82);
    const legs = [], knees = [];
    for (const sx of [-1, 1]) {
      const leg = joint(hips, sx * 0.11, -0.03, 0);
      part(cap(0.118, 0.22), pants, leg, 0, -0.2, 0);
      const knee = joint(leg, 0, -0.42, 0);
      part(cap(0.1, 0.2), pants, knee, 0, -0.19, 0);
      const boot = part(new T.CapsuleGeometry(0.085, 0.16, 3, 8), look.boots || '#4a3020', knee, 0, -0.4, -0.05);
      boot.rotation.x = Math.PI / 2; boot.scale.set(1.15, 1, 0.82);
      part(new T.CylinderGeometry(0.105, 0.1, 0.12, 8), look.boots || '#4a3020', knee, 0, -0.3, 0);   /* the boot's cuff */
      legs.push(leg); knees.push(knee);
    }
    /* the body: a barrel wider at the shoulders, a belt, round shoulders */
    const spine = joint(hips, 0, 0.05, 0);
    const chest = part(new T.CylinderGeometry(0.27 * sw, 0.2, 0.5, 10), shirt, spine, 0, 0.27, 0); chest.scale.z = 0.72;
    part(new T.SphereGeometry(0.27 * sw, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), shirt, spine, 0, 0.52, 0).scale.set(1, 0.32, 0.72);   /* the chest's rounded top */
    if (look.belt !== false) {
      part(new T.CylinderGeometry(0.212, 0.212, 0.075, 10), '#3b2814', spine, 0, 0.04, 0).scale.z = 0.76;
      part(new T.BoxGeometry(0.07, 0.06, 0.03), '#c9a24a', spine, 0, 0.04, -0.165);
    }
    if (look.apron) { const ap = part(new T.CylinderGeometry(0.2, 0.26, 0.5, 10, 1, true, Math.PI * 0.65, Math.PI * 0.7), look.apron, spine, 0, -0.2, -0.01); ap.scale.z = 0.95; }   /* hangs from the belt */
    if (look.robe) { const rb = part(new T.CylinderGeometry(0.22, 0.36, 0.78, 12, 1, true), look.robe, spine, 0, -0.42, 0); rb.material = rb.material.clone(); rb.material.side = T.DoubleSide; rb.scale.z = 0.85; }   /* a priest's or an elder's robe */
    const arms = [], elbows = [], hands = [];
    for (const sx of [-1, 1]) {
      part(new T.SphereGeometry(0.135, 10, 8), look.armor ? look.armor : shirt, spine, sx * 0.31 * sw, 0.46, 0).scale.set(1.05, 0.9, 1);   /* round shoulders */
      const arm = joint(spine, sx * 0.34 * sw, 0.44, 0);
      part(cap(0.095, 0.14), shirt, arm, 0, -0.14, 0);
      const elbow = joint(arm, 0, -0.29, 0);
      part(cap(0.088, 0.13), look.gloves ? look.gloves : shirt, elbow, 0, -0.13, 0);
      const hand = joint(elbow, 0, -0.3, 0);
      part(new T.SphereGeometry(0.1, 9, 7), look.gloves || skin, hand, 0, 0.02, 0).scale.set(0.95, 1.15, 0.9);   /* big hands */
      arms.push(arm); elbows.push(elbow); hands.push(hand);
    }
    /* the head: a little large, a painted face, a nose, ears, hair */
    part(new T.CylinderGeometry(0.075, 0.085, 0.1, 8), skin, spine, 0, 0.58, 0);
    const head = joint(spine, 0, 0.62, 0);
    const faceT = faceTexture(skin, look.eyes || '#2b4a7a', shade(hair.length === 7 ? hair : '#4a2f1b', 0.75), slim, !!look.eyepatch);
    const skull = part(new T.SphereGeometry(0.2, 16, 12), '#ffffff', head, 0, 0.18, 0, faceT); skull.scale.set(1, 1.07, 1.02);
    if (!slim) part(new T.SphereGeometry(0.15, 10, 8), skin, head, 0, 0.07, -0.05).scale.set(1.05, 0.62, 0.9);   /* a strong jaw */
    const nose = part(new T.ConeGeometry(0.034, 0.1, 6), skin, head, 0, 0.165, -0.205); nose.rotation.x = -Math.PI / 2 - 0.3;
    for (const sx of [-1, 1]) part(new T.SphereGeometry(0.045, 6, 5), skin, head, sx * 0.2, 0.17, 0.01).scale.set(0.5, 1, 0.8);
    if (style !== 'bald' && !look.hood && !look.helm) {
      part(new T.SphereGeometry(0.215, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.34), hair, head, 0, 0.19, 0.012).scale.set(1.02, 1.12, 1.06);   /* stops at the brow */
      part(new T.SphereGeometry(0.205, 12, 6, Math.PI * 0.15, Math.PI * 0.7, Math.PI * 0.4, Math.PI * 0.35), hair, head, 0, 0.18, 0.02);   /* the back of the head */
      if (style === 'long') part(cap(0.13, 0.22), hair, head, 0, 0.02, 0.1).scale.set(1.3, 1, 0.55);
      if (slim) for (const sx of [-1, 1]) part(cap(0.05, 0.16), hair, head, sx * 0.185, 0.12, -0.02);   /* locks framing the face */
      if (style === 'bun') part(new T.SphereGeometry(0.09, 8, 6), hair, head, 0, 0.36, 0.13);
    }
    if (look.beard) part(new T.SphereGeometry(0.14, 10, 8), look.beard, head, 0, 0.04, -0.11).scale.set(1.15, 1, 0.75);
    if (look.hat) { part(new T.CylinderGeometry(0.34, 0.34, 0.035, 14), look.hat, head, 0, 0.33, 0); part(new T.CylinderGeometry(0.2, 0.22, 0.2, 12), look.hat, head, 0, 0.45, 0); }
    if (look.helm) { part(new T.SphereGeometry(0.225, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.4), look.helm, head, 0, 0.18, 0.01).scale.set(1.04, 1.1, 1.06);
                     part(new T.CylinderGeometry(0.235, 0.235, 0.04, 14), look.helm, head, 0, 0.255, 0.01); part(new T.BoxGeometry(0.035, 0.11, 0.05), look.helm, head, 0, 0.2, -0.225); }
    if (look.tricorn) {   /* a pirate's hat: a crown and a brim turned up on three sides */
      part(new T.CylinderGeometry(0.2, 0.23, 0.18, 12), look.tricorn, head, 0, 0.42, 0.01);
      for (let i = 0; i < 3; i++) { const b = part(new T.BoxGeometry(0.42, 0.13, 0.04), look.tricorn, head, Math.sin(i * 2.09) * 0.2, 0.4, Math.cos(i * 2.09) * 0.2); b.rotation.y = i * 2.09; b.rotation.x = -0.35; }
    }
    if (look.bandana) part(new T.SphereGeometry(0.218, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.36), look.bandana, head, 0, 0.19, 0.01).scale.set(1.03, 1.1, 1.06);
    if (look.hood) { part(new T.SphereGeometry(0.245, 14, 10, Math.PI * 1.85, Math.PI * 1.3, 0, Math.PI * 0.62), look.hood, head, 0, 0.17, 0.03).scale.set(1.02, 1.1, 1.1);   /* open at the face */
                     part(new T.SphereGeometry(0.245, 14, 4, 0, Math.PI * 2, 0, Math.PI * 0.3), look.hood, head, 0, 0.17, 0.03).scale.set(1.02, 1.1, 1.1);
                     part(new T.CylinderGeometry(0.2, 0.33 * sw, 0.16, 12, 1, true), look.hood, spine, 0, 0.53, 0.01); }
    g.scale.setScalar(s);
    /* each joint's parts of one material drawn as one (2026-10-31: a figure was some 30 draw calls); only joints move */
    { const joints = []; g.traverse(o => { if (o.isGroup || o === g) joints.push(o); }); for (const j of joints) joinByMaterial(j); }
    const root = new T.Group(); root.add(g); root.userData.keep = true;   /* the engine places root; g moves inside it */
    /* a name over the head */
    const [nc, nx] = canvas(256); nc.height = 48; const ntex = new T.CanvasTexture(nc); ntex.colorSpace = T.SRGBColorSpace;
    const tag = new T.Sprite(new T.SpriteMaterial({ map: ntex, depthTest: false, transparent: true })); tag.scale.set(1.15 / s, 0.215 / s, 1); tag.position.y = 2.25; tag.renderOrder = 10; g.add(tag);
    const setName = (text, color) => { nx.clearRect(0, 0, 256, 48); nx.font = '600 24px Georgia,serif'; nx.textAlign = 'center'; const w = Math.min(250, nx.measureText(text).width + 20); nx.fillStyle = 'rgba(0,0,0,.45)'; nx.fillRect(128 - w / 2, 6, w, 36); nx.fillStyle = color || '#fff'; nx.fillText(text, 128, 33); ntex.needsUpdate = true; };
    ctx.scene.add(root);
    /* WHAT IS IN THE HANDS (tbuuol: a new weapon should be seen -- by the others too): things built in metres, a
       little bigger than in your own hands (seen from afar). A weapon, in either hand, is gripped in the fist with its
       blade or head pointing forward (-z) on a hanging arm; a shield (userData.kind 'shield') is strapped to the
       outside of the forearm, facing out (tbuuol 2026-10-27: the blade pointed backwards, the shield sat in the arm). */
    let held = null;
    function holdItem(right, left) {
      if (held) for (const o of held) if (o && o.parent) o.parent.remove(o);
      held = [right, left];
      [[right, hands[1], 1], [left, hands[0], -1]].forEach(([o, hand, side]) => {
        if (!o) return;
        o.scale.setScalar(1.25 / s);
        if (o.userData.kind === 'shield') { o.position.set(side * 0.13, 0.14, 0); o.rotation.set(0, side * Math.PI / 2, 0); }
        else { o.position.set(0, 0, -0.01); o.rotation.set(-Math.PI / 2 + 0.55, 0, 0); }   /* forward, the tip a little up */
        o.traverse(m => { if (m.isMesh) m.castShadow = true; });
        hand.add(o);
      });
    }
    /* MOVEMENT, by code: a pose made fresh every frame from the walk's phase, the breath, a gesture under way, a pose held */
    let phase = 0, breathe = Math.random() * 6, once = null, onceT = 0, hold = null, holdT = 0;
    const DUR = { 'attack-melee-right': 0.5, 'interact-right': 1.0, 'emote-yes': 0.9, 'emote-no': 0.9, 'pick-up': 1.1 };
    const lerp = (a, b, k) => a + (b - a) * Math.max(0, Math.min(1, k));
    function pose(dt, speed) {
      const sp = Math.min(1.6, (speed || 0) / 2.6), run = speed > 5 ? 1 : 0;
      phase += dt * (3.2 + speed * 1.9); breathe += dt * 1.5;
      const sw0 = Math.sin(phase), idle = 1 - Math.min(1, sp * 3);
      /* legs: swing from the hip, bend at the knee as the foot comes back */
      legs[0].rotation.set(sw0 * 0.62 * sp, 0, 0); legs[1].rotation.set(-sw0 * 0.62 * sp, 0, 0);
      knees[0].rotation.x = -Math.max(0, -Math.sin(phase - 0.6)) * 1.1 * sp; knees[1].rotation.x = -Math.max(0, Math.sin(phase - 0.6)) * 1.1 * sp;
      /* arms: against the legs, elbows a little bent, out from the broad shoulders */
      arms[0].rotation.set(-sw0 * 0.55 * sp, 0, -0.14 - Math.sin(breathe) * 0.03 * idle); arms[1].rotation.set(sw0 * 0.55 * sp, 0, 0.14 + Math.sin(breathe) * 0.03 * idle);
      elbows[0].rotation.x = elbows[1].rotation.x = 0.22 + 0.35 * sp + run * 0.5;
      hips.position.y = HIP + Math.abs(Math.cos(phase)) * 0.045 * sp - 0.02 * run;
      spine.rotation.set(-0.06 * sp - 0.16 * run, sw0 * 0.09 * sp, 0);
      spine.scale.y = 1 + Math.sin(breathe) * 0.012 * idle;
      head.rotation.set(0.04 * sp, -sw0 * 0.05 * sp, 0);
      /* a gesture on top */
      if (once) {
        onceT += dt; const k = onceT / DUR[once];
        if (once === 'attack-melee-right') {
          const up = k < 0.35;
          arms[1].rotation.x = up ? lerp(0, 2.7, k / 0.35) : lerp(2.7, -0.3, (k - 0.35) / 0.65); arms[1].rotation.z = 0.25;
          elbows[1].rotation.x = up ? lerp(0.3, 1.1, k / 0.35) : lerp(1.1, 0.2, (k - 0.35) / 0.65);
          spine.rotation.y = up ? lerp(0, -0.35, k / 0.35) : lerp(-0.35, 0.3, (k - 0.35) / 0.65);
        } else if (once === 'interact-right') {
          const a = Math.sin(Math.min(1, k) * Math.PI);
          arms[1].rotation.x = 1.5 * a; elbows[1].rotation.x = 0.3; arms[0].rotation.x = 0.7 * a; head.rotation.x = -0.15 * a;
        } else if (once === 'emote-yes') head.rotation.x = Math.sin(k * Math.PI * 4) * 0.28;
        else if (once === 'emote-no') head.rotation.y = Math.sin(k * Math.PI * 4) * 0.4;
        else if (once === 'pick-up') {
          const a = Math.sin(Math.min(1, k) * Math.PI);
          spine.rotation.x = 0.9 * a; knees[0].rotation.x = knees[1].rotation.x = -1.2 * a; legs[0].rotation.x = legs[1].rotation.x = 0.7 * a;
          hips.position.y = HIP - 0.25 * a; arms[0].rotation.x = arms[1].rotation.x = 0.8 * a;
        }
        if (k >= 1) once = null;
      }
    }
    function fallen(dt) {   /* falls on its back and stays there; got up again with hold(null) */
      holdT = Math.min(1, holdT + dt / 0.6);
      const k = holdT * holdT;
      g.rotation.x = -k * Math.PI / 2; g.position.y = k * 0.16 * s; g.position.z = k * 0.12;
      arms[0].rotation.set(0.2, 0, -1.0 * k); arms[1].rotation.set(0.2, 0, 1.0 * k); legs[0].rotation.set(0, 0, -0.15 * k); legs[1].rotation.set(0, 0, 0.15 * k);
      knees[0].rotation.x = knees[1].rotation.x = -0.2 * k; head.rotation.set(-0.3 * k, 0.4 * k, 0);
    }
    return {
      group: root, head, setName, tag, holdItem,
      /* a one-off gesture: 'emote-yes', 'emote-no', 'pick-up', 'interact-right', 'attack-melee-right' */
      emote(name) { if (hold || !DUR[name]) return; once = name; onceT = 0; },
      /* a pose kept until it is let go: 'die' (falls and stays down); null gets up again */
      hold(name) {
        if (hold === name) return;
        hold = name; once = null; holdT = 0;
        if (!name) { g.rotation.x = 0; g.position.y = 0; g.position.z = 0; }
      },
      animate(dt, speed) { if (hold === 'die') fallen(dt); else pose(dt, speed); },
      wave(t) { arms[1].rotation.x = 2.8 + Math.sin(t * 9) * 0.3; arms[1].rotation.z = 0.3; }
    };
  };

  /* a weapon for a foe to hold (the people of a dungeon): the same shapes as a player's, made here */
  art.held = function (model, look) {
    const g = new T.Group(), steel = plain(look || '#cfd5dd', { metalness: 0.8, roughness: 0.3 }), wood = plain('#6b4a2e'), brass = plain('#b8893a', { metalness: 0.7, roughness: 0.4 });
    const add = (geo, m, x, y, z) => { const p = new T.Mesh(geo, m); p.position.set(x || 0, y || 0, z || 0); g.add(p); return p; };
    if (model === 'sword') { add(new T.BoxGeometry(0.05, 0.62, 0.014), steel, 0.03, 0.38); add(new T.BoxGeometry(0.2, 0.04, 0.05), brass, 0, 0.07); add(new T.CylinderGeometry(0.02, 0.022, 0.15, 8), wood, 0, -0.02); }
    else if (model === 'axe') { add(new T.CylinderGeometry(0.022, 0.025, 0.62, 8), wood, 0, 0.2); add(new T.BoxGeometry(0.16, 0.14, 0.02), steel, 0.07, 0.44); }
    else { add(new T.CylinderGeometry(0.022, 0.025, 0.5, 8), wood, 0, 0.15); add(new T.SphereGeometry(0.07, 10, 8), plain('#5a5a5a'), 0, 0.42); }
    g.userData.kind = model;
    return g;
  };
  /* --- creatures ---------------------------------------------------------------------------------------- */
  /* THE BEASTS OF THE GREENWOOD (Etappe 3), made by code in the same round, painted style as the people: a boar, a wolf
     and a forest spider. The same interface as a person (group, setName, tag, animate, emote, hold), so the fight
     draws them alike; barY is where the health bar sits. look: {kind, color, scale}. */
  art.creature = function (ctx, look) {
    look = look || {};
    const cap = (r, len) => new T.CapsuleGeometry(r, len, 3, 8);
    const kind = look.kind || 'boar', s = look.scale || 1, g = new T.Group();
    const M = col => bodyMat(col, look.tint);
    const part = (geo, col, parent, x, y, z) => { const m = mesh(litFromAbove(geo), M(col)); m.position.set(x || 0, y || 0, z || 0); parent.add(m); return m; };
    const joint = (parent, x, y, z) => { const j = new T.Group(); j.position.set(x, y, z); parent.add(j); return j; };
    const body = joint(g, 0, 0, 0), legs = [];   /* legs: [joint, phase offset] */
    let head = null, tail = null, barY = 1.3;
    if (kind === 'boar') {
      const hide = look.color || '#6b4a32', dark = shade(hide, 0.6);
      body.position.y = 0.52;
      part(new T.SphereGeometry(0.42, 12, 9), hide, body, 0, 0, 0.05).scale.set(0.95, 0.9, 1.55);
      part(new T.ConeGeometry(0.12, 0.9, 6), dark, body, 0, 0.36, 0.1).rotation.x = Math.PI / 2;   /* the bristly ridge */
      head = joint(body, 0, 0.05, -0.58);
      part(new T.SphereGeometry(0.27, 10, 8), hide, head, 0, 0, 0).scale.set(1, 0.95, 1.1);
      const snout = part(new T.CylinderGeometry(0.11, 0.15, 0.24, 8), '#a7786a', head, 0, -0.06, -0.28); snout.rotation.x = Math.PI / 2;
      part(new T.CylinderGeometry(0.11, 0.11, 0.02, 8), '#5a3a34', head, 0, -0.06, -0.405).rotation.x = Math.PI / 2;
      for (const sx of [-1, 1]) {
        const tusk = part(new T.ConeGeometry(0.03, 0.17, 5), '#f2ead6', head, sx * 0.12, -0.08, -0.3); tusk.rotation.set(-0.6, 0, sx * -0.5);
        part(new T.ConeGeometry(0.07, 0.15, 5), dark, head, sx * 0.16, 0.22, 0.02).rotation.z = sx * -0.4;
        part(new T.SphereGeometry(0.035, 6, 5), '#1a0f0a', head, sx * 0.12, 0.08, -0.2);
      }
      for (const [x, z, ph] of [[-0.2, -0.35, 0], [0.2, -0.35, Math.PI], [-0.2, 0.45, Math.PI], [0.2, 0.45, 0]]) {
        const l = joint(body, x, -0.18, z); part(cap(0.075, 0.2), dark, l, 0, -0.18, 0); part(new T.CylinderGeometry(0.07, 0.08, 0.08, 6), '#2a1a12', l, 0, -0.33, 0); legs.push([l, ph]);
      }
      tail = joint(body, 0, 0.12, 0.66); part(new T.ConeGeometry(0.04, 0.2, 5), dark, tail, 0, -0.08, 0.02).rotation.x = 2.6;
      barY = 1.3;
    } else if (kind === 'wolf') {
      const fur = look.color || '#7d7f86', light = shade(fur, 1.3), dark = shade(fur, 0.7);
      body.position.y = 0.68;
      part(new T.SphereGeometry(0.3, 12, 9), fur, body, 0, 0, 0).scale.set(0.85, 0.9, 1.75);
      part(new T.SphereGeometry(0.28, 10, 8), light, body, 0, -0.02, -0.32).scale.set(0.95, 1, 0.9);   /* the ruff */
      head = joint(body, 0, 0.18, -0.62);
      part(new T.SphereGeometry(0.2, 10, 8), fur, head, 0, 0, 0).scale.set(0.95, 0.9, 1.05);
      const muzzle = part(new T.ConeGeometry(0.11, 0.32, 8), light, head, 0, -0.05, -0.26); muzzle.rotation.x = -Math.PI / 2;
      part(new T.SphereGeometry(0.035, 6, 5), '#111', head, 0, -0.03, -0.42);
      for (const sx of [-1, 1]) {
        part(new T.ConeGeometry(0.065, 0.2, 4), dark, head, sx * 0.11, 0.2, 0.02).rotation.z = sx * -0.25;
        part(new T.SphereGeometry(0.028, 6, 5), '#e8c34a', head, sx * 0.1, 0.06, -0.15);
      }
      for (const [x, z, ph] of [[-0.14, -0.38, 0], [0.14, -0.38, Math.PI], [-0.14, 0.38, Math.PI], [0.14, 0.38, 0]]) {
        const l = joint(body, x, -0.1, z), knee = joint(l, 0, -0.27, 0);
        part(cap(0.06, 0.2), fur, l, 0, -0.13, 0); part(cap(0.045, 0.2), dark, knee, 0, -0.14, 0); legs.push([l, ph, knee]);
      }
      tail = joint(body, 0, 0.12, 0.5); part(cap(0.07, 0.35), fur, tail, 0, -0.1, 0.18).rotation.x = 1.0;
      barY = 1.45;
    } else if (kind === 'crab') {   /* a shore crab (zone 2): a wide shell, eight thin legs, two big claws, eyes on stalks */
      const shell = look.color || '#c4532e', dark = shade(shell, 0.65), light = shade(shell, 1.25);
      body.position.y = 0.32;
      part(new T.SphereGeometry(0.42, 12, 8), shell, body, 0, 0, 0).scale.set(1.25, 0.45, 0.9);
      part(new T.SphereGeometry(0.3, 10, 6), light, body, 0, 0.08, -0.05).scale.set(1.2, 0.35, 0.8);
      head = joint(body, 0, 0.08, -0.32);
      for (const sx of [-1, 1]) {
        const st = part(new T.CylinderGeometry(0.02, 0.02, 0.22, 5), dark, head, sx * 0.1, 0.12, 0); st.rotation.z = sx * 0.2;
        part(new T.SphereGeometry(0.045, 6, 5), '#111', head, sx * 0.12, 0.24, 0);
        const arm = joint(body, sx * 0.42, 0, -0.25); arm.rotation.y = sx * -0.5;
        part(cap(0.05, 0.25), dark, arm, sx * 0.1, 0, -0.18).rotation.x = Math.PI / 2;
        part(new T.SphereGeometry(0.13, 8, 6), shell, arm, sx * 0.12, 0.02, -0.42).scale.set(0.8, 0.6, 1.3);   /* the claw */
        for (let i = 0; i < 4; i++) {
          const l = joint(body, sx * 0.4, -0.05, -0.05 + i * 0.13); l.rotation.y = sx * (0.2 - i * 0.25);
          const up = part(cap(0.03, 0.26), dark, l, sx * 0.16, 0.06, 0); up.rotation.z = sx * -1.1;
          const dn = part(cap(0.025, 0.3), dark, l, sx * 0.34, -0.12, 0); dn.rotation.z = sx * 0.5;
          legs.push([l, (i % 2 ? Math.PI : 0) + (sx > 0 ? Math.PI : 0), null, sx]);
        }
      }
      barY = 0.95;
    } else if (kind === 'siren') {   /* a siren of the cove: a woman's body, long sea-green hair, a fish's tail */
      const skin = look.skin || '#9fc9c0', tailC = look.color || '#2f8f8a', hair = look.hair || '#1f5a4a';
      body.position.y = 0.95;
      part(new T.CylinderGeometry(0.2, 0.16, 0.42, 10), skin, body, 0, 0.25, 0).scale.z = 0.75;
      part(new T.SphereGeometry(0.14, 8, 6), '#e0c25a', body, 0, 0.32, -0.08).scale.set(1.5, 0.5, 0.5);   /* shells */
      head = joint(body, 0, 0.55, 0);
      part(new T.SphereGeometry(0.17, 12, 10), skin, head, 0, 0.1, 0).scale.set(1, 1.08, 1);
      for (const sx of [-1, 1]) part(new T.SphereGeometry(0.03, 6, 5), '#ffef8a', head, sx * 0.06, 0.12, -0.15);
      part(new T.SphereGeometry(0.19, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, head, 0, 0.12, 0.02);
      part(cap(0.12, 0.55), hair, head, 0, -0.2, 0.12).scale.set(1.3, 1, 0.5);   /* hair down the back */
      for (const sx of [-1, 1]) { const arm = joint(body, sx * 0.24, 0.42, 0); part(cap(0.05, 0.38), skin, arm, 0, -0.22, 0); arm.rotation.z = sx * 0.3; legs.push([arm, sx > 0 ? 0 : Math.PI, null, sx * 0.2]); }
      tail = joint(body, 0, 0, 0);   /* the tail: four parts, each a little smaller, swaying */
      let t2 = tail, sz = 0.17;
      for (let i = 0; i < 4; i++) { const seg = joint(t2, 0, i ? -0.24 : 0, i ? 0.05 : 0); part(new T.SphereGeometry(sz, 10, 8), tailC, seg, 0, -0.12, 0).scale.set(1, 1.5, 0.8); t2 = seg; sz *= 0.85; }
      const fin = part(new T.ConeGeometry(0.22, 0.3, 4), '#57c4b0', t2, 0, -0.42, 0.05); fin.rotation.x = Math.PI; fin.scale.z = 0.25;
      barY = 1.85;
    } else {   /* a forest spider */
      const shell = look.color || '#3b2f3a', mark = '#b85a2a';
      body.position.y = 0.55;
      part(new T.SphereGeometry(0.4, 12, 9), shell, body, 0, 0.12, 0.42).scale.set(1, 0.85, 1.15);   /* the abdomen */
      part(new T.SphereGeometry(0.12, 8, 6), mark, body, 0, 0.42, 0.42).scale.set(1.4, 0.4, 1.8);
      head = joint(body, 0, 0, -0.12);
      part(new T.SphereGeometry(0.24, 10, 8), shell, head, 0, 0, 0).scale.set(1, 0.75, 1.1);
      for (const [x, y] of [[-0.07, 0.08], [0.07, 0.08], [-0.12, 0.04], [0.12, 0.04]]) part(new T.SphereGeometry(0.035, 6, 5), '#ff3a2a', head, x, y, -0.24);
      for (const sx of [-1, 1]) part(new T.ConeGeometry(0.04, 0.16, 5), '#20181f', head, sx * 0.06, -0.12, -0.24).rotation.x = -2.6;   /* fangs */
      for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) {
        const l = joint(body, sx * 0.18, 0.02, -0.25 + i * 0.17);
        l.rotation.y = sx * (0.5 - i * 0.35); const up = part(cap(0.035, 0.42), shell, l, sx * 0.24, 0.16, 0); up.rotation.z = sx * -1.0;
        const down = part(cap(0.03, 0.5), shell, l, sx * 0.52, -0.2, 0); down.rotation.z = sx * 0.45;
        legs.push([l, (i % 2 ? Math.PI : 0) + (sx > 0 ? Math.PI : 0), null, sx]);
      }
      barY = 1.2;
    }
    g.scale.setScalar(s);
    const root = new T.Group(); root.add(g); root.userData.keep = true;
    const [nc, nx] = canvas(256); nc.height = 48; const ntex = new T.CanvasTexture(nc); ntex.colorSpace = T.SRGBColorSpace;
    const tag = new T.Sprite(new T.SpriteMaterial({ map: ntex, depthTest: false, transparent: true })); tag.scale.set(1.15 / s, 0.215 / s, 1); tag.position.y = (barY + 0.25) / s; tag.renderOrder = 10; g.add(tag);
    const setName = (text, color) => { nx.clearRect(0, 0, 256, 48); nx.font = '600 24px Georgia,serif'; nx.textAlign = 'center'; const w = Math.min(250, nx.measureText(text).width + 20); nx.fillStyle = 'rgba(0,0,0,.45)'; nx.fillRect(128 - w / 2, 6, w, 36); nx.fillStyle = color || '#fff'; nx.fillText(text, 128, 33); ntex.needsUpdate = true; };
    ctx.scene.add(root);
    let phase = Math.random() * 6, breathe = Math.random() * 6, lunge = 0, hold = null, holdT = 0;
    const baseY = body.position.y;
    return {
      group: root, head, setName, tag, barY: barY * s, holdItem() {},
      emote(name) { if (!hold && name === 'attack-melee-right') lunge = 0.45; },
      hold(name) { if (hold === name) return; hold = name; holdT = 0; if (!name) { g.rotation.z = 0; g.position.y = 0; } },
      animate(dt, speed) {
        if (hold === 'die') {   /* rolls onto its side and stays */
          holdT = Math.min(1, holdT + dt / 0.5); g.rotation.z = holdT * Math.PI / 2 * 0.95; g.position.y = holdT * 0.15;
          for (const [l] of legs) l.rotation.x = 0.4 * holdT;
          return;
        }
        const sp = Math.min(1.8, (speed || 0) / 2.2);
        phase += dt * (4 + speed * 3.2); breathe += dt * 2;
        for (const [l, ph, knee, sx] of legs) {
          const a = Math.sin(phase + ph);
          if (sx) { l.rotation.x = 0; l.rotation.z = sx * a * 0.25 * sp; l.position.y = 0.02 + Math.max(0, a) * 0.05 * sp; }
          else { l.rotation.x = a * 0.6 * sp; if (knee) knee.rotation.x = Math.max(0, -a) * 0.8 * sp; }
        }
        body.position.y = baseY + Math.abs(Math.sin(phase)) * 0.03 * sp + Math.sin(breathe) * 0.008;
        if (tail && kind === 'siren') { let j = tail, k = 0; while (j && k < 5) { j.rotation.x = Math.sin(phase * 0.6 - k * 0.7) * 0.18; j = j.children.find(c => c.isGroup); k++; } }
        else if (tail) tail.rotation.y = Math.sin(phase * 0.7) * 0.4;
        lunge = Math.max(0, lunge - dt);
        const k = Math.sin((lunge / 0.45) * Math.PI);
        body.position.z = -k * 0.25; if (head) head.rotation.x = k * 0.35 + Math.sin(breathe * 0.5) * 0.04;
      }
    };
  };

  /* --- a piece of the real Earth --------------------------------------------------------------------------- */
  /* The level's "real" block (tools/realworld.py: OpenStreetMap + terrain tiles, in decimetres) drawn in the game's
     own style: the ground is the real heights with a painted map on it (land use, streets by class, water), every
     building rises from its real footprint (plaster and windows, a gable roof on a rectangle, a hipped or flat one
     otherwise), walls, rivers and trees stand where they are. All buildings are merged into a handful of meshes, so
     five hundred houses cost a few draw calls. Returns what the engine needs to walk on it:
       {groundAt(x, z), polys: [{pts, top}], segs: [{a, b, r, top}], half, spawn: [x, z]} */
  const unpack = (arr, from) => { const out = []; let x = 0, z = 0; for (let i = from || 0; i + 1 < arr.length; i += 2) { if (!out.length) { x = arr[i]; z = arr[i + 1]; } else { x += arr[i]; z += arr[i + 1]; } out.push([x / 10, z / 10]); } return out; };
  const AREA_COLOR = { 1: '#b9b26a', 2: '#7fa356', 3: '#8fae5a', 4: '#9aa58a', 5: '#a8a49a', 6: '#6f9561', 7: '#6e8c4c',
                       8: '#4e6e38', 9: '#8d8a84', 10: '#83a85a', 11: '#9a958a' };
  const ROAD_STYLE = [[9, '#5d5b58', '#3c3b39'], [6.5, '#6f6c68', '#4a4845'], [4, '#7d7a74', '#56534f'], [2, '#b39c78', null], [3, '#a08a68', null], [2.2, '#9a948a', null]];
  painters.plaster = function (rnd) {   /* 3 x 3 m of a wall: plaster, one window with a frame and a sill */
    const [c, x] = canvas(256); x.fillStyle = '#f2ece2'; x.fillRect(0, 0, 256, 256);
    speckle(x, 2500, 256, rnd, ['#e3dccf', '#fbf8f2', '#d8d0c2'], 0.5);
    x.fillStyle = '#d9d0c1'; x.fillRect(0, 248, 256, 8);
    x.fillStyle = '#5a4630'; x.fillRect(84, 70, 88, 120);
    x.fillStyle = '#2d3b46'; x.fillRect(92, 78, 72, 104);
    x.fillStyle = 'rgba(160,200,230,.35)'; x.fillRect(96, 82, 30, 40);
    x.fillStyle = '#5a4630'; x.fillRect(125, 78, 6, 104); x.fillRect(92, 126, 72, 6);
    x.fillStyle = '#e8e2d6'; x.fillRect(78, 190, 100, 8);
    return c;
  };
  painters.rooftiles = function (rnd) {
    const [c, x] = canvas(128); x.fillStyle = '#9a4a32'; x.fillRect(0, 0, 128, 128);
    for (let row = 0; row < 128; row += 16) for (let col = -8; col < 136; col += 16) {
      const off = (row / 16) % 2 ? 8 : 0; x.fillStyle = shade('#a8543a', rnd.range(0.8, 1.12));
      x.beginPath(); x.arc(col + off, row + 12, 8, 0, Math.PI); x.lineTo(col + off - 8, row); x.lineTo(col + off + 8, row); x.fill();
      x.strokeStyle = 'rgba(40,15,8,.45)'; x.beginPath(); x.arc(col + off, row + 12, 8, 0, Math.PI); x.stroke();
    }
    return c;
  };
  art.realworld = function (ctx, real) {
    const t = real.terrain, n = t.n, S = t.size, half = S / 2, step = S / (n - 1), H = t.h.map(v => v / 10);
    const groundAt = (x, z) => {
      const fx = Math.max(0, Math.min(n - 1.001, (x + half) / step)), fz = Math.max(0, Math.min(n - 1.001, (z + half) / step));
      const i = Math.floor(fx), j = Math.floor(fz), ax = fx - i, az = fz - j;
      return (H[j * n + i] * (1 - ax) + H[j * n + i + 1] * ax) * (1 - az) + (H[(j + 1) * n + i] * (1 - ax) + H[(j + 1) * n + i + 1] * ax) * az;
    };
    const rnd = art.rng(97);
    const buildings = (real.buildings || []).map(b => ({ kind: b[0], levels: b[1], hgt: b[2] / 10, pts: unpack(b, 3) }));
    const areas = (real.areas || []).map(a => ({ cls: a[0], pts: unpack(a, 1) }));
    const roads = (real.roads || []).map(r => ({ cls: r[0], pts: unpack(r, 1) }));
    const walls = (real.walls || []).map(w => ({ kind: w[0], pts: unpack(w, 1) }));
    const rivers = ((real.water || {}).rivers || []).map(r => ({ w: r[0] / 10, pts: unpack(r, 1) }));
    const lakes = ((real.water || {}).areas || []).map(a => unpack(a, 0));

    /* the ground: a map painted at half a metre a pixel, laid over the real heights */
    const PX = 2048, k = PX / S, P = (x, z) => [(x + half) * k, (z + half) * k];
    const [c, g] = canvas(PX);
    g.fillStyle = '#7d9e55'; g.fillRect(0, 0, PX, PX);
    speckle(g, 60000, PX, rnd, ['#6f914a', '#8aab5f', '#72904c', '#93b267'], 0.5);
    const poly = (pts) => { g.beginPath(); pts.forEach((p, i) => { const [px, py] = P(p[0], p[1]); if (i) g.lineTo(px, py); else g.moveTo(px, py); }); g.closePath(); };
    const line = (pts) => { g.beginPath(); pts.forEach((p, i) => { const [px, py] = P(p[0], p[1]); if (i) g.lineTo(px, py); else g.moveTo(px, py); }); };
    for (const a of areas) {
      poly(a.pts); g.fillStyle = AREA_COLOR[a.cls] || '#7d9e55'; g.globalAlpha = 0.85; g.fill(); g.globalAlpha = 1;
      if (a.cls === 1) { g.save(); poly(a.pts); g.clip(); g.strokeStyle = 'rgba(90,80,40,.25)'; g.lineWidth = 2; for (let i = -PX; i < PX * 2; i += 9) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + PX * 0.3, PX); g.stroke(); } g.restore(); }
    }
    g.lineCap = g.lineJoin = 'round';
    for (const w of lakes) { poly(w); g.fillStyle = '#3d6e86'; g.fill(); }
    for (const r of rivers) { line(r.pts); g.strokeStyle = '#3d6e86'; g.lineWidth = Math.max(2, r.w * k); g.stroke(); }
    for (const pass of [0, 1]) for (const r of roads.slice().sort((a, b) => b.cls - a.cls)) {   /* casings first, then the surface */
      const st = ROAD_STYLE[r.cls] || ROAD_STYLE[2]; if (pass === 0 && !st[2]) continue;
      line(r.pts); g.strokeStyle = pass ? st[1] : st[2]; g.lineWidth = (st[0] + (pass ? 0 : 1.2)) * k;
      if (r.cls === 5 && pass) g.setLineDash([3, 3]); g.stroke(); g.setLineDash([]);
    }
    for (const b of buildings) { poly(b.pts.map(p => [p[0] + 0.8, p[1] + 0.8])); g.fillStyle = 'rgba(30,30,25,.35)'; g.fill(); }   /* a dark rim at the foot */
    const groundTex = new T.CanvasTexture(c); groundTex.colorSpace = T.SRGBColorSpace; groundTex.anisotropy = 8;
    const detail = tex(cache['c:grass'] || (cache['c:grass'] = painters.grass(art.rng(5 * 977 + 103))), [S / 4, S / 4]);
    const tg = new T.PlaneGeometry(S, S, n - 1, n - 1); tg.rotateX(-Math.PI / 2);
    const tp = tg.attributes.position; for (let i = 0; i < tp.count; i++) tp.setY(i, H[i]);
    tg.computeVertexNormals();
    const ground = new T.Mesh(tg, new T.MeshStandardMaterial({ map: groundTex, bumpMap: detail, bumpScale: 1.5, roughness: 0.95 }));
    ground.receiveShadow = true; ctx.scene.add(ground);

    /* buildings, merged: walls (plaster with windows, tinted per house) and roofs (tiles, tinted) */
    const W = { p: [], n: [], u: [], c: [] }, R = { p: [], n: [], u: [], c: [] }, F = { p: [], n: [], u: [], c: [] };
    const push = (B, a, b, c2, na, ua, ub, uc, col) => { for (const [v, uv] of [[a, ua], [b, ub], [c2, uc]]) { B.p.push(v[0], v[1], v[2]); B.n.push(na[0], na[1], na[2]); B.u.push(uv[0], uv[1]); B.c.push(col.r, col.g, col.b); } };
    const tri = (B, a, b, c2, ua, ub, uc, col) => {   /* a triangle with its own face normal */
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c2[0] - a[0], vy = c2[1] - a[1], vz = c2[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
      push(B, a, b, c2, [nx / l, ny / l, nz / l], ua, ub, uc, col);
    };
    const quad = (B, a, b, c2, d, ua, ub, uc, ud, col) => { tri(B, a, b, c2, ua, ub, uc, col); tri(B, a, c2, d, ua, uc, ud, col); };
    const triUp = (B, a, b, c2, ua, ub, uc, col) => {   /* a horizontal triangle, facing the sky whatever order it came in */
      const ny = (b[2] - a[2]) * (c2[0] - a[0]) - (b[0] - a[0]) * (c2[2] - a[2]);
      if (ny >= 0) tri(B, a, b, c2, ua, ub, uc, col); else tri(B, a, c2, b, ua, uc, ub, col);
    };
    const WALLS = ['#f4efe6', '#efe3c8', '#e8d5b0', '#f1e6d8', '#dcd6cc', '#e9dccb', '#f5f0d8', '#d9c7a8'];
    const ROOFS = ['#a8543a', '#9a4a32', '#b5603f', '#8a4632', '#6e6a68', '#7a3f2e'];
    const col = new T.Color(), rcol = new T.Color();
    const polys = [];
    const orient = pts => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a < 0 ? pts : pts.slice().reverse(); };
    for (const b of buildings) {
      const pts = orient(b.pts); if (pts.length < 3) continue;
      const hs = pts.map(p => groundAt(p[0], p[1])), base = Math.min(...hs) - 0.6, top0 = Math.max(...hs);
      const tall = b.hgt || (b.levels ? b.levels * 3 + 0.8 : [6.5, 9, 15, 13, 3, 18][b.kind] || 6.5);
      const top = top0 + tall;
      const stone = b.kind === 2 || b.kind === 3 || b.kind === 5;
      col.set(stone ? '#c9c2b4' : rnd.pick(WALLS)); rcol.set(b.kind === 4 ? '#6b6560' : stone ? '#5e5a58' : rnd.pick(ROOFS));
      let along = 0;
      for (let i = 0; i < pts.length; i++) {   /* the walls, wound so their faces look outwards */
        const p = pts[i], q = pts[(i + 1) % pts.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        quad(W, [p[0], base, p[1]], [q[0], base, q[1]], [q[0], top, q[1]], [p[0], top, p[1]],
          [along / 3, (base - top0) / 3], [(along + len) / 3, (base - top0) / 3], [(along + len) / 3, (top - top0) / 3], [along / 3, (top - top0) / 3], col);
        along += len;
      }
      polys.push({ pts, top, base });
      /* the roof: a gable on anything close to a rectangle, a hip (to the middle) on small shapes, flat on the rest */
      let rect = false, ax = 0, az = 0, len0 = 0;
      if (pts.length === 4) {
        const e = [0, 1, 2, 3].map(i => [pts[(i + 1) % 4][0] - pts[i][0], pts[(i + 1) % 4][1] - pts[i][1]]);
        const dot = Math.abs(e[0][0] * e[1][0] + e[0][1] * e[1][1]) / (Math.hypot(...e[0]) * Math.hypot(...e[1]) || 1);
        rect = dot < 0.2; const L0 = Math.hypot(...e[0]), L1 = Math.hypot(...e[1]); ax = L0 >= L1 ? 0 : 1; len0 = Math.min(L0, L1);
      }
      const area = Math.abs(pts.reduce((s2, p, i) => { const q = pts[(i + 1) % pts.length]; return s2 + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
      if (rect && b.kind !== 1) {
        /* ridge along the long side: its ends are the middles of the two short sides */
        const pitch = b.kind === 2 || b.kind === 5 ? 1.4 : 0.75, rise = len0 / 2 * pitch;
        const [p0, p1, p2, p3] = ax === 0 ? [pts[0], pts[1], pts[2], pts[3]] : [pts[1], pts[2], pts[3], pts[0]];
        const m1 = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2], m0 = [(p3[0] + p0[0]) / 2, (p3[1] + p0[1]) / 2];
        const A = [p0[0], top, p0[1]], B2 = [p1[0], top, p1[1]], C = [p2[0], top, p2[1]], Dd = [p3[0], top, p3[1]];
        const r0 = [m0[0], top + rise, m0[1]], r1 = [m1[0], top + rise, m1[1]];
        const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / 2, sl = Math.hypot(len0 / 2, rise) / 2;
        quad(R, A, B2, r1, r0, [0, 0], [L, 0], [L, sl], [0, sl], rcol);
        quad(R, C, Dd, r0, r1, [0, 0], [L, 0], [L, sl], [0, sl], rcol);
        tri(W, B2, C, r1, [0, (top - top0) / 3], [len0 / 3, (top - top0) / 3], [len0 / 6, (top + rise - top0) / 3], col);   /* gables */
        tri(W, Dd, A, r0, [0, (top - top0) / 3], [len0 / 3, (top - top0) / 3], [len0 / 6, (top + rise - top0) / 3], col);
      } else if (area < 260 || b.kind === 2 || b.kind === 5) {
        const cx = pts.reduce((s2, p) => s2 + p[0], 0) / pts.length, cz = pts.reduce((s2, p) => s2 + p[1], 0) / pts.length;
        const r2 = Math.sqrt(area) * (b.kind === 5 || b.kind === 2 ? 0.9 : 0.35), apex = [cx, top + r2, cz];
        for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]) / 2;
          tri(R, [p[0], top, p[1]], [q[0], top, q[1]], apex, [0, 0], [L, 0], [L / 2, r2 / 2], rcol); }
      } else {
        const flat = T.ShapeUtils.triangulateShape(pts.map(p => new T.Vector2(p[0], p[1])), []);
        const fc = new T.Color('#77736d');
        for (const [i, j, k2] of flat) triUp(F, [pts[i][0], top, pts[i][1]], [pts[k2][0], top, pts[k2][1]], [pts[j][0], top, pts[j][1]], [pts[i][0] / 4, pts[i][1] / 4], [pts[k2][0] / 4, pts[k2][1] / 4], [pts[j][0] / 4, pts[j][1] / 4], fc);
      }
    }
    /* walls in the open: the castle's, old town walls, retaining walls */
    const segs = [];
    for (const w of walls) {
      const hgt = [2.4, 6, 1.6][w.kind] || 2.4, th = [0.5, 1.4, 0.6][w.kind] || 0.5, sc = new T.Color('#b9b2a4');
      for (let i = 0; i + 1 < w.pts.length; i++) {
        const p = w.pts[i], q = w.pts[i + 1], dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz) || 1, ox = -dz / L * th / 2, oz = dx / L * th / 2;
        const gp = groundAt(p[0], p[1]), gq = groundAt(q[0], q[1]), lo = Math.min(gp, gq) - 0.8;
        const c4 = (x, z, y) => [x, y, z];
        quad(W, c4(p[0] + ox, p[1] + oz, lo), c4(q[0] + ox, q[1] + oz, lo), c4(q[0] + ox, q[1] + oz, gq + hgt), c4(p[0] + ox, p[1] + oz, gp + hgt), [0, 0], [L / 3, 0], [L / 3, 1], [0, 1], sc);
        quad(W, c4(q[0] - ox, q[1] - oz, lo), c4(p[0] - ox, p[1] - oz, lo), c4(p[0] - ox, p[1] - oz, gp + hgt), c4(q[0] - ox, q[1] - oz, gq + hgt), [0, 0], [L / 3, 0], [L / 3, 1], [0, 1], sc);
        quad(F, c4(p[0] + ox, p[1] + oz, gp + hgt), c4(q[0] + ox, q[1] + oz, gq + hgt), c4(q[0] - ox, q[1] - oz, gq + hgt), c4(p[0] - ox, p[1] - oz, gp + hgt), [0, 0], [L / 3, 0], [L / 3, 0.2], [0, 0.2], sc);
        segs.push({ a: p, b: q, r: th / 2, top: Math.max(gp, gq) + hgt });
      }
    }
    const merged = (B, material) => {
      if (!B.p.length) return;
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(B.p, 3)); geo.setAttribute('normal', new T.Float32BufferAttribute(B.n, 3));
      geo.setAttribute('uv', new T.Float32BufferAttribute(B.u, 2)); geo.setAttribute('color', new T.Float32BufferAttribute(B.c, 3));
      const m = new T.Mesh(geo, material); m.castShadow = m.receiveShadow = true; ctx.scene.add(m); return m;
    };
    const plasterC = cache['c:plaster'] || (cache['c:plaster'] = painters.plaster(art.rng(31)));
    const plasterT = tex(plasterC), tilesT = tex(cache['c:rooftiles'] || (cache['c:rooftiles'] = painters.rooftiles(art.rng(32))));
    if (assetURL) {   /* the photographed plaster, with the painted window drawn over it; the photographed tiles as they are */
      picture('plaster', 'color').then(t => { if (!t) return; const x = plasterC.getContext('2d'), w = plasterC.width;
        const keep = document.createElement('canvas'); keep.width = keep.height = w; keep.getContext('2d').drawImage(plasterC, 0, 0);
        x.drawImage(t.image, 0, 0, w, w); x.drawImage(keep, 78, 70, 100, 128, 78, 70, 100, 128);   /* frame, glass, sill */
        plasterT.needsUpdate = true; });
    }
    merged(W, new T.MeshStandardMaterial({ map: plasterT, vertexColors: true, roughness: 0.9 }));
    const roofM = new T.MeshStandardMaterial({ map: tilesT, bumpMap: tilesT, bumpScale: 1.2, vertexColors: true, roughness: 0.8, side: T.DoubleSide });
    if (assetURL) dressReal(roofM, ['tiles', 1], [0.5, 0.5]);
    merged(R, roofM);
    merged(F, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));

    /* rivers: a ribbon of water a little above the painted bed */
    const Wt = { p: [], n: [], u: [], c: [] }, wc = new T.Color('#ffffff');
    for (const r of rivers) for (let i = 0; i + 1 < r.pts.length; i++) {
      const p = r.pts[i], q = r.pts[i + 1], dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz) || 1, ox = -dz / L * r.w / 2, oz = dx / L * r.w / 2;
      const yp = groundAt(p[0], p[1]) + 0.35, yq = groundAt(q[0], q[1]) + 0.35;
      quad(Wt, [p[0] + ox, yp, p[1] + oz], [q[0] + ox, yq, q[1] + oz], [q[0] - ox, yq, q[1] - oz], [p[0] - ox, yp, p[1] - oz], [0, 0], [1, 0], [1, 1], [0, 1], wc);
    }
    for (const w of lakes) {
      const y = Math.min(...w.map(p => groundAt(p[0], p[1]))) + 0.3;
      for (const [i, j, k2] of T.ShapeUtils.triangulateShape(w.map(p => new T.Vector2(p[0], p[1])), []))
        triUp(Wt, [w[i][0], y, w[i][1]], [w[k2][0], y, w[k2][1]], [w[j][0], y, w[j][1]], [0, 0], [1, 0], [0, 1], wc);
    }
    const water = merged(Wt, new T.MeshStandardMaterial({ color: '#3f7391', roughness: 0.12, metalness: 0.15, emissive: '#0d2633', transparent: true, opacity: 0.88 }));
    if (water) { water.castShadow = false; water.material.side = T.DoubleSide; }

    /* trees: the ones OSM names, and woods, parks and cemeteries filled from the seed */
    const inside = (pts, x, z) => { let c2 = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c2 = !c2; } return c2; };
    const trees = unpack(real.trees || [], 0).map(p => [p[0], p[1], rnd.range(0.9, 1.3), 'oak']);
    const DENSITY = { 8: 70, 2: 900, 6: 160, 3: 120, 7: 260 };
    for (const a of areas) {
      const per = DENSITY[a.cls]; if (!per) continue;
      const xs = a.pts.map(p => p[0]), zs = a.pts.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
      const ar = Math.abs(a.pts.reduce((s2, p, i) => { const q = a.pts[(i + 1) % a.pts.length]; return s2 + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
      const want = Math.min(1500, Math.round(ar / per));
      for (let i = 0, got = 0; got < want && i < want * 6; i++) {
        const x = rnd.range(x0, x1), z = rnd.range(z0, z1);
        if (!inside(a.pts, x, z) || polys.some(b => inside(b.pts, x, z))) continue;
        trees.push([x, z, rnd.range(0.8, 1.5), a.cls === 8 && rnd() < 0.55 ? 'pine' : 'oak']); got++;
      }
    }
    if (trees.length) art.trees(ctx, trees, groundAt);

    /* where to start: the free spot nearest the middle, not in a house or a river */
    let spawn = [0, 0];
    /* somewhere open: not in a house, 5 m from every wall of one, and off the river */
    const nearWall = (x, z, d) => polys.some(b => b.pts.some((p, i) => { const q = b.pts[(i + 1) % b.pts.length], ex = q[0] - p[0], ez = q[1] - p[1], L2 = ex * ex + ez * ez || 1e-9, t = Math.max(0, Math.min(1, ((x - p[0]) * ex + (z - p[1]) * ez) / L2)); return Math.hypot(x - p[0] - ex * t, z - p[1] - ez * t) < d; }));
    const blocked = (x, z) => polys.some(b => inside(b.pts, x, z)) || nearWall(x, z, 5) || rivers.some(r => r.pts.some(p => Math.hypot(p[0] - x, p[1] - z) < r.w + 2));
    for (let r = 0; r < 200 && blocked(spawn[0], spawn[1]); r += 3) for (let a = 0; a < 16; a++) { const x = Math.cos(a / 16 * 6.283) * r, z = Math.sin(a / 16 * 6.283) * r; if (!blocked(x, z)) { spawn = [x, z]; r = 999; break; } }
    return { groundAt, polys, segs, half, spawn, inside, stats: { buildings: buildings.length, trees: trees.length } };
  };

  if (G.LWQ && G.LWQ.define) G.LWQ.define('art', { api: 1, v: 16 }, () => art);
})(typeof globalThis !== 'undefined' ? globalThis : this);
