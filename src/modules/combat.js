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
     f.pick(x, z, yaw, range) -> unitId|null    what a swing from here would hit
     f.snapshot() / f.apply(snap)               the fight on the wire (host -> everyone), well inside 500 bytes
     f.units()                                  for tests and the HUD: [{id, kind, name, x, z, hp, max, state}]
   THE HOST decides everything (as with the shared world): raiders, their blows, the guards, the priest. A player's own
   swing is an intent ({X: unit, d}) the host applies. Guards do not die: at 0 they go down, and the priest has them up
   again a few seconds later -- the guards always win, which is the point of the scene. */
(function (G) {
  'use strict';
  const KIND = ['guard', 'priest', 'raider'];
  const STATE = ['idle', 'walk', 'attack', 'down', 'dead'];
  /* what each kind can do: hit points, damage, reach, seconds between blows, speed (m/s) */
  const BASE = {
    guard: { max: 140, dmg: 9, range: 1.7, cd: 1.15, speed: 3.2, guard: 8 },
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
    const T = o.THREE, art = o.art, ctx = o.ctx, def = o.def || {}, scene = ctx.scene;
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
      s.scale.set(0.9, 0.14, 1); s.position.y = 2.42; s.renderOrder = 11; u.c.group.add(s);
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
    function ring(x, z, r) {
      const m = new T.Mesh(new T.RingGeometry(0.85, 1, 64), new T.MeshBasicMaterial({ color: '#ffd76a', transparent: true, opacity: 0.9,
        side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending }));
      m.rotation.x = -Math.PI / 2; m.position.set(x, 0.15, z); m.renderOrder = 9; scene.add(m);
      rings.push({ m, r, life: 1 });
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
    function make(id, kind, x, z) {
      const b = statOf(kind), u = { id, kind, name: nameOf(kind, id), x, z, tx: x, tz: z, yaw: 0, tyaw: 0, buf: [], hp: b.max, max: b.max,
        state: 'idle', cd: Math.random() * 0.5, atk: 0, shown: { hp: -1, atk: 0, state: '' }, gone: 0, target: null, aggro: null };
      u.c = art.character(ctx, look(kind, id));
      u.c.setName(u.name, kind === 'raider' ? '#ff9a8a' : kind === 'priest' ? '#c9f5c0' : '#cfe1ff');
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
      if (u.kind === 'raider' && by) u.aggro = by;
      if (u.hp > 0) return;
      if (u.kind === 'raider') {
        u.state = 'dead'; u.gone = 3.2;
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
    }

    /* --- what everybody draws (the host too) ---------------------------------------------------------- */
    function view(dt, host) {
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
        u.c.group.position.set(u.x, 0, u.z);
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
        const g = rings[i]; g.life -= dt * 1.25; const k = 1 - Math.max(0, g.life);
        g.m.scale.setScalar(0.5 + k * g.r); g.m.material.opacity = Math.max(0, g.life) * 0.9;
        if (g.life <= 0) { scene.remove(g.m); g.m.geometry.dispose(); g.m.material.dispose(); rings.splice(i, 1); }
      }
      /* the host's own effects, the moment they happen (a client's come with the snapshot) */
      for (const e of fx) if (!fxSeen.has(e.id)) { fxSeen.add(e.id); ring(e.x, e.z, e.r); }
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
        if (!u || !alive(u) || d <= 0) return;
        floater(u.x, 2.2, u.z, '-' + d, '#ff6b5a');
        (u.predicted = u.predicted || []).push({ d, until: performance.now() + 2500 });
      },
      damage(id, d, byPlayer) {
        const events = [], u = units.get(String(id));
        if (u && u.kind === 'raider') hurt(u, Math.max(0, Math.min(60, Math.round(+d || 0))), 'p:' + byPlayer, events);
        return events;
      },
      pick(x, z, yaw, range) {
        const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
        let best = null, bestD = range;
        for (const u of units.values()) {
          if (u.kind !== 'raider' || !alive(u)) continue;
          const dx = u.x - x, dz = u.z - z, d = Math.hypot(dx, dz);
          if (d > range) continue;
          if (d > 0.6 && (dx * fx + dz * fz) / d < 0.55) continue;   /* in front of you, roughly */
          if (d < bestD) { best = u.id; bestD = d; }
        }
        return best;
      },
      snapshot() {
        const u = [];
        for (const v of units.values()) u.push([v.id, KIND.indexOf(v.kind), Math.round(v.x * 10), Math.round(v.z * 10), Math.round(v.tyaw * 100), v.hp, STATE.indexOf(v.state), v.atk % 100]);
        const snap = { s: ++seq, t: Math.round(performance.now()), u };
        if (fx.length) snap.e = fx.map(e => [e.id, Math.round(e.x * 10), Math.round(e.z * 10), e.r]);
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
        for (const e of snap.e || []) if (Array.isArray(e) && !fxSeen.has('h' + e[0])) { fxSeen.add('h' + e[0]); ring(e[1] / 10, e[2] / 10, +e[3] || 10); }
        for (const row of snap.u) {
          if (!Array.isArray(row) || row.length < 8) continue;
          const [id, k, x, z, yaw, hp, st, atk] = row, kind = KIND[k];
          if (!kind) continue;
          let u = units.get(String(id));
          if (!u) { u = make(String(id), kind, x / 10, z / 10); u.post = u.post || [x / 10, z / 10]; u.face = u.face || [0, 40]; u.shown.atk = atk; u.atk = atk; }
          u.tx = x / 10; u.tz = z / 10; u.tyaw = yaw / 100; u.hp = +hp || 0; u.state = STATE[st] || 'idle';
          const last = u.buf[u.buf.length - 1];
          if (last && last.t === at) { last.x = x / 10; last.z = z / 10; }   /* the same moment twice (a piece and the whole) */
          else { u.buf.push({ t: at, x: x / 10, z: z / 10 }); if (u.buf.length > 40) u.buf.shift(); }
          u.seenAt = now;
          if (atk !== u.atk % 100) u.atk = atk;
        }
        /* a raider the host has not mentioned for a while is gone (snapshots may come in pieces, so not being in one
           piece says nothing) */
        for (const u of Array.from(units.values())) if (u.kind === 'raider' && now - (u.seenAt || now) > 3000) drop(u);
      },
      units() { return Array.from(units.values()).map(u => ({ id: u.id, kind: u.kind, name: u.name, x: Math.round(u.x * 10) / 10, z: Math.round(u.z * 10) / 10, hp: u.hp, max: u.max, state: u.state })); }
    };
  }

  const combat = { api: 1, player, gain, nextXp, create };
  if (G.LWQ && G.LWQ.define) G.LWQ.define('combat', { api: 1, v: 4, needs: { three: 160, art: 1 } }, () => combat);
})(typeof globalThis !== 'undefined' ? globalThis : this);
