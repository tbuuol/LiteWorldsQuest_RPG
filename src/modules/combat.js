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
      const b = BASE[kind], u = { id, kind, name: nameOf(kind, id), x, z, tx: x, tz: z, yaw: 0, tyaw: 0, hp: b.max, max: b.max,
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
        if (by && by.startsWith('p:')) events.push({ t: 'kill', by: by.slice(2), xp: BASE.raider.xp, name: u.name });
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
        if (raiders.filter(alive).length < (sp.max || 4)) {
          const pt = sp.points[Math.floor(Math.random() * sp.points.length)];
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
        const b = BASE.raider;
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
        if (!host) { const k = Math.min(1, dt * 8); u.x += (u.tx - u.x) * k; u.z += (u.tz - u.z) * k; }
        u.c.group.position.set(u.x, 0, u.z);
        let d = u.tyaw - u.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); u.yaw += d * Math.min(1, dt * 8);
        u.c.group.rotation.y = u.yaw;
        const speed = dt > 0 ? Math.hypot(u.x - ox, u.z - oz) / dt : 0;
        if (u.state === 'dead' || u.state === 'down') u.c.hold('die');
        else { u.c.hold(null); if (u.atk !== u.shown.atk) u.c.emote(u.kind === 'priest' ? 'interact-right' : 'attack-melee-right'); u.c.animate(dt, speed > 0.4 ? speed : 0); }
        if (u.hp !== u.shown.hp) {
          if (u.shown.hp >= 0) {
            const diff = u.hp - u.shown.hp;
            if (diff < 0) floater(u.x, 2.2, u.z, String(diff), '#ff6b5a');
            else if (diff > 0) floater(u.x, 2.2, u.z, '+' + diff, '#7dff8a');
          }
          u.bar.draw(u.hp, u.max, u.kind === 'raider' ? '#e0483a' : '#4cc35a');
          u.shown.hp = u.hp;
        }
        u.bar.s.visible = u.state !== 'dead';
        u.shown.atk = u.atk;
      }
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
        return { s: ++seq, u };
      },
      apply(snap) {
        if (!snap || !Array.isArray(snap.u)) return;
        const seen = new Set();
        for (const row of snap.u) {
          if (!Array.isArray(row) || row.length < 8) continue;
          const [id, k, x, z, yaw, hp, st, atk] = row, kind = KIND[k];
          if (!kind) continue;
          seen.add(String(id));
          let u = units.get(String(id));
          if (!u) { u = make(String(id), kind, x / 10, z / 10); u.post = u.post || [x / 10, z / 10]; u.face = u.face || [0, 40]; u.shown.atk = atk; u.atk = atk; }
          u.tx = x / 10; u.tz = z / 10; u.tyaw = yaw / 100; u.hp = +hp || 0; u.state = STATE[st] || 'idle';
          if (atk !== u.atk % 100) u.atk = atk;
        }
        for (const u of Array.from(units.values())) if (u.kind === 'raider' && !seen.has(u.id)) drop(u);
      },
      units() { return Array.from(units.values()).map(u => ({ id: u.id, kind: u.kind, name: u.name, x: Math.round(u.x * 10) / 10, z: Math.round(u.z * 10) / 10, hp: u.hp, max: u.max, state: u.state })); }
    };
  }

  const combat = { api: 1, player, gain, nextXp, create };
  if (G.LWQ && G.LWQ.define) G.LWQ.define('combat', { api: 1, v: 1, needs: { three: 160, art: 1 } }, () => combat);
})(typeof globalThis !== 'undefined' ? globalThis : this);
