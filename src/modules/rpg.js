/* LiteWorldsQuest rpg module: what a player is -- skills, attributes, professions, items, equipment -- and the house's
   book of every player (tbuuol 2026-10-23: "the house keeps it; it rolls the damage").
   THE SYSTEM (tbuuol 2026-10-27: "looks like WoW, works like Entropia Universe"): no classes, no levels, no XP bar.
   Doing a thing raises the skills it uses -- every blow, miss, dodge, felled tree and forged sword -- and the gain
   depends on the effort (a foe at your own level teaches a lot, a trivial one almost nothing) and grows smaller the
   more you know, without a cap. Skills never fall. PROFESSIONS are weighted sums of skills and attributes (a skill
   counts in several), and they are what does the work: hitting and damage are separate professions per weapon,
   gathering yields and recipes need theirs, and things to wear ask for a profession's level.
     rpg.SLOTS, rpg.SKILLS, rpg.PROFS, rpg.ATTRS, rpg.ITEMS, rpg.RANKS     the rules, as data
     rpg.fresh(address)       -> record                     a new player: starter items in the bag, fists in hand
     rpg.stats(record)        -> {hp, def, dmg, bonus, hit, evade, weapon, hitProf, dmgProf, attrs, prof}
     rpg.profs(record)        -> {sword_hit: 1.37, ...}     every profession's level (a weighted 100 points a level)
     rpg.rank(points)         -> [name, from, to]           a skill's rank, for the menu
     rpg.meets(record, item)  -> [] or the unmet requirements
     const book = rpg.book()  the house's book: book.load(json), book.dump(), book.of(address)
       book.strike(address, targetDef, targetLvl) -> {d, miss, up}   a blow: hit or miss, rolled, less the defence
       book.struck(address, d, foeLvl)            -> {d, dodged, up} a foe's blow on the player
       book.loot / gather / craft / equip / unequip
   A RECORD: {v: 2, a: address, sk: {skill: points}, at: {attr: points}, bag: [[uid, itemId]], mat: {material: count},
   eq: {slot: uid}, rk: [recipe], n: next uid}. Attributes are 10 plus one for every 25 points. Records of the old
   system (v 1) are not taken over: everybody begins again (tbuuol 2026-10-27). */
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
  const ATTRS = { str: 'Strength', sta: 'Stamina', dex: 'Agility', int: 'Intelligence' };
  /* skills: raised only by doing them */
  const SKILLS = {
    sword: { name: 'Swordsmanship', group: 'Combat' }, axe: { name: 'Axe Fighting', group: 'Combat' },
    mace: { name: 'Mace Fighting', group: 'Combat' }, unarmed: { name: 'Brawling', group: 'Combat' },
    melee: { name: 'Melee Combat', group: 'Combat' }, anatomy: { name: 'Anatomy', group: 'Combat' },
    evade: { name: 'Evade', group: 'Combat' }, toughness: { name: 'Toughness', group: 'Combat' },
    woodcutting: { name: 'Woodcutting', group: 'Gathering' }, mining: { name: 'Mining', group: 'Gathering' },
    herbalism: { name: 'Herbalism', group: 'Gathering' },
    smithing: { name: 'Smithing', group: 'Crafting' }, woodworking: { name: 'Woodworking', group: 'Crafting' },
    tailoring: { name: 'Tailoring', group: 'Crafting' }
  };
  /* professions: what each is made of (weights add up to 1; attribute points count like skill points) */
  const PROFS = {
    sword_hit: { name: 'Swordsman (hit)', group: 'Combat', w: { sword: 0.45, melee: 0.25, dex: 0.2, evade: 0.1 } },
    sword_dmg: { name: 'Swordsman (damage)', group: 'Combat', w: { sword: 0.4, anatomy: 0.35, str: 0.25 } },
    axe_hit: { name: 'Axeman (hit)', group: 'Combat', w: { axe: 0.45, melee: 0.25, dex: 0.2, woodcutting: 0.1 } },
    axe_dmg: { name: 'Axeman (damage)', group: 'Combat', w: { axe: 0.4, anatomy: 0.3, str: 0.2, woodcutting: 0.1 } },
    mace_hit: { name: 'Maceman (hit)', group: 'Combat', w: { mace: 0.45, melee: 0.25, dex: 0.2, toughness: 0.1 } },
    mace_dmg: { name: 'Maceman (damage)', group: 'Combat', w: { mace: 0.4, anatomy: 0.3, str: 0.3 } },
    unarmed_hit: { name: 'Brawler (hit)', group: 'Combat', w: { unarmed: 0.5, melee: 0.3, dex: 0.2 } },
    unarmed_dmg: { name: 'Brawler (damage)', group: 'Combat', w: { unarmed: 0.4, anatomy: 0.3, str: 0.3 } },
    evader: { name: 'Evader', group: 'Combat', w: { evade: 0.6, dex: 0.3, melee: 0.1 } },
    defender: { name: 'Defender', group: 'Combat', w: { toughness: 0.6, sta: 0.3, anatomy: 0.1 } },
    woodcutter: { name: 'Woodcutter', group: 'Gathering', w: { woodcutting: 0.7, str: 0.2, sta: 0.1 } },
    miner: { name: 'Miner', group: 'Gathering', w: { mining: 0.7, str: 0.2, sta: 0.1 } },
    herbalist: { name: 'Herbalist', group: 'Gathering', w: { herbalism: 0.7, int: 0.2, dex: 0.1 } },
    smith: { name: 'Smith', group: 'Crafting', w: { smithing: 0.6, mining: 0.2, str: 0.2 } },
    carpenter: { name: 'Carpenter', group: 'Crafting', w: { woodworking: 0.6, woodcutting: 0.2, dex: 0.2 } },
    tailor: { name: 'Tailor', group: 'Crafting', w: { tailoring: 0.6, herbalism: 0.2, dex: 0.2 } }
  };
  /* a skill's standing, by its points: the names say how far along it is, the bar shows the way to the next */
  const RANKS = [[0, 'Untrained'], [25, 'Novice'], [100, 'Apprentice'], [250, 'Journeyman'], [500, 'Adept'], [1000, 'Expert'],
                 [2000, 'Master'], [4000, 'Grandmaster'], [8000, 'Legend']];
  /* a weapon's skill and the two professions that use it */
  const WEAPON = { sword: ['sword_hit', 'sword_dmg'], axe: ['axe_hit', 'axe_dmg'], mace: ['mace_hit', 'mace_dmg'], unarmed: ['unarmed_hit', 'unarmed_dmg'] };
  /* things. slot: what fits where (main/off: a hand). skill: a weapon's kind; dmg: its roll; def: armour; at:
     attributes it adds; req: what it needs (profession levels, attribute values); starter: given to a new player. */
  const ITEMS = {
    training_sword: { name: 'Training Sword', slot: 'main', skill: 'sword', model: 'sword', dmg: [4, 8], starter: true, look: '#b8bfc8' },
    linen_shirt: { name: 'Linen Shirt', slot: 'chest', def: 1, starter: true },
    worn_boots: { name: 'Worn Boots', slot: 'feet', def: 1, starter: true },
    rusty_sword: { name: 'Rusty Sword', slot: 'main', skill: 'sword', model: 'sword', dmg: [6, 11], req: { sword_hit: 1 }, look: '#9a6b4b' },
    raider_axe: { name: "Raider's Axe", slot: 'main', skill: 'axe', model: 'axe', dmg: [5, 13], req: { str: 11 } },
    cudgel: { name: 'Cudgel', slot: 'main', skill: 'mace', model: 'mace', dmg: [5, 9] },
    wooden_buckler: { name: 'Wooden Buckler', slot: 'off', model: 'shield', def: 3, req: { defender: 1 } },
    leather_cap: { name: 'Leather Cap', slot: 'head', def: 2 },
    padded_gloves: { name: 'Padded Gloves', slot: 'hands', def: 1, at: { dex: 1 } },
    copper_ring: { name: 'Copper Ring', slot: 'ring', at: { str: 1 } },
    bone_amulet: { name: 'Bone Amulet', slot: 'amulet', at: { sta: 2 }, req: { sta: 11 } },
    lucky_coin: { name: 'Lucky Coin', slot: 'trinket', at: { dex: 2 } },
    /* raw materials: counted, not worn */
    scrap_iron: { name: 'Scrap Iron', material: true }, torn_cloth: { name: 'Torn Cloth', material: true },
    leather_scrap: { name: 'Leather Scrap', material: true },
    /* made at the forge */
    copper_sword: { name: 'Copper Sword', slot: 'main', skill: 'sword', model: 'sword', dmg: [6, 10], look: '#c87533' },
    copper_axe: { name: 'Copper Axe', slot: 'main', skill: 'axe', model: 'axe', dmg: [6, 12], look: '#c87533' },
    copper_bracers: { name: 'Copper Bracers', slot: 'wrists', def: 2 },
    iron_sword: { name: 'Iron Sword', slot: 'main', skill: 'sword', model: 'sword', dmg: [9, 15], req: { sword_hit: 2 } },
    iron_mace: { name: 'Iron Mace', slot: 'main', skill: 'mace', model: 'mace', dmg: [8, 14], req: { mace_hit: 1, str: 12 } },
    iron_helm: { name: 'Iron Helm', slot: 'head', def: 4, req: { defender: 1 } },
    iron_ring: { name: 'Iron Ring', slot: 'ring', at: { str: 1, sta: 1 }, req: { sta: 11 } },
    oak_shield: { name: 'Oak Shield', slot: 'off', model: 'shield', def: 4, look: '#9a7448' },
    oak_belt_charm: { name: 'Oak Charm', slot: 'trinket', at: { sta: 1, dex: 1 } },
    flax_tunic: { name: 'Flax Tunic', slot: 'chest', def: 2, at: { dex: 1 } },
    leather_boots: { name: 'Leather Boots', slot: 'feet', def: 2 },
    leather_belt: { name: 'Leather Belt', slot: 'belt', def: 1, at: { sta: 1 } },
    herb_amulet: { name: 'Herb Amulet', slot: 'amulet', at: { int: 2, sta: 1 }, req: { int: 11 } },
    oak_log: { name: 'Oak Log', material: true }, copper_ore: { name: 'Copper Ore', material: true },
    iron_ore: { name: 'Iron Ore', material: true }, wild_herb: { name: 'Wild Herb', material: true }, flax: { name: 'Flax', material: true }
  };
  /* what gathering a kind of thing gives: [material, chance, more per level of the profession], the skill it teaches,
     its profession, how hard it is (for the effort), and the attributes it trains */
  const GATHER = {
    tree: { skill: 'woodcutting', prof: 'woodcutter', lvl: 0, verb: 'chop', yields: [['oak_log', 1, 0.15]], at: { str: 0.3, sta: 0.2 } },
    rock: { skill: 'mining', prof: 'miner', lvl: 1, verb: 'mine', yields: [['copper_ore', 0.8, 0.05], ['iron_ore', 0.12, 0.1]], at: { str: 0.4, sta: 0.2 } },
    herb: { skill: 'herbalism', prof: 'herbalist', lvl: 0, verb: 'gather', yields: [['wild_herb', 1, 0.15], ['flax', 0.35, 0.05]], at: { dex: 0.3, int: 0.2 } }
  };
  /* RECIPES: the craft's skill, its profession and the level of it they need; known: everybody knows it from the
     start, the others turn up now and then while crafting (tbuuol 2026-10-23) */
  const RECIPES = {
    copper_sword: { skill: 'smithing', prof: 'smith', level: 0, needs: { copper_ore: 3, oak_log: 1 }, known: true },
    copper_axe: { skill: 'smithing', prof: 'smith', level: 0, needs: { copper_ore: 3, oak_log: 2 }, known: true },
    copper_bracers: { skill: 'smithing', prof: 'smith', level: 0, needs: { copper_ore: 2, leather_scrap: 1 }, known: true },
    oak_shield: { skill: 'woodworking', prof: 'carpenter', level: 0, needs: { oak_log: 3, leather_scrap: 1 }, known: true },
    oak_belt_charm: { skill: 'woodworking', prof: 'carpenter', level: 0, needs: { oak_log: 1, wild_herb: 1 }, known: true },
    flax_tunic: { skill: 'tailoring', prof: 'tailor', level: 0, needs: { flax: 4 }, known: true },
    leather_belt: { skill: 'tailoring', prof: 'tailor', level: 0, needs: { leather_scrap: 2 }, known: true },
    iron_sword: { skill: 'smithing', prof: 'smith', level: 1, needs: { iron_ore: 4, oak_log: 1, leather_scrap: 1 } },
    iron_mace: { skill: 'smithing', prof: 'smith', level: 1, needs: { iron_ore: 4, oak_log: 1 } },
    iron_helm: { skill: 'smithing', prof: 'smith', level: 1, needs: { iron_ore: 3, torn_cloth: 1 } },
    iron_ring: { skill: 'smithing', prof: 'smith', level: 2, needs: { iron_ore: 1, copper_ore: 1 } },
    leather_boots: { skill: 'tailoring', prof: 'tailor', level: 1, needs: { leather_scrap: 3, torn_cloth: 1 } },
    herb_amulet: { skill: 'tailoring', prof: 'tailor', level: 1, needs: { wild_herb: 3, flax: 1, copper_ore: 1 } }
  };
  const CRAFT_AT = { smithing: { str: 0.5, int: 0.3 }, woodworking: { dex: 0.3, str: 0.2 }, tailoring: { dex: 0.4, int: 0.2 } };
  const RECIPE_DROP = 0.04;   /* very low: a recipe of the craft being done, up to a level above the crafter's */
  const knows = (r, rid) => !!RECIPES[rid] && (RECIPES[rid].known || (r.rk || []).includes(rid));
  const FISTS = { name: 'Fists', skill: 'unarmed', model: 'fists', dmg: [2, 4] };
  /* what a raider leaves, each by its own chance */
  const LOOT = [['torn_cloth', 0.35], ['scrap_iron', 0.2], ['leather_scrap', 0.2], ['rusty_sword', 0.05], ['leather_cap', 0.05],
                ['copper_ring', 0.04], ['wooden_buckler', 0.03], ['raider_axe', 0.03], ['cudgel', 0.04], ['padded_gloves', 0.03],
                ['lucky_coin', 0.015], ['bone_amulet', 0.015]];

  function fresh(address) {
    const r = { v: 2, a: address, sk: {}, at: {}, bag: [], mat: {}, eq: {}, n: 1 };
    /* starter clothes are worn from the first moment; the starter sword waits in the bag (fists first, tbuuol) */
    for (const id in ITEMS) if (ITEMS[id].starter) { if (ITEMS[id].slot !== 'main') r.eq[ITEMS[id].slot] = r.n; r.bag.push([r.n++, id]); }
    return r;
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const attr = (r, k) => 10 + Math.floor((r.at[k] || 0) / 25);
  const pointsOf = (r, k) => (ATTRS[k] ? r.at[k] : r.sk[k]) || 0;
  function profs(r) {
    const out = {};
    for (const k in PROFS) { let s = 0; const w = PROFS[k].w; for (const x in w) s += w[x] * pointsOf(r, x); out[k] = s / 100; }
    return out;
  }
  function rank(points) {
    let i = 0; while (i < RANKS.length - 1 && points >= RANKS[i + 1][0]) i++;
    return [RANKS[i][1], RANKS[i][0], i < RANKS.length - 1 ? RANKS[i + 1][0] : null];
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
    const p = profs(r), main = r.eq.main ? itemOf(r, r.eq.main) : null, w = main && main.dmg ? main : FISTS;
    const [hitProf, dmgProf] = WEAPON[w.skill] || WEAPON.unarmed;
    const mul = 0.85 + Math.min(0.4, 0.05 * p[dmgProf]);   /* the damage profession gets the most out of a weapon */
    return {
      hp: 90 + (at.sta - 10) * 5 + Math.floor((r.sk.toughness || 0) / 20) + Math.floor((r.sk.anatomy || 0) / 40),
      def: def + Math.floor(p.defender),
      dmg: [Math.max(1, Math.round(w.dmg[0] * mul)), Math.max(1, Math.round(w.dmg[1] * mul))],
      bonus: Math.floor((at.str - 10) / 3),
      hit: clamp(0.68 + 0.03 * p[hitProf] + (at.dex - 10) * 0.005, 0.5, 0.95),
      evade: clamp(0.03 + 0.012 * p.evader + (at.dex - 10) * 0.004, 0, 0.35),
      skill: w.skill, model: w.model, weapon: w.name, hitProf, dmgProf, attrs: at, prof: p
    };
  }
  function meets(r, item) {
    const unmet = [], p = profs(r), st = stats(r);
    for (const k in item.req || {}) {
      const have = PROFS[k] ? p[k] : st.attrs[k];
      if ((have || 0) < item.req[k]) unmet.push((PROFS[k] ? PROFS[k].name + ' level ' : ATTRS[k] + ' ') + item.req[k]);
    }
    return unmet;
  }
  /* LEARNING: each point earned is worth less the more of it there is (800 points: half), times the effort */
  const learn = (r, gains, effort) => {
    for (const k in gains) {
      const box = ATTRS[k] ? r.at : r.sk, have = box[k] || 0;
      box[k] = Math.round((have + gains[k] * effort / (1 + have / 800)) * 1000) / 1000;
    }
  };
  /* how much a thing teaches: a foe or a task at your own level 1, an easy one less (down to 0.1), a hard one up to 1.5 */
  const effortOf = (taskLvl, yourLvl) => clamp(((taskLvl || 0) + 1) / ((yourLvl || 0) + 1), 0.1, 1.5);
  /* which professions passed a whole level since `before` */
  function ups(r, before) {
    const now = profs(r), out = [];
    for (const k in now) if (Math.floor(now[k]) > Math.floor(before[k])) out.push(PROFS[k].name + ' level ' + Math.floor(now[k]));
    return out;
  }

  /* --- the house's book ---------------------------------------------------------------------------------- */
  function book() {
    const recs = new Map();
    const of = a => { if (!recs.has(a)) recs.set(a, fresh(a)); return recs.get(a); };
    return {
      of, has: a => recs.has(a),
      load(json) { try { const all = typeof json === 'string' ? JSON.parse(json) : json; for (const a in all || {}) if (all[a] && all[a].v === 2) recs.set(a, all[a]); } catch (e) { /* a bad file: begin empty */ } return recs.size; },
      dump() { const o = {}; for (const [a, r] of recs) o[a] = r; return o; },
      /* a blow by this player: the hit profession says whether it lands; a hit is the weapon's roll (made the most of by
         the damage profession) plus strength, less the target's defence. A miss teaches too, a little. */
      strike(a, targetDef, targetLvl, rnd) {
        rnd = rnd || Math.random;
        const r = of(a), s = stats(r), before = profs(r), effort = effortOf(targetLvl, s.prof[s.hitProf]);
        const g = {};
        if (rnd() >= s.hit) {
          g[s.skill] = 0.4; g.melee = 0.2; g.dex = 0.1;
          learn(r, g, effort);
          return { d: 0, miss: true, up: ups(r, before) };
        }
        const roll = s.dmg[0] + Math.floor(rnd() * (s.dmg[1] - s.dmg[0] + 1)), d = Math.max(1, roll + s.bonus - (targetDef || 0));
        g[s.skill] = 1; g.melee = 0.5; g.anatomy = 0.3 + d / 40; g.str = 0.2; g.dex = 0.1;
        learn(r, g, effort);
        return { d, miss: false, up: ups(r, before) };
      },
      /* a foe's blow on this player: dodged (the evader profession), or taken less the player's defence */
      struck(a, d, foeLvl, rnd) {
        rnd = rnd || Math.random;
        const r = of(a), s = stats(r), before = profs(r);
        if (rnd() < s.evade) { learn(r, { evade: 1, dex: 0.2 }, effortOf(foeLvl, s.prof.evader)); return { d: 0, dodged: true, up: ups(r, before) }; }
        learn(r, { toughness: 0.6, sta: 0.25 }, effortOf(foeLvl, s.prof.defender));
        return { d: Math.max(1, Math.round(d - s.def)), dodged: false, up: ups(r, before) };
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
      /* gathering: what the thing gives (each by its chance, better with the profession), straight into the bag */
      gather(a, kind, rnd) {
        const r = of(a), g = GATHER[kind]; rnd = rnd || Math.random;
        if (!g) return { got: [], up: [] };
        const before = profs(r), lv = before[g.prof], got = [];
        for (const [id, p, more] of g.yields) {
          if (rnd() >= Math.min(1, p + more * lv)) continue;
          const n = 1 + (rnd() < more * lv ? 1 : 0);
          r.mat[id] = (r.mat[id] || 0) + n; got.push(ITEMS[id].name + (n > 1 ? ' ×' + n : ''));
        }
        const sk = Object.assign({}, g.at); sk[g.skill] = 1;
        learn(r, sk, effortOf(g.lvl, lv));
        return { got, up: ups(r, before) };
      },
      /* crafting at the forge: a known recipe, the profession's level, the materials -- used up, and the thing in the
         bag; it teaches the craft, and now and then a recipe not known yet turns up */
      craft(a, rid, rnd) {
        const r = of(a), rc = RECIPES[rid]; rnd = rnd || Math.random;
        if (!rc) return { ok: false, why: 'there is no such recipe' };
        if (!knows(r, rid)) return { ok: false, why: 'you do not know that recipe yet' };
        const before = profs(r), lv = before[rc.prof];
        if (lv < rc.level) return { ok: false, why: 'it needs ' + PROFS[rc.prof].name + ' level ' + rc.level };
        for (const m in rc.needs) if ((r.mat[m] || 0) < rc.needs[m]) return { ok: false, why: 'not enough ' + ITEMS[m].name };
        for (const m in rc.needs) { r.mat[m] -= rc.needs[m]; if (!r.mat[m]) delete r.mat[m]; }
        r.bag.push([r.n++, rid]);
        const sk = Object.assign({}, CRAFT_AT[rc.skill] || {}); sk[rc.skill] = 6 + rc.level * 2;
        learn(r, sk, effortOf(rc.level, lv));
        const after = profs(r)[rc.prof];
        let learnt = null;
        if (rnd() < RECIPE_DROP) {
          const open = Object.keys(RECIPES).filter(k => !knows(r, k) && RECIPES[k].prof === rc.prof && RECIPES[k].level <= Math.floor(after) + 1);
          if (open.length) { learnt = open[Math.floor(rnd() * open.length)]; (r.rk = r.rk || []).push(learnt); }
        }
        return { ok: true, made: ITEMS[rid].name, up: ups(r, before), learnt: learnt && ITEMS[learnt].name };
      },
      unequip(a, slot) { const r = of(a); if (!r.eq[slot]) return { ok: false, why: 'nothing there' }; delete r.eq[slot]; return { ok: true }; }
    };
  }

  const rpg = { api: 1, SLOTS, SKILLS, PROFS, ATTRS, RANKS, ITEMS, FISTS, LOOT, GATHER, RECIPES, knows, fresh, stats, profs, rank, meets, itemOf, attr, book };
  if (G.LWQ && G.LWQ.define) G.LWQ.define('rpg', { api: 1, v: 4 }, () => rpg);
})(typeof globalThis !== 'undefined' ? globalThis : this);
