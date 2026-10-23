/* LiteWorldsQuest art module: everything that is drawn, made by code, with no picture files.
   Textures are painted on canvases when the game starts; the world is laid out from a seed, so every player sees
   the same village. A builder takes a level's description of a thing and returns what the engine needs:
     art.setup(THREE, renderer, scene, env)            -> {update(dt, t)}       sky, sun, light, fog, ground
     art.hut(ctx, def)    -> {door}                     a log hut with a thatched roof, a door that swings, a room inside
     art.campfire(ctx, def), art.forest(ctx, def), art.fence(ctx, def), art.paths(ctx, def), art.prop(ctx, def),
     art.well(ctx, def) -> {use: mesh}, art.grass(ctx, def)
     art.character(ctx, look) -> {group, animate(dt, speed), face(yaw), setName(text)}   a blocky person
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
  const painters = {
    grass(rnd) {
      const [c, x] = canvas(256); x.fillStyle = '#4f7a32'; x.fillRect(0, 0, 256, 256);
      speckle(x, 5000, 256, rnd, ['#5f8f3a', '#41692a', '#6d9b45', '#3a5e25', '#7aa64f'], 0.8);
      for (let i = 0; i < 400; i++) { x.strokeStyle = rnd.pick(['#6fa04a', '#3e6428', '#86b35a']); x.globalAlpha = 0.5; x.beginPath(); const px = rnd() * 256, py = rnd() * 256; x.moveTo(px, py); x.lineTo(px + rnd.range(-2, 2), py - rnd.range(3, 7)); x.stroke(); }
      x.globalAlpha = 1; return c;
    },
    dirt(rnd) {
      const [c, x] = canvas(256); x.fillStyle = '#7a5c3c'; x.fillRect(0, 0, 256, 256);
      speckle(x, 6000, 256, rnd, ['#8a6a46', '#6b4f33', '#94754f', '#5d442c'], 0.8);
      for (let i = 0; i < 90; i++) { x.fillStyle = rnd.pick(['#9a8a78', '#7d7368', '#a89a88']); x.beginPath(); x.ellipse(rnd() * 256, rnd() * 256, rnd.range(1.5, 4), rnd.range(1, 3), rnd() * 3, 0, 7); x.fill(); }
      return c;
    },
    logs(rnd) {   /* horizontal logs, as a log cabin's wall */
      const [c, x] = canvas(256), band = 32;
      for (let y = 0; y < 256; y += band) {
        const g = x.createLinearGradient(0, y, 0, y + band);
        g.addColorStop(0, '#5a3d22'); g.addColorStop(0.15, '#8b6239'); g.addColorStop(0.55, '#7a5431'); g.addColorStop(0.9, '#4e331c'); g.addColorStop(1, '#2e1d10');
        x.fillStyle = g; x.fillRect(0, y, 256, band);
        for (let i = 0; i < 26; i++) { x.strokeStyle = 'rgba(40,25,12,' + rnd.range(0.15, 0.4) + ')'; x.beginPath(); const yy = y + rnd.range(5, band - 5); x.moveTo(rnd() * 256, yy); x.lineTo(rnd() * 256, yy + rnd.range(-1, 1)); x.stroke(); }
      }
      return c;
    },
    planks(rnd) {
      const [c, x] = canvas(256), w = 32;
      for (let i = 0; i < 8; i++) {
        x.fillStyle = shade('#9a7148', rnd.range(0.82, 1.08)); x.fillRect(i * w, 0, w, 256);
        for (let k = 0; k < 14; k++) { x.strokeStyle = 'rgba(60,38,20,' + rnd.range(0.12, 0.35) + ')'; x.beginPath(); const xx = i * w + rnd.range(3, w - 3); x.moveTo(xx, 0); x.bezierCurveTo(xx + rnd.range(-3, 3), 90, xx + rnd.range(-3, 3), 170, xx, 256); x.stroke(); }
        x.fillStyle = 'rgba(30,18,8,.7)'; x.fillRect(i * w, 0, 2, 256);
        const cut = rnd.range(40, 220); x.fillRect(i * w, cut, w, 2);
        x.fillStyle = 'rgba(30,18,8,.5)'; x.beginPath(); x.arc(i * w + 6, cut + 8, 1.5, 0, 7); x.arc(i * w + w - 6, cut + 8, 1.5, 0, 7); x.fill();
      }
      return c;
    },
    thatch(rnd) {
      const [c, x] = canvas(256); x.fillStyle = '#8a7340'; x.fillRect(0, 0, 256, 256);
      for (let row = 0; row < 256; row += 16) {
        for (let i = 0; i < 260; i++) {
          x.strokeStyle = rnd.pick(['#c9a55a', '#a8873f', '#d8b86a', '#8d6f33', '#b8964c']); x.globalAlpha = rnd.range(0.5, 1); x.lineWidth = rnd.range(0.8, 1.8);
          const px = rnd() * 256, py = row + rnd() * 6; x.beginPath(); x.moveTo(px, py); x.lineTo(px + rnd.range(-2, 2), py + rnd.range(12, 22)); x.stroke();
        }
        x.globalAlpha = 0.35; x.fillStyle = '#4a3a1a'; x.fillRect(0, row + 14, 256, 2);
      }
      x.globalAlpha = 1; return c;
    },
    stone(rnd) {
      const [c, x] = canvas(256); x.fillStyle = '#5c5a55'; x.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 70; i++) {
        const px = rnd() * 256, py = rnd() * 256, r = rnd.range(10, 26);
        x.fillStyle = shade('#8d8a82', rnd.range(0.75, 1.1)); x.beginPath();
        for (let a = 0; a < 7; a++) { const ang = a / 7 * Math.PI * 2, rr = r * rnd.range(0.75, 1.1); x.lineTo(px + Math.cos(ang) * rr, py + Math.sin(ang) * rr); }
        x.closePath(); x.fill(); x.strokeStyle = 'rgba(30,30,28,.6)'; x.stroke();
      }
      speckle(x, 3000, 256, rnd, ['#a9a69e', '#4a4844'], 0.4); return c;
    },
    cloth(rnd) {
      const [c, x] = canvas(64); x.fillStyle = '#fff'; x.fillRect(0, 0, 64, 64);
      for (let i = 0; i < 64; i += 4) { x.fillStyle = 'rgba(0,0,0,.06)'; x.fillRect(i, 0, 2, 64); x.fillRect(0, i, 64, 2); }
      return c;
    },
    leaves(rnd) {
      const [c, x] = canvas(128); x.fillStyle = '#2f5a24'; x.fillRect(0, 0, 128, 128);
      speckle(x, 2500, 128, rnd, ['#3d7a2d', '#25481c', '#4f8f38', '#1d3a16'], 0.9); return c;
    },
    bark(rnd) {
      const [c, x] = canvas(64); x.fillStyle = '#4a3423'; x.fillRect(0, 0, 64, 64);
      for (let i = 0; i < 40; i++) { x.strokeStyle = rnd.pick(['#2f2015', '#5e4430', '#3b2a1c']); x.beginPath(); const px = rnd() * 64; x.moveTo(px, 0); x.lineTo(px + rnd.range(-3, 3), 64); x.stroke(); }
      return c;
    }
  };
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
    const m = new T.MeshStandardMaterial(Object.assign({ map: t, bumpMap: t, bumpScale: 0.6, roughness: 0.92, metalness: 0 }, (opts && opts.m) || {}));
    if (assetURL && REAL[name]) dressReal(m, REAL[name], opts && opts.repeat);
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
  art.setup = function (THREE, renderer, scene, env) {
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
    const size = env.ground === 0 ? 0 : env.ground || 260, seg = 96, rnd = art.rng(7);
    if (size) {
    const g = new THREE.PlaneGeometry(size, size, seg, seg); g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position, flat = env.flat || 30;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), d = Math.hypot(x, z);
      const k = Math.max(0, Math.min(1, (d - flat) / 40));
      pos.setY(i, k * k * (Math.sin(x * 0.05) * 4 + Math.cos(z * 0.043) * 5 + Math.sin((x + z) * 0.11) * 1.5 + 3) - 0.001);
    }
    g.computeVertexNormals();
    const ground = mesh(g, mat('grass', { repeat: [size / 6, size / 6], m: { bumpScale: 1.2 } }), false); ground.receiveShadow = true; scene.add(ground);
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
  art.lantern = function () {
    const g = new T.Group(), metal = plain('#2d2a26', { metalness: 0.6, roughness: 0.5 });
    const glow = mesh(new T.BoxGeometry(0.16, 0.22, 0.16), new T.MeshStandardMaterial({ color: '#ffcf7a', emissive: '#ffb347', emissiveIntensity: 2.2 }), false);
    g.add(glow); const cap = mesh(new T.ConeGeometry(0.15, 0.12, 4), metal); cap.position.y = 0.17; cap.rotation.y = Math.PI / 4; g.add(cap);
    const base = mesh(new T.BoxGeometry(0.18, 0.04, 0.18), metal); base.position.y = -0.13; g.add(base);
    return g;
  };

  /* --- the campfire -------------------------------------------------------------------------------------- */
  /* a ring of stones, crossed logs, glowing embers, flames, sparks and smoke as particles, and a light that flickers */
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
  art.trees = function (ctx, list, height) {
    const pines = list.filter(t => (t[3] || 'pine') === 'pine'), oaks = list.filter(t => t[3] === 'oak');
    const M = new T.Matrix4(), Q = new T.Quaternion(), S = new T.Vector3(), P = new T.Vector3(), up = new T.Vector3(0, 1, 0);
    function instanced(geo, material, items, place) {
      const im = new T.InstancedMesh(geo, material, items.length); im.castShadow = true; im.receiveShadow = true;
      items.forEach((it, i) => { place(it, P, S); Q.setFromAxisAngle(up, (it[0] * 13.7 + it[1] * 7.1) % 6.28); M.compose(P, Q, S); im.setMatrixAt(i, M); });
      ctx.scene.add(im); return im;
    }
    const bark = mat('bark'), leaves = mat('leaves', { m: { color: '#7d9268', bumpScale: 2 } }), pineLeaves = mat('leaves', { m: { color: '#6b8070', bumpScale: 2.5 } });
    instanced(new T.CylinderGeometry(0.12, 0.24, 3.4, 7), bark, pines, (t, p, s) => { p.set(t[0], height(t[0], t[1]) + 1.7 * t[2], t[1]); s.set(t[2], t[2], t[2]); });
    for (const [y, r, h] of [[2.3, 1.7, 2.0], [3.2, 1.45, 1.9], [4.1, 1.15, 1.7], [4.9, 0.85, 1.5], [5.6, 0.55, 1.3]]) {
      instanced(new T.ConeGeometry(r, h, 9, 1, true), pineLeaves, pines, (t, p, s) => { p.set(t[0], height(t[0], t[1]) + y * t[2], t[1]); s.set(t[2], t[2], t[2]); });
    }
    instanced(new T.CylinderGeometry(0.2, 0.3, 2.4, 7), bark, oaks, (t, p, s) => { p.set(t[0], height(t[0], t[1]) + 1.2 * t[2], t[1]); s.set(t[2], t[2], t[2]); });
    const crown = new T.IcosahedronGeometry(1.5, 1);
    for (const [dx, dy, dz, k] of [[0, 3.1, 0, 1], [0.8, 2.7, 0.3, 0.7], [-0.7, 2.8, -0.4, 0.75], [0.1, 3.8, -0.2, 0.65]]) {
      instanced(crown, leaves, oaks, (t, p, s) => { p.set(t[0] + dx * t[2], height(t[0], t[1]) + dy * t[2], t[1] + dz * t[2]); s.set(t[2] * k, t[2] * k * 0.85, t[2] * k); });
    }
  };

  art.forest = function (ctx, def) {
    const rnd = art.rng(def.seed || 11), list = (def.trees || []).slice();
    const inner = def.inner || 26, outer = def.outer || 90, n = def.count || 160;
    const clear = def.clear || [];   /* [x0, z0, x1, z1] boxes kept free of trees: a field, a road */
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, r = inner + Math.pow(rnd(), 0.8) * (outer - inner);
      const t = [Math.cos(a) * r, Math.sin(a) * r, rnd.range(0.8, 1.5), rnd() < 0.62 ? 'pine' : 'oak'];
      if (!clear.some(b => t[0] > b[0] && t[0] < b[2] && t[1] > b[1] && t[1] < b[3])) list.push(t);
    }
    const height = (x, z) => { const d = Math.hypot(x, z), k = Math.max(0, Math.min(1, (d - (def.flat || 30)) / 40)); return k * k * (Math.sin(x * 0.05) * 4 + Math.cos(z * 0.043) * 5 + Math.sin((x + z) * 0.11) * 1.5 + 3); };
    art.trees(ctx, list, height);
    for (const t of list) if (Math.hypot(t[0], t[1]) < inner + 6) ctx.solid([t[0] - 0.3, 0, t[1] - 0.3], [t[0] + 0.3, 3, t[1] + 0.3]);
    /* the horizon: two ridges all the way round, the far one paler, higher and snowy; each fades into the haze at its
       foot (vertex colours), crags from a seeded wobble, no lighting: at that distance a mountain is a silhouette */
    const haze = new T.Color(def.haze || '#c9c3b6');
    const ridge = (radius, height, rough, colour, snow, seed) => {
      const r = art.rng(seed), N = 260, P = [], C = [], idx = [], ph = [r() * 6, r() * 6, r() * 6, r() * 6], top = new T.Color(colour), white = new T.Color('#b9c1c9');
      for (let i = 0; i <= N; i++) {
        const a = i / N * Math.PI * 2;
        let h = height * (0.55 + 0.25 * Math.sin(a * 3 + ph[0]) + 0.14 * Math.sin(a * 7 + ph[1]) + 0.07 * Math.sin(a * 17 + ph[2]) + 0.04 * Math.sin(a * 41 + ph[3]));
        h = Math.max(6, h + (r() - 0.5) * rough);
        const x = Math.cos(a) * radius, z = Math.sin(a) * radius, tc = snow && h > height * 0.8 ? white : top;
        P.push(x, -10, z, x, h, z); C.push(haze.r, haze.g, haze.b, tc.r, tc.g, tc.b);
      }
      for (let i = 0; i < N; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.setAttribute('color', new T.Float32BufferAttribute(C, 3)); g.setIndex(idx);
      const m = new T.Mesh(g, new T.MeshBasicMaterial({ vertexColors: true, fog: false, side: T.DoubleSide })); m.userData.keep = true; ctx.scene.add(m);
    };
    ridge(250, 95, 10, '#8b97a2', true, 22);
    ridge(175, 48, 7, '#5f6b63', false, 21);
    /* boulders: the same rock, bent once from a seed, scattered and half sunk; the near ones block the way */
    const rg = new T.DodecahedronGeometry(1, 1), rp = rg.attributes.position, rr = art.rng(77);
    for (let i = 0; i < rp.count; i++) { const k = 0.8 + rr() * 0.35; rp.setXYZ(i, rp.getX(i) * k, rp.getY(i) * k * 0.75, rp.getZ(i) * k); }
    rg.computeVertexNormals();
    const rocks = [];
    for (let i = 0; i < (def.rocks || 70); i++) {
      const a = rnd() * Math.PI * 2, d = rnd.range(22, 80), sc = rnd.range(0.4, 1.8);
      rocks.push([Math.cos(a) * d, Math.sin(a) * d, sc]);
    }
    const im = new T.InstancedMesh(rg, mat('stone', { m: { color: '#a29c92' } }), rocks.length), M = new T.Matrix4(), Q = new T.Quaternion(), V = new T.Vector3(), S = new T.Vector3();
    rocks.forEach((rk, i) => { V.set(rk[0], height(rk[0], rk[1]) + rk[2] * 0.15, rk[1]); Q.setFromEuler(new T.Euler(rnd() * 0.4, rnd() * 6.3, rnd() * 0.4)); S.set(rk[2], rk[2], rk[2]); M.compose(V, Q, S); im.setMatrixAt(i, M);
      if (Math.hypot(rk[0], rk[1]) < 30) ctx.solid([rk[0] - rk[2] * 0.8, 0, rk[1] - rk[2] * 0.8], [rk[0] + rk[2] * 0.8, rk[2] * 0.8, rk[1] + rk[2] * 0.8]); });
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
  art.paths = function (ctx, def) {
    const dirt = mat('dirt', { repeat: [1, 1], m: { bumpScale: 1.5, polygonOffset: true, polygonOffsetFactor: -2 } });
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
         c = mix(vec3(l), c, 0.88);                                   /* muted, not candy */
         c = mix(c * vec3(0.9, 0.96, 1.08), c * vec3(1.03, 1.0, 0.95), smoothstep(0.1, 0.7, l));   /* cool shadows, warm light */
         c = mix(c, c * c * (3.0 - 2.0 * c), 0.35);
         vec2 d = vUv - 0.5; c *= 1.0 - dot(d, d) * 0.6;
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
      }
    };
  };

  /* --- people from a model file: Kenney's Blocky Characters (CC0) ------------------------------------------------ */
  /* One small GLB (tools/assets.py slims it to 49 KB) holds the body every character shares and its animations; a
     character is that body in one of eighteen textures. A minimal reader for exactly what the file uses (float data,
     byte indices, node animations, linear keys) instead of three.js's whole glTF loader. */
  let personP = null;
  const personMats = {};
  function loadPerson() {
    if (personP) return personP;
    personP = fetch(assetURL('model.person')).then(r => { if (!r.ok) throw new Error('model ' + r.status); return r.arrayBuffer(); }).then(buf => {
      const dv = new DataView(buf), jl = dv.getUint32(12, true);
      const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl))), bin = 20 + jl + 8;
      const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
      const acc = i => {
        const a = json.accessors[i], v = json.bufferViews[a.bufferView], n = SIZE[a.type] * a.count, off = bin + (v.byteOffset || 0) + (a.byteOffset || 0);
        if (a.componentType === 5126) return new Float32Array(buf.slice(off, off + n * 4));
        if (a.componentType === 5123) return new Uint16Array(buf.slice(off, off + n * 2));
        if (a.componentType === 5125) return new Uint32Array(buf.slice(off, off + n * 4));
        return new Uint16Array(new Uint8Array(buf.slice(off, off + n)));   /* byte indices, widened */
      };
      const geos = json.meshes.map(m => m.primitives.map(p => {
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.BufferAttribute(acc(p.attributes.POSITION), 3));
        if (p.attributes.NORMAL != null) g.setAttribute('normal', new T.BufferAttribute(acc(p.attributes.NORMAL), 3));
        if (p.attributes.TEXCOORD_0 != null) g.setAttribute('uv', new T.BufferAttribute(acc(p.attributes.TEXCOORD_0), 2));
        if (p.indices != null) g.setIndex(new T.BufferAttribute(acc(p.indices), 1));
        return g;
      }));
      const nodes = json.nodes.map(n => { const o = new T.Group(); o.name = n.name || '';
        if (n.translation) o.position.fromArray(n.translation); if (n.rotation) o.quaternion.fromArray(n.rotation); if (n.scale) o.scale.fromArray(n.scale); return o; });
      json.nodes.forEach((n, i) => {
        (n.children || []).forEach(c => nodes[i].add(nodes[c]));
        if (n.mesh != null) geos[n.mesh].forEach(g => nodes[i].add(new T.Mesh(g)));
      });
      const root = new T.Group(); json.scenes[json.scene || 0].nodes.forEach(i => root.add(nodes[i]));
      const PATH = { translation: 'position', rotation: 'quaternion', scale: 'scale' };
      const clips = (json.animations || []).map(a => new T.AnimationClip(a.name, -1, a.channels.map(ch => {
        const sm = a.samplers[ch.sampler], prop = PATH[ch.target.path], name = json.nodes[ch.target.node].name;
        return new (prop === 'quaternion' ? T.QuaternionKeyframeTrack : T.VectorKeyframeTrack)(name + '.' + prop, acc(sm.input), acc(sm.output));
      })));
      root.updateMatrixWorld(true);
      const box = new T.Box3().setFromObject(root);
      return { root, clips, height: box.max.y - box.min.y, foot: box.min.y };
    });
    return personP;
  }
  function personMat(letter, tint) {   /* tint: a colour the picture is multiplied by (raiders: darker, dustier) */
    const key = letter + (tint || '');
    if (personMats[key]) return personMats[key];
    const m = new T.MeshStandardMaterial({ roughness: 0.85, color: tint || '#ffffff' });
    /* glTF's way: no flip, and the UVs run past 0..1 (the default sampler repeats) */
    new T.TextureLoader().load(assetURL('tex.person.' + letter), t => { t.colorSpace = T.SRGBColorSpace; t.flipY = false; t.wrapS = t.wrapT = T.RepeatWrapping; t.needsUpdate = true; m.map = t; m.needsUpdate = true; });
    return (personMats[key] = m);
  }
  art.PEOPLE = 'abcefikmnp';   /* the looks that belong in a village (no robots, suits or ninjas) */

  /* --- people ------------------------------------------------------------------------------------------------ */
  /* blocky, as befits Blockshire: a head with a painted face, a body, arms and legs on joints. The face is painted
     once per look; walking swings arms and legs by the speed it is told, standing still it breathes. */
  art.character = function (ctx, look) {
    look = look || {};
    const g = new T.Group(), skin = look.skin || '#e0b18c', shirt = look.shirt || '#3e6fa8', pants = look.pants || '#4a3b2a', hair = look.hair || '#4a2f1b';
    const [c, x] = canvas(64);
    x.fillStyle = skin; x.fillRect(0, 0, 64, 64);
    x.fillStyle = hair; x.fillRect(0, 0, 64, look.bald ? 4 : 14);
    x.fillStyle = '#fff'; x.fillRect(14, 24, 12, 8); x.fillRect(38, 24, 12, 8);
    x.fillStyle = look.eyes || '#2b4a7a'; x.fillRect(19, 24, 6, 8); x.fillRect(39, 24, 6, 8);
    x.fillStyle = shade(skin.length === 7 ? skin : '#e0b18c', 0.75); x.fillRect(29, 33, 6, 8);
    x.fillStyle = '#7a3b2e'; x.fillRect(22, 46, 20, 4);
    if (look.beard) { x.fillStyle = look.beard; x.fillRect(10, 40, 44, 24); x.fillStyle = '#7a3b2e'; x.fillRect(24, 46, 16, 3); }
    const face = new T.CanvasTexture(c); face.colorSpace = T.SRGBColorSpace; face.magFilter = T.NearestFilter;
    const skinM = plain(skin), hairM = plain(hair), shirtM = plain(shirt), pantsM = plain(pants), shoeM = plain('#2b2118');
    const headMats = [skinM, skinM, hairM, skinM, skinM, new T.MeshStandardMaterial({ map: face, roughness: 0.9 })];
    const part = (w, h, d, m, px, py, pz, pivotY) => {   /* a box hanging from a joint at its top */
      const j = new T.Group(); j.position.set(px, py, pz);
      const b = mesh(new T.BoxGeometry(w, h, d), m); b.position.y = pivotY ? -h / 2 : h / 2; j.add(b); g.add(j); return j;
    };
    const legL = part(0.24, 0.72, 0.26, pantsM, -0.13, 0.74, 0, true), legR = part(0.24, 0.72, 0.26, pantsM, 0.13, 0.74, 0, true);
    for (const leg of [legL, legR]) { const s = mesh(new T.BoxGeometry(0.26, 0.12, 0.32), shoeM); s.position.set(0, -0.68, -0.03); leg.add(s); }
    const body = part(0.54, 0.74, 0.32, shirtM, 0, 0.74, 0, false);
    if (look.belt !== false) { const b = mesh(new T.BoxGeometry(0.56, 0.08, 0.34), plain('#3b2814')); b.position.y = 0.06; body.add(b); }
    if (look.apron) { const a = mesh(new T.BoxGeometry(0.42, 0.55, 0.02), plain(look.apron)); a.position.set(0, 0.3, -0.17); body.add(a); }
    const armL = part(0.2, 0.7, 0.22, shirtM, -0.37, 1.44, 0, true), armR = part(0.2, 0.7, 0.22, shirtM, 0.37, 1.44, 0, true);
    for (const arm of [armL, armR]) { const h = mesh(new T.BoxGeometry(0.18, 0.14, 0.2), skinM); h.position.y = -0.67; arm.add(h); }
    const head = new T.Group(); head.position.set(0, 1.48, 0); g.add(head);
    const hm = mesh(new T.BoxGeometry(0.48, 0.48, 0.48), headMats); hm.position.y = 0.24; head.add(hm);
    if (look.hat) { const brim = mesh(new T.CylinderGeometry(0.42, 0.42, 0.04, 14), plain(look.hat)); brim.position.y = 0.5; head.add(brim); const top = mesh(new T.CylinderGeometry(0.24, 0.27, 0.26, 12), plain(look.hat)); top.position.y = 0.64; head.add(top); }
    if (look.hood) { const hd = mesh(new T.BoxGeometry(0.54, 0.4, 0.54), plain(look.hood)); hd.position.set(0, 0.36, 0.04); head.add(hd); }
    const s = look.scale || 0.9; g.scale.setScalar(s);
    const root = new T.Group(); root.add(g); root.userData.keep = true;   /* the engine places root; g bobs inside it while walking */
    /* a name over the head */
    const [nc, nx] = canvas(256); nc.height = 48; const ntex = new T.CanvasTexture(nc); ntex.colorSpace = T.SRGBColorSpace;
    const tag = new T.Sprite(new T.SpriteMaterial({ map: ntex, depthTest: false, transparent: true })); tag.scale.set(1.15 / s, 0.215 / s, 1); tag.position.y = 2.25; tag.renderOrder = 10; g.add(tag);
    const hashStr = str => { let h = 0; for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) | 0; return h; };
    const setName = (text, color) => { nx.clearRect(0, 0, 256, 48); nx.font = '600 24px Georgia,serif'; nx.textAlign = 'center'; const w = Math.min(250, nx.measureText(text).width + 20); nx.fillStyle = 'rgba(0,0,0,.45)'; nx.fillRect(128 - w / 2, 6, w, 36); nx.fillStyle = color || '#fff'; nx.fillText(text, 128, 33); ntex.needsUpdate = true; };
    ctx.scene.add(root);
    let phase = 0, breathe = Math.random() * 6;
    let mixer = null, actions = {}, now = null, once = null, hold = null, swingT = 0;
    const play = (name, fade) => {
      const a = actions[name]; if (!a || now === a) return;
      a.reset().fadeIn(fade == null ? 0.25 : fade).play(); if (now) now.fadeOut(fade == null ? 0.25 : fade); now = a;
    };
    if (assetURL) loadPerson().then(tpl => {
      const model = tpl.root.clone(true), material = personMat(look.person || art.PEOPLE[Math.abs(hashStr(shirt)) % art.PEOPLE.length], look.tint);
      model.traverse(o => { if (o.isMesh) { o.material = material; o.castShadow = true; o.receiveShadow = true; } });
      const k = 1.8 * (look.scale ? look.scale / 0.9 : 1) / tpl.height;
      model.scale.setScalar(k); model.position.y = -tpl.foot * k; model.rotation.y = Math.PI;   /* glTF faces +z, the game faces -z */
      g.children.forEach(ch => { if (ch !== tag) ch.visible = false; });
      root.add(model);
      mixer = new T.AnimationMixer(model);
      for (const c of tpl.clips) actions[c.name] = mixer.clipAction(c);
      for (const n of ['emote-yes', 'emote-no', 'pick-up', 'interact-right', 'attack-melee-right', 'die']) if (actions[n]) { actions[n].setLoop(T.LoopOnce, 1); actions[n].clampWhenFinished = true; }
      if (hold) play(hold, 0);
      mixer.addEventListener('finished', () => { once = null; });
      play('idle', 0);
    }).catch(e => console.warn('LWQ: the people model did not load; blocky stand-ins stay', e && e.message));
    return {
      group: root, head, setName, tag,
      /* a one-off gesture: 'emote-yes', 'emote-no', 'pick-up', 'interact-right', 'attack-melee-right' */
      emote(name) {
        if (name === 'attack-melee-right') swingT = 0.45;   /* the blocky stand-in swings its arm instead */
        if (!actions[name] || hold) return;
        if (now === actions[name]) now = null;   /* the same swing again starts again */
        once = name; play(name, 0.1);
      },
      /* a pose kept until it is let go: 'die' (falls and stays down); null gets up again */
      hold(name) {
        if (hold === name) return;
        hold = name; once = null;
        /* every other action stops first: left running at full weight, a walk under the fall kept a dying raider on
           its feet, and a fall under the idle kept a guard who was raised again on the ground (tbuuol 2026-10-23) */
        if (mixer) { mixer.stopAllAction(); now = null; }
        if (name) play(name, 0); else play('idle', 0);
        if (!mixer) g.rotation.x = name === 'die' ? -Math.PI / 2 : 0, g.position.z = name === 'die' ? 0.9 : 0;
      },
      animate(dt, speed) {
        if (hold) { if (mixer) mixer.update(dt); return; }
        if (mixer) {
          if (!once || speed > 0.3) { once = null; play(speed > 5 ? 'sprint' : speed > 0.3 ? 'walk' : 'idle'); }
          if (actions.walk) actions.walk.timeScale = Math.max(0.6, speed / 2.6);
          mixer.update(dt);
          return;
        }
        const sp = Math.min(1.6, (speed || 0) / 3);
        phase += dt * (4 + speed * 1.8); breathe += dt * 1.6;
        const swing = Math.sin(phase) * 0.75 * sp;
        legL.rotation.x = swing; legR.rotation.x = -swing; armL.rotation.x = -swing * 0.9; armR.rotation.x = swing * 0.9;
        const idle = 1 - Math.min(1, sp * 3);
        body.scale.y = 1 + Math.sin(breathe) * 0.012 * idle; armL.rotation.z = -0.04 - Math.sin(breathe) * 0.02 * idle; armR.rotation.z = 0.04 + Math.sin(breathe) * 0.02 * idle;
        g.position.y = Math.abs(Math.sin(phase)) * 0.05 * sp;
        if (swingT > 0) { swingT -= dt; const k = Math.sin(Math.max(0, swingT) / 0.45 * Math.PI); armR.rotation.x = -2.2 * k; }
      },
      wave(t) { armR.rotation.x = -2.6 + Math.sin(t * 9) * 0.3; armR.rotation.z = 0.3; }
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

  if (G.LWQ && G.LWQ.define) G.LWQ.define('art', { api: 1, v: 3 }, () => art);
})(typeof globalThis !== 'undefined' ? globalThis : this);
