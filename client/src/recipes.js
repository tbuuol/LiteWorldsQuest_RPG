// Recipes for people (kit.js builds them): rolled for villagers from the catalogue (content/core/people/
// catalogue.json) by role and seed, so every screen rolls the same person; made from a villager's hand-written body
// and look; and checked for players (only player and shared things, nothing a villager wears).

const BASE_SKIN = { m: 'male', f: 'female' };

/** a small seeded random (mulberry32): the same seed gives the same person everywhere */
export function rng(seed) {
  let a = (typeof seed === 'string' ? [...seed].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0, 7) : seed >>> 0) || 1;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    f: next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    pick: list => list[Math.floor(next() * list.length) % list.length],
    chance: p => next() < p,
  };
}

const forOk = (who, tag) => tag === 'both' || tag === who;

/** the skin texture for a base, an origin and an age (-1 child .. 1 old) */
export function skinFor(base, origin, age, have = null) {
  const band = age > 0.55 ? 'old' : age > 0.12 ? 'middleage' : 'young';
  const name = `${band}_${origin}_${BASE_SKIN[base]}`;
  if (!have || have.includes(name)) return name;
  return have.find(s => s.startsWith(band) && s.endsWith('_' + BASE_SKIN[base])) || `young_caucasian_${BASE_SKIN[base]}`;
}

function colourParts(cat, who, outfit, R, prefs, fixed = {}) {
  const pal = cat.palettes[who];
  const o = cat.outfits[outfit];
  const colour = {};
  for (const id of o.parts) {
    if (fixed[id]) { colour[id] = fixed[id]; continue; }
    if (/boots|belt/.test(id)) colour[id] = R.pick(pal.leather);
    else if (id === 'apron') colour[id] = R.pick(pal.light);
    else colour[id] = R.pick(pal[R.pick(prefs)] || pal.cloth);
  }
  for (const group of o.same || []) for (const id of group.slice(1)) if (!fixed[id]) colour[id] = colour[group[0]];
  return o.parts.map(id => ({ id, color: colour[id] }));
}

/**
 * A villager rolled from the catalogue: role picks outfits and ranges, the seed everything else.
 * opts: { base: 'm'|'f' (else rolled), origin }
 */
export function dice(cat, seed, role = 'villager', opts = {}, skins = null) {
  const R = rng(seed);
  const r = cat.roles[role] || cat.roles.villager;
  const base = opts.base || (R.chance(0.5) ? 'm' : 'f');
  const lim = cat.shape.npc;
  const span = (k, def) => { const [a, b] = r[k] || def; return R.range(a, b); };
  const shape = {
    weight: span('weight', [-0.7, 0.8]) * (R.chance(0.3) ? 1 : 0.6),
    muscle: span('muscle', [-0.6, 0.7]),
    age: span('age', [-0.3, 0.9]),
  };
  for (const k of ['weight', 'muscle', 'age']) shape[k] = Math.max(lim[k][0], Math.min(lim[k][1], shape[k]));
  const origin = opts.origin || R.pick(['caucasian', 'caucasian', 'caucasian', 'african', 'asian']);
  if (cat.origins[origin].african) shape.african = cat.origins[origin].african;
  if (cat.origins[origin].asian) shape.asian = cat.origins[origin].asian;
  for (const f of cat.shape.face) if (R.chance(0.6)) shape[f] = R.range(-0.8, 0.8);
  const hairs = Object.entries(cat.hair[base]).filter(([, t]) => forOk('npc', t)).map(([h]) => h);
  const old = shape.age > 0.6;
  const hairColors = [...cat.hairColors.both, ...(old ? cat.hairColors.npc : [])];
  const hc = old && R.chance(0.7) ? R.pick(cat.hairColors.npc) : R.pick(hairColors);
  const bald = base === 'm' && shape.age > 0.5 && R.chance(0.25);
  const outfit = R.pick(base === 'm' ? r.outfits_m : r.outfits_f);
  return {
    base, height: span('height', [-0.8, 0.8]), shape,
    skin: skinFor(base, origin, shape.age, skins),
    eyes: R.pick(cat.eyes), brows: R.pick(cat.brows), browColor: hc,
    hair: bald ? null : R.pick(hairs), hairColor: hc,
    parts: colourParts(cat, 'npc', outfit, R, r.colors || ['cloth'], r.fixed || {}),
  };
}

/** MakeHuman's macro value (0..1, neutral 0.5) as a slider (-1..1), by the keys' ends (kit.py) */
const slider = (v, hi, lo) => v === undefined ? 0 : v >= 0.5 ? Math.min(1, (v - 0.5) / (hi - 0.5)) : -Math.min(1, (0.5 - v) / (0.5 - lo));

/** a villager written by hand (places/*.json: body and look) as a recipe */
export function fromNpc(cat, n, skins = null) {
  const b = n.body || {}, look = n.look || {};
  const base = (b.gender ?? 1) < 0.5 ? 'f' : 'm';
  const shape = {
    weight: slider(b.weight, 0.9, 0.12), muscle: slider(b.muscle, 0.9, 0.15),
    age: slider(b.age, 0.92, 0.1875),
  };
  const race = b.race || {};
  if (race.african) shape.african = race.african;
  if (race.asian) shape.asian = race.asian;
  const R = rng(n.id || 'npc');
  const leather = look.boots || '#4a3424', belt = look.belt || '#3b2a1c';
  let parts;
  const guard = n.role === 'guard' || look.trousers;
  if (look.robe) parts = [{ id: 'shirt', color: look.robe }, { id: 'skirt_long', color: look.robe }, { id: 'belt', color: belt }, { id: 'boots_low', color: leather }];
  else if (base === 'f' && !guard) parts = [{ id: 'shirt', color: look.shirt || '#6b5a48' }, { id: 'skirt_long', color: look.skirt || look.pants || '#4a3b2a' }, { id: 'belt', color: belt }, { id: 'boots_low', color: leather }];
  else parts = [{ id: 'shirt', color: look.shirt || '#6b5a48' }, { id: 'tunic_skirt', color: look.shirt || '#6b5a48' }, { id: 'trousers', color: look.pants || '#3a3028' }, { id: 'belt', color: belt }, { id: 'boots_high', color: leather }];
  if (look.apron) parts.push({ id: 'apron', color: look.apron });
  const skinName = b.skin && (!skins || skins.includes(b.skin)) ? b.skin : skinFor(base, race.african ? 'african' : race.asian ? 'asian' : 'caucasian', shape.age, skins);
  return {
    base, height: slider(b.height, 1, 0), shape, skin: skinName,
    eyes: R.pick(cat.eyes), brows: b.brows || R.pick(cat.brows), browColor: look.hair,
    hair: b.hair || null, hairColor: look.hair || '#4a3020', parts,
  };
}

/** a player's recipe made safe: only what players may have, sliders in their ranges; null if it is no recipe */
export function checkPlayer(cat, rec, skins = null) {
  if (!rec || (rec.base !== 'm' && rec.base !== 'f')) return null;
  const lim = cat.shape.player, out = { base: rec.base, shape: {} };
  const clamp = (v, [a, b]) => Math.max(a, Math.min(b, Number(v) || 0));
  out.height = clamp(rec.height, lim.height);
  for (const k of ['weight', 'muscle', 'age']) out.shape[k] = clamp(rec.shape?.[k], lim[k]);
  for (const k of ['african', 'asian']) if (rec.shape?.[k]) out.shape[k] = clamp(rec.shape[k], [0, 1]);
  for (const f of cat.shape.face) if (rec.shape?.[f]) out.shape[f] = clamp(rec.shape[f], [-1, 1]);
  const hairOk = h => h && forOk('player', cat.hair[rec.base][h]);
  out.hair = hairOk(rec.hair) ? rec.hair : null;
  const colours = [...cat.hairColors.both, ...cat.hairColors.player];
  out.hairColor = colours.includes(rec.hairColor) ? rec.hairColor : colours[0];
  out.browColor = colours.includes(rec.browColor) ? rec.browColor : out.hairColor;
  out.brows = cat.brows.includes(rec.brows) ? rec.brows : cat.brows[0];
  out.eyes = cat.eyes.includes(rec.eyes) ? rec.eyes : 'brown';
  out.skin = skins && skins.includes(rec.skin) && rec.skin.endsWith('_' + BASE_SKIN[rec.base]) ? rec.skin : skinFor(rec.base, 'caucasian', out.shape.age, skins);
  const pal = cat.palettes.player, allowed = new Set([...pal.cloth, ...pal.dyed, ...pal.light, ...pal.leather]);
  const outfit = Object.entries(cat.outfits).find(([, o]) => forOk('player', o.for) && o.parts.length === (rec.parts || []).length &&
    o.parts.every(id => rec.parts.some(p => p.id === id)));
  if (!outfit) return null;
  out.parts = outfit[1].parts.map(id => {
    const c = rec.parts.find(p => p.id === id).color;
    return { id, color: allowed.has(c) ? c : (/boots|belt/.test(id) ? pal.leather[0] : pal.cloth[0]) };
  });
  return out;
}

/** a first recipe for a new player (the creator starts from it): rolled from the player palette */
export function dicePlayer(cat, seed, skins = null) {
  const R = rng(seed);
  const base = R.chance(0.5) ? 'm' : 'f';
  const origin = R.pick(['caucasian', 'african', 'asian']);
  const shape = { weight: R.range(-0.4, 0.4), muscle: R.range(-0.2, 0.6), age: R.range(-0.3, 0.3) };
  if (origin === 'african') shape.african = 1;
  if (origin === 'asian') shape.asian = 1;
  const hairs = Object.entries(cat.hair[base]).filter(([, t]) => forOk('player', t)).map(([h]) => h);
  const hc = R.pick([...cat.hairColors.both, ...cat.hairColors.player]);
  const outfits = Object.entries(cat.outfits).filter(([, o]) => forOk('player', o.for)).map(([k]) => k);
  return {
    base, height: R.range(-0.5, 0.5), shape, skin: skinFor(base, origin, shape.age, skins),
    eyes: R.pick(cat.eyes), brows: R.pick(cat.brows), browColor: hc, hair: R.pick(hairs), hairColor: hc,
    parts: colourParts(cat, 'player', R.pick(outfits), R, ['cloth', 'dyed']),
  };
}
