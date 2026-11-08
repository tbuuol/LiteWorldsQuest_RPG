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
    oak_log: { name: 'Oak Log', material: true }, stone_block: { name: 'Rough Stone', material: true }, copper_ore: { name: 'Copper Ore', material: true },
    iron_ore: { name: 'Iron Ore', material: true }, wild_herb: { name: 'Wild Herb', material: true }, flax: { name: 'Flax', material: true },
    /* from the beasts of the Greenwood (Etappe 3) */
    boar_hide: { name: 'Boar Hide', material: true }, boar_tusk: { name: 'Boar Tusk', material: true },
    wolf_pelt: { name: 'Wolf Pelt', material: true }, wolf_fang: { name: 'Wolf Fang', material: true },
    spider_silk: { name: 'Spider Silk', material: true }, venom_sac: { name: 'Venom Sac', material: true },
    hide_jerkin: { name: 'Hide Jerkin', slot: 'chest', def: 3, at: { sta: 1 } },
    wolfskin_mantle: { name: 'Wolfskin Mantle', slot: 'shoulders', def: 3, at: { dex: 1 }, req: { defender: 1 } },
    tusk_amulet: { name: 'Tusk Amulet', slot: 'amulet', at: { str: 2 } },
    fang_ring: { name: 'Fang Ring', slot: 'ring', at: { dex: 1, str: 1 }, req: { evader: 1 } },
    silk_gloves: { name: 'Silk Gloves', slot: 'hands', def: 1, at: { dex: 2 }, req: { tailor: 1 } },
    /* the coast (zone 2): the Beach, Mermaid Cove and the pirate ship */
    crab_shell: { name: 'Crab Shell', material: true }, coral: { name: 'Coral', material: true },
    siren_scale: { name: 'Siren Scale', material: true }, pearl: { name: 'Pearl', material: true },
    sea_salt: { name: 'Sea Salt', material: true },
    shell_shield: { name: 'Shell Shield', slot: 'off', model: 'shield', def: 6, req: { defender: 2 }, look: '#e8b8a0' },
    coral_ring: { name: 'Coral Ring', slot: 'ring', at: { dex: 1, int: 1 } },
    siren_charm: { name: 'Siren Charm', slot: 'amulet', at: { int: 2, dex: 1 }, req: { herbalist: 1 } },
    boarding_axe: { name: 'Boarding Axe', slot: 'main', skill: 'axe', model: 'axe', dmg: [9, 17], req: { axe_hit: 2 }, look: '#8f9aa6' },
    pirate_cutlass: { name: 'Pirate Cutlass', slot: 'main', skill: 'sword', model: 'sword', dmg: [10, 17], req: { sword_hit: 3 }, look: '#d6dde6' },
    tricorn_hat: { name: 'Tricorn Hat', slot: 'head', def: 4, at: { dex: 1 } },
    captains_coat: { name: "Captain's Coat", slot: 'chest', def: 7, at: { sta: 2 }, req: { defender: 2 } },
    sea_boots: { name: 'Sea Boots', slot: 'feet', def: 3, at: { dex: 1 } }
  };
  /* what gathering a kind of thing gives: [material, chance, more per level of the profession], the skill it teaches,
     its profession, how hard it is (for the effort), and the attributes it trains */
  const GATHER = {
    tree: { skill: 'woodcutting', prof: 'woodcutter', lvl: 0, verb: 'chop', yields: [['oak_log', 1, 0.15]], at: { str: 0.3, sta: 0.2 } },
    rock: { skill: 'mining', prof: 'miner', lvl: 1, verb: 'mine', yields: [['copper_ore', 0.8, 0.05], ['iron_ore', 0.12, 0.1], ['stone_block', 0.5, 0.05]], at: { str: 0.4, sta: 0.2 } },
    /* the quarry's stone (2026-11-07): what building in Genesis takes, besides oak */
    stone: { skill: 'mining', prof: 'miner', lvl: 0, verb: 'quarry', yields: [['stone_block', 1, 0.2]], at: { str: 0.4, sta: 0.2 } },
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
    herb_amulet: { skill: 'tailoring', prof: 'tailor', level: 1, needs: { wild_herb: 3, flax: 1, copper_ore: 1 } },
    hide_jerkin: { skill: 'tailoring', prof: 'tailor', level: 0, needs: { boar_hide: 3, flax: 1 }, known: true },
    tusk_amulet: { skill: 'woodworking', prof: 'carpenter', level: 0, needs: { boar_tusk: 2, leather_scrap: 1 }, known: true },
    wolfskin_mantle: { skill: 'tailoring', prof: 'tailor', level: 1, needs: { wolf_pelt: 3, leather_scrap: 2 } },
    fang_ring: { skill: 'smithing', prof: 'smith', level: 1, needs: { wolf_fang: 2, copper_ore: 1 } },
    silk_gloves: { skill: 'tailoring', prof: 'tailor', level: 1, needs: { spider_silk: 4 } },
    shell_shield: { skill: 'woodworking', prof: 'carpenter', level: 1, needs: { crab_shell: 4, oak_log: 1 }, known: true },
    coral_ring: { skill: 'smithing', prof: 'smith', level: 1, needs: { coral: 2, copper_ore: 1 }, known: true },
    sea_boots: { skill: 'tailoring', prof: 'tailor', level: 1, needs: { leather_scrap: 3, siren_scale: 1 } },
    siren_charm: { skill: 'tailoring', prof: 'tailor', level: 2, needs: { siren_scale: 3, pearl: 1 } },
    boarding_axe: { skill: 'smithing', prof: 'smith', level: 2, needs: { iron_ore: 5, oak_log: 2, sea_salt: 1 } }
  };
  /* THE CODEX (Entropia's, tbuuol 2026-10-27): every beast of a kind killed counts; at each rank the player may put a
     reward of skill points into one of the skills that kind teaches (the level says which) */
  const CODEX = { ranks: [5, 15, 40, 100, 250, 600, 1500], reward: [8, 15, 30, 60, 120, 240, 480] };
  /* THE ABILITY BAR (Etappe 3, like the old WoW's, but without classes): what you can do comes from what you hold and
     what you have learnt. Slot 1 is the plain strike; these are slots 2 to 6. A sword and a shield make a tank, a
     herbalist heals, an axe cleaves. req: the level of the weapon's hit or damage profession, or of a named one. */
  const ABILITIES = [
    { key: 'heavy', name: 'Heavy Blow', icon: '✸', cd: 6, mul: 1.7, range: 2.6, text: 'One hard blow: 170% damage.' },
    { key: 'cleave', name: 'Cleave', icon: '✦', cd: 9, mul: 0.8, range: 2.8, most: 4, weapons: ['sword', 'axe'], req: { dmg: 1 }, text: 'Hits up to four foes in front of you: 80% damage each.' },
    { key: 'crush', name: 'Crush', icon: '✪', cd: 10, mul: 1.0, range: 2.6, stun: 1.5, weapons: ['mace', 'unarmed'], req: { hit: 1 }, text: 'A blow that stuns for 1.5 s.' },
    { key: 'bash', name: 'Shield Bash', icon: '❖', cd: 10, mul: 0.6, range: 2.4, stun: 2, shield: true, text: 'Stuns the foe for 2 s: 60% damage.' },
    { key: 'taunt', name: 'Taunt', icon: '!', cd: 12, radius: 8, last: 6, shield: true, text: 'Every foe within 8 m comes for you for 6 s.' },
    { key: 'salve', name: 'Herbal Salve', icon: '✚', cd: 8, range: 7, cost: { wild_herb: 1 }, req: { herbalist: 0.5 }, text: 'Heals the player you look at, or yourself. Uses a Wild Herb.' }
  ];
  const CRAFT_AT = { smithing: { str: 0.5, int: 0.3 }, woodworking: { dex: 0.3, str: 0.2 }, tailoring: { dex: 0.4, int: 0.2 } };
  const RECIPE_DROP = 0.04;   /* very low: a recipe of the craft being done, up to a level above the crafter's */
  /* BLUEPRINTS (tbuuol 2026-11-08, like Entropia's): a recipe is a thing in the bag, 'bp:<recipe>' with its quality
     rating {qr: 0.0 to 100.0}; it is made from only while held, it gets better each time it is used, and it can be kept,
     traded and sold like anything else. The best one of a kind is the one used. */
  const BP = 'bp:';
  const bpOf = (r, rid) => { let best = null; for (const e of r.bag) if (e[1] === BP + rid && (!best || ((e[2] || {}).qr || 0) > ((best[2] || {}).qr || 0))) best = e; return best; };
  const knows = (r, rid) => !!RECIPES[rid] && !!bpOf(r, rid);
  const giveBp = (r, rid) => { r.bag.push([r.n++, BP + rid, { qr: 0 }]); return 'Blueprint: ' + ITEMS[rid].name; };
  /* what a made thing comes out as: 35 % to 125 % of its kind, rolled -- a skilled maker rolls higher, but 125 % stays
     rare for everybody (tbuuol 2026-11-08) */
  const qualityRoll = (lv, rnd) => Math.round((35 + 90 * Math.pow(rnd(), clamp(2.6 - 0.35 * lv, 0.9, 2.6))) * 10) / 10;
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
  function itemOf(r, uid) {
    const e = r.bag.find(b => b[0] === uid); if (!e) return null;
    const x = e[2] || {};
    if (String(e[1]).startsWith(BP)) { const rid = e[1].slice(BP.length); return { uid, id: e[1], name: 'Blueprint: ' + ((ITEMS[rid] || {}).name || rid) + ' (QR ' + (x.qr || 0).toFixed(1) + ')', blueprint: rid, qr: x.qr || 0 }; }
    const it = Object.assign({ uid, id: e[1] }, ITEMS[e[1]]);
    if (x.q) {   /* its quality: what it does, scaled */
      const k = x.q / 100; it.q = x.q; it.name = it.name + ' (' + x.q.toFixed(1) + ' %)';
      if (it.dmg) it.dmg = [Math.max(1, Math.round(it.dmg[0] * k)), Math.max(1, Math.round(it.dmg[1] * k))];
      if (it.def) it.def = Math.max(1, Math.round(it.def * k));
    }
    return it;
  }
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

  /* the five abilities on slots 2 to 6 as they stand for this record: what is ready to use and why not.
     Slot 3 is Cleave with a sword or an axe, Crush otherwise. */
  function abilities(r) {
    const st = stats(r), off = r.eq.off ? itemOf(r, r.eq.off) : null, shield = !!(off && off.model === 'shield');
    const pick = ABILITIES.filter(a => a.key !== (['sword', 'axe'].includes(st.skill) ? 'crush' : 'cleave'));
    return pick.map(a => {
      let why = '';
      if (a.weapons && !a.weapons.includes(st.skill)) why = 'needs ' + a.weapons.join(' or ');
      else if (a.shield && !shield) why = 'needs a shield in the left hand';
      else for (const k in a.req || {}) {
        const pk = k === 'hit' ? st.hitProf : k === 'dmg' ? st.dmgProf : k;
        if ((st.prof[pk] || 0) < a.req[k]) { why = 'needs ' + PROFS[pk].name + ' level ' + a.req[k]; break; }
      }
      if (!why) for (const m in a.cost || {}) if ((r.mat[m] || 0) < a.cost[m]) { why = 'needs a ' + ITEMS[m].name; break; }
      return Object.assign({}, a, { ok: !why, why });
    });
  }

  /* QUESTS (Etappe 3: a short chain that leads through fighting, gathering and the forge). A quest is the level's:
     {id, npc, title, offer, done, need: {kill: {species: n}} | {bring: {material: n}} | {make: itemId | 'weapon'},
      reward: {items, mats, sk}, after: questId}. A record keeps r.qs {id: 'active'|'done'} and r.qk {id: progress}. */
  function questProgress(r, q) {
    const n = q.need || {}, got = (r.qk || {})[q.id] || {}, parts = [];
    for (const sp in n.kill || {}) parts.push([sp, Math.min(n.kill[sp], got[sp] || 0), n.kill[sp]]);
    for (const m in n.bring || {}) parts.push([m, Math.min(n.bring[m], r.mat[m] || 0), n.bring[m]]);
    if (n.make) parts.push(['make', got.made ? 1 : 0, 1]);
    return { parts, ready: parts.every(p => p[1] >= p[2]) };
  }
  function questState(r, q) {
    const st = (r.qs || {})[q.id];
    if (st === 'done') return 'done';
    if (st === 'active') return questProgress(r, q).ready ? 'ready' : 'active';
    if (q.after && (r.qs || {})[q.after] !== 'done') return 'locked';
    return 'offer';
  }

  /* --- the house's book ---------------------------------------------------------------------------------- */
  function book() {
    const recs = new Map();
    const of = a => { if (!recs.has(a)) recs.set(a, fresh(a)); return recs.get(a); };
    return {
      of, has: a => recs.has(a), forget: a => recs.delete(a),   /* forget: the player went to another zone; its house has it now */
      load(json) { try { const all = typeof json === 'string' ? JSON.parse(json) : json; for (const a in all || {}) if (all[a] && all[a].v === 2) recs.set(a, all[a]); } catch (e) { /* a bad file: begin empty */ } return recs.size; },
      dump() { const o = {}; for (const [a, r] of recs) o[a] = r; return o; },
      /* a blow by this player: the hit profession says whether it lands; a hit is the weapon's roll (made the most of by
         the damage profession) plus strength, less the target's defence. A miss teaches too, a little. */
      strike(a, targetDef, targetLvl, rnd, mul) {
        rnd = rnd || Math.random;
        const r = of(a), s = stats(r), before = profs(r), effort = effortOf(targetLvl, s.prof[s.hitProf]);
        const g = {};
        if (rnd() >= s.hit) {
          g[s.skill] = 0.4; g.melee = 0.2; g.dex = 0.1;
          learn(r, g, effort);
          return { d: 0, miss: true, up: ups(r, before) };
        }
        const roll = s.dmg[0] + Math.floor(rnd() * (s.dmg[1] - s.dmg[0] + 1)), d = Math.max(1, Math.round((roll + s.bonus) * (mul || 1)) - (targetDef || 0));
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
      loot(a, rnd, table) {   /* a raider's drop, or a beast's (its own table) */
        const r = of(a), got = []; rnd = rnd || Math.random;
        for (const [id, p] of table || LOOT) {
          if (!ITEMS[id]) continue;
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
        const bp = bpOf(r, rid);
        if (!bp) return { ok: false, why: 'you have no blueprint for it in your bag' };
        const before = profs(r), lv = before[rc.prof];
        if (lv < rc.level) return { ok: false, why: 'it needs ' + PROFS[rc.prof].name + ' level ' + rc.level };
        for (const m in rc.needs) if ((r.mat[m] || 0) < rc.needs[m]) return { ok: false, why: 'not enough ' + ITEMS[m].name };
        const x = bp[2] = bp[2] || { qr: 0 }, qr = x.qr || 0;
        /* the blueprint's QR goes up with every use, quickly at first, slowly near 100 */
        x.qr = Math.min(100, Math.round((qr + 0.5 * (1 - qr / 100) + 0.02) * 100) / 100);
        const sk = Object.assign({}, CRAFT_AT[rc.skill] || {}); sk[rc.skill] = 6 + rc.level * 2;
        /* it can fail: 70 % success at QR 0, 95 % at QR 100; a failure costs half of what was put in, and teaches less */
        if (rnd() >= 0.7 + 0.25 * qr / 100) {
          const lost = [];
          for (const m in rc.needs) { const n = Math.max(1, Math.floor(rc.needs[m] / 2)); r.mat[m] -= n; if (r.mat[m] <= 0) delete r.mat[m]; lost.push(ITEMS[m].name + ' ×' + n); }
          learn(r, sk, effortOf(rc.level, lv) * 0.4);
          return { ok: true, failed: true, lost, qr: x.qr, up: ups(r, before) };
        }
        for (const m in rc.needs) { r.mat[m] -= rc.needs[m]; if (!r.mat[m]) delete r.mat[m]; }
        const item = ITEMS[rid], q = item.slot ? qualityRoll(lv, rnd) : null;
        r.bag.push(q ? [r.n++, rid, { q }] : [r.n++, rid]);
        learn(r, sk, effortOf(rc.level, lv));
        const after = profs(r)[rc.prof];
        let learnt = null;
        if (rnd() < RECIPE_DROP) {   /* a new blueprint, found while working: into the bag */
          const open = Object.keys(RECIPES).filter(k => !knows(r, k) && RECIPES[k].prof === rc.prof && RECIPES[k].level <= Math.floor(after) + 1);
          if (open.length) { learnt = open[Math.floor(rnd() * open.length)]; giveBp(r, learnt); }
        }
        return { ok: true, made: item.name + (q ? ' (' + q.toFixed(1) + ' %)' : ''), qr: x.qr, up: ups(r, before), learnt: learnt && 'Blueprint: ' + ITEMS[learnt].name };
      },
      /* THE ADVENTURERS' GUILD (tbuuol 2026-11-08): three tasks a day for each player from Guildmaster Rowan -- a hunt,
         a delivery and a gathering -- the same all day, new at midnight (UTC). r.gd = {day, t: [[type, what, n, got, done]]} */
      guildDay(a, day) {
        const r = of(a);
        if (r.gd && r.gd.day === day) return r.gd;
        let h = 2166136261; for (const ch of day + a) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
        const pick = list => { h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return list[h % list.length]; };
        const lvl = Math.max(0, Math.floor((profs(r).miner || 0) + (profs(r)[stats(r).hitProf] || 0)) / 2);
        const more = n => n + Math.floor(n * Math.min(1, lvl * 0.15));
        const hunt = pick([['boar', 5], ['wolf', 4], ['spider', 3], ['crab', 5], ['goblin', 4], ['drowned', 3]]);
        const bring = pick([['stone_block', 10], ['oak_log', 8], ['copper_ore', 6], ['wild_herb', 6], ['flax', 4], ['boar_hide', 3]]);
        const gather = pick([['tree', 5], ['rock', 4], ['herb', 6], ['stone', 6]]);
        r.gd = { day, t: [['kill', hunt[0], more(hunt[1]), 0, 0], ['bring', bring[0], more(bring[1]), 0, 0], ['gather', gather[0], more(gather[1]), 0, 0]] };
        return r.gd;
      },
      guildCount(a, type, what) {   /* a kill or a gathering, counted for today's tasks; the lines to tell */
        const r = of(a), out = [];
        for (const t of (r.gd && r.gd.t) || []) if (t[0] === type && t[1] === what && !t[4] && t[3] < t[2]) { t[3]++; if (t[3] === t[2]) out.push('Guild task done: ' + (type === 'kill' ? 'the hunt' : 'the gathering') + ' -- tell Guildmaster Rowan.'); }
        return out;
      },
      guildTurn(a, i, rnd) {
        const r = of(a), t = r.gd && r.gd.t && r.gd.t[i | 0]; rnd = rnd || Math.random;
        if (!t || t[4]) return { ok: false, why: 'there is no such task open' };
        if (t[0] === 'bring') { if ((r.mat[t[1]] || 0) < t[2]) return { ok: false, why: 'you have ' + (r.mat[t[1]] || 0) + ' of ' + t[2] + ' ' + ITEMS[t[1]].name };
          r.mat[t[1]] -= t[2]; if (!r.mat[t[1]]) delete r.mat[t[1]]; }
        else if (t[3] < t[2]) return { ok: false, why: 'it is not done yet (' + t[3] + ' of ' + t[2] + ')' };
        t[4] = 1;
        const before = profs(r), got = [];
        const reward = [['copper_ore', 3], ['iron_ore', 2], ['oak_log', 4], ['stone_block', 6], ['leather_scrap', 2], ['flax', 2], ['wild_herb', 3]][Math.floor(rnd() * 7)];
        r.mat[reward[0]] = (r.mat[reward[0]] || 0) + reward[1]; got.push(ITEMS[reward[0]].name + ' ×' + reward[1]);
        const sk = t[0] === 'kill' ? { melee: 6, toughness: 4 } : t[0] === 'gather' ? { [GATHER[t[1]] ? GATHER[t[1]].skill : 'mining']: 8 } : { str: 3, sta: 3 };
        learn(r, sk, 1); got.push('skill');
        if (rnd() < 0.08) { const open = Object.keys(RECIPES).filter(k => !knows(r, k)); if (open.length) got.push(giveBp(r, open[Math.floor(rnd() * open.length)])); }
        return { ok: true, got, up: ups(r, before) };
      },
      /* taking a made thing apart at the forge: half of what its recipe needs comes back (at least one of each), never
         a failure; nothing worn, no blueprint, nothing that has no recipe */
      salvage(a, uid) {
        const r = of(a), i = r.bag.findIndex(e => e[0] === uid);
        if (i < 0) return { ok: false, why: 'it is not in your bag' };
        const id = r.bag[i][1], rc = RECIPES[id];
        if (Object.values(r.eq).includes(uid)) return { ok: false, why: 'take it off first' };
        if (!rc) return { ok: false, why: 'nobody knows how it was made' };
        r.bag.splice(i, 1);
        const got = [];
        for (const m in rc.needs) { const n = Math.max(1, Math.floor(rc.needs[m] / 2)); r.mat[m] = (r.mat[m] || 0) + n; got.push(ITEMS[m].name + ' ×' + n); }
        const before = profs(r), sk = {}; sk[rc.skill] = 2; learn(r, sk, 0.5);
        return { ok: true, got, of: ITEMS[id].name, up: ups(r, before) };
      },
      /* building (Genesis, 2026-11-07): materials taken for a piece, and given back when it is taken down */
      pay(a, needs) {
        const r = of(a);
        for (const m in needs) if ((r.mat[m] || 0) < needs[m]) return { ok: false, why: 'not enough ' + (ITEMS[m] ? ITEMS[m].name : m) + ' (' + (r.mat[m] || 0) + ' of ' + needs[m] + ')' };
        for (const m in needs) { r.mat[m] -= needs[m]; if (!r.mat[m]) delete r.mat[m]; }
        return { ok: true };
      },
      refund(a, mats) { const r = of(a); for (const m in mats) r.mat[m] = (r.mat[m] || 0) + mats[m]; },
      unequip(a, slot) { const r = of(a); if (!r.eq[slot]) return { ok: false, why: 'nothing there' }; delete r.eq[slot]; return { ok: true }; },
      /* the herbal salve: a Wild Herb used up; heals by the herbalist's skill and intelligence; teaches herbalism */
      salve(a) {
        const r = of(a), before = profs(r), s = stats(r);
        if ((r.mat.wild_herb || 0) < 1) return { ok: false, why: 'you have no Wild Herb' };
        if (!--r.mat.wild_herb) delete r.mat.wild_herb;
        learn(r, { herbalism: 0.6, int: 0.2 }, 1);
        return { ok: true, heal: Math.round(20 + 4 * s.prof.herbalist + (s.attrs.int - 10) * 1.5), up: ups(r, before) };
      },
      questTake(a, q) {
        const r = of(a);
        if (questState(r, q) !== 'offer') return { ok: false, why: 'that quest is not open to you' };
        (r.qs = r.qs || {})[q.id] = 'active'; (r.qk = r.qk || {})[q.id] = {};
        return { ok: true };
      },
      questTurn(a, q) {
        const r = of(a);
        if (questState(r, q) !== 'ready') return { ok: false, why: 'it is not done yet' };
        for (const m in (q.need || {}).bring || {}) { r.mat[m] -= q.need.bring[m]; if (r.mat[m] <= 0) delete r.mat[m]; }
        const before = profs(r), rw = q.reward || {}, got = [];
        for (const id of rw.items || []) if (ITEMS[id]) { r.bag.push([r.n++, id]); got.push(ITEMS[id].name); }
        for (const rid of rw.bp || []) if (RECIPES[rid] && ITEMS[rid]) got.push(giveBp(r, rid));   /* the smith's blueprints */
        for (const m in rw.mats || {}) if (ITEMS[m]) { r.mat[m] = (r.mat[m] || 0) + rw.mats[m]; got.push(ITEMS[m].name + ' ×' + rw.mats[m]); }
        for (const k in rw.sk || {}) { const box = ATTRS[k] ? r.at : r.sk; box[k] = Math.round(((box[k] || 0) + rw.sk[k]) * 1000) / 1000; got.push('+' + rw.sk[k] + ' ' + (SKILLS[k] || {}).name); }
        r.qs[q.id] = 'done'; delete r.qk[q.id];
        return { ok: true, got, up: ups(r, before) };
      },
      /* what a kill or a made thing does for the active quests: the lines to tell the player */
      questKill(a, species, quests) {
        const r = of(a), out = [];
        for (const q of quests || []) {
          const n = ((q.need || {}).kill || {})[species];
          if (!n || (r.qs || {})[q.id] !== 'active') continue;
          const got = r.qk[q.id] = r.qk[q.id] || {};
          if ((got[species] || 0) >= n) continue;
          got[species] = (got[species] || 0) + 1;
          out.push(q.title + ': ' + got[species] + '/' + n + (got[species] >= n ? ' -- done, go back.' : ''));
        }
        return out;
      },
      questMade(a, itemId, quests) {
        const r = of(a), out = [];
        for (const q of quests || []) {
          const m = (q.need || {}).make;
          if (!m || (r.qs || {})[q.id] !== 'active' || (m !== itemId && !(m === 'weapon' && ITEMS[itemId] && ITEMS[itemId].dmg))) continue;
          (r.qk[q.id] = r.qk[q.id] || {}).made = 1; out.push(q.title + ': done, go back.');
        }
        return out;
      },
      /* a beast of this kind killed: counted; says when a new codex rank is reached */
      kill(a, species) {
        const r = of(a); r.cx = r.cx || {}; const n = r.cx[species] = (r.cx[species] || 0) + 1;
        const rank = CODEX.ranks.indexOf(n);
        return { n, rank: rank >= 0 ? rank + 1 : 0 };
      },
      /* the next codex reward of a kind, put into one of the skills it may go to */
      claim(a, species, skill, allowed) {
        const r = of(a); r.cx = r.cx || {}; r.cxc = r.cxc || {};
        const done = r.cxc[species] || 0, reached = CODEX.ranks.filter(k => (r.cx[species] || 0) >= k).length;
        if (done >= reached) return { ok: false, why: 'no codex reward is waiting there' };
        if (!(allowed || []).includes(skill) || !(SKILLS[skill] || ATTRS[skill])) return { ok: false, why: 'that skill is not taught by this beast' };
        const before = profs(r), pts = CODEX.reward[done], box = ATTRS[skill] ? r.at : r.sk;
        box[skill] = Math.round(((box[skill] || 0) + pts) * 1000) / 1000;
        r.cxc[species] = done + 1;
        return { ok: true, pts, up: ups(r, before) };
      }
    };
  }

  /* a bag entry's name as shown (a blueprint with its QR, a made thing with its quality) */
  const entryName = e => { const it = itemOf({ bag: [e] }, e[0]); return it ? it.name : String(e[1]); };
  const rpg = { api: 1, entryName, SLOTS, SKILLS, PROFS, ATTRS, RANKS, ITEMS, FISTS, LOOT, GATHER, RECIPES, CODEX, ABILITIES, abilities, questState, questProgress, knows, fresh, stats, profs, rank, meets, itemOf, attr, book };
  if (G.LWQ && G.LWQ.define) G.LWQ.define('rpg', { api: 1, v: 9 }, () => rpg);
})(typeof globalThis !== 'undefined' ? globalThis : this);
