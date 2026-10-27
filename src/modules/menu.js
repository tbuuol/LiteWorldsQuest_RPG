/* LiteWorldsQuest menu module: the player's own book -- what is worn, attributes, skills, professions, the bag.
     const m = menu.create({el, rpg, touch, ask(q)})    q: {op: 'equip', uid} | {op: 'unequip', slot}   (to the house)
     m.open() / m.close() / m.isOpen() / m.update(record, stats)
   The bag is in two: raw materials as a list, things to use in a grid, each to wear or take off (tbuuol 2026-10-23).
   It only shows the record the house sent; wearing and taking off are asked of the house, which decides. */
(function (G) {
  'use strict';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const CSS =
    '.lwq-menu{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(10,8,6,.55);z-index:20;' +
    'font:14px/1.4 system-ui,sans-serif;color:#f1e7d3}' +
    '.lwq-menu .card{width:min(940px,96%);height:min(600px,92%);display:flex;flex-direction:column;background:rgba(32,24,16,.96);' +
    'border:2px solid #9a7a48;border-radius:10px;box-shadow:0 8px 40px rgba(0,0,0,.6);overflow:hidden}' +
    '.lwq-menu .top{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid #5a4630}' +
    '.lwq-menu .tab{background:none;border:1px solid #6d5636;color:#e9dcc0;border-radius:6px;padding:5px 9px;font:600 13px system-ui;cursor:pointer}' +
    '.lwq-menu .tab.on{background:#7a5a2c;border-color:#c9a25e}.lwq-menu .x{margin-left:auto;font-size:20px;padding:2px 10px}' +
    '.lwq-menu .body{flex:1;overflow:auto;padding:12px 14px}' +
    '.lwq-menu h4{margin:6px 0 8px;font:700 13px system-ui;letter-spacing:.06em;text-transform:uppercase;color:#d8b878}' +
    '.lwq-menu .cols{display:flex;gap:18px;flex-wrap:wrap}.lwq-menu .col{flex:1;min-width:230px}' +
    '.lwq-menu .slots{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}' +
    '.lwq-menu .slot{border:1px solid #5a4630;border-radius:6px;padding:5px 7px;min-height:38px;background:rgba(0,0,0,.25);cursor:pointer}' +
    '.lwq-menu .slot small{display:block;font-size:10px;opacity:.65;text-transform:uppercase;letter-spacing:.05em}' +
    '.lwq-menu .slot.full{border-color:#a8864f;background:rgba(122,90,44,.35)}' +
    '.lwq-menu .row{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px dotted #4a3a28}' +
    '.lwq-menu .bar{height:6px;background:rgba(0,0,0,.4);border-radius:3px;overflow:hidden;margin:2px 0 8px}.lwq-menu .bar i{display:block;height:100%;background:#6fb6ff}' +
    '.lwq-menu .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px}' +
    '.lwq-menu .item{border:1px solid #5a4630;border-radius:7px;padding:7px;background:rgba(0,0,0,.25);cursor:pointer;min-height:64px}' +
    '.lwq-menu .item.worn{border-color:#c9a25e;box-shadow:inset 0 0 0 1px #c9a25e}.lwq-menu .item.sel{background:rgba(201,162,94,.25)}' +
    '.lwq-menu .item b{display:block;font-size:13px}.lwq-menu .item small{opacity:.7;font-size:11px}' +
    '.lwq-menu .detail{margin-top:12px;padding:10px;border:1px solid #6d5636;border-radius:8px;background:rgba(0,0,0,.3)}' +
    '.lwq-menu .bad{color:#ff8f7a}.lwq-menu .good{color:#9be38f}' +
    '.lwq-menu .act{margin-top:8px;background:#7a5a2c;border:1px solid #c9a25e;color:#fff;border-radius:6px;padding:7px 14px;font:600 14px system-ui;cursor:pointer}' +
    '.lwq-menu .act[disabled]{opacity:.45;cursor:default}.lwq-menu .muted{opacity:.7}';

  function create(o) {
    const rpg = o.rpg, el = o.el;
    const st = document.createElement('style'); st.textContent = CSS; el.appendChild(st);
    const root = document.createElement('div'); root.className = 'lwq-menu';
    root.innerHTML = '<div class="card"><div class="top">' +
      '<button class="tab on" data-t="char">Character</button><button class="tab" data-t="skills">Skills</button>' +
      '<button class="tab" data-t="profs">Professions</button>' +
      '<button class="tab" data-t="bag">Bag</button><button class="tab" data-t="craft">Craft</button>' +
      '<button class="tab" data-t="quests">Quests</button>' + (o.wild ? '<button class="tab" data-t="codex">Codex</button>' : '') +
      '<button class="tab x" data-t="close" title="Close (I)">×</button></div>' +
      '<div class="body"></div></div>';
    el.appendChild(root);
    const body = root.querySelector('.body');
    let open = false, tab = 'char', rec = null, stats = null, picked = null;
    /* touches on the menu are the menu's, not the joystick's */
    for (const t of ['touchstart', 'touchmove', 'touchend']) root.addEventListener(t, e => e.stopPropagation(), { passive: true });
    root.addEventListener('click', e => {
      const t = e.target.closest('[data-t]');
      if (t) { if (t.dataset.t === 'close') close(); else { tab = t.dataset.t; draw(); } return; }
      /* the buttons first: they carry a uid or a slot too */
      const a = e.target.closest('[data-act]');
      if (a) {
        if (a.disabled) return;
        if (a.dataset.act === 'wear') o.ask({ op: 'equip', uid: +a.dataset.uid });
        else if (a.dataset.act === 'make') o.ask({ op: 'craft', recipe: a.dataset.recipe });
        else if (a.dataset.act === 'codex') o.ask({ op: 'codex', species: a.dataset.sp, skill: a.dataset.k });
        else o.ask({ op: 'unequip', slot: a.dataset.slot });
        a.disabled = true; a.textContent = 'Asking the house…';
        return;
      }
      const it = e.target.closest('[data-uid]');
      if (it) { picked = +it.dataset.uid; draw(); return; }
      const sl = e.target.closest('[data-slot]');
      if (sl && rec && rec.eq[sl.dataset.slot]) { picked = rec.eq[sl.dataset.slot]; tab = 'bag'; draw(); return; }
    });
    const wornSlot = uid => { for (const s in rec.eq) if (rec.eq[s] === uid) return s; return null; };
    const statLine = it => [it.dmg ? 'Damage ' + it.dmg[0] + '–' + it.dmg[1] : '', it.def ? 'Defence ' + it.def : '',
      ...Object.keys(it.at || {}).map(k => '+' + it.at[k] + ' ' + rpg.ATTRS[k])].filter(Boolean).join(' · ');
    const slotName = s => (rpg.SLOTS.find(x => x[0] === s) || [s, s, s])[2];
    const reqName = k => (rpg.PROFS[k] ? rpg.PROFS[k].name + ' level ' : rpg.ATTRS[k] + ' ');
    const pct = v => Math.round(v * 100) + '%';
    const groups = table => { const g = {}; for (const k in table) (g[table[k].group] = g[table[k].group] || []).push(k); return g; };
    function draw() {
      root.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
      if (!rec) { body.innerHTML = '<p class="muted">The house keeps what you carry and what you have learnt. It has not sent your record yet ' +
        '(it is only kept while the house is in the world, and for a player signed in with a wallet).</p>'; return; }
      if (tab === 'char') {
        let slots = '';
        for (const [s, , label] of rpg.SLOTS) {
          const it = rec.eq[s] && rpg.itemOf(rec, rec.eq[s]);
          slots += '<div class="slot' + (it ? ' full' : '') + '" data-slot="' + s + '"><small>' + esc(label) + '</small>' + (it ? esc(it.name) : '<span class="muted">—</span>') + '</div>';
        }
        let attrs = '';
        for (const k in rpg.ATTRS) attrs += '<div class="row"><span>' + rpg.ATTRS[k] + '</span><b>' + stats.attrs[k] + '</b></div>';
        body.innerHTML = '<div class="cols"><div class="col" style="flex:2"><h4>Worn</h4><div class="slots">' + slots + '</div></div>' +
          '<div class="col"><h4>Attributes</h4>' + attrs + '<h4 style="margin-top:14px">In a fight</h4>' +
          '<div class="row"><span>Hit points</span><b>' + stats.hp + '</b></div>' +
          '<div class="row"><span>Weapon</span><b>' + esc(stats.weapon) + '</b></div>' +
          '<div class="row"><span>Chance to hit</span><b>' + pct(stats.hit) + '</b></div>' +
          '<div class="row"><span>Damage</span><b>' + stats.dmg[0] + '–' + stats.dmg[1] + (stats.bonus ? ' +' + stats.bonus : '') + '</b></div>' +
          '<div class="row"><span>Defence</span><b>' + stats.def + '</b></div>' +
          '<div class="row"><span>Chance to dodge</span><b>' + pct(stats.evade) + '</b></div></div></div>';
      } else if (tab === 'skills') {
        /* skills rise only by doing: every blow, miss, dodge and felled tree. A foe or a task at your level teaches the
           most; the more you know, the slower it goes, but it never stops and never falls back. */
        let h = '<p class="muted">Skills rise by doing. A foe or task at your own level teaches the most, an easy one little. ' +
          'Nothing is ever lost.</p><div class="cols">';
        const g = groups(rpg.SKILLS);
        for (const name in g) {
          h += '<div class="col"><h4>' + esc(name) + '</h4>';
          for (const k of g[name]) {
            const pts = rec.sk[k] || 0, [rk, from, to] = rpg.rank(pts);
            h += '<div class="row"><span>' + esc(rpg.SKILLS[k].name) + '</span><b>' + esc(rk) + '</b></div>' +
              '<div class="bar"><i style="width:' + (to ? 100 * (pts - from) / (to - from) : 100) + '%"></i></div>' +
              '<div class="muted" style="font-size:11px;margin:-6px 0 8px">' + pts.toFixed(1) + ' points' + (to ? ' · ' + (to - pts).toFixed(1) + ' to the next rank' : '') + '</div>';
          }
          h += '</div>';
        }
        h += '<div class="col"><h4>Attributes</h4>';
        for (const k in rpg.ATTRS) { const pts = rec.at[k] || 0, into = pts % 25; h += '<div class="row"><span>' + rpg.ATTRS[k] + ' ' + rpg.attr(rec, k) + '</span><span class="muted">' + into.toFixed(1) + ' / 25</span></div>'; }
        body.innerHTML = h + '</div></div>';
      } else if (tab === 'profs') {
        /* professions are weighted sums of skills: what each is made of, and how far to its next level */
        let h = '<p class="muted">A profession is made of several skills; a skill counts in each profession it belongs to. ' +
          'Professions decide how well you hit, how hard, what you can wear and what you can make.</p><div class="cols">';
        const g = groups(rpg.PROFS);
        for (const name in g) {
          h += '<div class="col"><h4>' + esc(name) + '</h4>';
          for (const k of g[name]) {
            const lv = stats.prof[k] || 0, w = rpg.PROFS[k].w;
            const parts = Object.keys(w).map(x => (rpg.SKILLS[x] ? rpg.SKILLS[x].name : rpg.ATTRS[x]) + ' ' + Math.round(w[x] * 100) + '%').join(', ');
            h += '<div class="row"><span>' + esc(rpg.PROFS[k].name) + '</span><b>' + lv.toFixed(1) + '</b></div>' +
              '<div class="bar"><i style="width:' + (100 * (lv % 1)) + '%"></i></div>' +
              '<div class="muted" style="font-size:11px;margin:-6px 0 8px">' + esc(parts) + '</div>';
          }
          h += '</div>';
        }
        body.innerHTML = h + '</div>';
      } else if (tab === 'quests') {
        /* the quest log: what is under way (and how far), what waits to be handed in, what is done */
        const qs = o.quests || [], names = { offer: 'Open', active: 'Under way', ready: 'Hand it in', done: 'Done' };
        const label = p => p[0] === 'make' ? 'Made' : (o.wild && o.wild.species[p[0]] ? o.wild.species[p[0]].name + 's killed' : (rpg.ITEMS[p[0]] || {}).name || p[0]);
        let h = '<p class="muted">People in Blockshire have work for you. Talk to them (E) to take a quest and to hand it in.</p>';
        for (const st of ['ready', 'active', 'offer', 'done']) {
          const list = qs.filter(q => rpg.questState(rec, q) === st);
          if (!list.length) continue;
          h += '<h4 style="margin-top:12px">' + names[st] + '</h4>';
          for (const q of list) {
            const pr = rpg.questProgress(rec, q).parts.map(p => '<span class="' + (p[1] >= p[2] ? 'good' : 'bad') + '">' + esc(label(p)) + ' ' + p[1] + '/' + p[2] + '</span>').join(' · ');
            h += '<div class="detail" style="margin-top:6px"><b>' + esc(q.title) + '</b> <span class="muted">· ' + esc(q.giver || q.npc) + '</span>' +
              (st === 'done' ? '' : '<div class="muted" style="margin-top:4px">' + esc(q.offer) + '</div>') + (st === 'active' || st === 'ready' ? '<div>' + pr + '</div>' : '') + '</div>';
          }
        }
        body.innerHTML = h;
      } else if (tab === 'codex') {
        /* Entropia's codex: kills of each kind count; at each rank a reward of skill points, put where you choose */
        const C = rpg.CODEX, cx = rec.cx || {}, done = rec.cxc || {};
        let h = '<p class="muted">Every beast you kill counts. At each rank the codex gives skill points: you choose which of the skills that beast teaches gets them.</p>';
        for (const sp in o.wild.species) {
          const def = o.wild.species[sp], n = cx[sp] || 0, reached = C.ranks.filter(k => n >= k).length, claimed = done[sp] || 0;
          const next = C.ranks[reached], prev = reached ? C.ranks[reached - 1] : 0;
          h += '<div class="detail" style="margin-top:8px"><b>' + esc(def.name) + '</b> <span class="muted">· rank ' + reached + ' · ' + n + ' killed</span>' +
            '<div class="bar"><i style="width:' + (next ? 100 * (n - prev) / (next - prev) : 100) + '%"></i></div>' +
            '<div class="muted" style="font-size:11px">' + (next ? (next - n) + ' more to rank ' + (reached + 1) : 'every rank reached') + '</div>';
          if (claimed < reached) {
            h += '<div class="good" style="margin-top:6px">Reward waiting: +' + C.reward[claimed] + ' skill points. Put them into:</div>';
            for (const k of def.codex || []) h += '<button class="act" style="margin-right:6px" data-act="codex" data-sp="' + sp + '" data-k="' + k + '">' + esc((rpg.SKILLS[k] || {}).name || rpg.ATTRS[k]) + '</button>';
          }
          h += '</div>';
        }
        body.innerHTML = h;
      } else if (tab === 'craft') {
        /* the recipes this player knows, by craft: what each needs (have / need), what it makes, and Make -- at the forge */
        const at = o.atForge ? o.atForge() : false;
        let h = at ? '<p class="muted">At the forge. Making teaches the craft; now and then a new recipe turns up while you work.</p>'
                   : '<p class="bad">Walk to the forge in Blockshire (east of the square) to make things. You can look at your recipes here.</p>';
        let hidden = 0;
        for (const craft of ['smith', 'carpenter', 'tailor']) {
          const sk = rpg.PROFS[craft], lv = stats.prof[craft] || 0;
          h += '<h4 style="margin-top:12px">' + esc(sk.name) + ' · level ' + lv.toFixed(1) + '</h4>';
          for (const rid in rpg.RECIPES) {
            const rc = rpg.RECIPES[rid]; if (rc.prof !== craft) continue;
            if (!rpg.knows(rec, rid)) { hidden++; continue; }
            const it = rpg.ITEMS[rid], tooLow = lv < rc.level;
            let enough = true;
            const needs = Object.keys(rc.needs).map(m => { const have = rec.mat[m] || 0, ok = have >= rc.needs[m]; if (!ok) enough = false;
              return '<span class="' + (ok ? 'good' : 'bad') + '">' + esc(rpg.ITEMS[m].name) + ' ' + have + '/' + rc.needs[m] + '</span>'; }).join(' · ');
            h += '<div class="detail" style="margin-top:6px"><b>' + esc(it.name) + '</b> <span class="muted">' + esc(statLine(it) || '') + '</span>' +
              '<div>' + needs + (rc.level ? ' · <span class="' + (tooLow ? 'bad' : 'good') + '">' + esc(sk.name) + ' level ' + rc.level + '</span>' : '') + '</div>' +
              '<button class="act" data-act="make" data-recipe="' + rid + '"' + (at && enough && !tooLow ? '' : ' disabled') + '>Make</button></div>';
          }
        }
        if (hidden) h += '<p class="muted" style="margin-top:12px">' + hidden + ' more recipes are still to be found.</p>';
        body.innerHTML = h;
      } else {
        let mats = '';
        for (const id in rec.mat) if (rec.mat[id] > 0) mats += '<div class="row"><span>' + esc(rpg.ITEMS[id] ? rpg.ITEMS[id].name : id) + '</span><b>× ' + rec.mat[id] + '</b></div>';
        let grid = '';
        for (const [uid, id] of rec.bag) {
          const it = rpg.ITEMS[id]; if (!it) continue;
          grid += '<div class="item' + (wornSlot(uid) ? ' worn' : '') + (picked === uid ? ' sel' : '') + '" data-uid="' + uid + '"><b>' + esc(it.name) + '</b><small>' +
            esc(slotName(it.slot === 'main' ? 'main' : (rpg.SLOTS.find(x => x[1] === it.slot) || [it.slot])[0])) + (wornSlot(uid) ? ' · worn' : '') + '</small></div>';
        }
        let detail = '';
        const it = picked != null && rpg.itemOf(rec, picked);
        if (it) {
          const unmet = rpg.meets(rec, it), worn = wornSlot(it.uid);
          const req = Object.keys(it.req || {}).map(k => reqName(k) + it.req[k]);
          detail = '<div class="detail"><b>' + esc(it.name) + '</b><div>' + esc(statLine(it) || 'no numbers') + '</div>' +
            (req.length ? '<div class="' + (unmet.length ? 'bad' : 'good') + '">Needs ' + esc(req.join(', ')) + '</div>' : '<div class="muted">Anybody can use it</div>') +
            (worn ? '<button class="act" data-act="off" data-slot="' + worn + '">Take off</button>'
                  : '<button class="act" data-act="wear" data-uid="' + it.uid + '"' + (unmet.length ? ' disabled' : '') + '>Wear</button>') + '</div>';
        }
        body.innerHTML = '<div class="cols"><div class="col" style="flex:2"><h4>Things</h4>' + (grid ? '<div class="grid">' + grid + '</div>' : '<p class="muted">Nothing yet.</p>') + detail + '</div>' +
          '<div class="col"><h4>Materials</h4>' + (mats || '<p class="muted">None yet. Raiders drop some; the forest will give more.</p>') + '</div></div>';
      }
    }
    function close() { open = false; root.style.display = 'none'; }
    return {
      open(t) { if (t) tab = t; open = true; root.style.display = 'flex'; draw(); },
      close, isOpen: () => open,
      update(r, s) { rec = r; stats = s; if (open) draw(); }
    };
  }

  const menu = { api: 1, create };
  if (G.LWQ && G.LWQ.define) G.LWQ.define('menu', { api: 1, v: 4 }, () => menu);
})(typeof globalThis !== 'undefined' ? globalThis : this);
