/* LiteWorldsQuest engine: first person, one small level, other players, the wallet.
     const game = engine.start(element, {room, game})     -> {stop()}
   MOVEMENT  WASD / arrows, Shift to run, Space to jump, mouse to look (click the view to capture it), E to use.
   THE WORLD  doors, levers, pickups are shared. As in ASHVALE, one player keeps them: the HOST, who joined the room
     first (ties by id). Everyone else sends an intent ({I: 'use'|'take', o: id}); the host decides and sends the
     whole world ({W}) to everyone, again every 3 s for anybody who missed it. Alone, you are the host.
   PLAYERS  each page sends its position 15 times a second over the fast lane (browser to browser), or 4 a second
     through the room when there is none, and a heartbeat once a second standing still. Others are drawn a little
     behind (100 ms on the fast lane, 300 ms through the room) and interpolated between the samples.
   MESSAGES  {p: [x, y, z], r: [yaw, pitch], j: joinedAt, n?: name, w?: [main, off] item ids}   where a player is
             {I: op, o: id}                                         an intent, to the host
             {W: world}                                             the world, from the host
             {H: 1}                                                 "I am new: the world, please"
             {S: 'offered'}                                         a shrine offering went through (for the log)
             {C: snapshot}                                          the fight at the gate, from the host (combat module)
             {X: unit, d}                                           my blow on a raider, to the host
             {D: player, d}  /  {K: player, x}                      from the host: damage (negative heals) / a kill's XP
   COMBAT  F or the left mouse button strikes (a sword, in front of you); hit points, level and XP are in the HUD and
     level and XP are kept in the wallet's storage. At 0 hit points you are back inside the gate after a moment.
   PHONES  a touch screen gets a joystick (left thumb), looking (right thumb) and buttons; the first tap asks for full
     screen and a landscape lock (where the browser allows them; otherwise the picture simply follows the phone).
   THE WALLET  the HUD shows @name and balance; crystals and offerings are remembered (arcade.storage); the shrine
     asks the wallet for a 1-coin payment to the player's own address (only the fee leaves), which the player
     approves or refuses in the wallet. */
(function (G) {
  'use strict';
  const TAU = Math.PI * 2;
  const R2 = v => Math.round(v * 100) / 100;
  const angLerp = (a, b, k) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return a + d * k; };
  const hue = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function start(D, el, opts) {
    opts = opts || {};
    const THREE = D.three, net = D.net, wallet = D.wallet, art = D.art;
    /* the Hybrid tier's real files (textures, the people model): the loader says where each one lives */
    const assetURL = G.LWQ && G.LWQ.get ? G.LWQ.get('$asset') : null;
    if (assetURL && art.useAssets) art.useAssets(assetURL);
    const sound = D.sound ? D.sound.create() : null;
    const LEVEL = opts.level || (D.levels.blockshire ? 'blockshire' : 'test');
    const LV = D.levels[LEVEL];
    if (!LV) throw new Error('no level ' + LEVEL);
    const ROOM = opts.room || ('lwq.' + LV.id), GAME = opts.game || 'liteworldsquest';
    let stopped = false;

    /* --- scene ---------------------------------------------------------------------------------------- */
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.info.autoReset = false;   /* the stats count the whole frame, scene and after-passes, not only the last pass */
    renderer.setPixelRatio(Math.min(2, G.devicePixelRatio || 1));
    el.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%';
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 600);
    camera.rotation.order = 'YXZ';
    let env = null;
    if (LV.env) env = art.setup(THREE, renderer, scene, LV.env);   /* sky, sun and shadows, fog, ground: the art module */
    else {
      scene.background = new THREE.Color(LV.sky || '#9cc4e4');
      if (LV.fog) scene.fog = new THREE.Fog(LV.sky || '#9cc4e4', LV.fog[0], LV.fog[1]);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 0.9));
      const sun = new THREE.DirectionalLight(0xffffff, 0.8); sun.position.set(6, 12, 4); scene.add(sun);
    }
    /* bloom, film tone, grade, vignette after the scene (art.post); without WebGL2 the scene goes straight to the screen */
    const post = LV.env && art.post ? art.post(renderer, scene, camera, { exposure: LV.env.exposure || 1, bloom: LV.env.bloom == null ? 0.32 : LV.env.bloom }) : null;
    function resize() {
      const w = el.clientWidth || G.innerWidth, h = el.clientHeight || G.innerHeight;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      if (post) post.resize(w, h);
    }
    G.addEventListener('resize', resize);

    const boxes = [];          /* collision: {min:[x,y,z], max:[x,y,z], on()} */
    const usable = [];         /* meshes the crosshair can use */
    const updates = [];        /* fn(dt, t) every frame: fire, water, ... */
    const ctx = { THREE, scene, rng: art.rng,
                  solid: (min, max, on) => boxes.push({ min, max, on: on || (() => true) }),
                  usable: (m, data) => { m.userData = data; usable.push(m); },
                  every: fn => updates.push(fn) };
    function box(def, mat) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(def.size[0], def.size[1], def.size[2]),
        mat || new THREE.MeshLambertMaterial({ color: def.color || '#888' }));
      m.position.set(def.pos[0], def.pos[1], def.pos[2]);
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
      return m;
    }
    const aabb = (def, on) => ({ min: def.pos.map((p, i) => p - def.size[i] / 2), max: def.pos.map((p, i) => p + def.size[i] / 2), on: on || (() => true) });
    for (const s of LV.solids || []) { if (!s.invisible) box(s); boxes.push(aabb(s)); }

    /* the level's things, built by the art module; the engine keeps what can be used and what blocks the way */
    const doors = {}, switches = {}, pickups = {}, shrines = {}, npcs = {};
    for (const d of LV.doors || []) {   /* a door that slides up (the test level) */
      const m = box(d); m.userData = { kind: 'door', id: d.id };
      doors[d.id] = { def: d, mesh: m, y0: d.pos[1] };
      boxes.push(aabb(d, () => !W.open[d.id]));
      usable.push(m);
    }
    for (const h of LV.huts || []) {    /* a hut, and its door that swings on a hinge */
      const built = art.hut(ctx, h), d = built.door;
      if (!d) continue;
      d.panel.userData = { kind: 'door', id: d.id }; usable.push(d.panel);
      doors[d.id] = { def: d, mesh: d.panel, pivots: [{ p: d.pivot, swing: d.swing }] };
      boxes.push({ min: d.box.min, max: d.box.max, on: () => !W.open[d.id] });
    }
    /* the camp's fence, and its gate when it has an id: a door of two wings, open at the start if the level says so */
    if (LV.fence) {
      const gd = (art.fence(ctx, LV.fence) || {}).door;
      if (gd) {
        for (const w of gd.wings) { w.userData = { kind: 'door', id: gd.id }; usable.push(w); }
        doors[gd.id] = { def: gd, mesh: gd.wings[0], pivots: gd.pivots };
        boxes.push({ min: gd.box.min, max: gd.box.max, on: () => !W.open[gd.id] });
      }
    }
    /* a piece of the real Earth (tools/realworld.py): the ground is its heights, the houses its footprints */
    const realW = LV.real ? art.realworld(ctx, LV.real) : null;
    const grid = new Map(), CELL = 25, cellKey = (i, j) => i + ',' + j;
    if (realW) {   /* footprints and walls by 25 m cell, so a step only looks at what is near */
      const file = (o, x0, z0, x1, z1) => { for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) { const k = cellKey(i, j); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(o); } };
      for (const b of realW.polys) { const xs = b.pts.map(q => q[0]), zs = b.pts.map(q => q[1]); file({ poly: b }, Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)); }
      for (const sg of realW.segs) file({ seg: sg }, Math.min(sg.a[0], sg.b[0]) - 1, Math.min(sg.a[1], sg.b[1]) - 1, Math.max(sg.a[0], sg.b[0]) + 1, Math.max(sg.a[1], sg.b[1]) + 1);
    }
    /* portals to other levels; the real world gets one home, where you arrive (its data says nothing of portals) */
    const portalDefs = (LV.portals || []).slice();
    if (realW && !portalDefs.length) portalDefs.push({ pos: [realW.spawn[0], realW.spawn[1]], y: realW.groundAt(realW.spawn[0], realW.spawn[1]) - 0.2, to: 'blockshire', label: 'Blockshire', rot: 0, color: '#ffc77f' });
    const portals = portalDefs.map(d => art.portal(ctx, d));
    if (LV.fire) { art.campfire(ctx, LV.fire); if (sound) sound.fire(LV.fire.pos[0], 0, LV.fire.pos[1]); }
    if (LV.forest) art.forest(ctx, LV.forest);
    if (LV.grass) art.grass(ctx, LV.grass);
    if (LV.paths) art.paths(ctx, LV.paths);
    for (const pr of LV.props || []) art.prop(ctx, pr);
    /* THINGS TO GATHER around the camp (tbuuol 2026-10-23): an oak, an ore boulder, herbs. Which are spent is part of
       the shared world (W.dep); the house decides what gathering gives, and when a spent one grows back. */
    const resources = {};
    for (const n of (LV.resources && LV.resources.nodes) || []) {
      const look = art.resource(ctx, n);
      look.use.userData = { kind: 'res', id: n.id }; usable.push(look.use);
      resources[n.id] = { def: n, look };
    }
    const RES_NAME = { tree: 'oak', rock: 'ore boulder', herb: 'herbs' };
    /* THE FORGE: E opens the menu's Craft tab; making is asked of the house, which wants the player at the forge */
    let forge = null;
    if (LV.forge) { forge = art.forge(ctx, LV.forge); forge.use.userData = { kind: 'forge' }; usable.push(forge.use); }
    const nearForge = (x, z) => !!LV.forge && Math.hypot(x - LV.forge.pos[0], z - LV.forge.pos[1]) < 5;
    for (const s of LV.switches || []) {
      const m = box(s); m.userData = { kind: 'switch', id: s.id };
      switches[s.id] = { def: s, mesh: m };
      usable.push(m);
    }
    for (const p of LV.pickups || []) {
      const geo = p.kind === 'key' ? new THREE.TorusGeometry(0.15, 0.05, 8, 16) : new THREE.OctahedronGeometry(0.22);
      const mat = p.kind === 'key'
        ? new THREE.MeshStandardMaterial({ color: '#d4a03a', metalness: 0.8, roughness: 0.3, emissive: '#3a2400' })
        : new THREE.MeshStandardMaterial({ color: '#7ff0ff', metalness: 0.2, roughness: 0.15, emissive: '#1aa9c9', emissiveIntensity: 0.9 });
      const m = new THREE.Mesh(geo, mat); m.position.set(p.pos[0], p.pos[1], p.pos[2]); m.castShadow = true; scene.add(m);
      m.userData = { kind: 'pickup', id: p.id, keep: true };   /* keep: it spins and hides, art.freeze must leave it alone */
      /* small things are hard to aim at (and a key is a ring: the crosshair goes through its hole), so each has an
         unseen sphere around it that the crosshair finds instead */
      const hit = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.copy(m.position); hit.userData = m.userData; scene.add(hit);
      pickups[p.id] = { def: p, mesh: m, hit };
      usable.push(hit);
    }
    for (const s of LV.shrines || []) {
      const m = box(s); m.userData = { kind: 'shrine', id: s.id };
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshBasicMaterial({ color: '#777' }));
      glow.position.set(s.pos[0], s.pos[1] + s.size[1] / 2 + 0.3, s.pos[2]); scene.add(glow);
      shrines[s.id] = { def: s, mesh: m, glow };
      boxes.push(aabb(s)); usable.push(m, glow); glow.userData = m.userData;
    }
    if (LV.well) {   /* the wishing well is a shrine: an offering through the wallet */
      const w = art.well(ctx, LV.well), data = { kind: 'shrine', id: LV.well.id };
      for (const m of [w.use].concat(w.also || [])) { m.userData = data; usable.push(m); }
      shrines[LV.well.id] = { def: LV.well, glow: w.glow };
    }

    /* --- the people of the level ----------------------------------------------------------------------- */
    /* each stands where the level puts them, turns to whoever comes close, and says their lines one at a time when
       spoken to (E). One with a "walk" goes round its points, stopping now and then, and stands still to talk. */
    const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
    for (const n of LV.npcs || []) {
      const c = art.character(ctx, n.look); c.setName(n.name, '#ffe9a8');
      const home = n.lookAt ? yawTo(n.lookAt[0] - n.pos[0], n.lookAt[1] - n.pos[1]) : (n.rot || 0) * Math.PI / 180;
      c.group.position.set(n.pos[0], 0, n.pos[1]); c.group.rotation.y = home;
      const hit = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.9, 0.8), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.set(n.pos[0], 0.95, n.pos[1]); hit.userData = { kind: 'npc', id: n.id }; scene.add(hit); usable.push(hit);
      if (!n.walk) ctx.solid([n.pos[0] - 0.3, 0, n.pos[1] - 0.3], [n.pos[0] + 0.3, 1.8, n.pos[1] + 0.3]);
      npcs[n.id] = { def: n, c, hit, home, x: n.pos[0], z: n.pos[1], wp: 0, wait: 1 + Math.random() * 2, line: -1 };
    }
    let travelling = false;
    const armed = new Set();
    function portalTick() {
      for (let i = 0; i < portals.length; i++) {
        const P = portals[i], d = Math.hypot(me.x - P.x, me.z - P.z);
        if (d > 2.5) armed.add(i);                       /* you arrived in it: it waits until you have stepped out */
        if (!travelling && armed.has(i) && d < 0.9 && Math.abs(me.y - P.y) < 2) travel(P);
      }
    }
    function travel(P) {
      travelling = true;
      const veil = document.createElement('div');
      veil.style.cssText = 'position:absolute;inset:0;background:#000;opacity:0;transition:opacity .8s;display:flex;align-items:center;' +
        'justify-content:center;color:#e9dcc0;font:22px Georgia,serif;pointer-events:none';
      veil.textContent = 'Travelling to ' + (P.label || P.to) + '…';
      el.appendChild(veil); requestAnimationFrame(() => { veil.style.opacity = '1'; });
      if (sound) sound.blip('pickup');
      setTimeout(() => {
        if (room) room.leave();
        try { const q = new URLSearchParams(location.search); q.set('level', P.to); location.search = '?' + q.toString(); }
        catch (e) { log('The portal is cold here: ' + (e && e.message || e)); travelling = false; veil.remove(); }
      }, 900);
    }
    function npcTick(dt, t) {
      for (const id in npcs) {
        const N = npcs[id], n = N.def, dx = me.x - N.x, dz = me.z - N.z, dist = Math.hypot(dx, dz);
        const talking = talk && talk.id === id;
        let speed = 0, want = N.home;
        if (n.walk && !talking && !(dist < 2.2)) {
          if (N.wait > 0) N.wait -= dt;
          else {
            const tgt = n.walk[N.wp], tx = tgt[0] - N.x, tz = tgt[1] - N.z, d = Math.hypot(tx, tz);
            if (d < 0.15) { N.wp = (N.wp + 1) % n.walk.length; N.wait = 0.8 + Math.random() * 2.5; }
            else { const sp = n.speed || 1.4, k = Math.min(1, sp * dt / d); N.x += tx * k; N.z += tz * k; speed = sp; want = yawTo(tx, tz); N.home = want; }
          }
        }
        if (dist < 4 && speed === 0) want = yawTo(dx, dz);   /* turn to whoever comes close */
        N.c.group.rotation.y = angLerp(N.c.group.rotation.y, want, Math.min(1, dt * 5));
        N.c.group.position.set(N.x, 0, N.z); N.hit.position.set(N.x, 0.95, N.z);
        N.c.animate(dt, speed);
        if (N.c.tag) N.c.tag.visible = dist < 9 || (talk && talk.id === id);   /* a name over a head only up close */
        if (talking && dist > 5) closeTalk();
      }
    }
    let talk = null;   /* {id, line} while somebody is being spoken to */
    function speak(id) {
      const N = npcs[id], lines = N.def.lines || ['…'];
      if (talk && talk.id === id) talk.line++; else talk = { id, line: 0 };
      if (N.c.emote) N.c.emote(talk.line % 2 ? 'emote-no' : 'emote-yes');
      if (sound) sound.blip('talk');
      if (talk.line >= lines.length) { closeTalk(); return; }
      const box2 = $('.lwq-talk');
      box2.innerHTML = '<b>' + esc(N.def.name) + '</b><br>' + esc(lines[talk.line]) +
        '<small>' + (talk.line + 1 < lines.length ? 'E: more' : 'E: goodbye') + '</small>';
      box2.style.display = 'block';
    }
    function closeTalk() { talk = null; $('.lwq-talk').style.display = 'none'; }

    /* --- the fight at the gate (combat module): guards, a priest, raiders out of the forest ------------------ */
    const combat = D.combat || null;
    const fight = LV.defense && combat ? combat.create({ THREE, art, ctx, def: LV.defense }) : null;

    /* everything that never moves, merged by material: hundreds of parts become a few dozen draw calls */
    for (const id in doors) if (!doors[id].pivots) doors[id].mesh.userData.keep = true;
    for (const id in switches) switches[id].mesh.userData.keep = true;
    const frozen = art.freeze ? art.freeze(scene) : null;
    if (frozen) console.info('LWQ: ' + frozen.joined + ' still parts drawn in ' + frozen.calls + ' calls');

    /* --- the shared world --------------------------------------------------------------------------- */
    let W = { seq: 0, open: {}, taken: {}, dep: {} };
    for (const id in doors) W.open[id] = !!doors[id].def.open;
    for (const id in pickups) W.taken[id] = null;

    /* --- HUD ------------------------------------------------------------------------------------------ */
    /* a touch screen (a phone, a tablet): the joystick and buttons */
    const TOUCH = !!((G.matchMedia && G.matchMedia('(pointer: coarse)').matches) || (G.navigator && G.navigator.maxTouchPoints > 0 && 'ontouchstart' in G));
    const hud = document.createElement('div');
    hud.innerHTML =
      '<div class="lwq-hurt"></div>' +
      '<div class="lwq-tl"></div><div class="lwq-tr"></div><div class="lwq-x">+</div><div class="lwq-prompt"></div>' +
      '<div class="lwq-inv"></div><div class="lwq-log"></div><div class="lwq-talk"></div>' +
      (fight ? '<div class="lwq-stats"><span class="lwq-lv"></span><div class="lwq-bar lwq-hp"><i></i><span></span></div>' +
               '<div class="lwq-bar lwq-xp"><i></i><span></span></div></div>' : '') +
      (LV.credits ? '<div class="lwq-credit">' + esc(LV.credits) + '</div>' : '') +
      (TOUCH ? '<div class="lwq-touch"><div class="lwq-stick"><div class="lwq-knob"></div></div>' +
               '<button class="lwq-b lwq-b-atk" data-b="attack">⚔</button><button class="lwq-b lwq-b-use" data-b="use">E</button>' +
               '<button class="lwq-b lwq-b-jump" data-b="jump">▲</button><button class="lwq-b lwq-b-run" data-b="run">Run</button>' +
               '<button class="lwq-b lwq-b-menu" data-b="menu">☰</button></div>' : '') +
      '<div class="lwq-start"><b>' + esc(LV.title || 'LiteWorldsQuest') + '</b><br>' + (TOUCH ? 'Tap to play' : 'Click to play') + '<br>' +
      (TOUCH ? '<small>Left thumb: walk · right thumb: look · ⚔ strike · E use · ▲ jump</small></div>'
             : '<small>WASD move · Shift run · Space jump · Mouse look · E use · F / click strike · M sound · F3 fps · Esc release mouse</small></div>');
    el.appendChild(hud);
    const st = document.createElement('style');
    st.textContent =
      '.lwq-tl,.lwq-tr,.lwq-inv,.lwq-log,.lwq-prompt{position:absolute;font:13px/1.4 system-ui,sans-serif;color:#fff;' +
      'text-shadow:0 1px 2px #000;pointer-events:none}' +
      '.lwq-tl{left:12px;top:10px}.lwq-tr{right:12px;top:10px;text-align:right}.lwq-inv{left:12px;bottom:10px}' +
      '.lwq-log{right:12px;bottom:10px;text-align:right;max-width:46%}' +
      '.lwq-x{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);color:#fff;font:18px monospace;' +
      'text-shadow:0 0 3px #000;pointer-events:none}' +
      '.lwq-prompt{left:50%;top:calc(50% + 22px);transform:translateX(-50%)}' +
      '.lwq-start{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;' +
      'background:rgba(0,0,0,.45);color:#fff;font:20px/1.6 system-ui,sans-serif;text-align:center;cursor:pointer}' +
      '.lwq-start small{font-size:13px;opacity:.85}' +
      '.lwq-talk{display:none;position:absolute;left:50%;bottom:64px;transform:translateX(-50%);width:min(560px,80%);' +
      'background:rgba(28,20,12,.82);border:2px solid #b08a50;border-radius:8px;padding:12px 16px;color:#f3e6cc;' +
      'font:15px/1.45 Georgia,serif;pointer-events:none}.lwq-talk b{color:#ffd88a}' +
      '.lwq-talk small{display:block;margin-top:6px;font:12px system-ui,sans-serif;opacity:.7}' +
      '.lwq-credit{position:absolute;left:50%;bottom:4px;transform:translateX(-50%);font:11px system-ui,sans-serif;' +
      'color:#fff;opacity:.75;text-shadow:0 1px 2px #000;pointer-events:none;white-space:nowrap}' +
      '.lwq-hurt{position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 140px rgba(190,0,0,.85);opacity:0;transition:opacity .5s}' +
      '.lwq-stats{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);width:min(320px,44%);pointer-events:none;' +
      'font:600 12px system-ui,sans-serif;color:#fff;text-shadow:0 1px 2px #000;text-align:center}' +
      '.lwq-bar{position:relative;height:13px;margin-top:4px;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.25);border-radius:4px;overflow:hidden}' +
      '.lwq-bar i{position:absolute;left:0;top:0;bottom:0;transition:width .2s}.lwq-hp i{background:linear-gradient(#e5574a,#a4241b)}' +
      '.lwq-xp{height:8px}.lwq-xp i{background:linear-gradient(#6fb6ff,#2f6fc9)}' +
      '.lwq-bar span{position:relative;font-size:10px;line-height:13px}.lwq-xp span{display:none}' +
      '.lwq-touch{display:none;position:absolute;inset:0;touch-action:none;user-select:none;-webkit-user-select:none}' +
      '.lwq-stick{display:none;position:absolute;width:120px;height:120px;margin:-60px 0 0 -60px;border-radius:50%;' +
      'background:rgba(255,255,255,.12);border:2px solid rgba(255,255,255,.35);pointer-events:none}' +
      '.lwq-knob{position:absolute;left:35px;top:35px;width:50px;height:50px;border-radius:50%;background:rgba(255,255,255,.55)}' +
      '.lwq-b{position:absolute;border-radius:50%;border:2px solid rgba(255,255,255,.55);background:rgba(20,20,20,.38);color:#fff;' +
      'font:700 18px system-ui,sans-serif;touch-action:none;padding:0}.lwq-b.on{background:rgba(255,200,80,.55)}' +
      '.lwq-b-atk{right:28px;bottom:42px;width:84px;height:84px;font-size:34px;background:rgba(150,30,20,.5)}' +
      '.lwq-b-use{right:124px;bottom:30px;width:58px;height:58px}.lwq-b-jump{right:40px;bottom:140px;width:58px;height:58px}' +
      '.lwq-b-run{right:124px;bottom:104px;width:52px;height:52px;font-size:13px}.lwq-b-menu{right:14px;top:120px;width:48px;height:48px;font-size:22px}' +
      (TOUCH ? '.lwq-log{top:48px;bottom:auto;font-size:12px}.lwq-inv{bottom:auto;top:48px}' +
               /* held upright the buttons fill the bottom: the bars go to the top, the log below them */
               '@media (max-aspect-ratio:1/1){.lwq-stats{bottom:auto;top:52px;width:min(320px,64%)}.lwq-log{top:104px;max-width:70%}}' : '');
    el.appendChild(st);
    const $ = c => hud.querySelector(c);
    const logLines = [];
    function log(text) {
      logLines.push(text); while (logLines.length > 6) logLines.shift();
      $('.lwq-log').innerHTML = logLines.map(esc).join('<br>');
    }
    /* THE PLAYER'S MENU (menu module): skills, attributes, the bag, what is worn. Wearing and taking off are asked of
       the house, which keeps the record; I or Tab, or the ☰ button on a phone. */
    let menu = null;
    if (D.menu && D.rpg && LV.defense) {
      menu = D.menu.create({ el, rpg: D.rpg, touch: TOUCH, atForge: () => nearForge(me.x, me.z),
        ask(q) {
          if (!room || !houseId()) { log('The house is away: what you carry is kept by the house, so nothing can change now.'); return; }
          const msg = Object.assign({ Q: q.op }, q.op === 'equip' ? { u: q.uid } : q.op === 'craft' ? { r: q.recipe } : { s: q.slot });
          if (room.fast && room.peers()[hostId()] === 'direct') room.state(msg);
          else room.tell(msg);
        } });
    }
    function toggleMenu() {
      if (!menu) return;
      if (menu.isOpen()) { menu.close(); return; }
      try { document.exitPointerLock(); } catch (e) { /* not locked */ }
      menu.open();
    }

    /* --- the player ------------------------------------------------------------------------------------ */
    const HALF = 0.3, HEIGHT = 1.7, EYE = 1.6, WALK = 4.2, RUN = 7, JUMP = 7.5, GRAVITY = 20;
    const SPAWN = realW ? [realW.spawn[0], realW.groundAt(realW.spawn[0], realW.spawn[1]) + 0.05, realW.spawn[1]] : LV.spawn;
    const me = { x: SPAWN[0], y: SPAWN[1], z: SPAWN[2], vy: 0, ground: false, yaw: LV.spawnYaw || 0, pitch: 0, name: '' };
    const keys = {};
    const canvas = renderer.domElement;
    const locked = () => document.pointerLockElement === canvas;
    let touchPlaying = false;
    const playing = () => locked() || touchPlaying;
    $('.lwq-start').addEventListener('click', () => {
      if (sound) sound.start();
      if (TOUCH) { startTouch(); return; }
      try { canvas.requestPointerLock(); } catch (e) { /* no pointer lock here */ }
    });
    canvas.addEventListener('click', () => { if (!TOUCH && !locked()) try { canvas.requestPointerLock(); } catch (e) { /* ignore */ } });
    canvas.addEventListener('mousedown', e => { if (e.button === 0 && locked()) attack(); });
    document.addEventListener('pointerlockchange', () => { if (!TOUCH) $('.lwq-start').style.display = locked() ? 'none' : 'flex'; });

    /* --- phones: full screen, a joystick and buttons ------------------------------------------------------- */
    /* The picture follows the phone: held upright it is tall, turned it is wide. (v0.4 turned the game itself a
       quarter when the phone was upright; tbuuol 2026-10-22: turning the phone then turned the screen again and
       nothing fitted -- so the game asks the browser for a landscape lock on the first tap, and does no more.) */
    const local = t => ({ x: t.clientX, y: t.clientY });
    function goFull() {
      try {
        const d = document.documentElement, ask = d.requestFullscreen || d.webkitRequestFullscreen;
        if (ask) Promise.resolve(ask.call(d)).then(() => {
          const o = G.screen && G.screen.orientation;
          return o && o.lock ? o.lock('landscape') : null;
        }).catch(() => { /* not allowed here (a game in a frame usually is not): the picture follows the phone */ }).then(() => setTimeout(resize, 250));
      } catch (e) { /* ignore */ }
    }
    const move2 = { x: 0, y: 0 };   /* the joystick, -1..1 each way */
    let runOn = false;
    function startTouch() {
      touchPlaying = true;
      $('.lwq-start').style.display = 'none';
      $('.lwq-touch').style.display = 'block';
      goFull();
    }
    if (TOUCH) {
      const pad = $('.lwq-touch'), stick = $('.lwq-stick'), knob = $('.lwq-knob'), R = 55;
      let stickId = null, lookId = null, base = null, last = null;
      const press = (b, on) => {
        const k = b.dataset.b;
        if (k === 'attack' && on) attack();
        else if (k === 'menu' && on) toggleMenu();
        else if (k === 'use' && on) useAim();
        else if (k === 'jump') keys.Space = on;
        else if (k === 'run' && on) { runOn = !runOn; b.classList.toggle('on', runOn); }
      };
      pad.addEventListener('touchstart', e => {
        e.preventDefault();
        for (const t of e.changedTouches) {
          const b = t.target.closest && t.target.closest('.lwq-b');
          if (b) { press(b, true); continue; }
          const p = local(t), wide = el.clientWidth;
          if (p.x < wide * 0.42 && stickId == null) {
            stickId = t.identifier; base = p;
            stick.style.left = p.x + 'px'; stick.style.top = p.y + 'px'; stick.style.display = 'block'; knob.style.transform = '';
          } else if (lookId == null) { lookId = t.identifier; last = p; }
        }
      }, { passive: false });
      pad.addEventListener('touchmove', e => {
        e.preventDefault();
        for (const t of e.changedTouches) {
          const p = local(t);
          if (t.identifier === stickId) {
            let dx = p.x - base.x, dy = p.y - base.y; const d = Math.hypot(dx, dy);
            if (d > R) { dx *= R / d; dy *= R / d; }
            move2.x = dx / R; move2.y = dy / R;
            knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
          } else if (t.identifier === lookId) {
            me.yaw -= (p.x - last.x) * 0.0065;
            me.pitch = Math.max(-1.4, Math.min(1.4, me.pitch - (p.y - last.y) * 0.0065));
            last = p;
          }
        }
      }, { passive: false });
      const end = e => {
        for (const t of e.changedTouches) {
          const b = t.target.closest && t.target.closest('.lwq-b');
          if (b) press(b, false);
          if (t.identifier === stickId) { stickId = null; move2.x = move2.y = 0; stick.style.display = 'none'; }
          if (t.identifier === lookId) lookId = null;
        }
      };
      pad.addEventListener('touchend', end); pad.addEventListener('touchcancel', end);
      G.addEventListener('orientationchange', () => setTimeout(resize, 200));
    }
    document.addEventListener('mousemove', e => {
      if (!locked()) return;
      me.yaw -= e.movementX * 0.0022;
      me.pitch = Math.max(-1.5, Math.min(1.5, me.pitch - e.movementY * 0.0022));
    });
    const onKey = down => e => {
      keys[e.code] = down;
      if (down && e.code === 'KeyE') useAim();
      if (down && e.code === 'KeyF' && !e.repeat) attack();
      if (down && (e.code === 'KeyI' || e.code === 'Tab') && !e.repeat && menu) { e.preventDefault(); toggleMenu(); }
      if (down && e.code === 'F3') { showFps = !showFps; drawNet(); e.preventDefault(); }
      if (down && e.code === 'KeyM' && sound) log(sound.mute() ? 'Sound off (M).' : 'Sound on (M).');
      if (down && e.code === 'Space') e.preventDefault();
    };
    document.addEventListener('keydown', onKey(true));
    document.addEventListener('keyup', onKey(false));

    function hits(x, y, z) {
      const a = [x - HALF, y, z - HALF], b = [x + HALF, y + HEIGHT, z + HALF];
      for (const B of boxes) {
        if (!B.on()) continue;
        if (a[0] < B.max[0] && b[0] > B.min[0] && a[1] < B.max[1] && b[1] > B.min[1] && a[2] < B.max[2] && b[2] > B.min[2]) return B;
      }
      return null;
    }
    /* SMOOTH OWN MOVEMENT (tbuuol 2026-10-20: "es wirkt etwas rucklig"): physics runs on a fixed 120 Hz step, however
       uneven the frames are, and the camera is placed between the last two steps by how far into the next one this
       frame falls. Looking around is not stepped: the mouse turns the camera at once. */
    const STEP = 1 / 120, prev = { x: me.x, y: me.y, z: me.z };
    let acc = 0;
    /* a ledge up to 42 cm (a hut's floor, a doorstep) is stepped onto while walking, as long as there is room above */
    function stepUp(B) {
      if (B.max[1] - me.y > 0.42 || B.max[1] <= me.y || me.vy > 0.5) return false;
      if (hits(me.x, B.max[1] + 1e-3, me.z)) return false;
      me.y = B.max[1] + 1e-3; return true;
    }
    /* the real world's houses and walls: a circle the player's width is pushed out of any footprint it enters */
    function realPush() {
      if (!realW) return;
      const lim = realW.half - 1; me.x = Math.max(-lim, Math.min(lim, me.x)); me.z = Math.max(-lim, Math.min(lim, me.z));
      const near = grid.get(cellKey(Math.floor(me.x / CELL), Math.floor(me.z / CELL))) || [];
      for (const o of near) {
        if (o.poly) {
          const b = o.poly; if (me.y >= b.top - 0.05) continue;
          let best = 1e9, cx = 0, cz = 0;
          for (let i = 0; i < b.pts.length; i++) {
            const a = b.pts[i], q = b.pts[(i + 1) % b.pts.length], ex = q[0] - a[0], ez = q[1] - a[1], L2 = ex * ex + ez * ez || 1e-9;
            const t = Math.max(0, Math.min(1, ((me.x - a[0]) * ex + (me.z - a[1]) * ez) / L2)), px = a[0] + ex * t, pz = a[1] + ez * t, d = Math.hypot(me.x - px, me.z - pz);
            if (d < best) { best = d; cx = px; cz = pz; }
          }
          if (realW.inside(b.pts, me.x, me.z)) { const dx = cx - me.x, dz = cz - me.z, d = Math.hypot(dx, dz) || 1e-6; me.x = cx + dx / d * (HALF + 1e-3); me.z = cz + dz / d * (HALF + 1e-3); }
          else if (best < HALF) { const dx = me.x - cx, dz = me.z - cz, d = best || 1e-6; me.x = cx + dx / d * (HALF + 1e-3); me.z = cz + dz / d * (HALF + 1e-3); }
        } else {
          const sg = o.seg; if (me.y >= sg.top - 0.05) continue;
          const ex = sg.b[0] - sg.a[0], ez = sg.b[1] - sg.a[1], L2 = ex * ex + ez * ez || 1e-9;
          const t = Math.max(0, Math.min(1, ((me.x - sg.a[0]) * ex + (me.z - sg.a[1]) * ez) / L2)), px = sg.a[0] + ex * t, pz = sg.a[1] + ez * t;
          const dx = me.x - px, dz = me.z - pz, d = Math.hypot(dx, dz), r = sg.r + HALF;
          if (d < r) { const k = d || 1e-6; me.x = px + dx / k * (r + 1e-3); me.z = pz + dz / k * (r + 1e-3); }
        }
      }
    }
    function physics(dt) {
      let f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
      let s = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
      if (move2.x || move2.y) { f = -move2.y; s = move2.x; }   /* the joystick: how far it is pushed is how fast */
      if (P && P.dead) f = s = 0;
      const sp = keys.ShiftLeft || keys.ShiftRight || runOn ? RUN : WALK, len = Math.max(1, Math.hypot(f, s));
      const sin = Math.sin(me.yaw), cos = Math.cos(me.yaw);
      const dx = ((s * cos) - (f * sin)) / len * sp * dt, dz = ((-s * sin) - (f * cos)) / len * sp * dt;
      if (keys.Space && me.ground) { me.vy = JUMP; me.ground = false; }
      me.vy -= GRAVITY * dt;
      /* one axis at a time, so a wall stops the part of a step that goes into it and not the rest */
      let B;
      const x0 = me.x, z0 = me.z;
      me.x += dx; if ((B = hits(me.x, me.y, me.z)) && !stepUp(B)) me.x = dx > 0 ? B.min[0] - HALF - 1e-4 : B.max[0] + HALF + 1e-4;
      me.z += dz; if ((B = hits(me.x, me.y, me.z)) && !stepUp(B)) me.z = dz > 0 ? B.min[2] - HALF - 1e-4 : B.max[2] + HALF + 1e-4;
      realPush();
      me.vx = (me.x - x0) / dt; me.vz = (me.z - z0) / dt;   /* what was really walked (a wall stops it): sent to the others */
      const wasGround = me.ground;
      me.y += me.vy * dt; me.ground = false;
      if ((B = hits(me.x, me.y, me.z))) {
        if (me.vy <= 0) { me.y = B.max[1]; me.ground = true; } else me.y = B.min[1] - HEIGHT - 1e-4;
        me.vy = 0;
      }
      if (realW) {
        const g = realW.groundAt(me.x, me.z);
        if (me.y <= g || (wasGround && me.vy <= 0 && me.y - g < 0.45)) { me.y = g; me.vy = 0; me.ground = true; }   /* down a slope too, not in hops */
      }
      if (me.y < (realW ? -100 : -20)) { me.x = prev.x = SPAWN[0]; me.y = prev.y = SPAWN[1] + 1; me.z = prev.z = SPAWN[2]; me.vy = 0; log('You fell out of the world.'); }
    }
    function move(dt) {
      acc += Math.min(dt, 0.25);                     /* after a long stall (a hidden tab) do not run seconds of physics at once */
      while (acc >= STEP) { prev.x = me.x; prev.y = me.y; prev.z = me.z; physics(STEP); acc -= STEP; }
      const k = acc / STEP;
      camera.position.set(prev.x + (me.x - prev.x) * k, prev.y + (me.y - prev.y) * k + EYE, prev.z + (me.z - prev.z) * k);
      camera.rotation.set(me.pitch, me.yaw, 0);
    }

    /* --- using things ---------------------------------------------------------------------------------- */
    const ray = new THREE.Raycaster(); ray.far = 2.8;
    const center = new THREE.Vector2(0, 0);
    function aimed() {
      ray.setFromCamera(center, camera);
      const vis = usable.filter(m => m.visible);
      const hit = ray.intersectObjects(vis, false)[0];
      return hit ? hit.object.userData : null;
    }
    function promptFor(u) {
      if (!u) return '';
      if (u.kind === 'door') {
        const d = doors[u.id].def, word = d.label.toLowerCase();
        if (d.opens === 'hand') return 'E: ' + (W.open[u.id] ? 'close' : 'open') + ' the ' + word;
        if (W.open[u.id]) return '';
        return d.opens === 'key' ? (hasItem(d.key) ? 'E: unlock the ' + word : d.label + ': it needs a key') : d.label + ': opened somewhere else';
      }
      if (u.kind === 'npc') return 'E: talk to ' + npcs[u.id].def.name;
      if (u.kind === 'forge') return 'E: work at the forge';
      if (u.kind === 'res') {
        const n = resources[u.id].def, name = RES_NAME[n.kind], g = rpg && rpg.GATHER[n.kind];
        if (W.dep[u.id]) return 'The ' + name + (n.kind === 'herb' ? ' are' : ' is') + ' spent; it grows back';
        const lv = g && mine ? mine.prof[g.prof] || 0 : 0;
        return 'E: ' + (g ? g.verb : 'gather') + ' the ' + name + (g ? ' (' + rpg.PROFS[g.prof].name + ' ' + lv.toFixed(1) + ')' : '');
      }
      if (u.kind === 'switch') return 'E: pull the ' + switches[u.id].def.label.toLowerCase();
      if (u.kind === 'pickup') return 'E: take the ' + pickups[u.id].def.label.toLowerCase();
      if (u.kind === 'shrine') return paying ? 'The wallet is asking you…' : 'E: ' + (shrines[u.id].def.action || 'make an offering') + ' (1 coin, to yourself)';
      return '';
    }
    function useAim(force) {
      if (!playing() && !force) return;
      const u = aimed(); if (!u) return;
      if (u.kind === 'shrine') { offer(shrines[u.id].def); return; }
      if (u.kind === 'npc') { speak(u.id); return; }
      if (u.kind === 'res') { gather(u.id); return; }
      if (u.kind === 'forge') { if (menu) { try { document.exitPointerLock(); } catch (e) { /* not locked */ } menu.open('craft'); } return; }
      if (u.kind === 'door') {
        const d = doors[u.id].def;
        if (d.opens === 'switch' || (d.opens === 'key' && W.open[u.id])) return;
        if (d.opens === 'key' && !hasItem(d.key)) { log('It is locked. Somewhere there is a key.'); return; }
      }
      intent(u.kind === 'pickup' ? 'take' : 'use', u.id);
    }
    const hasItem = id => W.taken[id] != null && W.taken[id] === myId();

    /* --- fighting, and what a player is (rpg module) --------------------------------------------------------- */
    /* THE HOUSE KEEPS EVERY PLAYER (tbuuol 2026-10-23): skills, attributes, the bag and what is worn are in the house's
       book, by wallet address; it rolls every blow (the weapon's range, strength and job level, less the target's
       defence), teaches skills, drops loot into the bag and sends each player its own record. Without the house a
       player fights with bare fists and nothing is kept. */
    const rpg = D.rpg || null;
    let P = combat ? combat.player(null) : null;   /* hit points now, how fast and how far a blow reaches */
    let rec = null;                                /* my record, as the house last sent it */
    let mine = rpg ? rpg.stats(rpg.fresh('')) : null;
    const book = rpg ? rpg.book() : null;          /* the house's book (only the house writes in it) */
    const raiderDef = (LV.defense && LV.defense.raider && LV.defense.raider.def) || 0;
    const raiderLvl = (LV.defense && LV.defense.raider && LV.defense.raider.level) || 2;   /* how hard a raider is: what fighting one teaches */
    let atkReady = 0, swingT = 0, lastHurt = 0;
    let blowNo = Math.floor(Math.random() * 1e9);   /* numbered from a random start: a reload is not mistaken for a repeat */
    const blowsSeen = new Map();                    /* the host: player id -> the numbers of their latest blows */
    function freshBlow(who, n) {
      if (n == null) return true;
      const seen = blowsSeen.get(who) || [];
      if (seen.includes(n)) return false;
      seen.push(n); if (seen.length > 30) seen.shift();
      blowsSeen.set(who, seen);
      return true;
    }
    /* THE HANDS YOU SEE: bare fists, or what is in them (tbuuol: "default we hit with fists; a new weapon should be seen") */
    const hands = new THREE.Group(), right = new THREE.Group(), left = new THREE.Group();
    hands.add(right, left); hands.userData.keep = true;
    let handsKey = '';
    const M = c => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.75 }, c));
    function heldModel(model, look) {
      const g = new THREE.Group(), add = (geo, m, x, y, z) => { const p = new THREE.Mesh(geo, m); p.position.set(x || 0, y || 0, z || 0); g.add(p); return p; };
      const steel = M({ color: look || '#cfd5dd', metalness: 0.85, roughness: 0.3 }), wood = M({ color: '#6b4a2e' }), brass = M({ color: '#b8893a', metalness: 0.7, roughness: 0.4 });
      if (model === 'fist') { add(new THREE.BoxGeometry(0.08, 0.08, 0.1), M({ color: '#d9a882' })); add(new THREE.BoxGeometry(0.075, 0.075, 0.2), M({ color: '#5a3f2a' }), 0, -0.01, 0.15); }
      else if (model === 'sword') { add(new THREE.BoxGeometry(0.045, 0.6, 0.012), steel, 0, 0.38); add(new THREE.ConeGeometry(0.032, 0.08, 4), steel, 0, 0.72);
        add(new THREE.BoxGeometry(0.2, 0.035, 0.045), brass, 0, 0.07); add(new THREE.CylinderGeometry(0.02, 0.022, 0.15, 8), wood, 0, -0.02); }
      else if (model === 'axe') { add(new THREE.CylinderGeometry(0.022, 0.025, 0.62, 8), wood, 0, 0.2); add(new THREE.BoxGeometry(0.16, 0.14, 0.02), steel, 0.07, 0.44); }
      else if (model === 'mace') { add(new THREE.CylinderGeometry(0.022, 0.025, 0.5, 8), wood, 0, 0.15); add(new THREE.SphereGeometry(0.07, 10, 8), M({ color: '#5a5a5a', metalness: 0.6 }), 0, 0.42); }
      else if (model === 'shield') { const sh = add(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 16), M({ color: look || '#8a6238' })); sh.rotation.x = Math.PI / 2; add(new THREE.SphereGeometry(0.05, 8, 6), brass, 0, 0, 0.03); }
      return g;
    }
    function dressHands() {
      if (!fight) return;
      const main = rec && rec.eq.main && rpg.itemOf(rec, rec.eq.main), off = rec && rec.eq.off && rpg.itemOf(rec, rec.eq.off);
      const key = (main ? main.id : 'fist') + '|' + (off ? off.id : main ? '' : 'fist');
      if (key === handsKey) return;
      handsKey = key;
      right.clear(); left.clear();
      right.add(heldModel(main ? main.model : 'fist', main && main.look));
      if (off) left.add(heldModel(off.model, off.look)); else if (!main) left.add(heldModel('fist'));
      if (main) right.children[0].rotation.set(-0.35, 0.25, -0.3);
      if (off && off.model === 'shield') left.children[0].rotation.set(0.1, 0.5, 0);
    }
    if (fight) { dressHands(); camera.add(hands); scene.add(camera); }
    function myRecord(r) {
      rec = r; mine = rpg.stats(r);
      P.max = mine.hp; P.hp = Math.min(P.hp, P.max);
      dressHands(); drawStats();
      if (menu) menu.update(rec, mine);
    }
    /* the host's view of a blow: by the house from the striker's record; a player who keeps the world (no house)
       hits with fists, and nothing is learnt */
    /* whose record: a message over the direct link names only the player's id, so the address is the room's (the
       arcade node stamps it there, so it is the true one) */
    const addrOf = from => (from && from.address) || (from && remotes.get(from.id) && remotes.get(from.id).from.address) || null;
    function blowFor(from, unit) {
      const a = addrOf(from);
      if (iAmHouse && book && a) {
        const res = book.strike(a, raiderDef, raiderLvl);
        dirty.add(a);
        for (const u of res.up) notice(from.id, u + '!');
        if (res.miss && room) room.tell({ M: [from.id, unit] });   /* the striker sees "miss" over the raider */
        return res.d;
      }
      return Math.max(1, 2 + Math.floor(Math.random() * 3) - raiderDef);
    }
    function attack() {
      if (!fight || !P || P.dead || !playing() || (menu && menu.isOpen())) return;
      const now = performance.now();
      if (now < atkReady) return;
      atkReady = now + P.cd * 1000; swingT = 1;
      const id = fight.pick(me.x, me.z, me.yaw, P.range);
      if (sound) sound.blip(id ? 'hit' : 'swing');
      if (!id) return;
      if (amHost()) { route(fight.damage(id, blowFor(room ? room.me : null, id), myId())); return; }
      /* a blow for the house: over the direct link when there is one, and through the room as well; the house counts
         each once by its number, rolls it, and the number shows when it answers (a spark at once, here) */
      const msg = { X: id, n: ++blowNo };
      if (room.fast && room.peers()[hostId()] === 'direct') room.state(msg);
      room.tell(msg);
      fight.predict(id, 0);
    }
    /* GATHERING: E on an oak, a boulder or herbs. The house decides: near enough, not spent; it rolls what it gives
       (better with the skill), teaches the skill, and after so many a thing is spent for everyone until it grows back */
    let gatherReady = 0;
    function gather(id) {
      const now = performance.now();
      if (now < gatherReady || !fight || (P && P.dead)) return;
      gatherReady = now + 1200; swingT = 1;
      if (sound) sound.blip('swing');
      if (W.dep[id]) return;
      if (!room || !houseId() || iAmHouse) { log('Gathering needs the house: it keeps what you carry.'); return; }
      const msg = { G: id, n: ++blowNo };
      if (room.fast && room.peers()[hostId()] === 'direct') room.state(msg);
      room.tell(msg);
    }
    const charges = {}, growAt = {};
    function houseGather(from, id) {
      const res = resources[id], a = addrOf(from), r = remotes.get(from.id);
      if (!res || !a || W.dep[id]) return;
      if (r && Math.hypot(r.g.position.x - res.def.pos[0], r.g.position.z - res.def.pos[1]) > 4.5) return;   /* from afar: no */
      const kind = res.def.kind, conf = LV.resources || {};
      if (charges[id] == null) charges[id] = (conf.charges && conf.charges[kind]) || 3;
      const out = book.gather(a, kind);
      dirty.add(a);
      notice(from.id, out.got.length ? 'Into your bag: ' + out.got.join(', ') + '.' : 'Nothing this time.');
      for (const u of out.up) notice(from.id, u + '!');
      if (--charges[id] > 0) return;
      const N = { seq: W.seq + 1, open: Object.assign({}, W.open), taken: Object.assign({}, W.taken), dep: Object.assign({}, W.dep) };
      N.dep[id] = 1; applyWorld(N); sendWorld();
      growAt[id] = performance.now() + (conf.respawn || 90) * 1000; delete charges[id];
    }
    function growBack(now) {
      /* a spent one with no time to grow back (the house took the world over, or started again): it gets one */
      for (const id in W.dep) if (W.dep[id] && growAt[id] == null) growAt[id] = now + ((LV.resources && LV.resources.respawn) || 90) * 1000;
      const due = Object.keys(growAt).filter(id => now >= growAt[id]);
      if (!due.length) return;
      const N = { seq: W.seq + 1, open: Object.assign({}, W.open), taken: Object.assign({}, W.taken), dep: Object.assign({}, W.dep) };
      for (const id of due) { delete N.dep[id]; delete growAt[id]; }
      applyWorld(N); sendWorld();
    }
    /* what the host's fight says about players: blows and blessings, and who made a kill */
    function route(events) {
      for (const e of events) {
        if (e.t === 'hit' || e.t === 'heal') {
          let d = e.t === 'hit' ? e.d : -e.d;
          if (e.t === 'hit' && iAmHouse && book) {   /* dodged (the evader profession), or less the player's defence */
            const r = remotes.get(e.to);
            if (r && r.from.address) {
              const res = book.struck(r.from.address, d, raiderLvl);
              dirty.add(r.from.address);
              for (const u of res.up) notice(e.to, u + '!');
              if (res.dodged) { notice(e.to, 'You dodge the blow.'); continue; }
              d = res.d;
            }
          }
          if (e.to === myId()) hurt(d, e.from);
          else if (room) room.tell({ D: e.to, d });
        } else if (e.t === 'kill') {
          let text = 'You defeated a ' + String(e.name || 'raider').toLowerCase() + '.';
          const r = remotes.get(e.by);
          if (iAmHouse && book && r && r.from.address) {
            const got = book.loot(r.from.address);
            if (got.length) text += ' Into your bag: ' + got.join(', ') + '.';
            dirty.add(r.from.address);
          }
          notice(e.by, text);
        }
      }
    }
    function notice(to, text) { if (to === myId()) log(text); else if (room) room.tell({ N: [to, text] }); }
    /* the house sends each player its record when it changed (at most every 1.5 s), whole over the direct link,
       in pieces through the room */
    const dirty = new Set();
    let lastRecords = 0;
    function sendRecords(now) {
      if (!iAmHouse || !room || !book || !dirty.size || now - lastRecords < 1500) return;
      lastRecords = now;
      for (const a of dirty) for (const [id, r] of remotes) if (r.from.address === a) sendBig({ R: book.of(a), to: id }, id);
      dirty.clear();
    }
    function sendBig(obj, to) {
      if (room.fast && room.peers()[to] === 'direct') room.state(obj);
      const s = JSON.stringify(obj);
      if (s.length <= 470) { room.tell(obj); return; }
      const id = Math.floor(Math.random() * 1e9).toString(36), parts = [];
      let at = 0;
      while (at < s.length) {   /* as much as fits one room message, quotes escaped */
        let n = Math.min(400, s.length - at);
        while (n > 20 && JSON.stringify({ Z: [id, 0, 0, s.slice(at, at + n)] }).length > 470) n -= 20;
        parts.push(s.slice(at, at + n)); at += n;
      }
      parts.forEach((c, i) => room.tell({ Z: [id, i, parts.length, c] }));
    }
    const bigIn = new Map();
    function bigPiece(from, z) {
      if (!Array.isArray(z) || z.length < 4) return null;
      const key = from.id + ':' + z[0], got = bigIn.get(key) || { n: +z[2], parts: [], at: performance.now() };
      got.parts[+z[1]] = String(z[3]); bigIn.set(key, got);
      for (const [k, v] of bigIn) if (performance.now() - v.at > 30000) bigIn.delete(k);
      if (got.parts.filter(x => x != null).length < got.n) return null;
      bigIn.delete(key);
      try { return JSON.parse(got.parts.join('')); } catch (e) { return null; }
    }
    function hurt(d, from) {
      if (!P || P.dead || !d) return;
      P.hp = Math.max(0, Math.min(P.max, P.hp - d));
      if (d > 0) {
        lastHurt = performance.now();
        const fl = $('.lwq-hurt'); fl.style.transition = 'none'; fl.style.opacity = '0.9';
        requestAnimationFrame(() => { fl.style.transition = 'opacity .6s'; fl.style.opacity = '0'; });
      }
      if (P.hp <= 0) {
        P.dead = true;
        log((from ? 'A ' + String(from).toLowerCase() + ' strikes you down.' : 'You fall.') + ' Brother Anselm carries you back inside.');
        setTimeout(() => {
          P.dead = false; P.hp = P.max;
          me.x = prev.x = SPAWN[0]; me.y = prev.y = SPAWN[1]; me.z = prev.z = SPAWN[2]; me.vy = 0; me.yaw = LV.spawnYaw || 0;
          drawStats();
        }, 3000);
      }
      drawStats();
    }
    let statsKey = '';
    function drawStats() {
      if (!P || !fight) return;
      /* the weapon and its hit profession; the thin bar is the way to that profession's next level */
      const hp = Math.ceil(P.hp), prof = mine && rpg.PROFS[mine.hitProf], lvl = mine ? mine.prof[mine.hitProf] || 0 : 0;
      const key = [hp, P.max, P.dead, mine && mine.weapon, lvl.toFixed(2)].join();
      if (key === statsKey) return;
      statsKey = key;
      $('.lwq-lv').textContent = (mine ? mine.weapon : 'Fists') + (prof ? ' · ' + prof.name.replace(' (hit)', '') + ' ' + lvl.toFixed(1) : '') + (P.dead ? ' · down' : '');
      $('.lwq-hp i').style.width = (100 * hp / P.max) + '%'; $('.lwq-hp span').textContent = hp + ' / ' + P.max;
      $('.lwq-xp i').style.width = (100 * (lvl % 1)) + '%';
    }

    /* --- network ------------------------------------------------------------------------------------- */
    let room = null, joinedAt = Date.now(), electReadyAt = 0;
    const remotes = new Map();   /* id -> {from, j, name, buf: [{t, x, y, z, yaw}], heard, g (THREE.Group)} */
    /* who I am in the world: 'solo' until a room gives me an id, and that id from then on, also after the room has
       closed, so what I took stays mine (a key taken in the first seconds, or before a disconnect, is not lost) */
    let selfId = 'solo';
    const myId = () => selfId;
    function becomeId(id) {
      if (!id || id === selfId) return;
      const was = selfId; selfId = id;
      for (const pid in W.taken) if (W.taken[pid] === was) W.taken[pid] = id;
      drawInv();
    }
    /* THE HOUSE (tbuuol 2026-10-23: "a dedicated server"): the game's own account, kept in the room by a machine, keeps
       the world whenever it is there. Its addresses come from the registry (inscribed by a publisher the page trusts),
       and an address in a room is stamped by the arcade node, so nobody can pass for it. Without it, the first
       player keeps the world as before. The house plays nobody: it draws nothing, is not drawn and is not counted. */
    const HOUSE = (() => { try { const r = G.LWQ.get('$registry'); return Array.isArray(r && r.house) ? r.house.map(String) : []; } catch (e) { return []; } })();
    const isHouse = p => !!(p && p.address && HOUSE.includes(p.address));
    let iAmHouse = false;
    function houseId() {
      if (iAmHouse) return myId();
      for (const [id, r] of remotes) if (isHouse(r.from)) return id;
      return null;
    }
    function hostId() {
      if (!room) return myId();
      const h = houseId();
      if (h) return h;
      let best = { id: myId(), j: joinedAt };
      for (const [id, r] of remotes) {
        if (r.j == null) continue;
        if (r.j < best.j || (r.j === best.j && id < best.id)) best = { id, j: r.j };
      }
      return best.id;
    }
    /* alone in the room you keep the world at once; with others, listen 1.5 s first to learn who came before you
       (an intent sent in those first moments used to go to a host that did not exist yet, and was lost). With the
       house there, it decides at once, and nobody else does. */
    const amHost = () => {
      if (iAmHouse || !room) return true;
      if (houseId()) return false;
      return remotes.size === 0 || (Date.now() >= electReadyAt && hostId() === myId());
    };

    function intent(op, id) {
      if (amHost()) { hostApply(op, id, myId()); return; }
      room.tell({ I: op, o: id });
    }
    function hostApply(op, id, by) {
      const N = { seq: W.seq + 1, open: Object.assign({}, W.open), taken: Object.assign({}, W.taken), dep: Object.assign({}, W.dep) };
      let changed = false;
      if (op === 'use' && switches[id]) {
        for (const t of switches[id].def.targets || []) { N.open[t] = !N.open[t]; changed = true; }
      } else if (op === 'use' && doors[id]) {
        const d = doors[id].def;
        if (d.opens === 'hand') { N.open[id] = !N.open[id]; changed = true; }
        else if (d.opens === 'key' && !N.open[id] && N.taken[d.key] === by) { N.open[id] = true; changed = true; }
      } else if (op === 'take' && pickups[id] && N.taken[id] == null) {
        N.taken[id] = by; changed = true;
      }
      if (!changed) return;
      applyWorld(N);
      sendWorld();
    }
    let lastWorldSent = 0;
    /* the world on the wire: only open doors and taken things (the rest is closed / free), so it stays well inside a
       room message; j says when the host joined, so a newcomer knows whom to believe before it has seen them move */
    function sendWorld() {
      if (!room) return;
      const open = {}, taken = {};
      for (const id in W.open) if (W.open[id]) open[id] = true;
      for (const id in W.taken) if (W.taken[id] != null) taken[id] = W.taken[id];
      const dep = {}; for (const id in W.dep) if (W.dep[id]) dep[id] = 1;
      room.tell({ W: { seq: W.seq, open, taken, dep }, j: joinedAt }).then(ok => { if (!ok) console.warn('LWQ: the world is too big for one room message'); });
      lastWorldSent = performance.now();
    }
    /* the world as the host says it is: what changed is said in the log, each change once */
    function applyWorld(next) {
      const before = W;
      W = { seq: +next.seq || 0, open: Object.assign({}, next.open), taken: Object.assign({}, next.taken), dep: Object.assign({}, next.dep) };
      for (const id in resources) resources[id].look.set(!!W.dep[id]);
      for (const pid in pickups) {
        const now = W.taken[pid] == null ? null : W.taken[pid], was = before.taken[pid] == null ? null : before.taken[pid];
        pickups[pid].mesh.visible = pickups[pid].hit.visible = now == null;
        if (now != null && was == null) {
          if (now === myId()) gotItem(pickups[pid].def);
          else log(nameOf(now) + ' took the ' + pickups[pid].def.label.toLowerCase() + '.');
        }
      }
      for (const did in doors) {
        const word = doors[did].def.label.toLowerCase();
        if (doors[did].def.opens === 'hand') {   /* everyday doors open and close without a word, with a creak if near */
          if (sound && W.open[did] !== !!before.open[did] && doors[did].mesh) { const p = doors[did].mesh.getWorldPosition(new THREE.Vector3()); if (Math.hypot(p.x - me.x, p.z - me.z) < 14) sound.blip('door'); }
          continue;
        }
        if (W.open[did] && !before.open[did]) log('The ' + word + ' opens.');
        if (!W.open[did] && before.open[did]) log('The ' + word + ' closes.');
      }
      drawInv();
    }
    function nameOf(id) {
      if (id === myId()) return 'You';
      const r = remotes.get(id);
      return r ? label(r.from, r.name) : 'Someone';
    }
    const label = (from, name) => from && from.tag ? '@' + from.tag : (name || '@guest');

    function makeAvatar(id) {
      const h = hue(id);
      return art.character(ctx, { shirt: 'hsl(' + h + ',55%,45%)', pants: 'hsl(' + ((h + 200) % 360) + ',25%,28%)',
                                  hair: ['#2a1a10', '#6b3e1e', '#c9a04a', '#1c1c1c', '#8a4a1e'][h % 5] });
    }
    /* what another player holds, from the item ids they send now and then (nothing worn: fists, so nothing shown) */
    function armAvatar(r, w) {
      const key = w.slice(0, 2).map(String).join('|');
      if (key === r.w) return;
      r.w = key;
      const [main, off] = w.slice(0, 2).map(id => rpg.ITEMS[id] && !rpg.ITEMS[id].material ? rpg.ITEMS[id] : null);
      r.c.holdItem(main && main.model ? heldModel(main.model, main.look) : null, off && off.model ? heldModel(off.model, off.look) : null);
    }
    function remote(from) {
      let r = remotes.get(from.id);
      if (!r) {
        r = { from, j: null, name: '', buf: [], heard: performance.now(), c: makeAvatar(from.id) };
        r.g = r.c.group;
        r.c.setName(label(from, ''));
        r.g.visible = false;
        r.house = isHouse(from);   /* the house plays nobody: never drawn, never a target */
        remotes.set(from.id, r);
        drawNet();
      }
      return r;
    }
    function dropRemote(id) {
      const r = remotes.get(id); if (!r) return;
      scene.remove(r.g); remotes.delete(id);
      log(r.house ? 'The house has gone; a player keeps the world now.' : label(r.from, r.name) + ' left.');
      drawNet();
    }
    function heard({ from, data }) {
      const d = data && typeof data === 'object' ? data : {};
      if (Array.isArray(d.Z)) { const whole = bigPiece(from, d.Z); if (whole) heard({ from, data: whole }); return; }   /* a big one, in pieces */
      const r = remote(from); r.heard = performance.now();
      if (from.address && !r.from.address) r.from = from;   /* the room names the address; the direct link does not */
      /* when they joined is taken once and never changed: nobody becomes host later by claiming an earlier time */
      if (d.j != null && r.j == null && isFinite(+d.j)) r.j = +d.j;
      if (Array.isArray(d.p)) {
        if (d.n && d.n !== r.name) { r.name = String(d.n).slice(0, 24); r.c.setName(label(from, r.name)); }
        /* SMOOTH OTHERS: a sample is placed by when it was SENT (d.s, the sender's clock), not when it arrived, so
           uneven delivery does not make the avatar stutter. The sender's clock is mapped onto ours by the smallest
           arrival - sent seen (that is its offset plus the fastest trip); the scatter above that is the jitter. */
        const now = performance.now();
        let t = now;
        if (d.s != null) {
          const o = now - +d.s;
          if (r.off == null || o < r.off) r.off = o; else r.off += (o - r.off) * 0.002;   /* follows a drifting clock slowly */
          r.jit = r.jit == null ? 0 : r.jit + (Math.abs(o - r.off) - r.jit) * 0.1;
          t = +d.s + r.off;
        }
        const last = r.buf[r.buf.length - 1];
        if (last && t <= last.t) return finishHeard(d, from, r);
        if (last) { const gapMs = Math.min(1500, t - last.t); r.int = r.int == null ? gapMs : r.int + (gapMs - r.int) * 0.15; }                          /* old or doubled: the newer one is here */
        r.buf.push({ t, x: +d.p[0], y: +d.p[1], z: +d.p[2], yaw: Array.isArray(d.r) ? +d.r[0] : 0,
                     vx: Array.isArray(d.v) ? +d.v[0] || 0 : 0, vz: Array.isArray(d.v) ? +d.v[1] || 0 : 0 });
        while (r.buf.length > 40) r.buf.shift();
        r.g.visible = true;
      }
      finishHeard(d, from, r);
    }
    function finishHeard(d, from, r) {
      if (d.I && amHost()) hostApply(String(d.I), String(d.o || ''), from.id);
      /* the world only from the one who keeps it: during a handover, or from a client that lies, another's is ignored */
      /* the house, just arrived, takes the world over from whoever kept it so far (a few seconds to hear it) */
      const takingOver = iAmHouse && Date.now() < electReadyAt + 3000;
      if (d.W && typeof d.W === 'object' && (from.id === hostId() || takingOver) && +d.W.seq > W.seq) applyWorld(d.W);
      if (d.H && amHost()) sendWorld();
      /* the fight: the host's picture of it, a player's blow for the host, and what the host says happened to me */
      if (fight) {
        const fromHost = from.id === hostId();
        if (d.C && ((fromHost && !amHost()) || takingOver)) fight.apply(d.C);
        if (d.X != null && amHost() && freshBlow(from.id, d.n)) route(fight.damage(String(d.X), blowFor(from, String(d.X)), from.id));
        if (d.D != null && String(d.D) === myId() && fromHost) hurt(+d.d || 0, 'raider');
        if (Array.isArray(d.M) && String(d.M[0]) === myId() && fromHost) fight.missed(String(d.M[1]));
      }
      /* what is mine: a notice and my record from the house; and, at the house, what a player asks of it */
      if (Array.isArray(d.N) && String(d.N[0]) === myId() && from.id === hostId()) { log(String(d.N[1])); if (/bag|level/.test(d.N[1]) && sound) sound.blip('pickup'); }
      if (d.R && typeof d.R === 'object' && String(d.to) === myId() && from.id === hostId() && rpg) myRecord(d.R);
      if (d.G != null && iAmHouse && book && freshBlow(from.id, d.n)) houseGather(from, String(d.G));
      if (d.Q && iAmHouse && book && addrOf(from)) {
        const a = addrOf(from);
        if (d.Q === 'equip') { const res = book.equip(a, +d.u); if (!res.ok) notice(from.id, 'Cannot wear that: ' + res.why + '.'); }
        else if (d.Q === 'unequip') book.unequip(a, String(d.s));
        else if (d.Q === 'craft') {
          const r = remotes.get(from.id);
          if (r && !nearForge(r.g.position.x, r.g.position.z)) notice(from.id, 'You are not at the forge.');
          else {
            const res = book.craft(a, String(d.r));
            if (!res.ok) notice(from.id, 'Cannot make that: ' + res.why + '.');
            else {
              notice(from.id, 'You made: ' + res.made + '. It is in your bag.');
              if (res.learnt) notice(from.id, 'While you worked, you worked out a new recipe: ' + res.learnt + '!');
              for (const u of res.up) notice(from.id, u + '!');
            }
          }
        }
        dirty.add(a); lastRecords = 0;
      }
      if (Array.isArray(d.w) && rpg && !r.house) armAvatar(r, d.w);
      if (Array.isArray(d.h)) r.hp = [+d.h[0] || 0, +d.h[1] || 100, !!d.h[2]];
      if (d.S === 'offered') log(label(from, r.name) + ' made an offering at the shrine.');
      /* no drawNet() here: positions come 15 times a second from each player, and rewriting the HUD that often
         was one of the stutters. The HUD is redrawn when somebody comes or goes, and once a second. */
    }
    async function connect() {
      log('Looking for other players…');
      const res = await net.join(ROOM, { game: GAME, fast: true });
      if (stopped) { if (res.online) res.room.leave(); return; }
      if (!res.online) { log('Playing alone (' + (res.why || 'offline') + ').'); drawNet(); return; }
      room = res.room; joinedAt = Date.now(); electReadyAt = Date.now() + 1500;   /* just joined: listen before deciding who keeps the world */
      becomeId(room.me.id);
      iAmHouse = isHouse(room.me);
      if (iAmHouse) {   /* the machine that keeps the world: it runs the world and the fight, and draws nothing */
        drawing = false; renderer.setPixelRatio(0.25);
        log('This is the house: it keeps the world.');
      }
      room.on('message', heard);
      room.on('join', ({ from }) => {
        const wasHost = amHost();
        remote(from);
        if (isHouse(from)) {   /* hand the world and the fight over to the house, which decides from now on */
          log('The house keeps this world now.');
          if (wasHost && !iAmHouse) { sendWorld(); if (fight) room.send({ C: fight.snapshot() }); }
        } else {
          log(label(from, '') + ' joined.');
          if (amHost()) setTimeout(() => amHost() && sendWorld(), 500);
        }
        drawNet();
      });
      room.on('leave', ({ from }) => dropRemote(from.id));
      room.on('peer', () => drawNet());
      room.on('closed', why => { log('Disconnected: ' + (why || 'the room closed') + '. Playing alone.'); for (const id of Array.from(remotes.keys())) dropRemote(id); room = null; drawNet(); });
      room.on('reconnecting', () => { log('Connection lost, reconnecting…'); drawNet(); });
      room.on('rejoined', ({ me: m }) => { if (m) becomeId(m.id); log('Back online.'); room.tell({ H: 1 }); sendState(true); drawNet(); });
      for (const p of room.members()) if (p.id !== room.me.id) remote(p);
      if (room.me.tag) me.name = '@' + room.me.tag;
      room.tell({ H: 1 });
      log(room.fast ? 'Online (fast lane).' : 'Online (through the room).');
      drawNet();
    }
    let lastState = 0, lastKey = '', lastName = 0, lastBeat = 0, handsSent = '';
    function sendState(force) {
      if (!room || iAmHouse) return;
      const now = performance.now(), every = room.fast ? 66 : 250;
      if (!force && now - lastState < every) return;
      const key = [R2(me.x), R2(me.y), R2(me.z), R2(me.yaw), R2(me.pitch)].join(',');
      if (!force && key === lastKey && now - lastState < 1000) return;   /* standing still: a heartbeat is enough */
      /* on an even beat: the next send is due one interval after this one was, not after this frame happened to come */
      lastState = force || now - lastState > every * 2 ? now : lastState + every; lastKey = key;
      const m = { s: Math.round(now), p: [R2(me.x), R2(me.y), R2(me.z)], r: [R2(me.yaw), R2(me.pitch)], j: joinedAt };
      if (Math.abs(me.vx || 0) + Math.abs(me.vz || 0) > 0.01) m.v = [R2(me.vx), R2(me.vz)];   /* left out standing still */
      if (now - lastName > 2000 || handsKey !== handsSent) {   /* a change of weapon goes out with the next step */
        lastName = now; handsSent = handsKey; if (me.name) m.n = me.name;
        if (rec) m.w = ['main', 'off'].map(sl => { const it = rec.eq[sl] && rpg.itemOf(rec, rec.eq[sl]); return it ? it.id : ''; });   /* what you hold, for your avatar */
      }
      if (P && fight) m.h = [Math.ceil(P.hp), P.max, P.dead ? 1 : 0];   /* the host's priest needs to know who is hurt */
      room.state(m);
      /* once a second the same through the room: whatever the fast lane is doing, everyone keeps seeing you */
      if (room.fast) {
        const st = Object.values(room.peers()), waiting = st.some(x => x !== 'direct');   /* 'connecting' carries nothing yet */
        if (force || now - lastBeat > (waiting ? 330 : 1000)) { lastBeat = now; room.beat(m); }
      }
    }
    let remotesT = performance.now();
    function drawRemotes() {
      const now = performance.now(), dt = Math.min(0.1, (now - remotesT) / 1000); remotesT = now;
      for (const [id, r] of Array.from(remotes)) {
        /* silence is not leaving: a player who has gone quiet is hidden after 15 s and kept; only the room's 'leave'
           (or a minute without a word and no longer a member) takes them away */
        if (now - r.heard > 15000) {
          r.g.visible = false;
          if (now - r.heard > 60000 && room && !room.members().some(m => m.id === id)) dropRemote(id);
          continue;
        }
        const b = r.buf; if (!b.length) continue;
        /* how far behind to draw: one send interval plus room for the jitter actually measured, eased so it never jumps */
        /* SMOOTH FROM THE FIRST SECOND (tbuuol 2026-10-21: bad stutter at the start): how far behind to draw is what this
           player's samples really need -- the time between them as measured, plus room for jitter -- so while the
           direct link is still being set up (a sample a second, or three) they glide a little late instead of
           jumping. It grows at once when the samples thin out and shrinks slowly when they come fast again. */
        const want = Math.max(60, Math.min(1600, (r.int || 250) * 1.3 + 2.5 * (r.jit || 0)));
        r.delay = r.delay == null || want > r.delay * 1.4 ? want : r.delay + (want - r.delay) * 0.02;
        const t = now - r.delay;
        let x, y, z, yaw;
        if (b.length === 1 || t <= b[0].t) ({ x, y, z, yaw } = b[0]);
        if (b.length > 1 && t > b[0].t) {
          let i = 1; while (i < b.length - 1 && b[i].t < t) i++;
          const A = b[i - 1], B = b[i];
          if (t <= B.t) {
            const k = (t - A.t) / Math.max(1, B.t - A.t);
            x = A.x + (B.x - A.x) * k; y = A.y + (B.y - A.y) * k; z = A.z + (B.z - A.z) * k; yaw = angLerp(A.yaw, B.yaw, k);
          } else {
            /* the next sample is late: carry on at the speed they SAID they had, for as long as their samples usually
               take (half an interval more, at most 600 ms), then wait for it. Standing still they said none, so a
               player who stops is not carried past where they stopped. */
            const ahead = Math.min(Math.min(600, (r.int || 100) * 0.5 + 100), t - B.t) / 1000;
            x = B.x + B.vx * ahead; y = B.y; z = B.z + B.vz * ahead; yaw = B.yaw;
          }
          while (b.length > 2 && b[1].t < t - 1000) b.shift();
        }
        /* a last touch of smoothing on what is drawn, so a correction after a late packet glides instead of snapping */
        const g = r.g.position, far = Math.abs(g.x - x) + Math.abs(g.z - z) > 3, ox = g.x, oz = g.z;
        const follow = 1 - Math.exp(-dt * 14);   /* the same glide at any frame rate */
        if (far || !r.drawn) { g.set(x, y, z); r.drawn = true; } else { g.x += (x - g.x) * follow; g.y += (y - g.y) * follow; g.z += (z - g.z) * follow; }
        r.g.rotation.y = angLerp(r.g.rotation.y, yaw, far ? 1 : follow);
        /* legs and arms swing with how fast they are drawn moving (eased, so one late packet is not a stumble) */
        const sp = far || !dt ? 0 : Math.hypot(g.x - ox, g.z - oz) / dt;
        r.sp = (r.sp || 0) + (sp - (r.sp || 0)) * Math.min(1, dt * 8);
        r.c.animate(dt, r.sp > 0.3 ? r.sp : 0);
      }
    }

    /* --- the wallet ------------------------------------------------------------------------------------ */
    let who = { ok: false, why: 'asking…' }, store = null, progress = { crystals: 0, offerings: 0 }, paying = false;
    async function walletUp() {
      store = await wallet.store();
      progress = Object.assign(progress, store.get('progress', {}));
      who = await wallet.who();
      if (who.ok && who.tag && !me.name) me.name = '@' + who.tag;
      /* opened on an arcade where the player has no account signed in (tbuuol 2026-10-23, dogecoinarcade.com: "nobody
         signed in"): the arcade names no address, so the house can keep nothing -- say so instead of fists in silence */
      if (!who.ok && /signed in/.test(who.why || '')) {
        who.why = 'not signed in on this arcade';
        log('You are not signed in on this arcade, so you play as a guest: fists only, and nothing is kept. Sign in here (or open the game on the arcade where your account is) to keep your character.');
      }
      drawWho(); drawInv();
    }
    function drawWho() {
      const coin = who.ok ? who.coins.toLocaleString(undefined, { maximumFractionDigits: 4 }) + ' ' + (who.ticker || 'coins') : '';
      $('.lwq-tl').innerHTML = who.ok
        ? '<b>' + esc(who.tag ? '@' + who.tag : 'no @name yet') + '</b> · ' + esc(coin) + (who.mainnet ? ' · <b>MAINNET</b>' : ' · ' + esc(who.network || 'test'))
        : 'Wallet: ' + esc(who.why || 'not connected');
      $('.lwq-tl').innerHTML += '<br><small>' + (!who.ok ? 'playing as a guest: nothing is kept' : store && store.remembered ? 'progress is saved in your wallet' : 'progress is not saved (no wallet viewer)') + '</small>';
    }
    function gotItem(def) {
      if (sound) sound.blip('pickup');
      if (def.kind === 'crystal') {
        progress.crystals = (progress.crystals | 0) + 1;
        if (store) store.set('progress', progress);
        log('You found a crystal (' + progress.crystals + ' in all).');
      } else log('You picked up the ' + def.label.toLowerCase() + '.');
    }
    function drawInv() {
      const mine = Object.keys(pickups).filter(id => W.taken[id] === myId());
      const keysHeld = mine.filter(id => pickups[id].def.kind === 'key').map(id => pickups[id].def.label);
      const here = mine.filter(id => pickups[id].def.kind === 'crystal').length;
      const total = Object.keys(pickups).filter(id => pickups[id].def.kind === 'crystal').length;
      const parts = [];
      if (total) parts.push('Crystals ' + here + ' / ' + total + ' here · ' + (progress.crystals | 0) + ' in all');
      if (progress.offerings | 0) parts.push(progress.offerings + ' offering' + (progress.offerings === 1 ? '' : 's'));
      $('.lwq-inv').innerHTML = (keysHeld.length ? 'Key: ' + esc(keysHeld.join(', ')) + '<br>' : '') + parts.join(' · ');
    }
    function drawNet() {
      let n = iAmHouse ? 0 : 1;
      for (const r of remotes.values()) if (!r.house) n++;   /* the house is nobody */
      let mode = 'solo';
      if (room) {
        const peers = room.peers(), states = Object.values(peers);
        mode = !room.fast ? 'through the room' : !states.length ? 'fast lane' : states.every(s => s === 'direct') ? 'direct' : states.some(s => s === 'direct') ? 'direct + room' : 'through the room';
      }
      $('.lwq-tr').innerHTML = room ? 'Online · ' + n + ' player' + (n === 1 ? '' : 's') + ' · ' + esc(mode) +
        (iAmHouse ? '<br><small>the house: keeping this world</small>' : houseId() ? '<br><small>the house keeps this world</small>'
          : amHost() ? '<br><small>you keep this world in sync</small>' : '') : 'Solo';
      if (showFps) $('.lwq-tr').innerHTML += '<br><small>' + fps + ' fps' + Array.from(remotes.values()).map(r => ' · ' + esc(label(r.from, r.name)) +
        ' ' + Math.round(r.delay || 0) + ' ms behind').join('') + '</small>';
    }
    async function offer(def) {
      if (paying) return;
      if (!who.ok || !who.address) { log('The ' + (def.label || 'shrine').toLowerCase() + ' needs a wallet: ' + (who.why || 'none is connected') + '.'); return; }
      paying = true;
      try { document.exitPointerLock(); } catch (e) { /* the approval card needs the mouse */ }
      const sh = shrines[def.id]; sh.glow.material.color.set('#ffd700');
      log('The ' + (def.label || 'shrine').toLowerCase() + ' asks your wallet for ' + def.offer.amount + ' coin. Approve or refuse it there.');
      const res = await wallet.pay({ amount: def.offer.amount, to: who.address, label: 'LiteWorldsQuest', note: def.offer.note }, () => { });
      paying = false;
      if (res.status === 'sent') {
        progress.offerings = (progress.offerings | 0) + 1;
        if (store) store.set('progress', progress);
        sh.glow.material.color.set('#7CFC00'); if (sound) sound.blip('coin');
        log('Offering accepted' + (res.txid ? ' (tx ' + res.txid.slice(0, 10) + '…)' : '') + '.');
        if (room) room.tell({ S: 'offered' });
        who = await wallet.who(); drawWho();
      } else {
        sh.glow.material.color.set('#777');
        log(res.status === 'denied' ? 'You refused the offering.' : 'The offering did not go through: ' + (res.error || res.status) + '.');
      }
      drawInv();
    }

    /* --- the loop ------------------------------------------------------------------------------------ */
    let stepAcc = 0, drawing = true;
    /* RESOLUTION FOLLOWS THE FRAME RATE (tbuuol 2026-10-21: 22 fps): the picture is drawn at fewer pixels while the
       frames are slow, and at more again once they have been fast for a while; never above 1.5 per screen pixel */
    const maxPR = Math.min(1.5, G.devicePixelRatio || 1);
    let pr = Math.min(1.25, maxPR), fastFor = 0;
    renderer.setPixelRatio(pr);
    function adapt() {
      if (!document.hasFocus() || document.hidden) return;
      if (fps && fps < 50 && pr > 0.55) { pr = Math.max(0.55, pr - 0.15); fastFor = 0; renderer.setPixelRatio(pr); resize(); }
      else if (fps >= 58 && pr < maxPR) { if (++fastFor >= 6) { pr = Math.min(maxPR, pr + 0.1); fastFor = 0; renderer.setPixelRatio(pr); resize(); } }
      else fastFor = 0;
    }
    /* the fight each frame: the host runs it and says how it stands (5 a second over the fast lane, once a second
       through the room), everybody draws it; the sword swings; out of the fight, hit points come back slowly */
    let fightSent = 0, fightBeat = 0;
    function fightTick(dt, now) {
      const host = amHost(), players = [];
      if (host) {
        if (!iAmHouse) players.push({ id: myId(), x: me.x, z: me.z, hp: P.hp, max: P.max, dead: P.dead });
        for (const [id, r] of remotes) if (r.g.visible) players.push({ id, x: r.g.position.x, z: r.g.position.z, hp: r.hp ? r.hp[0] : 100, max: r.hp ? r.hp[1] : 100, dead: r.hp ? r.hp[2] : false });
      }
      /* the fight runs on real time in small steps: a house on a busy machine may get few frames, and one big step
         made raiders and guards jump (tbuuol 2026-10-23, as a client: "they stutter") */
      let rest = dt;
      do { const st = Math.min(rest, 0.1); route(fight.update(st, host, players)); rest -= st; } while (rest > 1e-6);
      if (host && room) {
        /* how the fight stands: 10 a second over the fast lane; through the room 3 a second from the house (it sends
           no position of its own, so the room's allowance is free), once a second from a player who keeps it */
        const snap = { C: fight.snapshot() };
        if (room.fast && now - fightSent > 100) { fightSent = now; room.state(snap); }
        /* through the room in pieces of a room message each, paced so that every piece fits the room's allowance */
        const parts = fight.pieces(snap.C, 470);
        if (now - fightBeat > (iAmHouse ? 330 : 1000) * parts.length) { fightBeat = now; for (const part of parts) room.send({ C: part }); }
      }
      if (!P.dead && P.hp < P.max && now - lastHurt > 6000) { P.hp = Math.min(P.max, P.hp + dt * 3); drawStats(); }
      swingT = Math.max(0, swingT - dt * 3.2);
      const k = Math.sin(swingT * Math.PI);   /* 0 -> 1 -> 0: up, across, back */
      const sx = 0.3 * Math.min(1, camera.aspect / 1.5);   /* a phone held upright: closer in, or it is off the picture */
      right.position.set(sx - k * 0.22, -0.32 + k * 0.08, -0.55);
      if (handsKey.startsWith('fist|')) right.position.set(sx - k * 0.12, -0.3 + k * 0.1, -0.5 - k * 0.3);   /* a punch goes forward */
      else right.rotation.set(-k * 1.3, k * 0.9, -k * 0.6);                                                        /* a weapon swings across */
      left.position.set(-sx, -0.32, -0.52);
      hands.visible = !P.dead;
      sendRecords(now);
    }
    let askedRec = -1e9;
    let last = performance.now(), worldT = 0, netT = 0, fps = 0, fpsN = 0, fpsT = performance.now(), showFps = false, promptNow = '';
    function frame(now) {
      if (stopped) return;
      const dt = Math.max(0, (now - last) / 1000); last = now;
      renderer.info.reset();
      move(dt);
      fpsN++; if (now - fpsT >= 500) { fps = Math.round(fpsN * 1000 / (now - fpsT)); fpsN = 0; fpsT = now; adapt(); if (showFps) drawNet(); }
      const ease = Math.min(1, Math.min(dt, 0.1) * 4);
      for (const id in doors) {
        const D2 = doors[id];
        if (D2.pivots) for (const pv of D2.pivots) pv.p.rotation.y += ((W.open[id] ? pv.swing : 0) - pv.p.rotation.y) * ease;
        else { const want = W.open[id] ? D2.y0 + D2.def.size[1] - 0.05 : D2.y0; D2.mesh.position.y += (want - D2.mesh.position.y) * ease; }
      }
      const t = now / 1000, fdt = Math.min(dt, 0.1);
      for (const fn of updates) fn(fdt, t);
      npcTick(fdt, t);
      portalTick();
      if (env) env.update(fdt, t, camera.position);
      if (sound) {
        sound.listen(camera);
        const sp = Math.hypot(me.vx || 0, me.vz || 0);
        if (me.ground && sp > 0.5) { stepAcc += sp * fdt; if (stepAcc > (sp > 5 ? 1.4 : 0.95)) { stepAcc = 0; sound.step(sp); } } else stepAcc = 0.6;
      }
      for (const id in pickups) pickups[id].mesh.rotation.y += dt * 1.5;
      if (fight) fightTick(iAmHouse ? Math.min(dt, 1) : fdt, now);
      sendState(false);
      drawRemotes();
      if (amHost()) growBack(now);
      if (room && amHost() && now - worldT > 3000) { worldT = now; if (now - lastWorldSent > 2500) sendWorld(); }
      if (now - netT > 1000) {
        netT = now; drawNet();
        /* no record yet and the house is here: ask it for mine */
        if (rpg && room && !iAmHouse && !rec && houseId() && now - askedRec > 5000) { askedRec = now; room.tell({ Q: 'me' }); }
      }
      const pr = playing() ? promptFor(aimed()) || (fight && !TOUCH && fight.pick(me.x, me.z, me.yaw, P.range) ? 'F / click: strike' : '') : '';
      if (pr !== promptNow) { promptNow = pr; $('.lwq-prompt').textContent = pr; }   /* only when it changes: a DOM write is not free */
      if (drawing) { if (post) post.render(t); else renderer.render(scene, camera); }
      G.requestAnimationFrame(frame);
    }
    resize(); drawInv(); drawNet(); drawWho(); drawStats();
    try { renderer.compile(scene, camera); } catch (e) { /* only a head start */ }
    walletUp().catch(e => log('Wallet: ' + (e && e.message || e)));
    connect().catch(e => log('Multiplayer: ' + (e && e.message || e)));
    G.requestAnimationFrame(frame);
    return {
      stop() { stopped = true; if (room) room.leave(); G.removeEventListener('resize', resize); },
      /* for tests and tools: stand somewhere, look somewhere, press E without a captured mouse */
      goto(x, y, z) { me.x = prev.x = +x; me.y = prev.y = +y; me.z = prev.z = +z; me.vy = 0; },
      look(yaw, pitch) { me.yaw = +yaw; me.pitch = +(pitch || 0); },
      use() { camera.position.set(me.x, me.y + EYE, me.z); camera.rotation.set(me.pitch, me.yaw, 0); camera.updateMatrixWorld(); useAim(true); },
      aimed() { camera.updateMatrixWorld(); return aimed(); },
      log: () => logLines.slice(),
      camZ: () => camera.position.z,
      draw(on) { drawing = !!on; },   /* tests: everything runs, nothing is drawn (a machine without a GPU keeps up) */
      play() { if (TOUCH) startTouch(); else touchPlaying = true; },   /* tests: as if the view had been clicked */
      strike() { attack(); },
      fight: () => fight ? fight.units() : [],
      /* the house's book of players, for tools/house.py to keep on disk: out as JSON, and back in after a start */
      houseDump: () => book ? JSON.stringify(book.dump()) : '{}',
      houseLoad: json => { const n = book ? book.load(json) : 0; for (const [, r] of remotes) if (r.from.address) dirty.add(r.from.address); return n; },
      record: () => rec,
      menu: on => { if (menu) { if (on === false) menu.close(); else { menu.open(); } } },
      player: () => P ? Object.assign({}, P) : null,
      stats: () => ({ fps, pixelRatio: pr, frozen, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }),
      get state() { return { me: Object.assign({}, me), world: W, host: amHost(), house: iAmHouse ? 'me' : houseId() ? 'there' : null, players: Array.from(remotes.values()).filter(r => !r.house).length + (iAmHouse ? 0 : 1), online: !!room,
                       others: Array.from(remotes.values()).map(r => ({ id: r.from.id, tag: r.from.tag, j: r.j, visible: r.g.visible, x: R2(r.g.position.x), y: R2(r.g.position.y), z: R2(r.g.position.z) })), fast: !!(room && room.fast), who, progress }; }
    };
  }

  if (G.LWQ && G.LWQ.define) G.LWQ.define('engine', { api: 1, v: 16, needs: { three: 160, net: 1, wallet: 1, art: 1, sound: 1, combat: 1, rpg: 1, menu: 1, levels: 1 } },
    D => ({ start: (el, opts) => start(D, el, opts) }));
})(typeof globalThis !== 'undefined' ? globalThis : this);
