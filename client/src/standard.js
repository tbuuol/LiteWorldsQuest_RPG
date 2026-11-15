// The standard people (content/core/people/std, tools/bake/standard.py): Quaternius' base characters and fantasy
// outfits as they come, put together the way the packs mean it: an outfit (body, arms with the hands, legs, feet),
// the base character's head with its eyes and brows, a hairstyle, the ranger's hood and pauldrons if wanted. All on
// one skeleton; the Universal Animation Library's clips play on it as they are.
//
// look = { base: 'm'|'f', outfit: 'peasant'|'ranger', colours: 1|2|3 (the outfit's texture variant), hair: 'simpleparted'
//          | 'long' | 'buns' | 'buzzed' | 'buzzedfemale' | null, beard: bool, brows: 'regular'|'female', hood: bool,
//          pauldrons: bool, hairColor: '#3a2a1a' (the packs' hair is grey, to be tinted) }

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
const files = new Map(), textures = new Map();
const gltf = url => { if (!files.has(url)) files.set(url, loader.loadAsync(url)); return files.get(url); };
function texture(url) {
  if (!textures.has(url)) {
    const t = new THREE.TextureLoader().load(url);
    t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    textures.set(url, t);
  }
  return textures.get(url);
}

/** a person ready for figure.js's createBody: { scene, animations } */
export async function buildStandard(contentBase, look) {
  const S = `${contentBase}/core/people/std`;
  const b = look.base === 'f' ? 'f' : 'm';
  const outfit = look.outfit === 'ranger' ? 'ranger' : 'peasant';
  const want = [`${b}_${outfit}`, `${b}_head`];
  if (look.hair) want.push(`hair_hair_${look.hair}`);
  if (look.beard && b === 'm') want.push('hair_hair_beard');
  want.push(`hair_eyebrows_${look.brows || (b === 'f' ? 'female' : 'regular')}`);
  if (outfit === 'ranger' && look.hood) want.push(`${b}_ranger_hood`);
  if (outfit === 'ranger' && look.pauldrons) want.push(b === 'f' ? 'f_ranger_pauldrons' : 'm_ranger_pauldron');
  const [anim, side, ...parts] = await Promise.all([gltf(`${S}/anim.glb`), gltf(`${S}/strafe.glb`), ...want.map(n => gltf(`${S}/${n}.glb`))]);
  // the outfit's skeleton is the person's skeleton; every other part's meshes join it, bone by bone (by name)
  const root = cloneSkinned(parts[0].scene);
  root.updateMatrixWorld(true);
  const bones = new Map();
  root.traverse(o => { if (o.isBone) bones.set(o.name, o); });
  const colourMap = look.colours > 1 ? texture(`${S}/tex/${outfit}_${look.colours}.jpg`) : null;
  root.traverse(o => {
    if (!o.isSkinnedMesh) return;
    o.castShadow = true; o.frustumCulled = false;
    if (colourMap && /peasant|ranger/i.test(o.material.name)) { o.material = o.material.clone(); o.material.map = colourMap; }
  });
  for (const g of parts.slice(1)) {
    const part = cloneSkinned(g.scene);
    const meshes = [];
    part.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
    for (const m of meshes) {
      const sk = m.skeleton;
      const skel = new THREE.Skeleton(sk.bones.map(x => bones.get(x.name) || x), sk.boneInverses);
      m.removeFromParent();
      root.add(m);
      m.bind(skel, m.bindMatrix);
      m.castShadow = true; m.frustumCulled = false;
      const mat = m.material;
      if (/hair|brow|beard/i.test(m.name + mat.name)) {
        m.material = mat.clone();
        m.material.color = new THREE.Color(look.hairColor || '#3a2a1a');
        m.material.alphaTest = Math.max(mat.alphaTest || 0, 0.5); m.material.transparent = false; m.material.side = THREE.DoubleSide;
      }
      if (colourMap && /peasant|ranger/i.test(mat.name)) { m.material = mat.clone(); m.material.map = colourMap; }
    }
  }
  // only the clips' rotations and the hips' position (every bone keeps the length it has here); the hips move about
  // this body's rest, scaled by how much higher or lower they are than the library's
  const ours = bones.get('pelvis').position, ual = anim.scene.getObjectByName('pelvis')?.position || ours;
  const k = ours.length() / Math.max(1e-6, ual.length());
  // the library's clips and our sidesteps (tools/bake/strafe.py)
  const animations = [...anim.animations, ...side.animations].map(c => new THREE.AnimationClip(c.name, c.duration, c.tracks
    .filter(t => !t.name.endsWith('.scale') && (!t.name.endsWith('.position') || t.name.startsWith('pelvis.')))
    .map(t => {
      if (!t.name.endsWith('.position')) return t;
      const t2 = t.clone();
      for (let i = 0; i < t2.values.length; i += 3) {
        t2.values[i] = ours.x + (t2.values[i] - ual.x) * k;
        t2.values[i + 1] = ours.y + (t2.values[i + 1] - ual.y) * k;
        t2.values[i + 2] = ours.z + (t2.values[i + 2] - ual.z) * k;
      }
      return t2;
    })));
  const outer = new THREE.Group();
  outer.add(root);
  return { scene: outer, animations };
}

// ---------------------------------------------------------------- looks: rolled, from a villager's description, checked
import { rng } from './recipes.js';

let catP = null;
export const standardCatalogue = base => catP ||= fetch(`${base}/core/people/standard.json`).then(r => r.json());

/** a look rolled from a seed (a new player's first look; villagers without a description) */
export function diceStandard(cat, seed, opts = {}) {
  const R = rng(seed);
  const base = opts.base || (R.chance(0.5) ? 'm' : 'f');
  const outfit = opts.outfit || R.pick(Object.keys(cat.outfits));
  const o = cat.outfits[outfit];
  return {
    base, outfit, colours: R.pick(o.colours),
    hair: R.chance(0.92) ? R.pick(cat.hair[base]) : null,
    beard: base === 'm' && R.chance(0.35),
    hood: outfit === 'ranger' && R.chance(0.3), pauldrons: outfit === 'ranger' && R.chance(0.5),
    hairColor: R.pick(cat.hairColors.slice(0, 9)),
  };
}

/** a villager as its place describes it (body and look, written for the old figures), in the standard's terms */
export function standardForNpc(cat, n) {
  const b = n.body || {}, look = n.look || {};
  const base = (b.gender ?? 1) < 0.5 ? 'f' : 'm';
  const R = rng(n.id || 'npc');
  const guard = n.role === 'guard';
  const old = (b.age ?? 0.5) > 0.8;
  const h = String(b.hair || '');
  const hair = base === 'f'
    ? (/bun/.test(look.hairStyle || '') ? 'buns' : /pony|braid|long/.test(h) ? 'long' : /bob/.test(h) ? 'simpleparted' : R.pick(cat.hair.f))
    : (/long/.test(h) ? 'long' : /short0[34]/.test(h) ? 'buzzed' : h ? 'simpleparted' : R.pick(cat.hair.m));
  return {
    base, outfit: guard ? 'ranger' : 'peasant', colours: guard ? 3 : (R.chance(0.5) ? 1 : 2),
    hair, beard: base === 'm' && (!!look.beard || old), hood: guard, pauldrons: guard,
    hairColor: look.hair || '#3a2a1a',
  };
}

/** a player's look made safe: only what the standard has; null if it is none */
export function checkStandard(cat, l) {
  if (!l || !cat.bases.includes(l.base) || !cat.outfits[l.outfit]) return null;
  const o = cat.outfits[l.outfit];
  return {
    base: l.base, outfit: l.outfit,
    colours: o.colours.includes(l.colours) ? l.colours : o.colours[0],
    hair: cat.hair[l.base].includes(l.hair) ? l.hair : null,
    beard: !!l.beard && cat.beard.includes(l.base),
    hood: !!l.hood && (o.extras || []).includes('hood'),
    pauldrons: !!l.pauldrons && (o.extras || []).includes('pauldrons'),
    hairColor: cat.hairColors.includes(l.hairColor) ? l.hairColor : cat.hairColors[2],
  };
}
