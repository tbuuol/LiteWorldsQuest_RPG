/* LiteWorldsQuest rpg module: what a player is -- skills, attributes, job levels, items, equipment -- and the house's
   book of every player (tbuuol 2026-10-23: "the house keeps it; it rolls the damage").
     rpg.SLOTS, rpg.SKILLS, rpg.ATTRS, rpg.ITEMS            the rules, as data
     rpg.fresh(address)       -> record                     a new player: starter items in the bag, fists in hand
     rpg.stats(record)        -> {hp, def, dmg: [min, max], skill, model, attrs, jobs}   what the record adds up to
     rpg.jobs(record)         -> {sword: 1, ...}            job levels (100 points a level; melee 1000 = +1 on all)
     rpg.meets(record, item)  -> [] or the unmet requirements
     const book = rpg.book()  the house's book: book.load(json), book.dump(), book.of(address)
       book.strike(address, targetDef)  -> {d, gains}       a blow: rolled, less the target's defence; skill points
       book.struck(address, d)          -> d                a raider's blow on the player, less the player's defence
       book.loot(address, rnd)          -> [item names]     a kill's drop, straight into the bag
       book.equip(address, uid) / book.unequip(address, slot)  -> {ok, why}
   A RECORD: {v, a: address, sk: {skill: points}, at: {attr: points}, bag: [[uid, itemId]], mat: {material: count},
   eq: {slot: uid}, n: next uid}. Attributes are 10 plus a point for every 25 earned. Everything is the house's: a
   player only ever sees its own record, sent by the house. */
(function (G) {
  'use strict';
  /* the 19 places a thing can be worn: [slot, kind of thing that fits, label] */
  const SLOTS = [
    ['head', 'head', 'Head'], ['shoulders', 'shoulders', 'Shoulders'], ['hands', 'hands', 'Gloves'], ['chest', 'chest', 'Chest'],
    ['legs', 'legs', 'Legs'], ['feet', 'feet', 'Feet'], ['belt', 'belt', 'Belt'], ['wrists', 'wrists', 'Wrists'],
    ['main', 'main', 'Right hand'], ['off', 'off', 'Left hand'],
    ['amulet1', 'amulet', 'Amulet'], ['amulet2', 'amulet', 'Amulet'],
    ['trinket1', 'trinket', 'Trinket'], ['trinket2', 'trinket', 'Trinket'], ['trinket3', 'trinket', 'Trinket'],
    ['ring1', 'ring', 'Ring'], ['ring2', 'ring', 'Ring'], ['ring3', 'ring', 'Ring'], ['ring4', 'ring', 'Ring']];
  /* skills: points earned by doing; a job level every `per` points */
  const SKILLS = {
    melee: { name: 'Melee', per: 1000, all: ['sword', 'axe', 'mace', 'unarmed'] },   /* +1 on every melee weapon */
    sword: { name: 'Swordsman', per: 100 }, axe: { name: 'Axeman', per: 100 }, mace: { name: 'Maceman', per: 100 },
    unarmed: { name: 'Brawler', per: 100 }, defense: { name: 'Defender', per: 100 }
  };
  const ATTRS = { str: 'Strength', sta: 'Stamina', dex: 'Dexterity', int: 'Intelligence' };
  /* things. slot: what fits where (main/off: a hand). dmg: a weapon's roll; def: armour; at: attributes it adds;
     req: what it needs (job levels by skill, attribute values); starter: given to a new player. */
  const ITEMS = {
    training_sword: { name: 'Training Sword', slot: 'main', skill: 'sword', model: 'sword', dmg: [4, 8], starter: true, look: '#b8bfc8' },
    linen_shirt: { name: 'Linen Shirt', slot: 'chest', def: 1, starter: true },
    worn_boots: { name: 'Worn Boots', slot: 'feet', def: 1, starter: true },
    rusty_sword: { name: 'Rusty Sword', slot: 'main', skill: 'sword', model: 'sword', dmg: [6, 11], req: { sword: 1 }, look: '#9a6b4b' },
    raider_axe: { name: "Raider's Axe", slot: 'main', skill: 'axe', model: 'axe', dmg: [5, 13], req: { str: 11 } },
    cudgel: { name: 'Cudgel', slot: 'main', skill: 'mace', model: 'mace', dmg: [5, 9] },
    wooden_buckler: { name: 'Wooden Buckler', slot: 'off', model: 'shield', def: 3, req: { defense: 1 } },
    leather_cap: { name: 'Leather Cap', slot: 'head', def: 2 },
    padded_gloves: { name: 'Padded Gloves', slot: 'hands', def: 1, at: { dex: 1 } },
    copper_ring: { name: 'Copper Ring', slot: 'ring', at: { str: 1 } },
    bone_amulet: { name: 'Bone Amulet', slot: 'amulet', at: { sta: 2 }, req: { sta: 11 } },
    lucky_coin: { name: 'Lucky Coin', slot: 'trinket', at: { dex: 2 } },
    /* raw materials: counted, not worn */
    scrap_iron: { name: 'Scrap Iron', material: true }, torn_cloth: { name: 'Torn Cloth', material: true },
    leather_scrap: { name: 'Leather Scrap', material: true }
  };
  const FISTS = { name: 'Fists', skill: 'unarmed', model: 'fists', dmg: [2, 4] };
  /* what a raider leaves, each by its own chance */
  const LOOT = [['torn_cloth', 0.35], ['scrap_iron', 0.2], ['leather_scrap', 0.2], ['rusty_sword', 0.05], ['leather_cap', 0.05],
                ['copper_ring', 0.04], ['wooden_buckler', 0.03], ['raider_axe', 0.03], ['cudgel', 0.04], ['padded_gloves', 0.03],
                ['lucky_coin', 0.015], ['bone_amulet', 0.015]];

  function fresh(address) {
    const r = { v: 1, a: address, sk: {}, at: {}, bag: [], mat: {}, eq: {}, n: 1 };
    for (const id in ITEMS) if (ITEMS[id].starter) r.bag.push([r.n++, id]);
    return r;
  }
  const attr = (r, k) => 10 + Math.floor((r.at[k] || 0) / 25);
  function jobs(r) {
    const out = {}, melee = Math.floor((r.sk.melee || 0) / SKILLS.melee.per);
    for (const k in SKILLS) {
      if (k === 'melee') { out.melee = melee; continue; }
      out[k] = Math.floor((r.sk[k] || 0) / SKILLS[k].per) + (SKILLS.melee.all.includes(k) ? melee : 0);
    }
    return out;
  }
  const itemOf = (r, uid) => { const e = r.bag.find(b => b[0] === uid); return e ? Object.assign({ uid, id: e[1] }, ITEMS[e[1]]) : null; };
  function stats(r) {
    const at = {}; for (const k in ATTRS) at[k] = attr(r, k);
    let def = 0;
    for (const s in r.eq) {
      const it = itemOf(r, r.eq[s]); if (!it) continue;
      def += it.def || 0;
      for (const k in it.at || {}) at[k] += it.at[k];
    }
    const j = jobs(r), main = r.eq.main ? itemOf(r, r.eq.main) : null, w = main && main.dmg ? main : FISTS;
    def += Math.floor((at.sta - 10) / 4) + j.defense;
    return { hp: 100 + (at.sta - 10) * 5, def, dmg: w.dmg, skill: w.skill, model: w.model, weapon: w.name, attrs: at, jobs: j,
             bonus: Math.floor((at.str - 10) / 3) + (j[w.skill] || 0) };
  }
  function meets(r, item) {
    const unmet = [], j = jobs(r), st = stats(r);
    for (const k in item.req || {}) {
      const have = SKILLS[k] ? j[k] : st.attrs[k];
      if ((have || 0) < item.req[k]) unmet.push((SKILLS[k] ? SKILLS[k].name + ' level ' : ATTRS[k] + ' ') + item.req[k]);
    }
    return unmet;
  }
  const gain = (r, sk, at) => { for (const k in sk) r.sk[k] = (r.sk[k] || 0) + sk[k]; for (const k in at) r.at[k] = (r.at[k] || 0) + at[k]; };

  /* --- the house's book ---------------------------------------------------------------------------------- */
  function book() {
    const recs = new Map();
    const of = a => { if (!recs.has(a)) recs.set(a, fresh(a)); return recs.get(a); };
    return {
      of, has: a => recs.has(a),
      load(json) { try { const all = typeof json === 'string' ? JSON.parse(json) : json; for (const a in all || {}) if (all[a] && all[a].v === 1) recs.set(a, all[a]); } catch (e) { /* a bad file: begin empty */ } return recs.size; },
      dump() { const o = {}; for (const [a, r] of recs) o[a] = r; return o; },
      /* a blow by this player: the weapon's roll, plus strength and job level, less the target's defence; and what
         doing it teaches (the weapon's skill and melee; strength and stamina, a little) */
      strike(a, targetDef, rnd) {
        const r = of(a), s = stats(r), roll = s.dmg[0] + Math.floor((rnd || Math.random)() * (s.dmg[1] - s.dmg[0] + 1));
        const d = Math.max(1, roll + s.bonus - (targetDef || 0));
        const lv = jobs(r), sk = { melee: 1 }; sk[s.skill] = 1;
        gain(r, sk, { str: 0.4, sta: 0.2 });
        const up = []; const lv2 = jobs(r);
        for (const k in lv2) if (lv2[k] > lv[k]) up.push(SKILLS[k].name + ' level ' + lv2[k]);
        return { d, up };
      },
      /* a raider's blow on this player: less the player's defence; taking it teaches defence and stamina */
      struck(a, d) {
        const r = of(a), s = stats(r); gain(r, { defense: 1 }, { sta: 0.3 });
        return Math.max(1, Math.round(d - s.def));
      },
      loot(a, rnd) {
        const r = of(a), got = []; rnd = rnd || Math.random;
        for (const [id, p] of LOOT) {
          if (rnd() >= p) continue;
          if (ITEMS[id].material) r.mat[id] = (r.mat[id] || 0) + 1; else r.bag.push([r.n++, id]);
          got.push(ITEMS[id].name);
        }
        return got;
      },
      equip(a, uid) {
        const r = of(a), it = itemOf(r, uid);
        if (!it || it.material || !it.slot) return { ok: false, why: 'that is not something to wear' };
        const unmet = meets(r, it);
        if (unmet.length) return { ok: false, why: 'needs ' + unmet.join(', ') };
        for (const s in r.eq) if (r.eq[s] === uid) delete r.eq[s];
        /* a weapon fits either hand (two weapons, or one and a shield); a shield or talisman only the left */
        const fits = it.slot === 'main' ? ['main', 'off'] : SLOTS.filter(x => x[1] === it.slot).map(x => x[0]);
        const slot = fits.find(s => !r.eq[s]) || fits[0];
        r.eq[slot] = uid;
        return { ok: true, slot };
      },
      unequip(a, slot) { const r = of(a); if (!r.eq[slot]) return { ok: false, why: 'nothing there' }; delete r.eq[slot]; return { ok: true }; }
    };
  }

  const rpg = { api: 1, SLOTS, SKILLS, ATTRS, ITEMS, FISTS, LOOT, fresh, stats, jobs, meets, itemOf, attr, book };
  if (G.LWQ && G.LWQ.define) G.LWQ.define('rpg', { api: 1, v: 1 }, () => rpg);
})(typeof globalThis !== 'undefined' ? globalThis : this);
