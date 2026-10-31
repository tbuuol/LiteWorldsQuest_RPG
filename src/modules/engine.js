/* LiteWorldsQuest engine: first person, one small level, other players, the wallet.
     const game = engine.start(element, {room, game, level})  -> {stop(), travel(level), level, ...}
   MOVEMENT  WASD / arrows, Shift to run, Space to jump, mouse to look (click the view to capture it), E to use.
   THE WORLD  doors, levers, pickups and the fight are kept by the HOUSE alone (the game's own account, kept in the
     room by a machine). ONLY DIRECT (tbuuol 2026-10-28): a player plays only while linked directly (WebRTC, the
     arcade's fast lane as a star) with the house; until then the game waits on its loading screen, and a player whose
     link is gone for 2 s is taken out. No solo, no player keeping the world, no game data through the room (the room is
     for joining, who is who and setting the link up). Intents ({I: 'use'|'take', o: id}) go to the house, which
     decides and sends the world ({W}) to the players linked with it.
   PLAYERS  each page sends its position 15 times a second to the house, which passes it on to the players near them
     ({F}). Others are drawn a little behind and interpolated between the samples.
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

  /* ZONES WITHOUT A RELOAD (tbuuol 2026-10-28: "doof, dass es neu laden muss"): the game is one zone at a time,
     played by play(); a portal stops it and plays the next in the same page -- the modules, the wallet's permission,
     the picture (renderer, canvas, a captured mouse) and the sound stay. What the page holds (window.LWQGAME) always
     speaks to the zone being played. */
  function start(D, el, opts) {
    opts = opts || {};
    const keep = { renderer: null, sound: undefined, touch: false, travel: go };
    let cur = null, level = opts.level || null, busy = false;
    function go(to, label) {
      if (busy || !D.levels[to]) return Promise.resolve(false);
      busy = true;
      const veil = document.createElement('div');
      veil.style.cssText = 'position:absolute;inset:0;z-index:50;background:#000;opacity:0;transition:opacity .6s;display:flex;align-items:center;' +
        'justify-content:center;color:#e9dcc0;font:22px Georgia,serif;pointer-events:none';
      veil.textContent = 'Travelling to ' + (label || D.levels[to].title || to) + '…';
      el.appendChild(veil); requestAnimationFrame(() => { veil.style.opacity = '1'; });
      return new Promise(res => setTimeout(() => {
        try {
          if (cur) cur.stop(true);
          level = to; cur = play(D, el, Object.assign({}, opts, { level: to }), keep);
          /* the address says where you are, so a reload comes back here */
          try { const q = new URLSearchParams(location.search); q.set('level', to); history.replaceState(history.state, '', '?' + q.toString()); } catch (e) { /* a frame that may not */ }
          res(true);
        } catch (e) { console.error(e); res(false); }
        setTimeout(() => { veil.style.opacity = '0'; setTimeout(() => veil.remove(), 700); busy = false; }, 400);
      }, 650));
    }
    cur = play(D, el, opts, keep);
    const extra = {
      travel: (to, label) => go(to, label),
      get level() { return level && D.levels[level] && !(D.levels.world && (D.levels.world.from || []).includes(level)) ? level : D.levels.world ? 'world' : D.levels.blockshire ? 'blockshire' : 'test'; },
      stop() { if (cur) cur.stop(false); cur = null; }
    };
    return new Proxy(extra, { get: (t, k) => k in t ? t[k] : cur ? cur[k] : undefined, has: (t, k) => k in t || !!cur && k in cur });
  }

  function play(D, el, opts, keep) {
    const THREE = D.three, net = D.net, wallet = D.wallet, art = D.art;
    /* the Hybrid tier's real files (textures, the people model): the loader says where each one lives */
    const assetURL = G.LWQ && G.LWQ.get ? G.LWQ.get('$asset') : null;
    if (assetURL && art.useAssets) art.useAssets(assetURL);
    if (keep.sound === undefined) keep.sound = D.sound ? D.sound.create() : null;
    const sound = keep.sound;
    if (sound && sound.clearFires) sound.clearFires();   /* the last zone's campfires */
    /* what this zone hangs on the page, window or document, taken off again when it stops */
    const offs = [], before = new Set(el.children);
    const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); offs.push(() => t.removeEventListener(type, fn, o)); };
    /* ONE WORLD (2026-10-28): the zones that are part of it now (an old ?level=beach) open the world */
    const inWorld = l => D.levels.world && (D.levels.world.from || []).includes(l);
    const LEVEL = opts.level && !inWorld(opts.level) ? opts.level : D.levels.world ? 'world' : D.levels.blockshire ? 'blockshire' : 'test';
    const LV = D.levels[LEVEL];
    if (!LV) throw new Error('no level ' + LEVEL);
    const ROOM = opts.room || ('lwq.' + LV.id), GAME = opts.game || 'liteworldsquest';
    let stopped = false;

    /* --- scene ---------------------------------------------------------------------------------------- */
    const renderer = keep.renderer || (keep.renderer = new THREE.WebGLRenderer({ antialias: true }));
    renderer.info.autoReset = false;   /* the stats count the whole frame, scene and after-passes, not only the last pass */
    renderer.setPixelRatio(Math.min(2, G.devicePixelRatio || 1));
    if (renderer.domElement.parentNode !== el) el.appendChild(renderer.domElement);
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
    on(G, 'resize', resize);

    const boxes = [];          /* collision: {min:[x,y,z], max:[x,y,z], on()} */
    const usable = [];         /* meshes the crosshair can use */
    const updates = [];        /* fn(dt, t) every frame: fire, water, ... */
    /* THE WHOLE WORLD (2026-10-29): its ground from the terrain module (the same the map is painted with), drawn round
       the eye in squares by art.land; how far the land reaches: further on a PC than on a phone */
    const TR = LV.land && D.terrain ? D.terrain.create(LV.land) : null;
    const PHONE = !!((G.matchMedia && G.matchMedia('(pointer: coarse)').matches) || (G.navigator && G.navigator.maxTouchPoints > 0 && 'ontouchstart' in G));
    const REACH = PHONE ? 170 : 340;
    if (TR) { camera.far = 4000; camera.updateProjectionMatrix(); if (scene.fog) { scene.fog.near = REACH * 0.35; scene.fog.far = REACH; } }
    const ctx = { THREE, scene, rng: art.rng,
                  solid: (min, max, on) => boxes.push({ min, max, on: on || (() => true) }),
                  usable: (m, data) => { m.userData = data; usable.push(m); },
                  every: fn => updates.push(fn),
                  /* the ground under any point: the village's hills or a coast (art.terrainAt) */
                  height: TR ? TR.height : !LV.real && LV.env && art.terrainAt ? art.terrainAt(LV.env) : null,
                  floor: TR ? TR.floor : !LV.real && LV.env && art.floorAt ? art.floorAt(LV.env) : null };   /* the ground without ships' decks */
    function box(def, mat) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(def.size[0], def.size[1], def.size[2]),
        mat || new THREE.MeshLambertMaterial({ color: def.color || '#888' }));
      m.position.set(def.pos[0], def.pos[1], def.pos[2]);
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
      return m;
    }
    const aabb = (def, on) => ({ min: def.pos.map((p, i) => p - def.size[i] / 2), max: def.pos.map((p, i) => p + def.size[i] / 2), on: on || (() => true) });
    /* the level's things, built by the art module; the engine keeps what can be used and what blocks the way */
    const doors = {}, switches = {}, pickups = {}, shrines = {}, npcs = {}, resources = {}, portals = [];
    const RES_NAME = { tree: 'oak', rock: 'ore boulder', herb: 'herbs' };
    const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
    let forge = null, forgeDef = null;
    const nearForge = (x, z) => !!forgeDef && Math.hypot(x - forgeDef.pos[0], z - forgeDef.pos[1]) < 5;
    /* a piece of the real Earth (tools/realworld.py): the ground is its heights, the houses its footprints */
    const realW = LV.real ? art.realworld(ctx, LV.real) : null;
    const grid = new Map(), CELL = 25, cellKey = (i, j) => i + ',' + j;
    /* footprints and walls by 25 m cell, so a step only looks at what is near (the real world's; a city wall's) */
    const file = (o, x0, z0, x1, z1) => { for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) { const k = cellKey(i, j); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(o); } };
    const fileSeg = sg => file({ seg: sg }, Math.min(sg.a[0], sg.b[0]) - sg.r - 1, Math.min(sg.a[1], sg.b[1]) - sg.r - 1, Math.max(sg.a[0], sg.b[0]) + sg.r + 1, Math.max(sg.a[1], sg.b[1]) + sg.r + 1);
    if (realW) {
      for (const b of realW.polys) { const xs = b.pts.map(q => q[0]), zs = b.pts.map(q => q[1]); file({ poly: b }, Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)); }
      for (const sg of realW.segs) fileSeg(sg);
      if (!(LV.portals || []).length) portals.push(art.portal(ctx, { pos: [realW.spawn[0], realW.spawn[1]], y: realW.groundAt(realW.spawn[0], realW.spawn[1]) - 0.2, to: 'blockshire', label: 'Blockshire', rot: 0, color: '#ffc77f' }));
    }
    const many = v => v ? [].concat(v) : [];
    /* a place's things: the level itself, or in the world each of its places (LV.places: Blockshire, Saltwind, ...) */
    function buildPlace(LV, lift) {
    const n0 = scene.children.length, b0 = boxes.length;
    for (const s of LV.solids || []) { if (!s.invisible) box(s); boxes.push(aabb(s)); }

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
    /* portals to other levels */
    const portals0 = portals.length;
    for (const d of LV.portals || []) portals.push(art.portal(ctx, d));
    /* zone 2: the sea, docks, ships (one of them the pirates' dungeon) */
    if (LV.water && art.water) art.water(ctx, LV.water);
    for (const dk of LV.docks || []) art.dock(ctx, dk);
    for (const sh of LV.ships || []) art.ship(ctx, sh);
    /* one of each in a zone, several in the world */
    for (const f of many(LV.fire)) { art.campfire(ctx, f); if (sound) sound.fire(f.pos[0], lift || (ctx.height ? ctx.height(f.pos[0], f.pos[1]) : 0), f.pos[1]); }
    for (const f of many(LV.forest)) art.forest(ctx, f);
    if (LV.forest_trees) {   /* a place's own few trees, placed by hand (they go up with it) */
      art.trees(ctx, LV.forest_trees, () => 0);
      for (const t of LV.forest_trees) ctx.solid([t[0] - 0.35, -1, t[1] - 0.35], [t[0] + 0.35, 3, t[1] + 0.35]);
    }
    for (const g of many(LV.grass)) art.grass(ctx, g);
    for (const pa of many(LV.paths)) art.paths(ctx, pa);
    for (const pr of LV.props || []) art.prop(ctx, pr);
    /* THINGS TO GATHER around the camp (tbuuol 2026-10-23): an oak, an ore boulder, herbs. Which are spent is part of
       the shared world (W.dep); the house decides what gathering gives, and when a spent one grows back. */
    for (const n of (LV.resources && LV.resources.nodes) || []) {
      if (n.ground && TR) n.y = TR.walk(n.pos[0], n.pos[1]) - 0.05;   /* out on the world's land (make_world.py's wilds) */
      const look = art.resource(ctx, n);
      look.use.userData = { kind: 'res', id: n.id }; usable.push(look.use);
      resources[n.id] = { def: n, look };
    }
    /* THE FORGE: E opens the menu's Craft tab; making is asked of the house, which wants the player at the forge */
    if (LV.forge) { forge = art.forge(ctx, LV.forge); forge.use.userData = { kind: 'forge' }; usable.push(forge.use); forgeDef = LV.forge; }
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
    for (const n of LV.npcs || []) {
      const c = art.character(ctx, n.look); c.setName(n.name, '#ffe9a8');
      const home = n.lookAt ? yawTo(n.lookAt[0] - n.pos[0], n.lookAt[1] - n.pos[1]) : (n.rot || 0) * Math.PI / 180;
      c.group.position.set(n.pos[0], 0, n.pos[1]); c.group.rotation.y = home;
      const hit = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.9, 0.8), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.set(n.pos[0], 0.95, n.pos[1]); hit.userData = { kind: 'npc', id: n.id }; scene.add(hit); usable.push(hit);
      if (!n.walk) ctx.solid([n.pos[0] - 0.3, 0, n.pos[1] - 0.3], [n.pos[0] + 0.3, 1.8, n.pos[1] + 0.3]);
      npcs[n.id] = { def: n, c, hit, home, x: n.pos[0], z: n.pos[1], y: lift, wp: 0, wait: 1 + Math.random() * 2, line: -1 };
    }
    /* A PLACE ON ITS GROUND (the world, 2026-10-29): its things are made standing on 0 -- now all of them go up to where
       the place lies (Blockshire on its cliff, 14 m), what blocks the way with them */
    if (lift) {
      for (const ch of scene.children.slice(n0)) ch.position.y += lift;
      for (const bx of boxes.slice(b0)) { bx.min[1] += lift; bx.max[1] += lift; }
      for (const P of portals.slice(portals0)) P.y += lift;
    }
    }
    if (LV.places) for (const pl of LV.places) buildPlace(pl, pl.lift || 0);
    else buildPlace(LV, 0);
    /* THE ZONE'S NAME, as the old WoW showed it: big, golden, in the middle, when you come into it (Etappe 3) */
    let zoneNow = null, zoneEl = null;
    function zoneTick() {
      if (!LV.wild || iAmHouse) return;
      /* the level's areas by rectangle ([x0, z0, x1, z1], first match), or the old ring round the village */
      const area = (LV.zones || []).find(a => me.x >= a.rect[0] && me.x <= a.rect[2] && me.z >= a.rect[1] && me.z <= a.rect[3]);
      const z = area ? area.name : LV.zones ? (LV.zoneElse || LV.title || '') : Math.hypot(me.x, me.z) > (LV.wild.from || 28) ? LV.wild.zone : (LV.title || 'Blockshire');
      if (!z) return;
      if (z === zoneNow) return;
      const first = zoneNow == null; zoneNow = z;
      if (first) return;
      if (!zoneEl) { zoneEl = document.createElement('div'); zoneEl.style.cssText = 'position:absolute;left:0;right:0;top:22%;text-align:center;pointer-events:none;' +
        'font:700 42px Georgia,serif;color:#ffd96a;text-shadow:0 2px 0 #3a2208,0 0 12px rgba(0,0,0,.7);opacity:0;transition:opacity 1.2s;letter-spacing:.04em'; el.appendChild(zoneEl); }
      zoneEl.textContent = z; zoneEl.style.opacity = '1';
      clearTimeout(zoneEl.t); zoneEl.t = setTimeout(() => { zoneEl.style.opacity = '0'; }, 3000);
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
    function travel(P) {   /* in this page: start() stops this zone and plays the next */
      travelling = true;
      if (sound) sound.blip('pickup');
      keep.travel(P.to, P.label).then(ok => { if (!ok && !stopped) { log('The portal is cold here.'); travelling = false; } });
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
        N.c.group.position.set(N.x, N.y || 0, N.z); N.hit.position.set(N.x, (N.y || 0) + 0.95, N.z);
        N.c.animate(dt, speed);
        if (N.c.tag) N.c.tag.visible = dist < 9 || (talk && talk.id === id);   /* a name over a head only up close */
        if (talking && dist > 5) closeTalk();
      }
    }
    let talk = null;   /* {id, line} while somebody is being spoken to */
    /* a quest this person has for me: one to hand in first, then one under way, then one to offer */
    function questOf(id) {
      if (!rpg || !rec || !LV.quests) return null;
      let best = null, rank = 0;
      for (const q of LV.quests) {
        if (q.npc !== id) continue;
        const st = rpg.questState(rec, q), r = { ready: 3, active: 2, offer: 1 }[st] || 0;
        if (r > rank) { rank = r; best = { q, st }; }
      }
      return best;
    }
    function speak(id) {
      const N = npcs[id], lines = N.def.lines || ['…'];
      /* QUESTS (Etappe 3): E shows the quest, E again takes it or hands it in (the house decides) */
      if (talk && talk.id === id && talk.quest) {
        const { q, st } = talk.quest;
        if (st === 'offer' || st === 'ready') askHouse({ Q: 'quest', q: q.id, x: st === 'offer' ? 'take' : 'turn' });
        closeTalk(); return;
      }
      const qq = (!talk || talk.id !== id) && questOf(id);
      if (qq) {
        talk = { id, line: 0, quest: qq };
        if (N.c.emote) N.c.emote('emote-yes');
        if (sound) sound.blip('talk');
        const prog = rpg.questProgress(rec, qq.q).parts.map(p => (p[0] === 'make' ? 'made' : (LV.wild && LV.wild.species[p[0]] ? LV.wild.species[p[0]].name : (rpg.ITEMS[p[0]] || {}).name || p[0])) + ' ' + p[1] + '/' + p[2]).join(' · ');
        const box = $('.lwq-talk');
        box.innerHTML = '<b>' + esc(N.def.name) + '</b> · <i style="color:#ffe9a8">' + esc(qq.q.title) + '</i><br>' +
          esc(qq.st === 'ready' ? qq.q.done : qq.q.offer) +
          (qq.st === 'active' ? '<br><span style="color:#cfe6a0">' + esc(prog) + '</span>' : '') +
          '<small>' + (qq.st === 'offer' ? 'E: accept the quest' : qq.st === 'ready' ? 'E: hand it in' : 'E: goodbye') + '</small>';
        box.style.display = 'block';
        return;
      }
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
    const fight = (LV.defense || LV.wild) && combat ? combat.create({ THREE, art, ctx, def: LV.defense || {}, wild: LV.wild || null,
      height: ctx.height }) : null;

    /* everything that never moves, merged by material: hundreds of parts become a few dozen draw calls */
    for (const id in doors) if (!doors[id].pivots) doors[id].mesh.userData.keep = true;
    for (const id in switches) switches[id].mesh.userData.keep = true;
    const frozen = art.freeze ? art.freeze(scene) : null;
    /* the world's land, after the freeze: its squares come and go as you walk */
    let resFrame = 0; const RES_NEAR = PHONE ? 90 : 150;
    const land = TR && art.land ? art.land(ctx, TR, { radius: REACH, haze: scene.fog ? '#' + scene.fog.color.getHexString() : null }) : null;
    if (frozen) console.info('LWQ: ' + frozen.joined + ' still parts drawn in ' + frozen.calls + ' calls');
    /* city walls on the land (Genesis', 2026-10-31): they stop you where they are drawn */
    if (TR && art.cityWall) for (const w of (LV.land && LV.land.walls) || []) for (const sg of art.cityWall(ctx, TR, w).segs) fileSeg(sg);

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
      '<button class="lwq-mute" type="button" title="Sound on / off">🔊</button>' +
      (TR ? '<div class="lwq-pos"></div><div class="lwq-compass"><div class="lwq-compass-in"></div><i></i></div><div class="lwq-map"><canvas></canvas><div class="lwq-map-t"></div></div>' : '') +
      '<div class="lwq-inv"></div><div class="lwq-log"></div><div class="lwq-talk"></div>' +
      (fight ? '<div class="lwq-abil"></div><div class="lwq-stats"><span class="lwq-lv"></span><div class="lwq-bar lwq-hp"><i></i><span></span></div>' +
               '<div class="lwq-bar lwq-xp"><i></i><span></span></div></div>' : '') +
      (LV.credits ? '<div class="lwq-credit">' + esc(LV.credits) + '</div>' : '') +
      (TOUCH ? '<div class="lwq-touch"><div class="lwq-stick"><div class="lwq-knob"></div></div>' +
               '<button class="lwq-b lwq-b-atk" data-b="attack">⚔</button><button class="lwq-b lwq-b-use" data-b="use">E</button>' +
               '<button class="lwq-b lwq-b-jump" data-b="jump">▲</button><button class="lwq-b lwq-b-run" data-b="run">Run</button>' +
               '<button class="lwq-b lwq-b-menu" data-b="menu">☰</button>' + (TR ? '<button class="lwq-b lwq-b-map" data-b="map">🗺</button>' : '') + '</div>' : '') +
      '<div class="lwq-start"><b>' + esc(LV.title || 'LiteWorldsQuest') + '</b><br>' + (TOUCH ? 'Tap to play' : 'Click to play') + '<br>' +
      (TOUCH ? '<small>Left thumb: walk · right thumb: look · ⚔ strike · E use · ▲ jump</small></div>'
             : '<small>WASD move · Shift run · Space jump · Mouse look · E use · F / click strike · ' + (TR ? 'M map · P position' : 'M sound') + ' · F3 fps · Esc release mouse</small></div>');
    /* THE GATE (only direct, tbuuol 2026-10-28): the loading screen until this player is linked directly with the house
       and has its character; and where you land when the link is lost for 2 s (kicked) */
    hud.insertAdjacentHTML('beforeend', '<div class="lwq-gate"><div class="lwq-gate-t">Connecting to the arcade…</div><small class="lwq-gate-s"></small>' +
      '<button class="lwq-gate-b" type="button" style="display:none"></button></div>');
    el.appendChild(hud);
    /* the ability bar takes taps and clicks itself (not the look or the joystick) */
    const abilBar = hud.querySelector('.lwq-abil');
    if (abilBar) {
      for (const t of ['touchstart', 'touchmove', 'touchend', 'mousedown']) abilBar.addEventListener(t, e => e.stopPropagation(), { passive: true });
      abilBar.addEventListener('click', e => { const b = e.target.closest('[data-ab]'); if (!b) return; const i = +b.dataset.ab; if (i < 0) attack(); else ability(i); });
    }
    const st = document.createElement('style');
    st.textContent =
      '.lwq-tl,.lwq-tr,.lwq-inv,.lwq-log,.lwq-prompt{position:absolute;font:13px/1.4 system-ui,sans-serif;color:#fff;' +
      'text-shadow:0 1px 2px #000;pointer-events:none}' +
      '.lwq-tl{left:12px;top:10px}.lwq-tr{right:12px;top:10px;text-align:right}.lwq-inv{left:12px;bottom:10px}' +
      '.lwq-mute{position:absolute;right:12px;top:58px;z-index:6;width:34px;height:30px;border-radius:7px;border:1px solid rgba(255,255,255,.35);background:rgba(0,0,0,.35);color:#fff;font-size:16px;cursor:pointer;padding:0}' +
      '.lwq-compass{position:absolute;left:50%;top:8px;transform:translateX(-50%);width:300px;height:26px;overflow:hidden;pointer-events:none;' +
      'background:linear-gradient(90deg,rgba(0,0,0,0),rgba(20,14,6,.55) 20%,rgba(20,14,6,.55) 80%,rgba(0,0,0,0));border-radius:4px}' +
      '.lwq-compass-in{position:absolute;top:0;left:0;height:26px;white-space:nowrap;font:bold 13px/26px Georgia,serif;color:#f3e3c3;text-shadow:0 1px 2px #000}' +
      '.lwq-compass-in span{display:inline-block;width:30px;text-align:center}.lwq-compass-in span.c{color:#ffd96a;font-size:16px}' +
      '.lwq-pos{position:absolute;left:50%;top:36px;transform:translateX(-50%);pointer-events:none;font:bold 12px/16px Georgia,serif;color:#f3e3c3;text-shadow:0 1px 2px #000;white-space:nowrap}' +
      '.lwq-compass i{position:absolute;left:50%;top:0;width:2px;height:26px;margin-left:-1px;background:#ffd96a}' +
      '.lwq-map{position:absolute;inset:0;z-index:15;display:none;align-items:center;justify-content:center;background:rgba(10,8,4,.72)}' +
      '.lwq-map canvas{max-width:94%;max-height:88%;border:6px solid #3a2610;outline:2px solid #c9a04a;box-shadow:0 8px 30px #000}' +
      '.lwq-map-t{position:absolute;bottom:3%;left:0;right:0;text-align:center;color:#f3e3c3;font:14px Georgia,serif;text-shadow:0 1px 2px #000}' +
      '.lwq-log{right:12px;bottom:10px;text-align:right;max-width:46%}' +
      '.lwq-x{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);color:#fff;font:18px monospace;' +
      'text-shadow:0 0 3px #000;pointer-events:none}' +
      '.lwq-prompt{left:50%;top:calc(50% + 22px);transform:translateX(-50%)}' +
      '.lwq-start{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;' +
      'background:rgba(0,0,0,.45);color:#fff;font:20px/1.6 system-ui,sans-serif;text-align:center;cursor:pointer}' +
      '.lwq-start small{font-size:13px;opacity:.85}' +
      '.lwq-gate{position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;' +
      'background:#0d0a07;color:#e9dcc0;font:22px/1.5 Georgia,serif;text-align:center;padding:0 16px}' +
      '.lwq-gate.soft{background:rgba(0,0,0,.55)}.lwq-gate small{font:14px/1.5 system-ui,sans-serif;opacity:.8;max-width:34em}' +
      '.lwq-gate button{font:16px system-ui,sans-serif;padding:8px 18px;border-radius:8px;border:1px solid #c9a04a;background:#3a2a12;color:#ffe9a8;cursor:pointer}' +
      '.lwq-talk{display:none;position:absolute;left:50%;bottom:118px;transform:translateX(-50%);width:min(560px,80%);' +
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
      '.lwq-abil{position:absolute;left:50%;bottom:62px;transform:translateX(-50%);display:flex;gap:6px;z-index:5}' +
      '.lwq-abil button{position:relative;width:44px;height:44px;border-radius:8px;border:2px solid #c9a25e;background:rgba(40,28,14,.82);' +
      'color:#ffe7b0;font:700 20px Georgia,serif;padding:0;overflow:hidden;cursor:pointer;touch-action:none;box-shadow:inset 0 0 8px rgba(0,0,0,.6)}' +
      '.lwq-abil button.off{filter:grayscale(1);opacity:.45}.lwq-abil small{position:absolute;right:3px;bottom:1px;font:600 10px system-ui;color:#fff}' +
      '.lwq-abil b{position:relative;z-index:1}.lwq-abil i{position:absolute;left:0;right:0;bottom:0;height:0;background:rgba(0,0,0,.6)}' +
      '.lwq-touch{display:none;position:absolute;inset:0;touch-action:none;user-select:none;-webkit-user-select:none}' +
      '.lwq-stick{display:none;position:absolute;width:120px;height:120px;margin:-60px 0 0 -60px;border-radius:50%;' +
      'background:rgba(255,255,255,.12);border:2px solid rgba(255,255,255,.35);pointer-events:none}' +
      '.lwq-knob{position:absolute;left:35px;top:35px;width:50px;height:50px;border-radius:50%;background:rgba(255,255,255,.55)}' +
      '.lwq-b{position:absolute;border-radius:50%;border:2px solid rgba(255,255,255,.55);background:rgba(20,20,20,.38);color:#fff;' +
      'font:700 18px system-ui,sans-serif;touch-action:none;padding:0}.lwq-b.on{background:rgba(255,200,80,.55)}' +
      '.lwq-b-atk{right:28px;bottom:42px;width:84px;height:84px;font-size:34px;background:rgba(150,30,20,.5)}' +
      '.lwq-b-use{right:124px;bottom:30px;width:58px;height:58px}.lwq-b-jump{right:40px;bottom:140px;width:58px;height:58px}' +
      '.lwq-b-run{right:124px;bottom:104px;width:52px;height:52px;font-size:13px}.lwq-b-menu{right:14px;top:120px;width:48px;height:48px;font-size:22px}.lwq-b-map{right:70px;top:120px;width:48px;height:48px;font-size:22px}' +
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
    if (D.menu && D.rpg && (LV.defense || LV.wild)) {
      menu = D.menu.create({ el, rpg: D.rpg, touch: TOUCH, wild: LV.wild || null, quests: LV.quests || [], atForge: () => nearForge(me.x, me.z),
        ask(q) {
          if (!live()) return;
          sendIntent(Object.assign({ Q: q.op }, q.op === 'equip' ? { u: q.uid } : q.op === 'craft' ? { r: q.recipe } : q.op === 'codex' ? { sp: q.species, k: q.skill } : { s: q.slot }));
        } });
    }
    function askHouse(msg) { if (live()) sendIntent(msg); }
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
    const playing = () => (locked() || touchPlaying) && live();
    $('.lwq-start').addEventListener('click', () => {
      if (sound) sound.start();
      if (TOUCH) { startTouch(); return; }
      try { canvas.requestPointerLock(); } catch (e) { /* no pointer lock here */ }
    });
    on(canvas, 'click', () => { if (!TOUCH && !locked()) try { canvas.requestPointerLock(); } catch (e) { /* ignore */ } });
    on(canvas, 'mousedown', e => { if (e.button === 0 && locked()) attack(); });
    on(document, 'pointerlockchange', () => { if (!TOUCH) $('.lwq-start').style.display = locked() ? 'none' : 'flex'; });

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
    /* SOUND ON AND OFF: a button (tbuuol 2026-10-29), and M where the level has no map */
    function muteSound() { if (!sound) return; const off = sound.mute(); $('.lwq-mute').textContent = off ? '🔇' : '🔊'; log(off ? 'Sound off.' : 'Sound on.'); }
    on($('.lwq-mute'), 'click', e => { e.stopPropagation(); muteSound(); });
    /* THE COMPASS: the directions slide past a mark in the middle, as you turn (north is -z) */
    let compassKey = '';
    function compassTick() {
      if (!TR) return;
      const deg = ((-me.yaw * 180 / Math.PI) % 360 + 360) % 360, k = Math.round(deg);
      if (k === compassKey) return; compassKey = k;
      const inner = $('.lwq-compass-in');
      if (!inner.childNodes.length) {
        const L = ['N', '·', 'NE', '·', 'E', '·', 'SE', '·', 'S', '·', 'SW', '·', 'W', '·', 'NW', '·'], parts = [];
        for (let r = 0; r < 3; r++) for (const t of L) parts.push('<span class="' + (t.length === 1 && t !== '·' ? 'c' : '') + '">' + (t === 'E' ? 'O' : t === 'SE' ? 'SO' : t === 'NE' ? 'NO' : t) + '</span>');
        inner.innerHTML = parts.join('');
      }
      inner.style.transform = 'translateX(' + (150 - 15 - (16 + deg / 22.5) * 30) + 'px)';
    }
    /* WHERE YOU ARE (tbuuol 2026-10-31: "ein Koordinatensystem damit ich dir Stellen nennen kann"): the map's squares
       of 200 m like a chessboard -- letters west to east, numbers north to south -- and the metres (x east, z south,
       Blockshire's middle 0 / 0) under the compass; P writes it into the log, the map (M) has the squares */
    const SQ = 200;
    function square(x, z) {
      const c = Math.floor((x - TR.EXT[0]) / SQ), r = Math.floor((z - TR.EXT[1]) / SQ);
      return String.fromCharCode(65 + Math.max(0, Math.min(25, c))) + (r + 1);
    }
    const whereText = () => square(me.x, me.z) + ' · ' + Math.round(me.x) + ' / ' + Math.round(me.z);
    let posKey = '';
    function posTick() {
      if (!TR) return;
      const k = whereText(); if (k === posKey) return; posKey = k;
      $('.lwq-pos').textContent = k;
    }
    /* THE MAP (M): the world drawn from the same terrain as the ground, once, the first time it is opened; you are
       the arrow on it */
    let mapDrawn = null;
    function drawMap() {
      const cv = $('.lwq-map canvas'), [ex0, ez0, ex1, ez1] = TR.EXT, W = 900, H = Math.round(W * (ez1 - ez0) / (ex1 - ex0));
      cv.width = W; cv.height = H;
      const x = cv.getContext('2d'), img = x.createImageData(W, H), d = img.data, sx = (ex1 - ex0) / W, sz = (ez1 - ez0) / H, Hh = new Float32Array(W * H);
      for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) Hh[py * W + px] = TR.floor(ex0 + px * sx, ez0 + py * sz);
      const PAL = { green: [134, 185, 90], valley: [162, 200, 98], troll: [164, 144, 88], fey: [90, 168, 138], ruins: [154, 150, 126], cemetery: [124, 135, 108], swamp: [114, 124, 68], mountain: [143, 138, 128] };
      for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
        const i = py * W + px, h = Hh[i], X = ex0 + px * sx, Z = ez0 + py * sz; let c;
        if (h < TR.SEA) { const k = Math.min(1, (TR.SEA - h) / 6); c = [63 - 34 * k, 194 - 120 * k, 192 - 70 * k]; }
        else {
          const w = TR.weights(X, Z, h); c = [0, 0, 0]; let tw = 0;
          for (const k in w) { const p2 = PAL[k]; c[0] += p2[0] * w[k]; c[1] += p2[1] * w[k]; c[2] += p2[2] * w[k]; tw += w[k]; }
          c = c.map(v => v / tw);
          if (h < 0.9 && TR.coast(X, Z) < 50 && w.swamp < 0.5) c = [226, 207, 152];
          if (h > 150) c = [240, 242, 245];
          const hx = Hh[i + (px < W - 1 ? 1 : 0)] - Hh[i - (px > 0 ? 1 : 0)], hz = Hh[i + (py < H - 1 ? W : 0)] - Hh[i - (py > 0 ? W : 0)];
          const sh = Math.max(0.55, Math.min(1.3, 1 + (-hx - hz) * 0.08));
          c = c.map(v => v * sh);
        }
        d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
      }
      x.putImageData(img, 0, 0);
      const P = (X, Z) => [(X - ex0) / sx, (Z - ez0) / sz];
      /* the squares, faint, named along the top and the left */
      x.strokeStyle = 'rgba(40,24,8,.28)'; x.lineWidth = 1; x.font = 'bold 11px Georgia, serif'; x.fillStyle = '#3a2610'; x.textAlign = 'center'; x.textBaseline = 'top';
      for (let c = 0; ex0 + c * SQ < ex1; c++) { const [a] = P(ex0 + c * SQ, 0); x.beginPath(); x.moveTo(a, 0); x.lineTo(a, H); x.stroke(); x.fillText(String.fromCharCode(65 + c), P(ex0 + (c + 0.5) * SQ, 0)[0], 3); }
      x.textAlign = 'left'; x.textBaseline = 'middle';
      for (let r = 0; ez0 + r * SQ < ez1; r++) { const b = P(0, ez0 + r * SQ)[1]; x.beginPath(); x.moveTo(0, b); x.lineTo(W, b); x.stroke(); x.fillText(String(r + 1), 4, P(0, ez0 + (r + 0.5) * SQ)[1]); }
      x.lineCap = x.lineJoin = 'round';
      for (const r of TR.ROADS) { x.strokeStyle = '#6a4a26'; x.lineWidth = 3.5; x.beginPath(); r.pts.forEach((q, n) => { const [a, b] = P(q[0], q[1]); n ? x.lineTo(a, b) : x.moveTo(a, b); }); x.stroke(); x.strokeStyle = '#e2c27e'; x.lineWidth = 1.8; x.stroke(); }
      x.font = 'bold 13px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      for (const zn of LV.zones || []) {
        if (/Pirate Ship|^Beach$/.test(zn.name)) continue;
        const [a, b] = P((zn.rect[0] + zn.rect[2]) / 2, (zn.rect[1] + zn.rect[3]) / 2);
        x.lineWidth = 3; x.strokeStyle = 'rgba(255,248,230,.9)'; x.strokeText(zn.name, a, b); x.fillStyle = '#3a2610'; x.fillText(zn.name, a, b);
      }
      mapDrawn = x.getImageData(0, 0, W, H);
      return { P };
    }
    let mapOpen = false, mapP = null;
    function toggleMap() {
      mapOpen = !mapOpen;
      $('.lwq-map').style.display = mapOpen ? 'flex' : 'none';
      if (!mapOpen) return;
      try { document.exitPointerLock(); } catch (e) { /* not locked */ }
      $('.lwq-map-t').textContent = 'The world — you are at ' + whereText() + ' — M to close';
      if (!mapDrawn) mapP = drawMap().P;
      mapTick(true);
    }
    if (TR) on($('.lwq-map'), 'click', () => { if (mapOpen) toggleMap(); });
    function mapTick(force) {
      if (!mapOpen || !mapDrawn) return;
      const cv = $('.lwq-map canvas'), x = cv.getContext('2d');
      x.putImageData(mapDrawn, 0, 0);
      const [a, b] = mapP(me.x, me.z);
      x.save(); x.translate(a, b); x.rotate(-me.yaw);
      x.fillStyle = '#d02010'; x.strokeStyle = '#fff'; x.lineWidth = 2;
      x.beginPath(); x.moveTo(0, -11); x.lineTo(7, 8); x.lineTo(0, 4); x.lineTo(-7, 8); x.closePath(); x.fill(); x.stroke(); x.restore();
    }
    function startTouch() {
      touchPlaying = keep.touch = true;
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
        else if (k === 'map' && on) toggleMap();
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
      on(G, 'orientationchange', () => setTimeout(resize, 200));
    }
    on(document, 'mousemove', e => {
      if (!locked()) return;
      me.yaw -= e.movementX * 0.0022;
      me.pitch = Math.max(-1.5, Math.min(1.5, me.pitch - e.movementY * 0.0022));
    });
    const onKey = down => e => {
      keys[e.code] = down;
      if (down && e.code === 'KeyE') useAim();
      if (down && e.code === 'KeyF' && !e.repeat) attack();
      if (down && !e.repeat && /^Digit[1-6]$/.test(e.code)) { const k = +e.code.slice(5); if (k === 1) attack(); else ability(k - 2); }
      if (down && (e.code === 'KeyI' || e.code === 'Tab') && !e.repeat && menu) { e.preventDefault(); toggleMenu(); }
      if (down && e.code === 'F3') { showFps = !showFps; drawNet(); e.preventDefault(); }
      if (down && e.code === 'KeyM' && !e.repeat) { if (TR) toggleMap(); else if (sound) muteSound(); }
      if (down && e.code === 'KeyP' && !e.repeat && TR) log('You are at ' + whereText() + (zoneNow ? ', ' + zoneNow : '') + '.');
      if (down && e.code === 'Space') e.preventDefault();
    };
    on(document, 'keydown', onKey(true));
    on(document, 'keyup', onKey(false));
    /* through a portal you are still playing: no "click to play" (the mouse is still captured, the thumbs still down) */
    if (locked()) $('.lwq-start').style.display = 'none';
    else if (keep.touch) { if (TOUCH) startTouch(); else touchPlaying = true; }

    function hits(x, y, z) {
      const a = [x - HALF, y, z - HALF], b = [x + HALF, y + HEIGHT, z + HALF];
      for (const B of boxes) {
        if (!B.on()) continue;
        if (a[0] < B.max[0] && b[0] > B.min[0] && a[1] < B.max[1] && b[1] > B.min[1] && a[2] < B.max[2] && b[2] > B.min[2]) return B;
      }
      if (land) for (const B of land.solids(x, z)) {   /* the trunks of the land near here */
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
      if (!grid.size) return;
      if (realW) { const lim = realW.half - 1; me.x = Math.max(-lim, Math.min(lim, me.x)); me.z = Math.max(-lim, Math.min(lim, me.z)); }
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
    /* the ground to walk on: the real world's, or the level's hills (flat where the village is) */
    const groundAt = realW ? realW.groundAt : TR ? TR.walk : ctx.floor || ctx.height;   /* the ground and bridges; a ship is walked on its solid decks */
    const dry = { x: SPAWN[0], y: SPAWN[1], z: SPAWN[2] };
    /* under the level's water (its plane: pos, size); a dip in the hills elsewhere is only a dip */
    const wet = (x, z) => { if (TR) return true; const w = LV.water; if (!w) return false; const [wx, wz] = w.pos || [0, 0], h = (w.size || 360) / 2; return Math.abs(x - wx) <= h && Math.abs(z - wz) <= h; };
    function inShape(e, x, z) {
      if (e.rect) return x >= e.rect[0] && x <= e.rect[2] && z >= e.rect[1] && z <= e.rect[3];
      if (e.c) return Math.hypot(x - e.c[0], z - e.c[1]) <= e.r;
      const [ax, az] = e.a, [bx, bz] = e.b, vx = bx - ax, vz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
      return Math.hypot(x - ax - vx * t, z - az - vz * t) <= e.r;
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
      /* NATURAL BORDERS (tbuuol 2026-10-29: no invisible walls): too steep a slope is not climbed -- cliffs, mountains */
      if (TR && groundAt) {
        const run = Math.hypot(me.x - x0, me.z - z0), g1 = groundAt(me.x, me.z), g0 = groundAt(x0, z0);
        if (run > 1e-5 && g1 > me.y + 0.05 && (g1 - g0) / run > 1.0) { me.x = x0; me.z = z0; }
        const [ex0, ez0, ex1, ez1] = TR.EXT; me.x = Math.max(ex0 + 4, Math.min(ex1 - 4, me.x)); me.z = Math.max(ez0 + 4, Math.min(ez1 - 4, me.z));
      }
      me.vx = (me.x - x0) / dt; me.vz = (me.z - z0) / dt;   /* what was really walked (a wall stops it): sent to the others */
      const wasGround = me.ground;
      me.y += me.vy * dt; me.ground = false;
      if ((B = hits(me.x, me.y, me.z))) {
        if (me.vy <= 0) { me.y = B.max[1]; me.ground = true; } else me.y = B.min[1] - HEIGHT - 1e-4;
        me.vy = 0;
      }
      if (groundAt) {
        const g = groundAt(me.x, me.z);
        /* down a slope too, not in hops -- but not off a dock or a deck onto the sand just under it */
        if (me.y <= g || (wasGround && me.vy <= 0 && me.y - g < 0.45 && !hits(me.x, me.y - 0.06, me.z))) { me.y = Math.max(me.y, g); me.vy = 0; me.ground = true; }
      }
      /* no swimming: deep water stops you at its edge (from a bank above it too); a dock or a deck under you is not water */
      if (groundAt && wet(me.x, me.z)) { const g = groundAt(me.x, me.z); if (g < -1.1 && g < me.y - 0.05 && !hits(me.x, me.y - 0.06, me.z)) { me.x = x0; me.z = z0; } }
      if (LV.env && LV.env.terrain === 'ship' && me.y < -1.5) { me.x = prev.x = SPAWN[0]; me.y = prev.y = SPAWN[1] + 0.5; me.z = prev.z = SPAWN[2]; me.vy = 0; log('Overboard! The crew hauls you back on deck.'); }
      /* OVERBOARD in the world (off the ship's rail): back where you last stood dry */
      if (me.ground && me.y > -0.2) { dry.x = me.x; dry.y = me.y; dry.z = me.z; }
      else if (wet(me.x, me.z) && me.y < -1.2) {
        me.x = prev.x = dry.x; me.y = prev.y = dry.y + 0.3; me.z = prev.z = dry.z; me.vy = 0;
        if (performance.now() - (dry.said || -1e9) > 10000) { dry.said = performance.now(); log('Overboard! You climb back out, soaked.'); }
      }
      if (!realW && LV.env && !TR) {   /* the edge of the world: the far side of the forest, before the mountains */
        if (Array.isArray(LV.edge)) {   /* the world: inside one of its shapes ({c, r} circles, {a, b, r} paths) */
          if (!LV.edge.some(e => inShape(e, me.x, me.z))) { me.x = x0; me.z = z0; }
        } else {
          const r = Math.hypot(me.x, me.z), most = LV.edge || 100;
          if (r > most) { me.x *= most / r; me.z *= most / r; }
        }
      }
      if (me.y < (realW ? -100 : -20)) { me.x = prev.x = SPAWN[0]; me.y = prev.y = SPAWN[1] + 1; me.z = prev.z = SPAWN[2]; me.vy = 0; log('You fell out of the world.'); }
    }
    function move(dt) {
      if (!live()) { acc = 0; for (const k in keys) keys[k] = false; }   /* not directly with the house: frozen */
      else acc += Math.min(dt, 0.25);                     /* after a long stall (a hidden tab) do not run seconds of physics at once */
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
      if (model === 'fist') {   /* our own figure's big round hand and its sleeve (Etappe 2) */
        add(new THREE.SphereGeometry(0.06, 10, 8), M({ color: '#e0b18c', roughness: 0.85 })).scale.set(1, 0.9, 1.2);
        const sl = add(new THREE.CapsuleGeometry(0.048, 0.16, 3, 8), M({ color: '#3e6fa8', roughness: 0.9 }), 0, -0.01, 0.15); sl.rotation.x = Math.PI / 2;
      }
      else if (model === 'sword') { add(new THREE.BoxGeometry(0.045, 0.6, 0.012), steel, 0, 0.38); add(new THREE.ConeGeometry(0.032, 0.08, 4), steel, 0, 0.72);
        add(new THREE.BoxGeometry(0.2, 0.035, 0.045), brass, 0, 0.07); add(new THREE.CylinderGeometry(0.02, 0.022, 0.15, 8), wood, 0, -0.02); }
      else if (model === 'axe') { add(new THREE.CylinderGeometry(0.022, 0.025, 0.62, 8), wood, 0, 0.2); add(new THREE.BoxGeometry(0.16, 0.14, 0.02), steel, 0.07, 0.44); }
      else if (model === 'mace') { add(new THREE.CylinderGeometry(0.022, 0.025, 0.5, 8), wood, 0, 0.15); add(new THREE.SphereGeometry(0.07, 10, 8), M({ color: '#5a5a5a', metalness: 0.6 }), 0, 0.42); }
      else if (model === 'shield') { const sh = add(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 16), M({ color: look || '#8a6238' })); sh.rotation.x = Math.PI / 2; add(new THREE.SphereGeometry(0.05, 8, 6), brass, 0, 0, 0.03); }
      g.userData.kind = model;   /* an avatar straps a shield to the forearm and grips everything else */
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
    let placed = false;
    function myRecord(r) {
      /* WHERE YOU LEFT OFF (tbuuol 2026-10-29): the house keeps where you were; the first record after joining puts you
         there -- unless that is deep water or out of the world, then at the nearest place that takes the fallen in */
      if (!placed && TR && Array.isArray(r.pos) && r.pos.length >= 3) {
        placed = true;
        const [x, y, z, yaw] = r.pos.map(Number), [ex0, ez0, ex1, ez1] = TR.EXT;
        if (isFinite(x) && isFinite(z) && x > ex0 && x < ex1 && z > ez0 && z < ez1 && TR.height(x, z) > TR.SEA - 0.3) {
          me.x = prev.x = x; me.z = prev.z = z; me.y = prev.y = Math.max(isFinite(y) ? y : 0, TR.walk(x, z)) + 0.2; me.vy = 0;
          if (isFinite(yaw)) me.yaw = yaw;
          dry.x = me.x; dry.y = me.y; dry.z = me.z;
        }
      }
      placed = true;
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
    function blowFor(from, unit, mul) {
      const a = addrOf(from);
      if (iAmHouse && book && a && ready(a)) {
        const inf = fight && unit ? fight.info(unit) : null, beast = inf && inf.kind === 'beast';   /* a beast's own level and hide */
        const res = book.strike(a, beast ? inf.def : raiderDef, beast ? inf.lvl : raiderLvl, null, mul);
        dirty.add(a);
        for (const u of res.up) notice(from.id, u + '!');
        if (res.miss) toPlayer(['M', from.id, unit]);   /* the striker sees "miss" over the raider */
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
      sendIntent(msg);
      fight.predict(id, 0);
    }
    /* THE ABILITY BAR (Etappe 3): keys 1-6 (1 is the plain strike). What a slot holds comes from the weapon, the shield
       and the professions (rpg.abilities); the house checks it all again -- reach, cooldown, what is needed -- and does it. */
    const abilCd = {}, abilSaid = {};
    function abilityList() { return rpg && rec ? rpg.abilities(rec) : []; }
    function ability(i) {
      if (!fight || !P || P.dead || !playing() || (menu && menu.isOpen())) return;
      const ab = abilityList()[i];
      if (!ab) return;
      const now = performance.now();
      if (!ab.ok) { if (now - (abilSaid[ab.key] || 0) > 3000) { abilSaid[ab.key] = now; log(ab.name + ': ' + ab.why + '.'); } return; }
      if ((abilCd[ab.key] || 0) > now) return;
      if (!room || !houseId() || iAmHouse) { log(ab.name + ' needs the house: it decides what an ability does.'); return; }
      const msg = { A: ab.key, n: ++blowNo };
      if (ab.key === 'cleave') { msg.u = fight.pickAll(me.x, me.z, me.yaw, ab.range, ab.most); if (!msg.u.length) { log('No foe in reach.'); return; } }
      else if (ab.mul) { const id = fight.pick(me.x, me.z, me.yaw, ab.range); if (!id) { log('No foe in reach.'); return; } msg.u = [id]; }
      else if (ab.key === 'salve') {   /* the player in front of you, else yourself */
        const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw); let best = null, bd = ab.range;
        for (const [id, r] of remotes) {
          if (r.house || !r.g.visible) continue;
          const dx = r.g.position.x - me.x, dz = r.g.position.z - me.z, dd = Math.hypot(dx, dz);
          if (dd < bd && (dx * fx + dz * fz) / Math.max(dd, 0.01) > 0.6) { best = id; bd = dd; }
        }
        msg.p = best || myId();
      }
      abilCd[ab.key] = now + ab.cd * 1000;
      if (ab.mul) { swingT = 1; if (sound) sound.blip('hit'); for (const id of msg.u) { fight.predict(id, 0); if (ab.stun) fight.say(id, 'stun'); } }
      else if (sound) sound.blip('pickup');
      sendIntent(msg);
      drawAbilities(true);
    }
    /* the house does an ability: checked again, then dealt out */
    const houseCd = new Map();
    function houseAbility(from, d) {
      const a = addrOf(from); if (!a || !ready(a)) return;
      const ab = rpg.abilities(book.of(a)).find(x => x.key === String(d.A));
      if (!ab) return;
      if (!ab.ok) { notice(from.id, ab.name + ': ' + ab.why + '.'); return; }
      const now = performance.now(), cds = houseCd.get(a) || {};
      if ((cds[ab.key] || 0) > now + 400) return;   /* too soon (a little slack for the trip) */
      cds[ab.key] = now + ab.cd * 1000; houseCd.set(a, cds);
      const r = remotes.get(from.id), pos = r ? [r.g.position.x, r.g.position.z] : null;
      const near = id => { const q = fight.posOf(id); return !!(q && pos && Math.hypot(q[0] - pos[0], q[1] - pos[1]) <= (ab.range || 3) + 2.5); };
      if (ab.mul) {
        for (const id of (Array.isArray(d.u) ? d.u : []).slice(0, ab.most || 1).map(String)) {
          if (!near(id)) continue;
          route(fight.damage(id, blowFor(from, id, ab.mul), from.id));
          if (ab.stun) fight.stun(id, ab.stun);
        }
      } else if (ab.key === 'taunt' && pos) {
        const n = fight.taunt(pos[0], pos[1], ab.radius, from.id);
        notice(from.id, n ? 'Taunt: ' + n + (n > 1 ? ' foes come' : ' foe comes') + ' for you.' : 'Taunt: nobody near enough.');
      } else if (ab.key === 'salve') {
        const to = String(d.p || from.id), tr = to === from.id ? r : remotes.get(to);
        if (!tr || !pos || Math.hypot(tr.g.position.x - pos[0], tr.g.position.z - pos[1]) > ab.range + 2.5) { notice(from.id, 'Herbal Salve: too far away.'); return; }
        const res = book.salve(a);
        if (!res.ok) { notice(from.id, 'Herbal Salve: ' + res.why + '.'); return; }
        route([{ t: 'heal', to, d: res.heal }]);
        notice(from.id, 'Herbal Salve: +' + res.heal + (to !== from.id ? ' for ' + nameOf(to) : '') + '.');
        if (to !== from.id) notice(to, nameOf(from.id) + ' heals you: +' + res.heal + '.');
        for (const u of res.up) notice(from.id, u + '!');
      }
      dirty.add(a);
    }
    /* the bar: six slots over the health bar, each greyed when it cannot be used, its cooldown running down */
    let abilKey = '', abilAt = 0;
    function drawAbilities(force) {
      const bar = $('.lwq-abil'); if (!bar) return;
      const now = performance.now();
      if (!force && now - abilAt < 100) return;
      abilAt = now;
      const list = abilityList(), key = list.map(a => a.key + a.ok).join();
      if (key !== abilKey) {
        abilKey = key;
        bar.innerHTML = '<button data-ab="-1" title="Strike (1)"><b>⚔</b><small>1</small><i></i></button>' +
          list.map((a, i) => '<button data-ab="' + i + '" class="' + (a.ok ? '' : 'off') + '" title="' + esc(a.name + ' (' + (i + 2) + '): ' + a.text + (a.ok ? '' : ' ' + a.why)) + '">' +
            '<b>' + a.icon + '</b><small>' + (i + 2) + '</small><i></i></button>').join('');
      }
      const btns = bar.querySelectorAll('button');
      list.forEach((a, i) => { const left = Math.max(0, (abilCd[a.key] || 0) - now) / (a.cd * 1000), b = btns[i + 1]; if (b) b.querySelector('i').style.height = (100 * left) + '%'; });
      if (btns[0]) btns[0].querySelector('i').style.height = (100 * Math.max(0, atkReady - now) / ((P && P.cd) || 0.6) / 1000) + '%';
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
      sendIntent(msg);
    }
    const charges = {}, growAt = {};
    /* where a player is, as they last said (not where the house draws them, a little behind: after a quick move that was
       metres away, and gathering was refused without a word -- tbuuol 2026-10-29) */
    const whereIs = r => r && r.last && Array.isArray(r.last.p) ? [+r.last.p[0], +r.last.p[2]] : r ? [r.g.position.x, r.g.position.z] : null;
    function houseGather(from, id) {
      const res = resources[id], a = addrOf(from), r = remotes.get(from.id);
      if (!res || !a || W.dep[id] || !ready(a)) return;
      const at = whereIs(r);
      if (at && Math.hypot(at[0] - res.def.pos[0], at[1] - res.def.pos[1]) > 5) { notice(from.id, 'You are too far away to reach it.'); return; }   /* from afar: no */
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
            if (r && r.from.address && ready(r.from.address)) {
              const res = book.struck(r.from.address, d, e.lvl || raiderLvl);
              dirty.add(r.from.address);
              for (const u of res.up) notice(e.to, u + '!');
              if (res.dodged) { notice(e.to, 'You dodge the blow.'); continue; }
              d = res.d;
            }
          }
          if (e.to === myId()) hurt(d, e.from);
          else toPlayer(['D', e.to, d, e.from]);
        } else if (e.t === 'kill') {
          let text = 'You defeated ' + aName(e.name || 'raider') + '.';
          const r = remotes.get(e.by);
          if (iAmHouse && book && r && r.from.address && ready(r.from.address)) {
            const got = book.loot(r.from.address, null, e.species ? e.loot : null);
            if (got.length) text += ' Into your bag: ' + got.join(', ') + '.';
            if (e.species) {   /* the codex counts it */
              const k = book.kill(r.from.address, e.species), sp = LV.wild && LV.wild.species[e.species];
              if (k.rank) notice(e.by, 'Codex: ' + (sp ? sp.name : e.species) + ' rank ' + k.rank + '! Open the Codex in your book to choose a skill for the reward.');
              for (const line of book.questKill(r.from.address, e.species, LV.quests)) notice(e.by, line);
            }
            dirty.add(r.from.address);
          }
          notice(e.by, text);
        }
      }
    }
    function notice(to, text) { if (to === myId()) heardNotice(text); else toPlayer(['N', to, text]); }
    function heardNotice(text) { log(text); if (/bag|level/.test(text) && sound) sound.blip('pickup'); }
    /* ONLY DIRECT (tbuuol 2026-10-28): game data goes over the direct link between a player and the house, and nowhere
       else -- no solo, no player keeping the world, nothing through the room. The room is for joining, who is who and
       setting the link up. A player plays only while linked directly to the house (see gateTick); the house serves only
       players linked directly to it. What the house says to a player goes out together, {B: [n, items]}, a tenth of a
       second at a time. */
    const linked = id => !!(room && room.star && id && room.peers()[id] === 'direct');
    const directPlayers = () => Array.from(remotes.keys()).filter(id => !remotes.get(id).house && linked(id));
    function sendIntent(msg) {   /* a blow, a gathering, an ability, a question: to the house, surely */
      const h = houseId();
      if (room && !iAmHouse && linked(h)) room.to([h], msg, true);
    }
    const outQ = []; let outNo = 0, outAt = 0;
    function toPlayer(item) { if (room) outQ.push(item); }
    function flushOut(now) {
      if (!room || !outQ.length || now - outAt < 100) return;
      outAt = now;
      /* each player a packet of its own, with only its own lines */
      const by = new Map();
      for (const it of outQ.splice(0)) { const k = String(it[1]); if (!by.has(k)) by.set(k, []); by.get(k).push(it); }
      for (const [to, items] of by) if (linked(to)) room.to([to], { B: [++outNo, items] }, true);
    }
    const packetsSeen = [];
    function heardPacket(b) {
      if (packetsSeen.includes(b[0])) return;   /* the same packet by both ways */
      packetsSeen.push(b[0]); if (packetsSeen.length > 60) packetsSeen.shift();
      for (const it of Array.isArray(b[1]) ? b[1] : []) {
        if (!Array.isArray(it) || String(it[1]) !== myId()) continue;
        if (it[0] === 'N') heardNotice(String(it[2]));
        else if (it[0] === 'D') hurt(+it[2] || 0, String(it[3] || 'raider').slice(0, 30));
        else if (it[0] === 'M' && fight) fight.missed(String(it[2]));
      }
    }
    /* the house sends each player its record when it changed (at most every 1.5 s), over the direct link */
    /* THE HOUSE'S STORE (Etappe 4): with houseStore(true) the house no longer holds every record from the start. A
       player's record is asked for when the player is there (houseWants -> the keeper's database -> houseGive), what
       changed is handed back (houseTake), and a player who left is handed back and forgotten -- the house of another
       zone may have them next. Until a record has come, the player's blows, gatherings and questions wait. */
    let storeMode = false;
    const saveDirty = new Set(), storeGiven = new Set(), leaving = new Set();
    const ready = a => !storeMode || (book && book.has(a));
    const dirty = new (class extends Set { add(a) { saveDirty.add(a); return super.add(a); } })();
    let lastRecords = 0;
    function sendRecords(now) {
      if (!iAmHouse || !room || !book || !dirty.size || now - lastRecords < 1500) return;
      lastRecords = now;
      for (const a of Array.from(dirty)) {
        if (storeMode && !book.has(a)) { dirty.delete(a); continue; }
        let sent = false;
        for (const [id, r] of remotes) if (r.from.address === a && linked(id)) { sendBig({ R: book.of(a), to: id }, id); sent = true; }
        if (sent) dirty.delete(a);   /* a player not linked yet gets it once they are */
      }
    }
    function sendBig(obj, to) { if (linked(to)) room.to([to], obj, true); }   /* whole, in one, surely, to that player only */
    /* "a raider", "an old boar" */
    const aName = (name, cap) => { const n = String(name).toLowerCase(), a = /^[aeiou]/.test(n) ? 'an ' : 'a '; return (cap ? a[0].toUpperCase() + a.slice(1) : a) + n; };
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
        /* the world: you wake at the nearest place that takes the fallen in (LV.revives: {at, spawn, yaw, text}) */
        const rv = (LV.revives || []).reduce((b, r) => !b || Math.hypot(me.x - r.at[0], me.z - r.at[1]) < Math.hypot(me.x - b.at[0], me.z - b.at[1]) ? r : b, null);
        const back = rv ? rv.spawn : SPAWN;
        log((from ? aName(from, true) + ' strikes you down.' : 'You fall.') + ' ' + ((rv && rv.text) || LV.revive || 'Brother Anselm carries you back inside.'));
        setTimeout(() => {
          P.dead = false; P.hp = P.max;
          me.x = prev.x = back[0]; me.y = prev.y = back[1]; me.z = prev.z = back[2]; me.vy = 0; me.yaw = rv && rv.yaw != null ? rv.yaw : LV.spawnYaw || 0;
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
    let room = null, joinedAt = Date.now();
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
       the world. Its addresses come from the registry (inscribed by a publisher the page trusts), and an address in a
       room is stamped by the arcade node, so nobody can pass for it. Without it nobody plays (the world is offline).
       The house plays nobody: it draws nothing, is not drawn and is not counted. */
    const HOUSE = (() => { try { const r = G.LWQ.get('$registry'); return Array.isArray(r && r.house) ? r.house.map(String) : []; } catch (e) { return []; } })();
    const isHouse = p => !!(p && p.address && HOUSE.includes(p.address));
    let iAmHouse = false;
    function houseId() {
      if (iAmHouse) return myId();
      for (const [id, r] of remotes) if (isHouse(r.from)) return id;
      return null;
    }
    /* only the house keeps the world */
    const hostId = () => houseId();
    const amHost = () => iAmHouse;

    function intent(op, id) {
      if (amHost()) { hostApply(op, id, myId()); return; }
      if (live()) sendIntent({ I: op, o: id });
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
    /* the world on the wire: only open doors and taken things (the rest is closed / free); to every player linked
       directly, or to one (a newcomer) */
    function sendWorld(to) {
      if (!room || !iAmHouse) return;
      const open = {}, taken = {};
      for (const id in W.open) if (W.open[id]) open[id] = true;
      for (const id in W.taken) if (W.taken[id] != null) taken[id] = W.taken[id];
      const dep = {}; for (const id in W.dep) if (W.dep[id]) dep[id] = 1;
      const ids = to ? [to].filter(linked) : directPlayers();
      if (ids.length) room.to(ids, { W: { seq: W.seq, open, taken, dep } }, true);
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
    /* THE HOUSE KEEPS WHERE EVERYBODY IS: into each player's record, every 5 s (only into the database, not sent back) */
    let posSaved = 0;
    function savePos(r) {
      const a = r.from && r.from.address;
      if (!iAmHouse || !TR || !book || !a || !book.has(a) || !r.last || !Array.isArray(r.last.p)) return;
      const R1 = v => Math.round(v * 10) / 10, rec2 = book.of(a), np = [R1(+r.last.p[0]), R1(+r.last.p[1]), R1(+r.last.p[2]), R1(Array.isArray(r.last.r) ? +r.last.r[0] : 0)];
      if (!np.every(isFinite) || (rec2.pos && rec2.pos.join() === np.join())) return;
      rec2.pos = np; saveDirty.add(a);
    }
    function savePositions(now) {
      if (!iAmHouse || now - posSaved < 5000) return;
      posSaved = now;
      for (const r of remotes.values()) if (!r.house) savePos(r);
    }
    function dropRemote(id) {
      const r = remotes.get(id); if (!r) return;
      savePos(r);   /* where they were as they went */
      scene.remove(r.g); remotes.delete(id);
      if (storeMode && r.from.address) leaving.add(r.from.address);
      log(r.house ? 'The house has gone.' : label(r.from, r.name) + ' left.');
      drawNet();
    }
    /* THE STAR (arcade PR #36): each player links with the house only, the house with everybody (up to 60). Players
       hear each other through the house: it passes on to each player what the players within 80 m of them said, as
       soon as it changed. A player joins linked with nobody, and links with the house once it is there. */
    let starKey = '';
    function starTick() {
      if (!room || !room.star) return;
      const want = iAmHouse ? null : (houseId() ? [houseId()] : []), key = want ? want.join() || 'none' : 'all';
      if (key === starKey) return;
      starKey = key;
      room.link(want, iAmHouse ? { max: 60 } : undefined);
    }
    let relayAt = 0;
    function relay(now) {
      if (!iAmHouse || !room || !room.star || now - relayAt < 100) return;
      relayAt = now;
      for (const [to, r] of remotes) {
        if (r.house || !r.g.visible || !linked(to)) continue;
        const rows = []; r.sentFrom = r.sentFrom || {};
        for (const [id, o] of remotes) {
          if (id === to || o.house || !o.last || r.sentFrom[id] === o.lastN || !linked(id)) continue;
          if (Math.hypot(o.g.position.x - r.g.position.x, o.g.position.z - r.g.position.z) > 80) continue;
          r.sentFrom[id] = o.lastN; rows.push([id, o.last]);
        }
        if (rows.length) room.to([to], { F: rows }, false);
      }
    }
    function heard({ from, data }, passed) {
      /* game data only over a direct link: what comes through the room (the viewer's own way round for a pair that
         is not linked) is not believed; players the house passes on (F) came to it directly */
      if (!passed && !linked(from.id)) return;
      if (data instanceof ArrayBuffer) {   /* bytes: the fight's snapshot (type 1), from the house */
        const t = data.byteLength ? new Uint8Array(data)[0] : 0;
        if (t === 1 && fight && combat.decode && (from.id === hostId())) { const snap = combat.decode(data); if (snap) fight.apply(snap); }
        return;
      }
      const d = data && typeof data === 'object' ? data : {};
      if (Array.isArray(d.F) && from.id === hostId()) {   /* other players, passed on by the house */
        for (const row of d.F) {
          if (!Array.isArray(row) || String(row[0]) === myId()) continue;
          const id = String(row[0]), who = (room && room.members().find(x => x.id === id)) || (remotes.get(id) || {}).from || { id };
          heard({ from: who, data: row[1] }, true);
        }
        return;
      }
      const r = remote(from); r.heard = performance.now();
      if (iAmHouse && Array.isArray(d.p)) { r.last = d; r.lastN = (r.lastN || 0) + 1; }   /* what to pass on (the star) */
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
      /* the world only from the house */
      if (d.W && typeof d.W === 'object' && from.id === hostId() && +d.W.seq > W.seq) applyWorld(d.W);
      if (d.H && amHost()) sendWorld(from.id);
      /* the fight: the host's picture of it, a player's blow for the host, and what the host says happened to me */
      if (fight) {
        const fromHost = from.id === hostId();
        if (d.C && fromHost && !amHost()) fight.apply(d.C);
        if (d.X != null && amHost() && freshBlow(from.id, d.n)) route(fight.damage(String(d.X), blowFor(from, String(d.X)), from.id));
        if (d.D != null && String(d.D) === myId() && fromHost) hurt(+d.d || 0, String(d.f || 'raider').slice(0, 30));
        if (Array.isArray(d.M) && String(d.M[0]) === myId() && fromHost) fight.missed(String(d.M[1]));
      }
      /* what is mine: a notice and my record from the house; and, at the house, what a player asks of it */
      if (Array.isArray(d.B) && from.id === hostId()) heardPacket(d.B);
      if (d.R && typeof d.R === 'object' && String(d.to) === myId() && from.id === hostId() && rpg) myRecord(d.R);
      if (d.G != null && iAmHouse && book && freshBlow(from.id, d.n)) houseGather(from, String(d.G));
      if (d.A != null && iAmHouse && book && fight && freshBlow(from.id, d.n)) houseAbility(from, d);
      if (d.Q && iAmHouse && book && addrOf(from) && ready(addrOf(from))) {
        const a = addrOf(from);
        if (d.Q === 'equip') { const res = book.equip(a, +d.u); if (!res.ok) notice(from.id, 'Cannot wear that: ' + res.why + '.'); }
        else if (d.Q === 'unequip') book.unequip(a, String(d.s));
        else if (d.Q === 'quest') {
          const q = (LV.quests || []).find(x => x.id === String(d.q)), r = remotes.get(from.id), N = q && npcs[q.npc];
          if (!q) return;
          if (!r || !N || Math.hypot(whereIs(r)[0] - N.x, whereIs(r)[1] - N.z) > 6) notice(from.id, 'You are too far away to talk.');
          else if (d.x === 'take') { const res = book.questTake(a, q); notice(from.id, res.ok ? 'Quest accepted: ' + q.title + '.' : 'Quest: ' + res.why + '.'); }
          else { const res = book.questTurn(a, q); if (!res.ok) notice(from.id, 'Quest: ' + res.why + '.'); else { notice(from.id, 'Quest done: ' + q.title + '! You get ' + res.got.join(', ') + '.'); for (const u of res.up) notice(from.id, u + '!'); } }
        }
        else if (d.Q === 'codex') {
          const sp = LV.wild && LV.wild.species[String(d.sp)], res = book.claim(a, String(d.sp), String(d.k), sp ? sp.codex : []);
          if (!res.ok) notice(from.id, 'Codex: ' + res.why + '.');
          else { notice(from.id, 'Codex reward: +' + res.pts + ' ' + ((rpg.SKILLS[d.k] || {}).name || rpg.ATTRS[d.k]) + '.'); for (const u of res.up) notice(from.id, u + '!'); }
        }
        else if (d.Q === 'craft') {
          const r = remotes.get(from.id);
          if (r && !nearForge(whereIs(r)[0], whereIs(r)[1])) notice(from.id, 'You are not at the forge.');
          else {
            const res = book.craft(a, String(d.r));
            if (!res.ok) notice(from.id, 'Cannot make that: ' + res.why + '.');
            else {
              notice(from.id, 'You made: ' + res.made + '. It is in your bag.');
              for (const line of book.questMade(a, String(d.r), LV.quests)) notice(from.id, line);
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
    /* --- the gate: in only while linked directly with the house ------------------------------------------- */
    let entered = false, lostAt = 0, kicked = false, gateSince = performance.now(), gateNow = '';
    const live = () => iAmHouse || (entered && !lostAt && !kicked);
    function gateSay(text, sub, button, soft) {
      const g = $('.lwq-gate'), b = $('.lwq-gate-b');
      g.style.display = 'flex'; g.classList.toggle('soft', !!soft);
      if (gateNow !== text) { gateNow = text; $('.lwq-gate-t').textContent = text; }
      $('.lwq-gate-s').textContent = sub || '';
      b.style.display = button ? '' : 'none'; if (button) b.textContent = button;
    }
    function gateOff() { $('.lwq-gate').style.display = 'none'; gateNow = ''; }
    on($('.lwq-gate-b'), 'click', () => keep.travel(LEVEL));   /* join again: this zone, from the start, in this page */
    function kick(text, sub) {
      if (kicked) return;
      kicked = true; entered = false;
      try { document.exitPointerLock(); } catch (e) { /* not locked */ }
      if (room) { try { room.leave(); } catch (e) { /* gone */ } room = null; }
      for (const id of Array.from(remotes.keys())) dropRemote(id);
      gateSay(text, sub || '', 'Join again');
      drawNet();
    }
    function gateTick(now) {
      if (iAmHouse || kicked) return;
      const h = room ? houseId() : null;
      if (!entered) {
        if (!room) return;   /* still joining (gateSay says so) */
        if (!room.star) { kick('This arcade cannot link players directly yet.', 'It needs the arcade update of 2026-10-28 (the fast lane as a star). Open the game on an arcade that has it.'); return; }
        const waited = now - gateSince;
        if (!h) { gateSay(waited > 8000 ? 'The world is offline' : 'Looking for the world…', waited > 8000 ? 'Its house is not here right now. Waiting for it…' : ''); return; }
        if (!linked(h)) {
          gateSay('Linking directly with the world…', waited > 45000 ? 'No direct link yet. Some networks do not let browsers link directly (WebRTC); it keeps trying.' : '',
            waited > 45000 ? 'Try again' : null);
          return;
        }
        if (rpg && room.me.address && !rec) { gateSay('Loading your character…'); return; }
        entered = true; gateOff();
        sendIntent({ H: 1 }); sendState(true);
        log('Linked directly with the world.');
        drawNet();
        return;
      }
      if (h && linked(h)) { if (lostAt) { lostAt = 0; gateOff(); } return; }
      if (!lostAt) { lostAt = now; gateSay('The connection to the world is gone…', '', null, true); }
      else if (now - lostAt > 2000) kick('You lost the direct connection to the world.', 'You play only while linked directly with its house, so you were taken out.');
    }
    async function connect() {
      gateSay('Connecting to the arcade…');
      const res = await net.join(ROOM, { game: GAME, fast: true, link: [] });   /* linked with nobody until the house is known */
      if (stopped) { if (res.online) res.room.leave(); return; }
      if (!res.online) { kick('No connection to the arcade.', String(res.why || 'offline')); return; }
      room = res.room; joinedAt = Date.now(); gateSince = performance.now();
      becomeId(room.me.id);
      iAmHouse = isHouse(room.me);
      if (iAmHouse) {   /* the machine that keeps the world: it runs the world and the fight, and draws nothing */
        drawing = false; renderer.setPixelRatio(0.25); gateOff();
        if (fight && fight.quiet) fight.quiet(true);
        log('This is the house: it keeps the world.');
      }
      room.on('message', heard);
      room.on('join', ({ from }) => { remote(from); log(isHouse(from) ? 'The house is here.' : label(from, '') + ' joined.'); drawNet(); });
      room.on('leave', ({ from }) => dropRemote(from.id));
      room.on('peer', () => drawNet());
      room.on('closed', why => { if (iAmHouse) { log('Disconnected: ' + (why || 'the room closed') + '.'); room = null; drawNet(); } else kick('The arcade closed the connection.', String(why || '')); });
      room.on('reconnecting', () => drawNet());
      room.on('rejoined', ({ me: m }) => { if (m) becomeId(m.id); drawNet(); });
      for (const p of room.members()) if (p.id !== room.me.id) remote(p);
      if (room.me.tag) me.name = '@' + room.me.tag;
      starTick();
      drawNet();
    }
    let lastState = 0, lastKey = '', lastName = 0, handsSent = '';
    function sendState(force) {   /* where I am, 15 times a second, to the house only (it passes it on to who is near) */
      if (!room || iAmHouse || !entered) return;
      const h = houseId();
      if (!linked(h)) return;
      const now = performance.now(), every = 66;
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
      room.to([h], m, false);
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
      /* one way only: linked directly with the house, or not playing */
      const mode = !room ? '' : iAmHouse ? 'the house' : linked(houseId()) ? 'direct' : 'not direct';
      $('.lwq-tr').innerHTML = room ? 'Online · ' + n + ' player' + (n === 1 ? '' : 's') + ' · ' + esc(mode) +
        (iAmHouse ? '<br><small>the house: keeping this world</small>' : '') : 'Offline';
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
        who = await wallet.who(); drawWho();
      } else {
        sh.glow.material.color.set('#777');
        log(res.status === 'denied' ? 'You refused the offering.' : 'The offering did not go through: ' + (res.error || res.status) + '.');
      }
      drawInv();
    }

    /* --- the loop ------------------------------------------------------------------------------------ */
    let stepAcc = 0, drawing = !keep.noDraw, mapT = 0;
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
    let fightSent = 0, fightFull = 0;
    function fightTick(dt, now) {
      const host = amHost(), players = [];
      if (host) {
        if (!iAmHouse) players.push({ id: myId(), x: me.x, z: me.z, hp: P.hp, max: P.max, dead: P.dead });
        for (const [id, r] of remotes) if (r.g.visible && linked(id)) players.push({ id, x: r.g.position.x, z: r.g.position.z, hp: r.hp ? r.hp[0] : 100, max: r.hp ? r.hp[1] : 100, dead: r.hp ? r.hp[2] : false });
      }
      /* the fight runs on real time in small steps: a house on a busy machine may get few frames, and one big step
         made raiders and guards jump (tbuuol 2026-10-23, as a client: "they stutter") */
      let rest = dt;
      do { const st = Math.min(rest, 0.1); route(fight.update(st, host, players)); rest -= st; } while (rest > 1e-6);
      if (host && room) {
        /* how the fight stands, 10 a second, to the players linked directly: only what changed (a whole picture once a
           second), only the beasts near somebody, as bytes */
        const near = players.map(q => [q.x, q.z]), ids = directPlayers();
        if (ids.length && now - fightSent > 100) {
          const full = now - fightFull > 1000; if (full) fightFull = now;
          fightSent = now;
          const snap = fight.snapshot({ near, delta: !full });
          room.to(ids, combat.encode ? combat.encode(snap) : { C: snap }, false);
        }
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
      sendRecords(now); flushOut(now);
    }
    let askedRec = -1e9;
    let last = performance.now(), worldT = 0, netT = 0, fps = 0, fpsN = 0, fpsT = performance.now(), showFps = false, promptNow = '';
    let frameMs = 0;
    function frame(now) {
      if (stopped) return;
      const t0 = performance.now();
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
      if (!iAmHouse) for (const fn of updates) fn(fdt, t);   /* flames, smoke, water: nothing the house needs */
      npcTick(fdt, t);
      if (!iAmHouse) { gateTick(now); if (live()) portalTick(); zoneTick(); drawAbilities(); compassTick(); posTick(); if (mapOpen && now - (mapT || 0) > 200) { mapT = now; mapTick(); } }
      if (env && !iAmHouse) env.update(fdt, t, camera.position);
      if (land && !iAmHouse) land.update(camera.position);
      /* things to gather out in the land are drawn near you only: there are a hundred and more, each a few meshes */
      if (TR && !iAmHouse && (resFrame = (resFrame + 1) % 30) === 0) for (const id in resources) { const r = resources[id]; if (r.look.group) r.look.group.visible = Math.hypot(r.def.pos[0] - camera.position.x, r.def.pos[1] - camera.position.z) < RES_NEAR; }
      if (sound && !iAmHouse) {
        sound.listen(camera);
        const sp = Math.hypot(me.vx || 0, me.vz || 0);
        if (me.ground && sp > 0.5) { stepAcc += sp * fdt; if (stepAcc > (sp > 5 ? 1.4 : 0.95)) { stepAcc = 0; sound.step(sp); } } else stepAcc = 0.6;
      }
      for (const id in pickups) pickups[id].mesh.rotation.y += dt * 1.5;
      if (fight) fightTick(iAmHouse ? Math.min(dt, 1) : fdt, now);
      sendState(false);
      relay(now);
      drawRemotes();
      if (amHost()) { growBack(now); savePositions(now); }
      if (room && amHost() && now - worldT > 3000) { worldT = now; if (now - lastWorldSent > 2500) sendWorld(); }
      if (now - netT > 1000) {
        netT = now; drawNet(); starTick();
        /* no record yet and the house is here: ask it for mine */
        if (rpg && room && !iAmHouse && !rec && linked(houseId()) && now - askedRec > 5000) { askedRec = now; sendIntent({ Q: 'me' }); }
      }
      const pr = playing() && !iAmHouse ? promptFor(aimed()) || (fight && !TOUCH && fight.pick(me.x, me.z, me.yaw, P.range) ? 'F / click: strike' : '') : '';
      if (pr !== promptNow) { promptNow = pr; $('.lwq-prompt').textContent = pr; }   /* only when it changes: a DOM write is not free */
      if (drawing) { if (post) post.render(t); else renderer.render(scene, camera); }
      frameMs += (performance.now() - t0 - frameMs) * 0.05;
      /* THE HOUSE'S TICK: 20 a second on a clock of its own, not the screen's (a headless browser's frames come
         unevenly, and a house that draws nothing has no use for 60) */
      if (iAmHouse) setTimeout(() => frame(performance.now()), 50); else G.requestAnimationFrame(frame);
    }
    resize(); drawInv(); drawNet(); drawWho(); drawStats();
    try { renderer.compile(scene, camera); } catch (e) { /* only a head start */ }
    walletUp().catch(e => log('Wallet: ' + (e && e.message || e)));
    connect().catch(e => log('Multiplayer: ' + (e && e.message || e)));
    G.requestAnimationFrame(frame);
    return {
      /* through a portal (keepPicture): this zone goes, the canvas and the sound stay for the next */
      stop(keepPicture) {
        stopped = true;
        if (room) { try { room.leave(); } catch (e) { /* gone already */ } room = null; }
        for (const off of offs.splice(0)) off();
        for (const c of Array.from(el.children)) if (!before.has(c) && c !== renderer.domElement) c.remove();
        if (sound && sound.clearFires) sound.clearFires();
        if (post && post.dispose) post.dispose();
        /* the zone's meshes off the graphics card (what the art module shares comes back by itself when used again) */
        scene.traverse(o => {
          if (o.geometry) o.geometry.dispose();
          for (const m of [].concat(o.material || [])) { for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose(); m.dispose(); }
        });
        for (const t of [scene.background, scene.environment]) if (t && t.isTexture) t.dispose();
        if (!keepPicture) { renderer.dispose(); renderer.domElement.remove(); keep.renderer = null; }
      },
      /* for tests and tools: stand somewhere, look somewhere, press E without a captured mouse */
      goto(x, y, z) { me.x = prev.x = +x; me.y = prev.y = +y; me.z = prev.z = +z; me.vy = 0; },
      look(yaw, pitch) { me.yaw = +yaw; me.pitch = +(pitch || 0); },
      use() { camera.position.set(me.x, me.y + EYE, me.z); camera.rotation.set(me.pitch, me.yaw, 0); camera.updateMatrixWorld(); useAim(true); },
      aimed() { camera.updateMatrixWorld(); return aimed(); },
      log: () => logLines.slice(),
      camZ: () => camera.position.z,
      draw(on) { drawing = !!on; keep.noDraw = !on; },   /* tests: everything runs, nothing is drawn (a machine without a GPU keeps up) */
      play() { if (TOUCH) startTouch(); else touchPlaying = keep.touch = true; },   /* tests: as if the view had been clicked */
      strike() { attack(); },
      netPeers() { return room ? room.peers() : null; },
      resourcesAt: () => Object.keys(resources).map(id => [id, resources[id].def.pos[0], resources[id].def.pos[1], !!W.dep[id]]),
      bridges: () => TR ? TR.bridges.map(b => ({ a: b.a.map(Math.round), b: b.b.map(Math.round), ya: Math.round(b.ya * 10) / 10, yb: Math.round(b.yb * 10) / 10 })) : [],
      landReady: () => !land || land.ready(), landCount: () => land ? land.count() : 0,
      sceneStats() {   /* tests: what is drawn, by kind of thing */
        const out = {}; scene.traverse(o => { if (!o.isMesh || !o.visible) return; let p = o, tag = 'top'; while (p.parent && p.parent !== scene) p = p.parent; tag = p === o ? (o.isInstancedMesh ? 'inst-top' : 'mesh-top') : (p.type + ':' + (p.userData && p.userData.kind || p.name || p.children.length)); out[tag] = (out[tag] || 0) + 1; });
        return out;
      }, landBuildMs: () => land ? land.buildMs() : 0,
      netStats(reset) { if (!room || !room.stats) return null; const st = room.stats(); if (reset) room.resetStats(); return st; },
      ability(i) { ability(i); },
      npcs() { return Object.keys(npcs).map(id => ({ id, x: R2(npcs[id].x), z: R2(npcs[id].z) })); },
      fight: () => fight ? fight.units() : [],
      /* the house's book of players, for tools/house.py to keep on disk: out as JSON, and back in after a start */
      houseDump: () => book ? JSON.stringify(book.dump()) : '{}',
      houseStore(on) { storeMode = !!on; return storeMode; },
      /* the records the house waits for: players here whose record has not come */
      houseWants() {
        const out = new Set();
        for (const [, r] of remotes) { const a = r.from.address; if (a && !r.house && book && !book.has(a) && !storeGiven.has(a)) out.add(a); }
        return Array.from(out);
      },
      /* records from the database ({address: record | null}); null, or one of an old kind: a new player */
      houseGive(json) {
        const all = typeof json === 'string' ? JSON.parse(json) : json;
        for (const a in all) {
          storeGiven.add(a);
          if (!all[a] || !book.load({ [a]: all[a] })) book.of(a);
          dirty.add(a);
        }
        return Object.keys(all).length;
      },
      /* what changed since the last time, and the players who left (handed back, then forgotten) */
      houseTake() { return JSON.stringify(JSON.parse(this.houseTake2()).rec); },
      /* the same, and who was handed back for good: another zone's house may have their record now */
      houseTake2() {
        const out = {}, gone = [];
        for (const a of saveDirty) if (book && book.has(a)) out[a] = book.of(a);
        saveDirty.clear();
        for (const a of leaving) {
          if (Array.from(remotes.values()).some(r => r.from.address === a)) continue;   /* back already */
          if (book && book.has(a)) { out[a] = book.of(a); book.forget(a); }
          storeGiven.delete(a); gone.push(a);
        }
        leaving.clear();
        return JSON.stringify({ rec: out, gone });
      },
      houseLoad: json => { const n = book ? book.load(json) : 0; for (const [, r] of remotes) if (r.from.address) dirty.add(r.from.address); return n; },
      record: () => rec,
      menu: on => { if (menu) { if (on === false) menu.close(); else { menu.open(); } } },
      player: () => P ? Object.assign({}, P) : null,
      stats: () => ({ fps, frameMs: Math.round(frameMs * 100) / 100, pixelRatio: pr, frozen, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }),
      get state() { return { gate: iAmHouse ? '' : kicked ? 'kicked: ' + gateNow : entered ? (lostAt ? 'lost' : '') : gateNow, live: live(), me: Object.assign({}, me), world: W, host: amHost(), house: iAmHouse ? 'me' : houseId() ? 'there' : null, players: Array.from(remotes.values()).filter(r => !r.house).length + (iAmHouse ? 0 : 1), online: !!room,
                       others: Array.from(remotes.values()).map(r => ({ id: r.from.id, tag: r.from.tag, j: r.j, visible: r.g.visible, x: R2(r.g.position.x), y: R2(r.g.position.y), z: R2(r.g.position.z) })), fast: !!(room && room.fast), who, progress }; }
    };
  }

  if (G.LWQ && G.LWQ.define) G.LWQ.define('engine', { api: 1, v: 28, needs: { three: 160, net: 1, wallet: 1, art: 1, sound: 1, combat: 1, rpg: 1, menu: 1, terrain: 1, levels: 1 } },
    D => ({ start: (el, opts) => start(D, el, opts) }));
})(typeof globalThis !== 'undefined' ? globalThis : this);
