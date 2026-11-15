// People from a recipe: one of two base bodies (content/core/people/kit, baked by tools/bake/kit.py), shaped by the
// recipe's sliders (shape keys on body, clothes and hair alike, the skeleton's joints moved to match), dressed in its
// parts, coloured as it says. Everything is loaded once and shared; a person costs only its recipe.
//
// recipe = { base: 'm'|'f', height: -1..1, shape: { weight, muscle, age (-1 child .. 1 old), african, asian, nose_wide,
//            ... -1..1 }, skin: 'young_caucasian_male', eyes: 'brown', hair: 'short02' | null, brows: 'eyebrow001',
//            hairColor, parts: [{ id: 'shirt', color: '#6b4a2a' }, ...] }

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();
const files = new Map(), textures = new Map(), clipsFor = new Map();

const once = (key, make) => { if (!files.has(key)) files.set(key, make()); return files.get(key); };
const gltf = url => once(url, () => loader.loadAsync(url));
const json = url => once(url, () => fetch(url).then(r => r.json()));
function texture(url, srgb = true) {
  if (!textures.has(url)) {
    const t = texLoader.load(url);
    t.flipY = false;   // glTF's UVs
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 4;
    textures.set(url, t);
  }
  return textures.get(url);
}

// how far a slider at its end drives a key: MakeHuman's own range of weight and muscle is mild (its heaviest body is
// a few centimetres rounder), so the keys are driven past it; clothes, hair and joints follow the same keys
const GAIN = { weight_hi: 2.6, weight_lo: 1.2, muscle_hi: 1.8, muscle_lo: 1.2 };

/** the shape keys' weights from a recipe's sliders */
function keyWeights(shape = {}) {
  const w = {};
  const two = (v, hi, lo) => {
    v = Math.max(-1, Math.min(1, v || 0));
    if (v > 0) w[hi] = v * (GAIN[hi] || 1); else if (v < 0) w[lo] = -v * (GAIN[lo] || 1);
  };
  two(shape.weight, 'weight_hi', 'weight_lo');
  two(shape.muscle, 'muscle_hi', 'muscle_lo');
  two(shape.age, 'age_old', 'age_young');
  for (const [k, v] of Object.entries(shape)) {
    if (['weight', 'muscle', 'age'].includes(k)) continue;
    w[k === 'african' ? 'race_african' : k === 'asian' ? 'race_asian' : k] = Math.max(-1, Math.min(1, v || 0));
  }
  return w;
}

function applyMorphs(mesh, weights) {
  const d = mesh.morphTargetDictionary;
  if (!d) return;
  mesh.morphTargetInfluences.fill(0);
  for (const [k, v] of Object.entries(weights)) if (k in d) mesh.morphTargetInfluences[d[k]] = v;
}

/**
 * The skeleton at rest, its joints where the shape keys put them (a child's knees are lower, not just smaller).
 * The rest pose comes from the skin's inverse bind matrices (the bones as loaded may stand in some pose): each joint
 * keeps its rest rotation and moves to its new place; every bone's local position follows from that, and every
 * mesh (body and parts) is bound to these new rests. Returns the new inverse bind matrix per bone name and where the
 * hips rest in their parent's space (for the clips' hip track).
 */
function fitJoints(root, info, weights) {
  root.updateMatrixWorld(true);
  let ref = null;
  root.traverse(o => { if (o.isSkinnedMesh && (!ref || o.skeleton.bones.length > ref.skeleton.bones.length)) ref = o; });
  // three.js drops dots from node names ("DEF-upper_arm.L" is bone "DEF-upper_armL"): look the joints up the same way
  const clean = n => THREE.PropertyBinding.sanitizeNodeName(n);
  const joints = new Map(Object.entries(info.joints).map(([n, v]) => [clean(n), v]));
  const jkeys = Object.fromEntries(Object.entries(info.jointKeys).map(([k, d]) => [k, Object.fromEntries(Object.entries(d).map(([n, v]) => [clean(n), v]))]));
  const W = new Map(), W2 = new Map();
  ref.skeleton.bones.forEach((bone, i) => W.set(bone.name, ref.skeleton.boneInverses[i].clone().invert()));
  const p = new THREE.Vector3();
  for (const [name, m] of W) {
    const j = joints.get(name);
    p.setFromMatrixPosition(m);
    if (j) {
      p.set(...j);
      for (const [k, w] of Object.entries(weights)) {
        const d = jkeys[k]?.[name];
        if (d) p.x += d[0] * w, p.y += d[1] * w, p.z += d[2] * w;
      }
    }
    W2.set(name, m.clone().setPosition(p));
  }
  const inv = new Map([...W2].map(([n, m]) => [n, m.clone().invert()]));
  const local = (name, mats) => {
    const bone = ref.skeleton.bones.find(x => x.name === name);
    const parent = bone.parent;
    const pm = parent && mats.has(parent.name) ? mats.get(parent.name) : (parent ? parent.matrixWorld : new THREE.Matrix4());
    return new THREE.Vector3().setFromMatrixPosition(mats.get(name)).applyMatrix4(pm.clone().invert());
  };
  let hips = new THREE.Vector3();
  for (const bone of ref.skeleton.bones) {
    const now = local(bone.name, W2);
    bone.position.copy(now);
    if (bone.name === 'DEF-hips') hips = now.clone();
  }
  root.updateMatrixWorld(true);
  return { inv, hips };
}

/** bind a skinned mesh to the person's bones (by name) at their new rest */
function rebind(mesh, bones, inv) {
  const bs = mesh.skeleton.bones.map(x => bones.get(x.name) || x);
  const is = mesh.skeleton.bones.map((x, i) => inv.get(x.name) || mesh.skeleton.boneInverses[i]);
  mesh.bind(new THREE.Skeleton(bs, is), mesh.bindMatrix);
}

// the body's skin under clothes is not drawn: bit i of its _hide attribute is set where garment i covers it
function hideShader(mat, mask) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uHideMask = { value: mask };
    sh.vertexShader = 'attribute float _hide;\nflat varying int vHide;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvHide = int(_hide + 0.5);');
    sh.fragmentShader = 'uniform int uHideMask;\nflat varying int vHide;\n' +
      sh.fragmentShader.replace('void main() {', 'void main() {\nif ((vHide & uHideMask) != 0) discard;');
  };
  mat.customProgramCacheKey = () => 'hide' + mask;
}

/**
 * The library's clips (one file for everyone: every person has its skeleton), the hips' track fitted to this body:
 * the library moves its hips about its own rest; here they move about this body's rest, by as much more or less as
 * this body's hips are higher or lower (a child bobs less). Only the hips move bones; every other bone keeps its length.
 */
async function clips(base, hips) {
  const key = hips.toArray().map(x => x.toFixed(3)).join(',');
  if (!clipsFor.has(key)) {
    clipsFor.set(key, gltf(`${base}/core/people/kit/anim.glb`).then(g => {
      const ual = g.scene.getObjectByName('DEF-hips')?.position || hips;
      const k = hips.length() / Math.max(1e-6, ual.length());
      return g.animations.map(c => {
        const tracks = [];
        for (const tr of c.tracks) {
          if (tr.name.endsWith('.scale')) continue;
          if (tr.name.endsWith('.position')) {
            if (!tr.name.startsWith('DEF-hips.')) continue;
            const t2 = tr.clone();
            for (let i = 0; i < t2.values.length; i += 3) {
              t2.values[i] = hips.x + (t2.values[i] - ual.x) * k;
              t2.values[i + 1] = hips.y + (t2.values[i + 1] - ual.y) * k;
              t2.values[i + 2] = hips.z + (t2.values[i + 2] - ual.z) * k;
            }
            tracks.push(t2);
            continue;
          }
          tracks.push(tr);
        }
        return new THREE.AnimationClip(c.name, c.duration, tracks);
      });
    }));
  }
  return clipsFor.get(key);
}

/**
 * A person, ready for figure.js: { scene, animations }.
 * contentBase: where content/ is served; recipe as above.
 */
export async function buildPerson(contentBase, recipe) {
  const b = recipe.base === 'f' ? 'f' : 'm';
  const K = `${contentBase}/core/people/kit`;
  const info = await json(`${K}/${b}.json`);
  const weights = keyWeights(recipe.shape);
  const garments = (recipe.parts || []).filter(p => p && p.id);
  const want = [gltf(`${K}/${b}_body.glb`)];
  if (recipe.hair) want.push(gltf(`${K}/${b}_hair_${recipe.hair}.glb`));
  if (recipe.brows) want.push(gltf(`${K}/${b}_brows_${recipe.brows}.glb`));
  for (const p of garments) want.push(gltf(`${K}/${b}_${p.id}.glb`));
  const [body, ...rest] = await Promise.all(want);
  const root = cloneSkinned(body.scene);
  const { inv, hips } = fitJoints(root, info, weights);
  const bones = new Map();
  root.traverse(o => { if (o.isBone) bones.set(o.name, o); });

  // the body: skin, eyes, lashes
  const mask = garments.reduce((m, p) => m | (info.hideBits[p.id] !== undefined ? 1 << info.hideBits[p.id] : 0), 0);
  root.traverse(o => {
    if (!o.isSkinnedMesh) return;
    const n = o.name.toLowerCase();
    let mat;
    if (n.includes('low-poly') || n.includes('eyes')) {
      mat = new THREE.MeshStandardMaterial({ map: texture(`${K}/eyes/${recipe.eyes || 'brown'}.jpg`), roughness: 0.25 });
    } else if (n.includes('lashes')) {
      mat = new THREE.MeshStandardMaterial({ map: texture(`${K}/hair/eyelashes01.png`), alphaTest: 0.5, side: THREE.DoubleSide, color: 0x222222 });
    } else {
      mat = new THREE.MeshStandardMaterial({ map: texture(`${K}/skin/${recipe.skin || (b === 'm' ? 'young_caucasian_male' : 'young_caucasian_female')}.jpg`), roughness: 0.62 });
      if (mask) hideShader(mat, mask);
    }
    o.material = mat;
    o.castShadow = true; o.frustumCulled = false;
    applyMorphs(o, weights);
    rebind(o, bones, inv);   // the joints moved: the skin binds to them at their new rest
  });

  // parts: each one's mesh joins this skeleton (its own bones by name), shaped as the body is
  const kinds = [];
  if (recipe.hair) kinds.push({ id: 'hair', hair: true, color: recipe.hairColor || '#4a3020', tex: `${K}/hair/${recipe.hair}.png` });
  if (recipe.brows) kinds.push({ id: 'brows', hair: true, color: recipe.browColor || recipe.hairColor || '#3a2a1a', tex: `${K}/hair/${recipe.brows}.png` });
  for (const p of garments) kinds.push(p);
  rest.forEach((g, i) => {
    const kind = kinds[i];
    const part = cloneSkinned(g.scene);
    const meshes = [];
    part.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
    for (const m of meshes) {
      m.removeFromParent();
      root.add(m);
      rebind(m, bones, inv);
      const skel = m.skeleton;
      applyMorphs(m, weights);
      m.castShadow = true; m.frustumCulled = false;
      if (kind.hair) {
        m.material = new THREE.MeshStandardMaterial({ map: texture(kind.tex), color: new THREE.Color(kind.color), alphaTest: 0.62,
          side: THREE.DoubleSide, roughness: 0.75 });
        // the soft fringe over the solid middle (as the old figures had it): clean edges, not ragged ones
        const soft = m.material.clone(); soft.transparent = true; soft.alphaTest = 0.08; soft.depthWrite = false; soft.side = THREE.FrontSide;
        const fringe = new THREE.SkinnedMesh(m.geometry, soft);
        fringe.morphTargetInfluences = m.morphTargetInfluences; fringe.morphTargetDictionary = m.morphTargetDictionary;
        fringe.bind(skel, m.bindMatrix); fringe.renderOrder = 2; fringe.frustumCulled = false;
        root.add(fringe);
      } else {
        const leather = /boots|belt/.test(kind.id);
        m.material = new THREE.MeshStandardMaterial({ map: texture(`${K}/tex/${leather ? 'leather' : 'linen'}.jpg`),
          color: new THREE.Color(kind.color || (leather ? '#4a3424' : '#6b5a48')), roughness: leather ? 0.7 : 0.95 });
      }
    }
  });

  // height: the whole figure scaled (feet stay on the ground: the root is at the feet)
  const scale = 1 + 0.08 * Math.max(-1, Math.min(1, recipe.height || 0));
  const outer = new THREE.Group();
  outer.add(root);
  outer.scale.setScalar(scale);
  return { scene: outer, animations: await clips(contentBase, hips) };
}
