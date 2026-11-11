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
    tailoring: { name: 'Tailoring', group: 'Crafting' }, jewelcrafting: { name: 'Jewelcrafting', group: 'Crafting' }, runecraft: { name: 'Runecraft', group: 'Crafting' }
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
    tailor: { name: 'Tailor', group: 'Crafting', w: { tailoring: 0.6, herbalism: 0.2, dex: 0.2 } },
    jeweler: { name: 'Jeweler', group: 'Crafting', w: { jewelcrafting: 0.6, mining: 0.1, int: 0.15, dex: 0.15 } },
    runecrafter: { name: 'Runecrafter', group: 'Crafting', w: { runecraft: 0.6, int: 0.3, herbalism: 0.1 } }
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
    iron_ore: { name: 'Iron Ore', material: true }, tin_ore: { name: 'Tin Ore', material: true }, wild_herb: { name: 'Wild Herb', material: true }, flax: { name: 'Flax', material: true },
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
    sea_boots: { name: 'Sea Boots', slot: 'feet', def: 3, at: { dex: 1 } },
    /* REFINING AND PARTS (tbuuol 2026-11-10: "Häute zu Leder, Erz zu Barren, Holz zu Teilen, Fasern zu Stoffen, und
       Komponenten"): the first step between what is gathered and what is worn -- all materials, made at the benches */
    copper_bar: { name: 'Copper Bar', material: true }, iron_bar: { name: 'Iron Bar', material: true },
    tin_bar: { name: 'Tin Bar', material: true }, bronze_bar: { name: 'Bronze Bar', material: true },
    copper_blade: { name: 'Copper Blade', material: true }, sword_hilt: { name: 'Sword Hilt', material: true },
    rivets: { name: 'Copper Rivets', material: true }, buckle: { name: 'Buckle', material: true },
    oak_plank: { name: 'Oak Plank', material: true }, wooden_handle: { name: 'Wooden Handle', material: true },
    shield_boards: { name: 'Shield Boards', material: true }, antler_buttons: { name: 'Antler Buttons', material: true },
    deer_leather: { name: 'Deer Leather', material: true }, boar_leather: { name: 'Boar Leather', material: true },
    leather_strap: { name: 'Leather Strap', material: true }, linen_thread: { name: 'Linen Thread', material: true },
    linen_cloth: { name: 'Linen Cloth', material: true }, fur_lining: { name: 'Fur Lining', material: true },
    copper_wire: { name: 'Copper Wire', material: true }, ring_setting: { name: 'Ring Setting', material: true },
    clasp: { name: 'Clasp', material: true }, ring_mold: { name: 'Ring Mould', material: true },
    antler_beads: { name: 'Antler Beads', material: true }, polished_tusk: { name: 'Polished Tusk', material: true },
    /* made from the parts (level 0): the first things a crafter makes from their own refined work */
    copper_longknife: { name: 'Copper Longknife', slot: 'main', skill: 'sword', model: 'sword', dmg: [5, 10], look: '#c87533' },
    hunters_jerkin: { name: "Hunter's Jerkin", slot: 'chest', def: 3, at: { dex: 1 } },
    furlined_gloves: { name: 'Fur-lined Gloves', slot: 'hands', def: 1, at: { dex: 1, sta: 1 } },
    linen_trousers: { name: 'Linen Trousers', slot: 'legs', def: 2 },
    buckler_board: { name: 'Board Buckler', slot: 'off', model: 'shield', def: 3, look: '#a07a4e' },
    antler_pendant: { name: 'Antler Pendant', slot: 'amulet', at: { dex: 1, int: 1 } },
    hares_foot_charm: { name: "Hare's Foot Charm", slot: 'trinket', at: { dex: 2 } },
    copper_band: { name: 'Copper Band', slot: 'ring', at: { sta: 1 } },
    /* RUNES and what they are made of (2026-11-10) */
    rune_blank: { name: 'Blank Rune', material: true },
    essence_might: { name: 'Essence of Might', material: true }, essence_guard: { name: 'Essence of Guard', material: true },
    essence_life: { name: 'Essence of Life', material: true }, essence_venom: { name: 'Essence of Venom', material: true },
    glyph_strike: { name: 'Glyph of Striking', material: true }, glyph_sweep: { name: 'Glyph of Sweeping', material: true },
    glyph_bind: { name: 'Glyph of Binding', material: true }, glyph_call: { name: 'Glyph of Calling', material: true },
    glyph_mend: { name: 'Glyph of Mending', material: true },
    rune_heavy: { name: 'Rune: Heavy Blow', rune: 'heavy' }, rune_cleave: { name: 'Rune: Cleave', rune: 'cleave' },
    rune_crush: { name: 'Rune: Crush', rune: 'crush' }, rune_bash: { name: 'Rune: Shield Bash', rune: 'bash' },
    rune_taunt: { name: 'Rune: Taunt', rune: 'taunt' }, rune_salve: { name: 'Rune: Herbal Salve', rune: 'salve' },
    rune_webshot: { name: 'Rune: Web Shot', rune: 'webshot' }, rune_venom: { name: 'Rune: Venom Strike', rune: 'venom' },
    rune_battlecry: { name: 'Rune: Battle Cry', rune: 'battlecry' }, rune_whirlwind: { name: 'Rune: Whirlwind', rune: 'whirlwind' },
    /* the Spider Cave's Broodmother (2026-11-10) */
    /* the shy ones of Greenwood and the fields (2026-11-10) */
    deer_hide: { name: 'Deer Hide', material: true }, antler: { name: 'Antler', material: true },
    hare_pelt: { name: 'Hare Pelt', material: true }, hare_foot: { name: "Hare's Foot", material: true },
    brood_carapace: { name: 'Brood Carapace', material: true },
    broodfang: { name: "Broodmother's Fang", slot: 'main', skill: 'sword', model: 'sword', dmg: [12, 20], req: { sword_hit: 3 }, at: { dex: 1 }, look: '#d9cfb4' },
    silkweave_mantle: { name: 'Silkweave Mantle', slot: 'shoulders', def: 4, at: { dex: 2 }, req: { evader: 2 } },
    venom_ring: { name: 'Venomweave Ring', slot: 'ring', at: { dex: 2, str: 1 } },
    carapace_shield: { name: 'Carapace Shield', slot: 'off', model: 'shield', def: 7, req: { defender: 2 }, look: '#3a1e2e' }
  };
  /* what gathering a kind of thing gives: [material, chance, more per level of the profession], the skill it teaches,
     its profession, how hard it is (for the effort), and the attributes it trains */
  const GATHER = {
    tree: { skill: 'woodcutting', prof: 'woodcutter', lvl: 0, verb: 'chop', yields: [['oak_log', 1, 0.15]], at: { str: 0.3, sta: 0.2 } },
    rock: { skill: 'mining', prof: 'miner', lvl: 1, verb: 'mine', yields: [['copper_ore', 0.8, 0.05], ['iron_ore', 0.12, 0.1], ['stone_block', 0.5, 0.05]], at: { str: 0.4, sta: 0.2 } },
    /* ORES BY WHERE (tbuuol 2026-11-11): copper and tin in Greenwood and on the beach, iron at the Goblin Village */
    copper: { skill: 'mining', prof: 'miner', lvl: 0, verb: 'mine', yields: [['copper_ore', 1, 0.1], ['stone_block', 0.3, 0.05]], at: { str: 0.4, sta: 0.2 } },
    tin: { skill: 'mining', prof: 'miner', lvl: 0, verb: 'mine', yields: [['tin_ore', 1, 0.1], ['stone_block', 0.3, 0.05]], at: { str: 0.4, sta: 0.2 } },
    iron: { skill: 'mining', prof: 'miner', lvl: 1, verb: 'mine', yields: [['iron_ore', 1, 0.08], ['stone_block', 0.3, 0.05]], at: { str: 0.5, sta: 0.2 } },
    /* the quarry's stone (2026-11-07): what building in Genesis takes, besides oak */
    stone: { skill: 'mining', prof: 'miner', lvl: 0, verb: 'quarry', yields: [['stone_block', 1, 0.2]], at: { str: 0.4, sta: 0.2 } },
    herb: { skill: 'herbalism', prof: 'herbalist', lvl: 0, verb: 'gather', yields: [['wild_herb', 1, 0.15], ['flax', 0.35, 0.05]], at: { dex: 0.3, int: 0.2 } }
  };
  /* RECIPES: the craft's skill, its profession and the level of it they need; known: everybody knows it from the
     start, the others turn up now and then while crafting (tbuuol 2026-10-23) */
  /* THE OLD THINGS FROM PARTS (tbuuol 2026-11-10): a sword is a blade, a hilt and rivets now, not ore and a log */
  const RECIPES = {
    /* REFINING (level 0, 2026-11-10): ore to bars, logs to planks, hides to leather, fibre to thread and cloth */
    copper_bar: { skill: 'smithing', prof: 'smith', level: 0, needs: { copper_ore: 2 }, yields: 1 },
    iron_bar: { skill: 'smithing', prof: 'smith', level: 1, needs: { iron_ore: 2 }, yields: 1 },
    tin_bar: { skill: 'smithing', prof: 'smith', level: 0, needs: { tin_ore: 2 }, yields: 1 },
    bronze_bar: { skill: 'smithing', prof: 'smith', level: 1, needs: { copper_bar: 2, tin_bar: 1 }, yields: 2 },   /* copper and tin: bronze */
    oak_plank: { skill: 'woodworking', prof: 'carpenter', level: 0, needs: { oak_log: 1 }, yields: 2 },
    deer_leather: { skill: 'tailoring', prof: 'tailor', level: 0, needs: { deer_hide: 1 }, yields: 1 },
    boar_leather: { skill: 'tailoring', prof: 'tailor', level: 0, needs: { boar_hide: 1 }, yields: 1 },
    linen_thread: { skill: 'tailoring', prof: 'tailor', level: 0, needs: { flax: 1 }, yields: 2 },
    linen_cloth: { skill: 'tailoring', prof: 'tailor', level: 0, needs: { linen_thread: 3 }, yields: 1 },
    copper_wire: { skill: 'jewelcrafting', prof: 'jeweler', level: 0, needs: { copper_bar: 1 }, yields: 3 },
    /* PARTS (level 0): what the things are put together from */
    copper_blade: { skill: 'smithing', prof: 'smith', level: 0, needs: { copper_bar: 2 }, yields: 1 },
    sword_hilt: { skill: 'smithing', prof: 'smith', level: 0, needs: { copper_bar: 1, leather_strap: 1 }, yields: 1 },
    rivets: { skill: 'smithing', prof: 'smith', level: 0, needs: { copper_bar: 1 }, yields: 6 },
    buckle: { skill: 'smithing', prof: 'smith', level: 0, needs: { copper_bar: 1 }, yields: 2 },
    wooden_handle: { skill: 'woodworking', prof: 'carpenter', level: 0, needs: { oak_plank: 1 }, yields: 2 },
    shield_boards: { skill: 'woodworking', prof: 'carpenter', level: 0, needs: { oak_plank: 3 }, yields: 1 },
    antler_buttons: { skill: 'woodworking', prof: 'carpenter', level: 0, needs: { antler: 1 }, yields: 4 },
    leather_strap: { skill: 'tailoring', prof: 'tailor', level: 0, needs: { deer_leather: 1 }, yields: 3 },
    fur_lining: { skill: 'tailoring', prof: 'tailor', level: 0, needs: { hare_pelt: 2, linen_thread: 1 }, yields: 1 },
    ring_setting: { skill: 'jewelcrafting', prof: 'jeweler', level: 0, needs: { copper_wire: 2 }, yields: 1 },
    clasp: { skill: 'jewelcrafting', prof: 'jeweler', level: 0, needs: { copper_wire: 1 }, yields: 2 },
    ring_mold: { skill: 'jewelcrafting', prof: 'jeweler', level: 0, needs: { stone_block: 1, copper_bar: 1 }, yields: 1 },
    antler_beads: { skill: 'jewelcrafting', prof: 'jeweler', level: 0, needs: { antler: 1 }, yields: 4 },
    polished_tusk: { skill: 'jewelcrafting', prof: 'jeweler', level: 0, needs: { boar_tusk: 1 }, yields: 1 },
    /* RUNES (2026-11-10): the blank from the jeweler, the runes from a runecrafter at a rune table */
    rune_blank: { skill: 'jewelcrafting', prof: 'jeweler', level: 0, needs: { stone_block: 1, copper_wire: 2 }, yields: 1 },
    rune_heavy: { skill: 'runecraft', prof: 'runecrafter', level: 0, needs: { rune_blank: 1, glyph_strike: 1, essence_might: 2 } },
    rune_salve: { skill: 'runecraft', prof: 'runecrafter', level: 0, needs: { rune_blank: 1, glyph_mend: 1, essence_life: 2, wild_herb: 1 } },
    rune_cleave: { skill: 'runecraft', prof: 'runecrafter', level: 1, needs: { rune_blank: 1, glyph_sweep: 1, essence_might: 2 } },
    rune_crush: { skill: 'runecraft', prof: 'runecrafter', level: 1, needs: { rune_blank: 1, glyph_strike: 1, essence_might: 1, essence_guard: 1 } },
    rune_bash: { skill: 'runecraft', prof: 'runecrafter', level: 1, needs: { rune_blank: 1, glyph_bind: 1, essence_guard: 2 } },
    rune_taunt: { skill: 'runecraft', prof: 'runecrafter', level: 1, needs: { rune_blank: 1, glyph_call: 1, essence_guard: 2 } },
    rune_webshot: { skill: 'runecraft', prof: 'runecrafter', level: 2, needs: { rune_blank: 1, glyph_bind: 1, essence_venom: 2 } },
    rune_venom: { skill: 'runecraft', prof: 'runecrafter', level: 2, needs: { rune_blank: 1, glyph_strike: 1, essence_venom: 2 } },
    rune_battlecry: { skill: 'runecraft', prof: 'runecrafter', level: 2, needs: { rune_blank: 1, glyph_call: 1, essence_might: 2 } },
    rune_whirlwind: { skill: 'runecraft', prof: 'runecrafter', level: 2, needs: { rune_blank: 1, glyph_sweep: 1, essence_might: 3 } },
    /* FROM THE PARTS (level 0) */
    copper_longknife: { skill: 'smithing', prof: 'smith', level: 0, needs: { copper_blade: 1, sword_hilt: 1, rivets: 2 } },
    hunters_jerkin: { skill: 'tailoring', prof: 'tailor', level: 0, needs: { deer_leather: 2, leather_strap: 1, antler_buttons: 4 } },
    furlined_gloves: { skill: 'tailoring', prof: 'tailor', level: 0, needs: { fur_lining: 1, deer_leather: 1, linen_thread: 1 } },
    linen_trousers: { skill: 'tailoring', prof: 'tailor', level: 0, needs: { linen_cloth: 2, buckle: 1, linen_thread: 1 } },
    buckler_board: { skill: 'woodworking', prof: 'carpenter', level: 0, needs: { shield_boards: 1, leather_strap: 1, rivets: 2 } },
    antler_pendant: { skill: 'jewelcrafting', prof: 'jeweler', level: 0, needs: { antler_beads: 4, clasp: 1, leather_strap: 1 } },
    hares_foot_charm: { skill: 'jewelcrafting', prof: 'jeweler', level: 0, needs: { hare_foot: 1, ring_setting: 1, leather_strap: 1 } },
    copper_band: { skill: 'jewelcrafting', prof: 'jeweler', level: 0, needs: { copper_bar: 1, ring_mold: 1 } },
    copper_sword: { skill: 'smithing', prof: 'smith', level: 0, needs: { copper_blade: 1, sword_hilt: 1, rivets: 2 }, known: true },
    copper_axe: { skill: 'smithing', prof: 'smith', level: 0, needs: { copper_bar: 2, wooden_handle: 1, rivets: 2 }, known: true },
    copper_bracers: { skill: 'smithing', prof: 'smith', level: 0, needs: { copper_bar: 2, leather_strap: 2, buckle: 1 }, known: true },
    oak_shield: { skill: 'woodworking', prof: 'carpenter', level: 0, needs: { shield_boards: 1, leather_strap: 1, rivets: 4 }, known: true },
    oak_belt_charm: { skill: 'jewelcrafting', prof: 'jeweler', level: 0, needs: { oak_plank: 1, wild_herb: 1, clasp: 1 }, known: true },
    flax_tunic: { skill: 'tailoring', prof: 'tailor', level: 0, needs: { linen_cloth: 2, linen_thread: 1 }, known: true },
    leather_belt: { skill: 'tailoring', prof: 'tailor', level: 0, needs: { boar_leather: 1, buckle: 1 }, known: true },
    iron_sword: { skill: 'smithing', prof: 'smith', level: 1, needs: { iron_bar: 3, sword_hilt: 1, rivets: 2 } },
    iron_mace: { skill: 'smithing', prof: 'smith', level: 1, needs: { iron_bar: 3, wooden_handle: 1 } },
    iron_helm: { skill: 'smithing', prof: 'smith', level: 1, needs: { iron_bar: 2, linen_cloth: 1, rivets: 4 } },
    iron_ring: { skill: 'jewelcrafting', prof: 'jeweler', level: 2, needs: { iron_bar: 1, ring_mold: 1 } },
    leather_boots: { skill: 'tailoring', prof: 'tailor', level: 1, needs: { boar_leather: 2, linen_thread: 1, buckle: 1 } },
    herb_amulet: { skill: 'jewelcrafting', prof: 'jeweler', level: 1, needs: { wild_herb: 3, copper_wire: 2, clasp: 1 } },
    hide_jerkin: { skill: 'tailoring', prof: 'tailor', level: 0, needs: { boar_leather: 2, linen_thread: 1, leather_strap: 1 }, known: true },
    tusk_amulet: { skill: 'jewelcrafting', prof: 'jeweler', level: 0, needs: { polished_tusk: 2, leather_strap: 1, clasp: 1 }, known: true },
    wolfskin_mantle: { skill: 'tailoring', prof: 'tailor', level: 1, needs: { wolf_pelt: 3, boar_leather: 1, clasp: 1 } },
    fang_ring: { skill: 'jewelcrafting', prof: 'jeweler', level: 1, needs: { wolf_fang: 2, ring_setting: 1 } },
    silk_gloves: { skill: 'tailoring', prof: 'tailor', level: 1, needs: { spider_silk: 4, linen_thread: 1 } },
    shell_shield: { skill: 'woodworking', prof: 'carpenter', level: 1, needs: { shield_boards: 1, crab_shell: 4, rivets: 4 }, known: true },
    coral_ring: { skill: 'jewelcrafting', prof: 'jeweler', level: 1, needs: { coral: 2, ring_setting: 1 }, known: true },
    sea_boots: { skill: 'tailoring', prof: 'tailor', level: 1, needs: { boar_leather: 2, siren_scale: 1, buckle: 1 } },
    siren_charm: { skill: 'jewelcrafting', prof: 'jeweler', level: 2, needs: { siren_scale: 3, pearl: 1, clasp: 1, copper_wire: 2 } },
    boarding_axe: { skill: 'smithing', prof: 'smith', level: 2, needs: { iron_bar: 3, wooden_handle: 1, rivets: 2, sea_salt: 1 } }
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
    { key: 'salve', name: 'Herbal Salve', icon: '✚', cd: 8, range: 7, cost: { wild_herb: 1 }, req: { herbalist: 0.5 }, text: 'Heals the player you look at, or yourself. Uses a Wild Herb.' },
    /* from the bosses' runes (2026-11-10) */
    { key: 'webshot', name: 'Web Shot', icon: '⌘', cd: 14, mul: 0.3, range: 9, stun: 2.5, text: 'Binds a foe up to 9 m away for 2.5 s.' },
    { key: 'venom', name: 'Venom Strike', icon: '☣', cd: 10, mul: 1.0, range: 2.6, dot: { d: 0.35, n: 4 }, text: 'A poisoned blow: 100% now, then 35% of it each second for 4 s.' },
    { key: 'battlecry', name: 'Battle Cry', icon: '♜', cd: 30, buff: { mul: 1.3, s: 8 }, text: 'For 8 s your blows hit 30% harder.' },
    { key: 'whirlwind', name: 'Whirlwind', icon: '❂', cd: 12, mul: 0.7, range: 3.2, most: 6, around: true, weapons: ['sword', 'axe', 'mace'], text: 'Hits every foe around you, up to six: 70% damage each.' }
  ];
  /* RUNES (tbuuol 2026-11-10): every ability is a thing now -- a rune in the bag, put into one of the bar's six slots
     (r.bar: the bag uids). A rune has a rank, 1 to 10 ({rk, rx}): it rises as it is used, each rank 6 % more effect and
     3 % less cooldown; two of a kind can be fused into one rank higher, by a runecrafter at a rune table. Bosses drop
     them; a runecrafter takes them apart into essences and glyphs, and makes runes of them again. */
  const RUNE_MAX = 10, BAR_SLOTS = 6;
  /* WHAT KIND OF MATERIAL (the bag's Materials tab, 2026-11-10): raw (gathered, dropped), refined, or a part */
  const REFINED = new Set(['copper_bar', 'iron_bar', 'tin_bar', 'bronze_bar', 'oak_plank', 'deer_leather', 'boar_leather', 'linen_thread', 'linen_cloth', 'copper_wire']);
  const PARTS = new Set(['copper_blade', 'sword_hilt', 'rivets', 'buckle', 'wooden_handle', 'shield_boards', 'antler_buttons', 'leather_strap',
    'fur_lining', 'ring_setting', 'clasp', 'ring_mold', 'antler_beads', 'polished_tusk', 'rune_blank',
    'essence_might', 'essence_guard', 'essence_life', 'essence_venom', 'glyph_strike', 'glyph_sweep', 'glyph_bind', 'glyph_call', 'glyph_mend']);
  const matKind = id => REFINED.has(id) ? 'refined' : PARTS.has(id) ? 'part' : 'raw';
  const runeNeed = rk => Math.round(8 * Math.pow(rk, 1.6));   /* uses from a rank to the next */
  const RUNE_PARTS = {
    heavy: { glyph_strike: 1, essence_might: 2 }, cleave: { glyph_sweep: 1, essence_might: 2 }, crush: { glyph_strike: 1, essence_might: 1, essence_guard: 1 },
    bash: { glyph_bind: 1, essence_guard: 2 }, taunt: { glyph_call: 1, essence_guard: 2 }, salve: { glyph_mend: 1, essence_life: 2 },
    webshot: { glyph_bind: 1, essence_venom: 2 }, venom: { glyph_strike: 1, essence_venom: 2 }, battlecry: { glyph_call: 1, essence_might: 2 },
    whirlwind: { glyph_sweep: 1, essence_might: 3 }
  };
  const CRAFT_AT = { smithing: { str: 0.5, int: 0.3 }, woodworking: { dex: 0.3, str: 0.2 }, tailoring: { dex: 0.4, int: 0.2 }, jewelcrafting: { dex: 0.4, int: 0.3 }, runecraft: { int: 0.5, dex: 0.2 } };
  /* WORKBENCHES (tbuuol 2026-11-10): each craft only at its own -- the forge, the carpenter's bench, the loom, the jeweler's bench */
  const STATIONS = { forge: { skill: 'smithing', name: 'a forge' }, bench: { skill: 'woodworking', name: "a carpenter's bench" },
                     loom: { skill: 'tailoring', name: 'a loom' }, jewel: { skill: 'jewelcrafting', name: "a jeweler's bench" },
                     rune: { skill: 'runecraft', name: 'a rune table' } };
  const stationOf = rc => Object.keys(STATIONS).find(k => STATIONS[k].skill === (rc && rc.skill)) || 'forge';
  /* where a thing is taken apart (tbuuol 2026-11-10: "Zerlegen geht nur an der passenden Bank"): its recipe's bench, or
     for a found thing by what it is -- rings, amulets and charms the jeweler's, shields the carpenter's, weapons the
     forge, everything worn of cloth or leather the loom */
  function salvageAt(id) {
    if (ITEMS[id] && ITEMS[id].rune) return 'rune';
    if (RECIPES[id]) return stationOf(RECIPES[id]);
    const it = ITEMS[id] || {};
    if (it.slot === 'ring' || it.slot === 'amulet' || it.slot === 'trinket') return 'jewel';
    if (it.model === 'shield') return 'bench';
    if (it.slot === 'main') return 'forge';
    return 'loom';
  }
  const RECIPE_DROP = 0.04;   /* very low: that a blueprint drops at all, from a successful craft */
  /* WHICH BLUEPRINT (tbuuol 2026-11-10): not the crafter's level but what is being made decides it -- a pool round the
     recipe's own level, the higher above it the rarer, lower ones too (so a better one stays hard to get); 75 % from
     the craft's own profession, 25 % from another. Any blueprint can drop, one already held too (they can be sold). */
  const BP_TIERS = [[-2, 10], [-1, 20], [0, 45], [1, 20], [2, 5]];   /* [levels from the recipe's, weight] */
  const BP_OWN = 0.75;
  function dropBlueprint(rc, rnd) {
    const profsAll = Array.from(new Set(Object.values(RECIPES).map(x => x.prof)));
    const others = profsAll.filter(p => p !== rc.prof);
    const prof = rnd() < BP_OWN || !others.length ? rc.prof : others[Math.floor(rnd() * others.length)];
    const pool = Object.keys(RECIPES).filter(k => RECIPES[k].prof === prof && ITEMS[k]);
    if (!pool.length) return null;
    const tiers = BP_TIERS.map(([d, w]) => [rc.level + d, w]).filter(([lv]) => pool.some(k => RECIPES[k].level === lv));
    let pick = null;
    if (tiers.length) {
      let sum = tiers.reduce((a, t) => a + t[1], 0), x = rnd() * sum;
      for (const [lv, w] of tiers) { x -= w; if (x <= 0) { pick = lv; break; } }
      if (pick == null) pick = tiers[tiers.length - 1][0];
    } else {   /* nothing of that profession near this level: its nearest level below, if any */
      const lower = pool.map(k => RECIPES[k].level).filter(lv => lv <= rc.level);
      if (!lower.length) return null;
      pick = Math.max(...lower);
    }
    const at = pool.filter(k => RECIPES[k].level === pick);
    return at[Math.floor(rnd() * at.length)];
  }
  /* BLUEPRINTS (tbuuol 2026-11-08, like Entropia's): a recipe is a thing in the bag, 'bp:<recipe>' with its quality
     rating {qr: 0.0 to 100.0}; it is made from only while held, it gets better each time it is used, and it can be kept,
     traded and sold like anything else. The best one of a kind is the one used. */
  const BP = 'bp:';
  const bpOf = (r, rid) => { let best = null; for (const e of r.bag) if (e[1] === BP + rid && (!best || ((e[2] || {}).qr || 0) > ((best[2] || {}).qr || 0))) best = e; return best; };
  const knows = (r, rid) => !!RECIPES[rid] && !!bpOf(r, rid);
  const giveBp = (r, rid) => { r.bag.push([r.n++, BP + rid, { qr: 0 }]); return 'Blueprint: ' + ITEMS[rid].name; };
  /* HOW WELL A THING IS MADE (tbuuol 2026-11-08): each blueprint has the level it can be used from (its recipe's
     level) and the level it is fully understood at (master). The maker's standing between the two gives at most 75 %
     of the result, the blueprint's QR the other 25 %: grade = 0.75 * skill + 0.25 * QR / 100, from 0 to 1.
       success:  35 % (just enough skill, QR 0) to 95 % (mastered, QR 100)
       quality:  35 % up to a ceiling of 35 + 90 * grade %, the top of it rare -- 125 % only for a mastered blueprint
                 at QR 100, and seldom even then */
  const MASTER = { 0: 5, 1: 8, 2: 10 };
  const masterOf = rc => rc.master || MASTER[rc.level] || rc.level + 6;
  const gradeOf = (rc, lv, qr) => 0.75 * clamp((lv - rc.level) / (masterOf(rc) - rc.level), 0, 1) + 0.25 * (qr || 0) / 100;
  const qualityRoll = (grade, rnd) => Math.round((35 + 90 * grade * Math.pow(rnd(), 1.8)) * 10) / 10;
  const FISTS = { name: 'Fists', skill: 'unarmed', model: 'fists', dmg: [2, 4] };
  /* what a raider leaves, each by its own chance */
  /* WHAT A FOUND THING IS TAKEN APART INTO (tbuuol 2026-11-10: "Drops sollten auch zerlegbar sein"): the things no
     recipe makes -- a boss's drops, what a new player starts with -- at the forge, into these */
  const SALVAGE = {
    training_sword: { oak_log: 1 }, linen_shirt: { flax: 1 }, worn_boots: { leather_scrap: 1 },
    rusty_sword: { scrap_iron: 2 }, raider_axe: { scrap_iron: 2, oak_log: 1 }, cudgel: { oak_log: 1 },
    wooden_buckler: { oak_log: 1, leather_scrap: 1 }, leather_cap: { leather_scrap: 1 }, padded_gloves: { torn_cloth: 1, leather_scrap: 1 },
    copper_ring: { copper_ore: 1 }, bone_amulet: { boar_tusk: 1 }, lucky_coin: { copper_ore: 1 },
    pirate_cutlass: { iron_ore: 2, sea_salt: 1 }, tricorn_hat: { torn_cloth: 2, leather_scrap: 1 },
    captains_coat: { torn_cloth: 2, leather_scrap: 2, pearl: 1 },
    broodfang: { brood_carapace: 1, venom_sac: 1, spider_silk: 1 }, silkweave_mantle: { spider_silk: 3 },
    venom_ring: { venom_sac: 2 }, carapace_shield: { brood_carapace: 2 }
  };
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
  /* a new bag entry: a rune with its rank (from a craft: the grade sets it, 1 to 3) */
  const entry = (r, id, rk) => ITEMS[id] && ITEMS[id].rune ? [r.n++, id, { rk: rk || 1, rx: 0 }] : [r.n++, id];
  function itemOf(r, uid) {
    const e = r.bag.find(b => b[0] === uid); if (!e) return null;
    const x = e[2] || {};
    if (String(e[1]).startsWith(BP)) { const rid = e[1].slice(BP.length); return { uid, id: e[1], name: 'Blueprint: ' + ((ITEMS[rid] || {}).name || rid) + ' (QR ' + (x.qr || 0).toFixed(1) + ')', blueprint: rid, qr: x.qr || 0 }; }
    const it = Object.assign({ uid, id: e[1] }, ITEMS[e[1]]);
    if (it.rune) { it.rk = x.rk || 1; it.rx = x.rx || 0; it.need = it.rk < RUNE_MAX ? runeNeed(it.rk) : 0; it.name += ' (rank ' + it.rk + ')'; }
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
  function abilities(r) {   /* the bar's six slots: the rune in each (empty: {empty}), what it does at its rank, usable or why not */
    const st = stats(r), off = r.eq.off ? itemOf(r, r.eq.off) : null, shield = !!(off && off.model === 'shield');
    const out = [];
    for (let i = 0; i < BAR_SLOTS; i++) {
      const uid = (r.bar || [])[i], e = uid != null && r.bag.find(b => b[0] === uid), it = e && ITEMS[e[1]];
      const base = it && it.rune && ABILITIES.find(x => x.key === it.rune);
      if (!base) { out.push({ empty: true, slot: i, key: '', icon: '', name: 'Empty', ok: false, why: 'no rune here: put one in from your bag' }); continue; }
      const rk = (e[2] || {}).rk || 1, up = 1 + 0.06 * (rk - 1), quick = 1 - 0.03 * (rk - 1);
      const a = Object.assign({}, base, { slot: i, uid, rk, rx: (e[2] || {}).rx || 0, need: rk < RUNE_MAX ? runeNeed(rk) : 0, cd: Math.round(base.cd * quick * 10) / 10 });
      if (base.mul) a.mul = base.mul * up;
      if (base.stun) a.stun = base.stun * up;
      if (base.buff) a.buff = { mul: 1 + (base.buff.mul - 1) * up, s: base.buff.s };
      let why = '';
      if (a.weapons && !a.weapons.includes(st.skill)) why = 'needs ' + a.weapons.join(' or ');
      else if (a.shield && !shield) why = 'needs a shield in the left hand';
      else for (const k in a.req || {}) {
        const pk = k === 'hit' ? st.hitProf : k === 'dmg' ? st.dmgProf : k;
        if ((st.prof[pk] || 0) < a.req[k]) { why = 'needs ' + PROFS[pk].name + ' level ' + a.req[k]; break; }
      }
      if (!why) for (const m in a.cost || {}) if ((r.mat[m] || 0) < a.cost[m]) { why = 'needs a ' + ITEMS[m].name; break; }
      out.push(Object.assign(a, { ok: !why, why }));
    }
    return out;
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
      loot(a, rnd, table, matsOnly) {   /* a raider's drop, or a beast's (its own table); matsOnly: not a boss */
        const r = of(a), got = []; rnd = rnd || Math.random;
        for (const [id, p] of table || LOOT) {
          if (!ITEMS[id]) continue;
          if (matsOnly && !ITEMS[id].material) continue;   /* ONLY BOSSES DROP THINGS (tbuuol 2026-11-10); the rest drop materials */
          if (rnd() >= p) continue;
          if (ITEMS[id].material) r.mat[id] = (r.mat[id] || 0) + 1; else r.bag.push(entry(r, id));
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
        /* the blueprint's QR: in 42 % of the uses it goes up by 0.05 to 0.2 (tbuuol 2026-11-10: it rose far too fast) */
        if (rnd() < 0.42) x.qr = Math.min(100, Math.round((qr + 0.05 + rnd() * 0.15) * 100) / 100);
        const sk = Object.assign({}, CRAFT_AT[rc.skill] || {}); sk[rc.skill] = 6 + rc.level * 2;
        /* it can fail: 35 % success with just enough skill and QR 0, up to 95 %; a failure costs half of what was put
           in, and teaches less */
        const grade = gradeOf(rc, lv, qr);
        if (rnd() >= 0.35 + 0.6 * grade) {
          const lost = [];
          for (const m in rc.needs) { const n = Math.max(1, Math.floor(rc.needs[m] / 2)); r.mat[m] -= n; if (r.mat[m] <= 0) delete r.mat[m]; lost.push(ITEMS[m].name + ' ×' + n); }
          learn(r, sk, effortOf(rc.level, lv) * 0.4);
          return { ok: true, failed: true, lost, qr: x.qr, up: ups(r, before) };
        }
        for (const m in rc.needs) { r.mat[m] -= rc.needs[m]; if (!r.mat[m]) delete r.mat[m]; }
        const item = ITEMS[rid], q = item.slot ? qualityRoll(grade, rnd) : null, many = item.material ? (rc.yields || 1) : 0;
        if (many) r.mat[rid] = (r.mat[rid] || 0) + many;   /* a refined material or a part: into the materials, rc.yields of it */
        else if (item.rune) r.bag.push(entry(r, rid, 1 + Math.floor(grade * 2.99)));   /* a rune: its rank from how well it went */
        else r.bag.push(q ? [r.n++, rid, { q }] : [r.n++, rid]);
        learn(r, sk, effortOf(rc.level, lv));
        const after = profs(r)[rc.prof];
        let learnt = null;
        if (rnd() < RECIPE_DROP) {   /* a blueprint, found while working: into the bag (dropBlueprint above) */
          learnt = dropBlueprint(rc, rnd);
          if (learnt) giveBp(r, learnt);
        }
        return { ok: true, made: item.name + (many > 1 ? ' ×' + many : '') + (q ? ' (' + q.toFixed(1) + ' %)' : ''), qr: x.qr, up: ups(r, before), learnt: learnt && 'Blueprint: ' + ITEMS[learnt].name };
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
        const gather = pick([['tree', 5], ['copper', 4], ['herb', 6], ['stone', 6]]);
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
        const was = {}; for (const k in sk) was[k] = (ATTRS[k] ? r.at[k] : r.sk[k]) || 0;
        learn(r, sk, 1);
        for (const k in sk) { const d = ((ATTRS[k] ? r.at[k] : r.sk[k]) || 0) - was[k]; if (d > 0) got.push('+' + d.toFixed(2) + ' ' + (ATTRS[k] || (SKILLS[k] || {}).name || k)); }
        if (rnd() < 0.08) { const open = Object.keys(RECIPES).filter(k => !knows(r, k)); if (open.length) got.push(giveBp(r, open[Math.floor(rnd() * open.length)])); }
        return { ok: true, got, up: ups(r, before) };
      },
      /* taking a made thing apart at the forge: half of what its recipe needs comes back (at least one of each), never
         a failure; nothing worn, no blueprint; a thing no recipe makes, into what SALVAGE says */
      /* RUNES: into a bar slot (taken from any other), off it; a use counts towards its next rank; two fused */
      toBar(a, uid, slot) {
        const r = of(a), e = r.bag.find(b => b[0] === uid);
        if (!e || !(ITEMS[e[1]] || {}).rune) return { ok: false, why: 'that is no rune' };
        slot = Math.max(0, Math.min(BAR_SLOTS - 1, slot | 0)); r.bar = (r.bar || []).slice(0, BAR_SLOTS);
        for (let i = 0; i < BAR_SLOTS; i++) if (r.bar[i] === uid) r.bar[i] = null;
        r.bar[slot] = uid; return { ok: true };
      },
      offBar(a, slot) { const r = of(a); if (r.bar) r.bar[slot | 0] = null; return { ok: true }; },
      runeUsed(a, key) {
        const r = of(a), e = (r.bar || []).map(u => r.bag.find(b => b[0] === u)).find(x => x && (ITEMS[x[1]] || {}).rune === key);
        if (!e) return null;
        const x = e[2] = e[2] || { rk: 1, rx: 0 }; x.rk = x.rk || 1;
        if (x.rk >= RUNE_MAX) return null;
        x.rx = (x.rx || 0) + 1;
        if (x.rx < runeNeed(x.rk)) return null;
        x.rk++; x.rx = 0;
        return ITEMS[e[1]].name + ' is rank ' + x.rk + ' now';
      },
      fuse(a, uid) {   /* this rune and the best other one of its kind: one rank above the better of the two */
        const r = of(a), e = r.bag.find(b => b[0] === uid);
        if (!e || !(ITEMS[e[1]] || {}).rune) return { ok: false, why: 'that is no rune' };
        const other = r.bag.filter(b => b !== e && b[1] === e[1]).sort((p, q) => ((q[2] || {}).rk || 1) - ((p[2] || {}).rk || 1))[0];
        if (!other) return { ok: false, why: 'you need a second ' + ITEMS[e[1]].name.replace(' (rank', '') };
        const rk = Math.min(RUNE_MAX, Math.max((e[2] || {}).rk || 1, (other[2] || {}).rk || 1) + 1);
        r.bag = r.bag.filter(b => b !== e && b !== other);
        const fresh2 = entry(r, e[1], rk); r.bag.push(fresh2);
        if (r.bar) { let kept = false; r.bar = r.bar.map(u => u === e[0] || u === other[0] ? (kept ? null : (kept = true, fresh2[0])) : u); }   /* the new one in the old one's slot */
        const before = profs(r); learn(r, { runecraft: 4, int: 0.3 }, 1);
        return { ok: true, made: ITEMS[e[1]].name + ' (rank ' + rk + ')', up: ups(r, before) };
      },
      salvage(a, uid) {
        const r = of(a), i = r.bag.findIndex(e => e[0] === uid);
        if (i < 0) return { ok: false, why: 'it is not in your bag' };
        const id = r.bag[i][1], rc = RECIPES[id];
        if (Object.values(r.eq).includes(uid)) return { ok: false, why: 'take it off first' };
        const runeK = ITEMS[id] && ITEMS[id].rune, rk = runeK ? ((r.bag[i][2] || {}).rk || 1) : 0;
        const parts = runeK ? Object.fromEntries(Object.entries(RUNE_PARTS[runeK] || {}).map(([m, n]) => [m, m.startsWith('essence') ? n + Math.floor(rk / 3) : n])) : rc ? null : SALVAGE[id];
        if (!rc && !parts) return { ok: false, why: 'nobody knows how it was made' };
        r.bag.splice(i, 1);
        const got = [];
        if (runeK) for (const m in parts) { r.mat[m] = (r.mat[m] || 0) + parts[m]; got.push(ITEMS[m].name + ' ×' + parts[m]); }
        else if (rc) for (const m in rc.needs) { const n = Math.max(1, Math.floor(rc.needs[m] / 2)); r.mat[m] = (r.mat[m] || 0) + n; got.push(ITEMS[m].name + ' ×' + n); }
        else for (const m in parts) { r.mat[m] = (r.mat[m] || 0) + parts[m]; got.push(ITEMS[m].name + ' ×' + parts[m]); }
        if (runeK && RECIPES[id] && Math.random() < 0.08) { giveBp(r, id); got.push('Blueprint: ' + ITEMS[id].name); }   /* now and then its pattern */
        const before = profs(r), sk = {}; sk[runeK ? 'runecraft' : rc ? rc.skill : 'smithing'] = 2; learn(r, sk, 0.5);
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
        for (const id of rw.items || []) if (ITEMS[id]) { r.bag.push(entry(r, id)); got.push(ITEMS[id].name); }
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
  const rpg = { api: 1, entryName, masterOf, gradeOf, SLOTS, SKILLS, PROFS, ATTRS, RANKS, ITEMS, FISTS, LOOT, GATHER, RECIPES, SALVAGE, STATIONS, stationOf, salvageAt, RUNE_MAX, BAR_SLOTS, matKind, CODEX, ABILITIES, abilities, questState, questProgress, knows, fresh, stats, profs, rank, meets, itemOf, attr, book };
  if (G.LWQ && G.LWQ.define) G.LWQ.define('rpg', { api: 1, v: 22 }, () => rpg);
})(typeof globalThis !== 'undefined' ? globalThis : this);
