/* LiteWorldsQuest combat module: player stats, and the fight at the gate -- guards, a priest, raiders.
     combat.player(saved)            -> {level, xp, hp, max, dmg, cd, range, next}   a player's numbers ({level, xp} saved)
     combat.gain(p, xp)              -> levels gained (p is changed: xp, level, max, dmg, hp)
     const f = combat.create({THREE, art, ctx, def})   the level's "defense" block:
        {guards: [{id, name, pos, face, look}], priest: {id, name, pos, look},
         spawns: {points: [[x, z]], every, max, first}, raider: {name, look}}
     f.update(dt, host, players) -> events      players: [{id, x, z, hp, max, dead}]; only the host simulates, the others
                                                draw what the host last sent; events (host only):
                                                {t: 'hit'|'heal', to: playerId, d}  and  {t: 'kill', by: playerId, xp}
     f.damage(unitId, d, byPlayer) -> events    a player's blow (host only)
     f.missed(unitId)                           the house says my blow missed: "miss" over that raider
     f.info(unitId) -> {kind, lvl, def, species}  a beast's level and defence (for what a blow teaches)
   o.wild: the level's Greenwood {species, areas, respawn}; o.height(x, z): the ground under a unit
     f.pick(x, z, yaw, range) -> unitId|null    what a swing from here would hit
     f.snapshot() / f.apply(snap)               the fight on the wire (host -> everyone), well inside 500 bytes
     f.units()                                  for tests and the HUD: [{id, kind, name, x, z, hp, max, state}]
   THE HOST decides everything (as with the shared world): raiders, their blows, the guards, the priest. A player's own
   swing is an intent ({X: unit, d}) the host applies. Guards do not die: at 0 they go down, and the priest has them up
   again a few seconds later -- the guards always win, which is the point of the scene. */
(function (G) {
  'use strict';
  const KIND = ['guard', 'priest', 'raider', 'beast'];
  /* THE BEASTS OF THE GREENWOOD (Etappe 3), like Entropia's creatures: one kind comes in maturities, the same beast,
     only stronger. [name, hit points, damage, size, levels above the kind's] */
  const MAT = [['Young', 0.7, 0.75, 0.85, -1], ['Mature', 1, 1, 1, 0], ['Old', 1.35, 1.2, 1.12, 1], ['Elder', 1.8, 1.45, 1.25, 2]];
  const MAT_ODDS = [0.4, 0.35, 0.18, 0.07];
  const STATE = ['idle', 'walk', 'attack', 'down', 'dead'];
  /* what each kind can do: hit points, damage, reach, seconds between blows, speed (m/s) */
  const BASE = {
    guard: { max: 140, dmg: 15, range: 1.7, cd: 1.0, speed: 3.2, guard: 8 },   /* 15-18 a blow (tbuuol: more damage) */
    priest: { max: 80, heal: 16, every: 2.2, range: 11 },
    raider: { max: 34, dmg: 5, range: 1.4, cd: 1.45, speed: 2.3, xp: 12 }
  };

  /* --- a player's numbers ----------------------------------------------------------------------------- */
  const nextXp = level => 40 + (level - 1) * 30;
  function player(saved) {
    const level = Math.max(1, Math.min(99, (saved && saved.level) | 0 || 1)), xp = Math.max(0, (saved && saved.xp) | 0);
    const max = 100 + (level - 1) * 12;
    return { level, xp, next: nextXp(level), max, hp: max, dmg: 10 + (level - 1) * 2, cd: 0.55, range: 2.5, dead: false };
  }
  function gain(p, xp) {
    let ups = 0; p.xp += xp;
    while (p.xp >= nextXp(p.level)) { p.xp -= nextXp(p.level); p.level++; ups++; }
    if (ups) { const fresh = player({ level: p.level, xp: p.xp }); p.max = fresh.max; p.dmg = fresh.dmg; p.hp = p.max; }
    p.next = nextXp(p.level);
    return ups;
  }

  function create(o) {
    const T = o.THREE, art = o.art, ctx = o.ctx, def = o.def || {}, scene = ctx.scene, wild = o.wild || null;
    const height = o.height || (() => 0);   /* the ground under a unit (the hills outside the village) */
    const units = new Map();
    let raiderNo = 0, spawnIn = (def.spawns && def.spawns.first) || 6, seq = 0;
    /* a kind's numbers: the defaults, with what the level says over them (a raider's hp and xp) */
    const statOf = kind => kind !== 'raider' ? BASE[kind]
      : Object.assign({}, BASE.raider, def.raider && def.raider.hp ? { max: +def.raider.hp } : {}, def.raider && def.raider.xp ? { xp: +def.raider.xp } : {});
    /* effects everybody sees (the priest's blessing on the whole gate): kept a moment, sent with the snapshot */
    const fx = [], fxSeen = new Set();
    let fxNo = 0;
    /* a client draws the host's fight a little in the past, between two snapshots, by the host's own clock (like
       other players): off maps the host's clock onto ours (the smallest arrival - sent seen), gap is how far apart
       snapshots come, and the delay is what that needs -- smooth whether they come ten times a second or once */
    let off = null, gap = 250, lastT = null, delay = 300, jit = 0;

    /* --- what is drawn ------------------------------------------------------------------------------- */
    /* a bar over a head: drawn again only when its hp changes */
    function bar(u) {
      const c = document.createElement('canvas'); c.width = 64; c.height = 10;
      const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace;
      const s = new T.Sprite(new T.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      s.scale.set(0.9, 0.14, 1); s.position.y = u.c.barY ? u.c.barY + 0.2 : 2.42; s.renderOrder = 11; u.c.group.add(s);
      return { s, draw(hp, max, colour) {
        const x = c.getContext('2d'); x.clearRect(0, 0, 64, 10);
        x.fillStyle = 'rgba(0,0,0,.6)'; x.fillRect(0, 0, 64, 10);
        x.fillStyle = colour; x.fillRect(1, 1, Math.max(0, Math.round(62 * hp / max)), 8); tex.needsUpdate = true;
      } };
    }
    /* numbers that rise and fade where a blow or a blessing landed */
    const floaters = [];
    function floater(x, y, z, text, colour) {
      const c = document.createElement('canvas'); c.width = 96; c.height = 48;
      const x2 = c.getContext('2d'); x2.font = 'bold 34px system-ui,sans-serif'; x2.textAlign = 'center';
      x2.lineWidth = 6; x2.strokeStyle = 'rgba(0,0,0,.75)'; x2.strokeText(text, 48, 36); x2.fillStyle = colour; x2.fillText(text, 48, 36);
      const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace;
      const s = new T.Sprite(new T.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      s.scale.set(0.8, 0.4, 1); s.position.set(x + (Math.random() - 0.5) * 0.4, y, z); s.renderOrder = 12; scene.add(s);
      floaters.push({ s, life: 1 });
    }
    /* the blessing as it is seen: a golden ring rising from the priest's feet to its radius, and gone */
    const rings = [];
    const RING = ['#ffd76a', '#ff3a2a', '#ff9a3a', '#ff7aa0'];   /* blessing, a warning, a blast, a taunt */
    const FXK = ['ae', 'warn', 'blast', 'taunt'];
    function ring(x, z, r, k) {
      const m = new T.Mesh(new T.RingGeometry(0.85, 1, 64), new T.MeshBasicMaterial({ color: RING[k | 0] || RING[0], transparent: true, opacity: 0.9,
        side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending }));
      m.rotation.x = -Math.PI / 2; m.position.set(x, 0.15, z); m.renderOrder = 9; scene.add(m);
      rings.push({ m, r, life: 1, slow: k === 1 });
    }
    function look(kind, id) {
      if (kind === 'raider') {
        const r = def.raider || {}, base = r.look || {};
        const shirts = ['#5b3a2a', '#4a4f2a', '#3b3b3b', '#6a2a2a'];
        return Object.assign({}, base, { shirt: shirts[Number(String(id).replace(/\D/g, '')) % shirts.length] });
      }
      const d = kind === 'priest' ? def.priest : (def.guards || []).find(g => g.id === id);
      return (d && d.look) || {};
    }
    function nameOf(kind, id) {
      if (kind === 'raider') return (def.raider && def.raider.name) || 'Raider';
      const d = kind === 'priest' ? def.priest : (def.guards || []).find(g => g.id === id);
      return (d && d.name) || kind;
    }
    /* a beast's id says what it is: b.<species>.<maturity>.<n> -- so a client that has never seen it can draw it */
    function beastOf(id) {
      const [, sp, m] = String(id).split('.'), spec = wild && wild.species && wild.species[sp], mt = MAT[+m] || MAT[1];
      if (!spec) return null;
      return { sp, spec, m: +m || 0, name: mt[0] + ' ' + spec.name, max: Math.round(spec.hp * mt[1]), dmg: Math.round(spec.dmg * mt[2]),
               scale: mt[3], lvl: Math.max(0, (spec.lvl || 1) + mt[4]), speed: spec.speed || 2.6, range: spec.range || 1.5 };
    }
    function make(id, kind, x, z) {
      const bs = kind === 'beast' ? beastOf(id) : null;
      if (kind === 'beast' && !bs) return null;
      const b = bs || statOf(kind), u = { id, kind, name: bs ? bs.name : nameOf(kind, id), x, z, tx: x, tz: z, yaw: 0, tyaw: 0, buf: [], hp: b.max, max: b.max,
        state: 'idle', cd: Math.random() * 0.5, atk: 0, shown: { hp: -1, atk: 0, state: '' }, gone: 0, target: null, aggro: null, beast: bs };
      if (bs && bs.spec.model === 'human') {   /* people of a dungeon (pirates): our own figure, a weapon in hand */
        u.c = art.character(ctx, Object.assign({}, bs.spec.look || {}, { scale: ((bs.spec.look && bs.spec.look.scale) || 0.9) * bs.scale }));
        if (bs.spec.weapon && art.held) u.c.holdItem(art.held(bs.spec.weapon, bs.spec.weaponLook));
      } else u.c = bs ? art.creature(ctx, { kind: bs.spec.model || bs.sp, color: bs.spec.color, scale: bs.scale }) : art.character(ctx, look(kind, id));
      u.c.setName(u.name, kind === 'raider' ? '#ff9a8a' : kind === 'priest' ? '#c9f5c0' : kind === 'beast' ? ['#c8d0c0', '#ffe9a8', '#ffb46a', '#ff7a5a'][bs.m] : '#cfe1ff');
      u.bar = bar(u);
      u.c.group.position.set(x, 0, z);
      units.set(id, u);
      return u;
    }
    function drop(u) { scene.remove(u.c.group); units.delete(u.id); }
    /* the people at the gate, where the level puts them */
    for (const g of def.guards || []) { const u = make(g.id, 'guard', g.pos[0], g.pos[1]); u.post = g.pos; u.face = g.face || [g.pos[0], g.pos[1] + 5]; }
    if (def.priest) { const p = def.priest, u = make(p.id, 'priest', p.pos[0], p.pos[1]); u.post = p.pos; u.face = p.face || [0, p.pos[1] + 5]; }
    for (const u of units.values()) u.yaw = u.tyaw = yawTo(u.face[0] - u.x, u.face[1] - u.z);

    function yawTo(dx, dz) { return Math.atan2(-dx, -dz); }
    const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    const alive = u => u.state !== 'dead' && u.state !== 'down';

    /* --- the host's simulation ------------------------------------------------------------------------- */
    function hurt(u, d, by, events) {
      if (!alive(u)) return;
      u.hp = Math.max(0, u.hp - d);
      if ((u.kind === 'raider' || u.kind === 'beast') && by && by.startsWith('p:')) { u.aggro = by; u.evade = false; }
      else if (u.kind === 'raider' && by) u.aggro = by;
      if (u.hp > 0) return;
      if (u.kind === 'beast') {
        u.state = 'dead'; u.gone = 2.0;
        if (by && by.startsWith('p:')) events.push({ t: 'kill', by: by.slice(2), name: u.name, species: u.beast.sp, mat: u.beast.m, lvl: u.beast.lvl, loot: u.beast.spec.loot || [] });
      } else if (u.kind === 'raider') {
        u.state = 'dead'; u.gone = 2.0;
        if (by && by.startsWith('p:')) events.push({ t: 'kill', by: by.slice(2), xp: statOf('raider').xp, name: u.name });
      } else { u.state = 'down'; u.gone = 6; }   /* a guard goes down, and gets up again */
    }
    function step(u, tx, tz, speed, dt, keep) {
      const dx = tx - u.x, dz = tz - u.z, d = Math.hypot(dx, dz);
      if (d <= keep) return false;
      const k = Math.min(1, speed * dt / d); u.x += dx * k; u.z += dz * k; u.tyaw = yawTo(dx, dz);
      return true;
    }
    function simulate(dt, players, events) {
      const guards = [], raiders = [];
      for (const u of units.values()) (u.kind === 'raider' ? raiders : u.kind === 'guard' ? guards : []).push(u);
      const livePlayers = players.filter(p => !p.dead);
      /* new raiders, from the edge of the forest */
      const sp = def.spawns || {};
      spawnIn -= dt;
      if (spawnIn <= 0 && (sp.points || []).length) {
        spawnIn = sp.every || 12;
        let living = raiders.filter(alive).length;
        const first = Math.floor(Math.random() * sp.points.length);
        for (let k = 0; k < (sp.count || 1) && living < (sp.max || 4); k++, living++) {   /* a wave: one at each point in turn */
          const pt = sp.points[(first + k) % sp.points.length];
          const u = make('r' + (++raiderNo % 1000), 'raider', pt[0] + (Math.random() - 0.5) * 3, pt[1] + (Math.random() - 0.5) * 3);
          u.state = 'walk';
        }
      }
      for (const u of raiders) {
        if (!alive(u)) continue;
        if (u.stun > 0) { u.stun -= dt; u.state = 'idle'; continue; }   /* stunned: does nothing */
        /* who to fight: whoever struck it last (a player), else the nearest guard standing, else a player nearby */
        let tgt = null;
        if (u.aggro) { const p = livePlayers.find(q => 'p:' + q.id === u.aggro); if (p && dist(u, p) < 18) tgt = { x: p.x, z: p.z, ref: u.aggro }; else u.aggro = null; }
        if (!tgt) { let best = null; for (const g of guards) if (alive(g) && (!best || dist(u, g) < dist(u, best))) best = g; if (best) tgt = { x: best.x, z: best.z, ref: best.id }; }
        if (!tgt) { let best = null; for (const p of livePlayers) if (dist(u, p) < 12 && (!best || dist(u, p) < dist(u, best))) best = p; if (best) tgt = { x: best.x, z: best.z, ref: 'p:' + best.id }; }
        if (!tgt) tgt = { x: 0, z: 21, ref: null };
        const b = statOf('raider');
        u.cd -= dt;
        if (step(u, tgt.x, tgt.z, b.speed, dt, b.range * 0.85)) u.state = 'walk';
        else {
          u.tyaw = yawTo(tgt.x - u.x, tgt.z - u.z); u.state = 'idle';
          if (tgt.ref && u.cd <= 0) {
            u.cd = b.cd; u.atk++; u.state = 'attack';
            const d = b.dmg + Math.floor(Math.random() * 3);
            if (tgt.ref.startsWith('p:')) events.push({ t: 'hit', to: tgt.ref.slice(2), d, from: u.name });
            else { const g = units.get(tgt.ref); if (g) hurt(g, d, u.id, events); }
          }
        }
      }
      /* raiders do not stand inside each other */
      for (let i = 0; i < raiders.length; i++) for (let j = i + 1; j < raiders.length; j++) {
        const a = raiders[i], c = raiders[j], dx = c.x - a.x, dz = c.z - a.z, d = Math.hypot(dx, dz);
        if (d > 0 && d < 0.8 && alive(a) && alive(c)) { const k = (0.8 - d) / 2 / d; a.x -= dx * k; a.z -= dz * k; c.x += dx * k; c.z += dz * k; }
      }
      for (const u of guards) {
        if (u.state === 'down') { u.gone -= dt; if (u.gone <= 0) { u.state = 'idle'; u.hp = Math.round(u.max * 0.5); } continue; }
        const b = BASE.guard;
        let foe = null;
        for (const r of raiders) if (alive(r) && Math.hypot(r.x - u.post[0], r.z - u.post[1]) < b.guard && (!foe || dist(u, r) < dist(u, foe))) foe = r;
        u.cd -= dt;
        if (foe) {
          if (step(u, foe.x, foe.z, b.speed, dt, b.range * 0.85)) u.state = 'walk';
          else {
            u.tyaw = yawTo(foe.x - u.x, foe.z - u.z); u.state = 'idle';
            if (u.cd <= 0) { u.cd = b.cd; u.atk++; u.state = 'attack'; hurt(foe, b.dmg + Math.floor(Math.random() * 4), 'g:' + u.id, events); }
          }
        } else if (step(u, u.post[0], u.post[1], b.speed * 0.6, dt, 0.15)) u.state = 'walk';
        else { u.state = 'idle'; u.tyaw = yawTo(u.face[0] - u.x, u.face[1] - u.z); }
      }
      /* the priest: a blessing every few seconds on whoever needs it most -- a guard who is down first, then the
         lowest share of hit points among the guards and the players near him */
      for (const u of units.values()) {
        if (u.kind !== 'priest') continue;
        const b = BASE.priest; u.cd -= dt;
        /* THE BLESSING OF THE GATE (tbuuol 2026-10-23): more than so many raiders near him, and he calls it down on
           everyone around: friends are healed, raiders burn. Then it needs a while before it comes again. */
        const ae = def.priest && def.priest.ae;
        if (ae) {
          u.aeCd = (u.aeCd || 0) - dt;
          const near = raiders.filter(r => alive(r) && dist(r, u) <= ae.radius);
          if (u.aeCd <= 0 && near.length >= (ae.min || 11)) {
            u.aeCd = ae.every || 10; u.cd = Math.max(u.cd, 1.5); u.atk++; u.state = 'attack';
            for (const r of near) hurt(r, ae.dmg || 35, 'ae', events);
            for (const g of guards) if (dist(g, u) <= ae.radius) {
              if (g.state === 'down') { g.state = 'idle'; g.hp = Math.round(g.max * 0.5); } else g.hp = Math.min(g.max, g.hp + (ae.heal || 40));
            }
            for (const p of livePlayers) if (Math.hypot(p.x - u.x, p.z - u.z) <= ae.radius) events.push({ t: 'heal', to: p.id, d: ae.heal || 40 });
            fx.push({ id: ++fxNo, k: 'ae', x: u.x, z: u.z, r: ae.radius, at: performance.now() });
            continue;
          }
        }
        let best = null, worst = 1;
        for (const g of guards) {
          const share = g.state === 'down' ? -1 : g.hp / g.max;
          if (share < worst && Math.hypot(g.x - u.x, g.z - u.z) < b.range) { worst = share; best = { g }; }
        }
        for (const p of livePlayers) { const share = p.hp / p.max; if (share < worst && Math.hypot(p.x - u.x, p.z - u.z) < b.range * 0.7) { worst = share; best = { p }; } }
        if (best) u.tyaw = yawTo((best.g || best.p).x - u.x, (best.g || best.p).z - u.z);
        else u.tyaw = yawTo(u.face[0] - u.x, u.face[1] - u.z);
        if (best && worst < 0.97 && u.cd <= 0) {
          u.cd = b.every; u.atk++; u.state = 'attack';
          if (best.g) { const g = best.g; if (g.state === 'down') { g.state = 'idle'; g.hp = Math.round(g.max * 0.5); } else g.hp = Math.min(g.max, g.hp + b.heal); }
          else events.push({ t: 'heal', to: best.p.id, d: b.heal });
        } else if (u.cd < b.every - 0.6) u.state = 'idle';
      }
      for (const u of raiders) if (u.state === 'dead') { u.gone -= dt; if (u.gone <= 0) drop(u); }
      if (wild) beasts(dt, livePlayers, events);
    }
    /* THE GREENWOOD: each area keeps its number of beasts (a dead one comes back after a while, of a maturity drawn by
       chance). A beast wanders in its area; an aggressive one goes for a player who comes close, any one for whoever
       hit it; too far from home it gives up, goes back and is whole again (the leash). */
    let beastNo = 0;
    const areaState = (wild && wild.areas || []).map(() => ({ due: [] }));
    function spawnBeast(ai) {
      const a = wild.areas[ai], r = Math.random(); let m = 0, acc = 0;
      for (let i = 0; i < MAT_ODDS.length; i++) { acc += MAT_ODDS[i]; if (r < acc) { m = i; break; } }
      if (a.mat != null) m = a.mat;   /* an area that always has the same one (a boss, a guard post) */
      const ang = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * a.r;
      const u = make('b.' + a.species + '.' + m + '.' + (++beastNo % 10000), 'beast', a.center[0] + Math.cos(ang) * d, a.center[1] + Math.sin(ang) * d);
      if (u) { u.area = ai; u.wt = Math.random() * 4; }
    }
    function beasts(dt, livePlayers, events) {
      const now = performance.now(), count = areaState.map(() => 0);
      for (const u of units.values()) if (u.kind === 'beast' && u.area != null && !u.extra) count[u.area]++;
      wild.areas.forEach((a, i) => {
        const st = areaState[i];
        while (count[i] + st.due.length < (a.count || 3)) st.due.push(st.started ? now + (a.respawn || wild.respawn || 25) * 1000 : now);   /* an area may have its own (the world: each zone's) */
        st.started = true;
        st.due = st.due.filter(t => { if (t <= now) { spawnBeast(i); return false; } return true; });
      });
      for (const u of Array.from(units.values())) {
        if (u.kind !== 'beast') continue;
        if (u.state === 'dead') { u.gone -= dt; if (u.gone <= 0) drop(u); continue; }
        if (u.stun > 0) { u.stun -= dt; u.state = 'idle'; continue; }
        const a = wild.areas[u.area] || { center: [u.x, u.z], r: 10 }, b = u.beast, home = Math.hypot(u.x - a.center[0], u.z - a.center[1]);
        let tgt = null;
        if (u.aggro) {
          const p = livePlayers.find(q => 'p:' + q.id === u.aggro);
          if (!p || dist(u, p) > 25 || home > a.r + 20) { u.aggro = null; u.evade = true; } else tgt = p;
        }
        if (!tgt && !u.evade && b.spec.aggressive) {
          let best = null; for (const p of livePlayers) if (dist(u, p) < (b.spec.sight || 7) && Math.hypot(p.x - a.center[0], p.z - a.center[1]) < a.r + 10 && (!best || dist(u, p) < dist(u, best))) best = p;
          if (best) { u.aggro = 'p:' + best.id; tgt = best; }
        }
        u.cd -= dt;
        /* A BOSS (the pirate captain): a broadside every so often -- a red ring where it will land, then it lands on
           everyone inside -- and, at half its life, a call for help */
        const boss = b.spec.boss;
        if (boss && tgt && !u.evade) {
          if (boss.aoe) {
            u.aoeCd = (u.aoeCd == null ? boss.aoe.first || 6 : u.aoeCd) - dt;
            if (u.warnLeft > 0) {
              u.warnLeft -= dt;
              if (u.warnLeft <= 0) {
                for (const p of livePlayers) if (Math.hypot(p.x - u.warnAt[0], p.z - u.warnAt[1]) <= boss.aoe.radius) events.push({ t: 'hit', to: p.id, d: boss.aoe.dmg, from: boss.aoe.name || u.name, lvl: b.lvl });
                fx.push({ id: ++fxNo, k: 'blast', x: u.warnAt[0], z: u.warnAt[1], r: boss.aoe.radius, at: performance.now() });
              }
            } else if (u.aoeCd <= 0) {
              u.aoeCd = boss.aoe.every || 12; u.warnLeft = boss.aoe.warn || 1.6; u.warnAt = [tgt.x, tgt.z];
              fx.push({ id: ++fxNo, k: 'warn', x: tgt.x, z: tgt.z, r: boss.aoe.radius, at: performance.now() });
            }
          }
          if (boss.adds && !u.added && u.hp <= u.max * (boss.adds.at || 0.5)) {
            u.added = true;
            for (let k = 0; k < (boss.adds.n || 2); k++) {
              const ai = wild.areas.findIndex(x => x.species === boss.adds.species);
              const add = make('b.' + boss.adds.species + '.' + (boss.adds.mat || 1) + '.' + (++beastNo % 10000), 'beast', u.x + (k ? 2 : -2), u.z + 1.5);
              if (add) { add.area = ai >= 0 ? ai : u.area; add.aggro = u.aggro; add.wt = 2; add.extra = true; }
            }
          }
        }
        if (u.evade) {   /* home, and whole again */
          u.hp = u.max;
          if (step(u, a.center[0], a.center[1], b.speed * 1.4, dt, 2)) u.state = 'walk'; else { u.evade = false; u.state = 'idle'; }
        } else if (tgt) {
          if (step(u, tgt.x, tgt.z, b.speed, dt, b.range * 0.85)) u.state = 'walk';
          else {
            u.tyaw = yawTo(tgt.x - u.x, tgt.z - u.z); u.state = 'idle';
            if (u.cd <= 0) { u.cd = b.spec.cd || 1.6; u.atk++; u.state = 'attack'; events.push({ t: 'hit', to: tgt.id, d: b.dmg + Math.floor(Math.random() * 3), from: u.name, lvl: b.lvl }); }
          }
        } else {   /* wandering */
          u.wt -= dt;
          if (u.wt <= 0) { u.wt = 3 + Math.random() * 6; const ang = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * a.r; u.goal = [a.center[0] + Math.cos(ang) * d, a.center[1] + Math.sin(ang) * d]; }
          if (u.goal && step(u, u.goal[0], u.goal[1], b.speed * 0.35, dt, 0.3)) u.state = 'walk'; else u.state = 'idle';
        }
      }
    }

    /* --- what everybody draws (the host too) ---------------------------------------------------------- */
    let quiet = false;   /* the house: it keeps the fight and draws none of it (no animations, bars or numbers) */
    function view(dt, host) {
      if (quiet && host) return;
      for (const u of units.values()) {
        const ox = u.c.group.position.x, oz = u.c.group.position.z;
        if (!host) {
          const b = u.buf, t = performance.now() - delay;
          if (b.length) {
            let i = 1; while (i < b.length - 1 && b[i].t < t) i++;
            const A = b[Math.max(0, i - 1)], B = b[i] || A;
            let x, z;
            if (t <= B.t || b.length < 2) {
              const k = B.t > A.t ? Math.max(0, Math.min(1, (t - A.t) / (B.t - A.t))) : 1;
              x = A.x + (B.x - A.x) * k; z = A.z + (B.z - A.z) * k;
            } else {
              /* the next snapshot is late (the house paused): carry on as it was going, at most 0.6 s; one that had
                 stopped stays stopped */
              const ahead = Math.min(600, t - B.t), span = Math.max(1, B.t - A.t);
              x = B.x + (B.x - A.x) / span * ahead; z = B.z + (B.z - A.z) / span * ahead;
            }
            /* and a correction glides rather than snaps; a big one (a respawn) is taken at once */
            const far = Math.abs(u.x - x) + Math.abs(u.z - z) > 3, follow = 1 - Math.exp(-dt * 14);
            if (far || !u.drawn) { u.x = x; u.z = z; u.drawn = true; } else { u.x += (x - u.x) * follow; u.z += (z - u.z) * follow; }
            while (b.length > 3 && b[1].t < t - 1000) b.shift();
          }
        }
        /* a raider that died lies a moment, then sinks into the ground before it is gone (the host drops it at 3.2 s) */
        let y = 0;
        if (u.state === 'dead') {
          u.deadSince = u.deadSince || performance.now();
          const lying = (performance.now() - u.deadSince) / 1000;
          if (lying > 0.6) y = -Math.min(1.4, (lying - 0.6) * 1.8);   /* down a moment, then quickly into the ground (tbuuol: too slow) */
        } else u.deadSince = 0;
        const gy = height(u.x, u.z);   /* a swimmer (a siren) keeps its head above the water */
        u.c.group.position.set(u.x, y + (u.beast && u.beast.spec.swim ? Math.max(gy, wild && wild.waterY != null ? wild.waterY : -0.75) : gy), u.z);
        let d = u.tyaw - u.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); u.yaw += d * Math.min(1, dt * 8);
        u.c.group.rotation.y = u.yaw;
        const speed = dt > 0 ? Math.hypot(u.x - ox, u.z - oz) / dt : 0;
        if (u.state === 'dead' || u.state === 'down') u.c.hold('die');
        else { u.c.hold(null); if (u.atk !== u.shown.atk) u.c.emote(u.kind === 'priest' ? 'interact-right' : 'attack-melee-right'); u.c.animate(dt, speed > 0.4 ? speed : 0); }
        if (u.hp !== u.shown.hp) {
          if (u.shown.hp >= 0) {
            const diff = u.hp - u.shown.hp, now = performance.now();
            u.predicted = (u.predicted || []).filter(q => q.until > now);
            const mine = diff < 0 ? u.predicted.findIndex(q => q.d === -diff) : -1;
            if (mine >= 0) u.predicted.splice(mine, 1);   /* my own blow, already shown when I struck */
            else if (diff < 0) floater(u.x, 2.2, u.z, String(diff), '#ff6b5a');
            else if (diff > 0) floater(u.x, 2.2, u.z, '+' + diff, '#7dff8a');
          }
          u.bar.draw(u.hp, u.max, u.kind === 'raider' ? '#e0483a' : '#4cc35a');
          u.shown.hp = u.hp;
        }
        u.bar.s.visible = u.state !== 'dead';
        u.shown.atk = u.atk;
      }
      for (let i = rings.length - 1; i >= 0; i--) {
        const g = rings[i]; g.life -= dt * (g.slow ? 0.6 : 1.25); const k = g.slow ? 1 : 1 - Math.max(0, g.life);
        g.m.scale.setScalar(0.5 + k * g.r); g.m.material.opacity = Math.max(0, g.life) * 0.9;
        if (g.life <= 0) { scene.remove(g.m); g.m.geometry.dispose(); g.m.material.dispose(); rings.splice(i, 1); }
      }
      /* the host's own effects, the moment they happen (a client's come with the snapshot) */
      for (const e of fx) if (!fxSeen.has(e.id)) { fxSeen.add(e.id); ring(e.x, e.z, e.r, Math.max(0, FXK.indexOf(e.k))); }
      while (fx.length && performance.now() - fx[0].at > 2000) fx.shift();
      for (let i = floaters.length - 1; i >= 0; i--) {
        const f = floaters[i]; f.life -= dt * 1.1; f.s.position.y += dt * 1.1; f.s.material.opacity = Math.max(0, Math.min(1, f.life * 1.6));
        if (f.life <= 0) { scene.remove(f.s); f.s.material.map.dispose(); f.s.material.dispose(); floaters.splice(i, 1); }
      }
    }

    return {
      update(dt, host, players) {
        const events = [];
        if (host) simulate(dt, players || [], events);
        view(dt, host);
        return events;
      },
      /* a client's own blow, shown at once; the host's word on it is then not shown a second time */
      predict(id, d) {
        const u = units.get(String(id)); d = Math.round(+d || 0);
        if (!u || !alive(u)) return;
        if (d <= 0) { floater(u.x, 2.0, u.z, '✶', '#fff6d0'); return; }   /* the house rolls the number: a spark now, the number when it says */
        floater(u.x, 2.2, u.z, '-' + d, '#ff6b5a');
        (u.predicted = u.predicted || []).push({ d, until: performance.now() + 2500 });
      },
      /* the house says a blow of mine missed: shown over the raider, where the spark was */
      quiet(on) { quiet = !!on; },
      missed(id) { const u = units.get(String(id)); if (u && alive(u)) floater(u.x, 2.2, u.z, 'miss', '#d9e2ec'); },
      damage(id, d, byPlayer) {
        const events = [], u = units.get(String(id));
        if (u && (u.kind === 'raider' || u.kind === 'beast')) hurt(u, Math.max(0, Math.min(60, Math.round(+d || 0))), 'p:' + byPlayer, events);
        return events;
      },
      pick(x, z, yaw, range) {
        const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
        let best = null, bestD = range;
        for (const u of units.values()) {
          if ((u.kind !== 'raider' && u.kind !== 'beast') || !alive(u)) continue;
          const dx = u.x - x, dz = u.z - z, d = Math.hypot(dx, dz);
          if (d > range) continue;
          if (d > 0.6 && (dx * fx + dz * fz) / d < 0.55) continue;   /* in front of you, roughly */
          if (d < bestD) { best = u.id; bestD = d; }
        }
        return best;
      },
      /* the fight on the wire. o.near: where the players are (a beast farther than 70 m from all of them is left out:
         nobody sees it); o.delta: only the units that changed since the last picture, and each one once more after it
         came to rest (so a client does not carry it on past where it stopped) */
      snapshot(o) {
        o = o || {};
        const u = [], near = o.near;
        for (const v of units.values()) {
          if (near && v.kind === 'beast' && !near.some(q => Math.abs(q[0] - v.x) + Math.abs(q[1] - v.z) < 90 && Math.hypot(q[0] - v.x, q[1] - v.z) < 70)) continue;
          const row = [v.id, KIND.indexOf(v.kind), Math.round(v.x * 10), Math.round(v.z * 10), Math.round(v.tyaw * 100), v.hp, STATE.indexOf(v.state), v.atk % 100];
          const key = row.slice(2).join();
          if (o.mark !== false) {   /* the room's pictures (whole) do not count as sent on the fast lane */
            if (o.delta && key === v.sentKey) { if ((v.rest = (v.rest || 0) + 1) > 1) continue; } else v.rest = 0;
            v.sentKey = key;
          }
          u.push(row);
        }
        const snap = { s: ++seq, t: Math.round(performance.now()), u };
        if (o.delta) snap.d = 1;
        if (fx.length) snap.e = fx.map(e => [e.id, Math.round(e.x * 10), Math.round(e.z * 10), e.r, Math.max(0, FXK.indexOf(e.k))]);
        return snap;
      },
      /* a snapshot cut into pieces that each fit a room message (the room takes 500 bytes): with thirty raiders one
         does not; the fast lane takes it whole */
      pieces(snap, most) {
        const out = []; let part = { s: snap.s, t: snap.t, p: 0, u: [] };
        if (snap.e) part.e = snap.e;
        for (const row of snap.u) {
          part.u.push(row);
          if (JSON.stringify({ C: part }).length > most && part.u.length > 1) {
            part.u.pop(); out.push(part); part = { s: snap.s, t: snap.t, p: out.length, u: [row] };
          }
        }
        out.push(part);
        return out;
      },
      apply(snap) {
        if (!snap || !Array.isArray(snap.u)) return;
        const now = performance.now(), sent = +snap.t;
        let at = now;
        if (isFinite(sent) && sent > 0) {
          const o = now - sent;
          off = off == null || o < off ? o : off + (o - off) * 0.002;   /* follows a drifting clock slowly */
          jit += (Math.abs(o - off) - jit) * 0.1;                        /* how unevenly they arrive */
          at = sent + off;
          if (lastT != null && sent > lastT) gap += (Math.min(1500, sent - lastT) - gap) * 0.2;
          if (lastT != null && (sent < lastT || (sent === lastT && snap.p == null))) return;   /* old or doubled */
          lastT = sent;
        }
        const want = Math.max(120, Math.min(1500, gap * 1.3 + 2.5 * jit + 50));   /* the same rule as for players */
        delay = want > delay ? want : delay + (want - delay) * 0.05;   /* grows at once, shrinks slowly */
        for (const e of snap.e || []) if (Array.isArray(e) && !fxSeen.has('h' + e[0])) { fxSeen.add('h' + e[0]); ring(e[1] / 10, e[2] / 10, +e[3] || 10, e[4] | 0); }
        for (const row of snap.u) {
          if (!Array.isArray(row) || row.length < 8) continue;
          const [id, k, x, z, yaw, hp, st, atk] = row, kind = KIND[k];
          if (!kind) continue;
          let u = units.get(String(id));
          if (!u) { u = make(String(id), kind, x / 10, z / 10); if (!u) continue; u.post = u.post || [x / 10, z / 10]; u.face = u.face || [0, 40]; u.shown.atk = atk; u.atk = atk; }
          u.tx = x / 10; u.tz = z / 10; u.tyaw = yaw / 100; u.hp = +hp || 0; u.state = STATE[st] || 'idle';
          const last = u.buf[u.buf.length - 1];
          if (last && last.t === at) { last.x = x / 10; last.z = z / 10; }   /* the same moment twice (a piece and the whole) */
          else { u.buf.push({ t: at, x: x / 10, z: z / 10 }); if (u.buf.length > 40) u.buf.shift(); }
          u.seenAt = now;
          if (atk !== u.atk % 100) u.atk = atk;
        }
        /* a raider the host has not mentioned for a while is gone (snapshots may come in pieces, so not being in one
           piece says nothing) */
        for (const u of Array.from(units.values())) if ((u.kind === 'raider' || u.kind === 'beast') && now - (u.seenAt || now) > 3000) drop(u);
      },
      /* foes in front of you, nearest first (Cleave) */
      pickAll(x, z, yaw, range, most) {
        const fx = -Math.sin(yaw), fz = -Math.cos(yaw), out = [];
        for (const u of units.values()) {
          if ((u.kind !== 'raider' && u.kind !== 'beast') || !alive(u)) continue;
          const dx = u.x - x, dz = u.z - z, d = Math.hypot(dx, dz);
          if (d > range || (d > 0.6 && (dx * fx + dz * fz) / d < 0.3)) continue;
          out.push([d, u.id]);
        }
        return out.sort((a, b) => a[0] - b[0]).slice(0, most || 4).map(e => e[1]);
      },
      posOf(id) { const u = units.get(String(id)); return u ? [u.x, u.z] : null; },
      /* host: a foe stunned for so long; every foe near a point made to come for a player (Taunt) */
      stun(id, secs) { const u = units.get(String(id)); if (u && alive(u) && u.kind !== 'guard') { u.stun = Math.max(u.stun || 0, secs); } },
      taunt(x, z, radius, playerId) {
        let n = 0;
        for (const u of units.values()) if ((u.kind === 'raider' || u.kind === 'beast') && alive(u) && Math.hypot(u.x - x, u.z - z) <= radius) { u.aggro = 'p:' + playerId; u.evade = false; n++; }
        fx.push({ id: ++fxNo, k: 'taunt', x, z, r: radius, at: performance.now() });
        return n;
      },
      /* a word over a foe (a stun, as the one who did it sees it) */
      say(id, text, colour) { const u = units.get(String(id)); if (u) floater(u.x, 2.4, u.z, text, colour || '#ffe08a'); },
      /* what a blow is against: how hard the foe is (what striking it teaches) and its defence */
      info(id) { const u = units.get(String(id)); if (!u) return null; return u.beast ? { kind: 'beast', lvl: u.beast.lvl, def: u.beast.spec.def || 0, species: u.beast.sp } : { kind: u.kind }; },
      units() { return Array.from(units.values()).map(u => ({ id: u.id, kind: u.kind, name: u.name, x: Math.round(u.x * 10) / 10, z: Math.round(u.z * 10) / 10, y: Math.round(u.c.group.position.y * 100) / 100, hp: u.hp, max: u.max, state: u.state })); }
    };
  }

  /* THE SNAPSHOT AS BYTES (Etappe 4, where the viewer passes bytes): about half of its JSON. Type 1:
       u8 1 | u8 flags (1 = delta) | u32 seq | u32 t (ms) | u16 rows | rows | u8 effects | effects
       row:    u8 id length | id (ASCII) | u8 kind | i16 x*10 | i16 z*10 | i16 yaw*100 | u16 hp | u8 state | u8 atk
       effect: u32 id | i16 x*10 | i16 z*10 | u8 radius | u8 kind (0 blessing, 1 warning, 2 blast, 3 taunt) */
  function encode(snap) {
    const rows = snap.u || [], fx2 = snap.e || [];
    let size = 1 + 1 + 4 + 4 + 2 + 1 + fx2.length * 10;
    for (const r of rows) size += 1 + Math.min(255, String(r[0]).length) + 1 + 2 + 2 + 2 + 2 + 1 + 1;
    const buf = new ArrayBuffer(size), v = new DataView(buf);
    let o = 0;
    v.setUint8(o, 1); o += 1; v.setUint8(o, snap.d ? 1 : 0); o += 1;
    v.setUint32(o, snap.s >>> 0); o += 4; v.setUint32(o, Math.max(0, Math.round(snap.t)) >>> 0); o += 4;
    v.setUint16(o, rows.length); o += 2;
    for (const r of rows) {
      const id = String(r[0]).slice(0, 255);
      v.setUint8(o, id.length); o += 1;
      for (let i = 0; i < id.length; i++) v.setUint8(o++, id.charCodeAt(i) & 127);
      v.setUint8(o, r[1]); o += 1; v.setInt16(o, r[2]); o += 2; v.setInt16(o, r[3]); o += 2; v.setInt16(o, r[4]); o += 2;
      v.setUint16(o, Math.max(0, Math.min(65535, r[5]))); o += 2; v.setUint8(o, r[6]); o += 1; v.setUint8(o, r[7] & 255); o += 1;
    }
    v.setUint8(o, fx2.length); o += 1;
    for (const e of fx2) { v.setUint32(o, e[0] >>> 0); o += 4; v.setInt16(o, e[1]); o += 2; v.setInt16(o, e[2]); o += 2; v.setUint8(o, e[3] & 255); o += 1; v.setUint8(o, (e[4] | 0) & 255); o += 1; }
    return buf;
  }
  function decode(buf) {
    const v = new DataView(buf);
    let o = 0;
    if (v.getUint8(o) !== 1) return null; o += 1;
    const flags = v.getUint8(o); o += 1;
    const snap = { s: v.getUint32(o), t: v.getUint32(o + 4), u: [] }; o += 8;
    if (flags & 1) snap.d = 1;
    const n = v.getUint16(o); o += 2;
    for (let k = 0; k < n; k++) {
      const len = v.getUint8(o); o += 1;
      let id = ''; for (let i = 0; i < len; i++) id += String.fromCharCode(v.getUint8(o++));
      snap.u.push([id, v.getUint8(o), v.getInt16(o + 1), v.getInt16(o + 3), v.getInt16(o + 5), v.getUint16(o + 7), v.getUint8(o + 9), v.getUint8(o + 10)]);
      o += 11;
    }
    const ne = v.getUint8(o); o += 1;
    if (ne) { snap.e = []; for (let k = 0; k < ne; k++) { snap.e.push([v.getUint32(o), v.getInt16(o + 4), v.getInt16(o + 6), v.getUint8(o + 8), v.getUint8(o + 9)]); o += 10; } }
    return snap;
  }
  const combat = { api: 1, player, gain, nextXp, create, encode, decode };
  if (G.LWQ && G.LWQ.define) G.LWQ.define('combat', { api: 1, v: 14, needs: { three: 160, art: 1 } }, () => combat);
})(typeof globalThis !== 'undefined' ? globalThis : this);
