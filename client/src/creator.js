// The character creator: on first entering (and with C later), the player shapes how it looks, from what the
// catalogue allows players (recipes.js, checkPlayer; the house checks it again). A turning preview on the left, the
// choices on the right; "Roll" rolls a whole new start; "Enter" sends it to the house, which keeps it and shows it
// to everyone.

import * as THREE from 'three';
import { buildPerson } from './kit.js';
import { dicePlayer, checkPlayer, skinFor } from './recipes.js';

const EYE_TINT = { blue: '#4a7ab0', bluegreen: '#4a8a80', brown: '#5a3a20', brownlight: '#8a6a40', deepblue: '#2a4a8a',
  green: '#4a7a3a', grey: '#7a8088', ice: '#a8c8d8', lightblue: '#7aa8d0' };
const FACE_NAMES = { nose_wide: 'Nose width', nose_long: 'Nose length', nose_hump: 'Nose hump', jaw_wide: 'Jaw', chin: 'Chin',
  cheekbones: 'Cheekbones', mouth_wide: 'Mouth', face_round: 'Round face', eyes_big: 'Eyes' };
const OUTFIT_NAMES = { tunic: 'Tunic and high boots', tunic_short_boots: 'Tunic and shoes', kirtle: 'Long dress' };
const PART_NAMES = { shirt: 'Shirt', tunic_skirt: 'Tunic', trousers: 'Trousers', skirt_long: 'Skirt', boots_high: 'Boots', boots_low: 'Shoes', belt: 'Belt' };
const HAIR_NAMES = { short01: 'Short', short02: 'Cropped', short03: 'Swept', short04: 'Close', long01: 'Long', afro01: 'Curls',
  ponytail01: 'Ponytail', bob01: 'Bob', bob02: 'Bob, parted', braid01: 'Braid' };

const CSS = `
#creator { position:absolute; inset:0; z-index:70; display:flex; background:radial-gradient(ellipse at 30% 40%, #1b2420 0%, #070908 80%);
  color:#eadfc4; font:14px system-ui,sans-serif; }
#creator .view { flex:1 1 55%; position:relative; min-width:0; cursor:grab; }
#creator .view canvas { width:100%; height:100%; display:block; }
#creator .view .hint { position:absolute; left:0; right:0; bottom:14px; text-align:center; color:#a99c80; font-size:12px; pointer-events:none; }
#creator .panel { flex:0 0 min(420px, 46vw); overflow-y:auto; padding:22px 22px 90px; box-sizing:border-box;
  background:rgba(8,10,9,.72); border-left:1px solid rgba(201,163,90,.35); }
#creator h1 { font:400 28px Georgia,serif; letter-spacing:.05em; color:#f3e6c4; margin:0 0 2px; }
#creator .sub { color:#c9a35a; font-size:12px; letter-spacing:.3em; text-transform:uppercase; margin-bottom:16px; }
#creator h2 { font:600 12px system-ui,sans-serif; letter-spacing:.18em; text-transform:uppercase; color:#c9a35a; margin:18px 0 8px; }
#creator .row { display:flex; align-items:center; gap:10px; margin:6px 0; }
#creator .row label { flex:0 0 92px; color:#cfc3a6; font-size:13px; }
#creator input[type=range] { flex:1; accent-color:#d9a24a; }
#creator .chips { display:flex; flex-wrap:wrap; gap:6px; }
#creator .chip { padding:5px 10px; border-radius:14px; border:1px solid rgba(201,163,90,.45); background:rgba(30,26,18,.6); color:#e8dcc0;
  cursor:pointer; font-size:13px; }
#creator .chip.on { background:#c9a35a; color:#1a140c; border-color:#f0c66a; }
#creator .sw { width:24px; height:24px; border-radius:50%; border:2px solid rgba(255,255,255,.18); cursor:pointer; padding:0; }
#creator .sw.on { border-color:#f0c66a; box-shadow:0 0 0 2px rgba(240,198,106,.5); }
#creator details summary { cursor:pointer; color:#c9a35a; font:600 12px system-ui,sans-serif; letter-spacing:.18em; text-transform:uppercase; margin:18px 0 8px; }
#creator .bar { position:absolute; right:0; bottom:0; width:min(420px, 46vw); box-sizing:border-box; padding:14px 22px; display:flex; gap:10px;
  background:linear-gradient(0deg, rgba(5,6,6,.95), rgba(5,6,6,.6)); border-left:1px solid rgba(201,163,90,.35); }
#creator button.big { flex:1; padding:11px; border-radius:6px; font:600 15px system-ui,sans-serif; cursor:pointer; border:1px solid #c9a35a; }
#creator .roll { background:transparent; color:#e8dcc0; }
#creator .enter { background:linear-gradient(180deg,#ffd98a,#d9a24a 55%,#a8661c); color:#1a120a; border-color:#f0c66a; }
@media (max-width: 760px) { #creator { flex-direction:column; } #creator .view { flex:0 0 42vh; } #creator .panel { flex:1; width:100%; border-left:0; }
  #creator .bar { width:100%; border-left:0; } }
`;

let catP = null, skinsP = null;

/**
 * Open the creator. opts: { contentBase, id, look (the current one or null), onDone(recipe), player (input paused) }.
 * Resolves when it is closed.
 */
export async function openCreator({ contentBase, id, look = null, onDone, player = null }) {
  if (document.getElementById('creator')) return;
  catP ||= fetch(`${contentBase}/core/people/catalogue.json`).then(r => r.json());
  skinsP ||= fetch(`${contentBase}/core/people/kit/assets.json`).then(r => r.json()).then(j => j.skins);
  const [cat, skins] = await Promise.all([catP, skinsP]);
  let rec = (look && checkPlayer(cat, look, skins)) || dicePlayer(cat, id, skins);
  let rolls = 0;

  if (!document.getElementById('creator-css')) {
    const st = document.createElement('style'); st.id = 'creator-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  const el = document.createElement('div'); el.id = 'creator';
  el.innerHTML = `<div class="view"><div class="hint">Drag to turn</div></div><div class="panel"></div>
    <div class="bar"><button class="big roll">Roll</button><button class="big enter">Enter the world</button></div>`;
  document.body.appendChild(el);
  player?.setTyping(true);
  document.exitPointerLock?.();

  // the preview: its own little stage
  const view = el.querySelector('.view');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  view.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xe0e8ff, 0x4a3a2a, 1.25));
  const sun = new THREE.DirectionalLight(0xfff0dd, 2.4); sun.position.set(2, 4, 3); sun.castShadow = true; scene.add(sun);
  const rim = new THREE.DirectionalLight(0xffc880, 1.2); rim.position.set(-3, 2, -2); scene.add(rim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.2, 48), new THREE.MeshStandardMaterial({ color: 0x3a3226, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  const stage = new THREE.Group(); scene.add(stage);
  let mixer = null, turn = 0.4, drag = null, alive = true, building = 0;
  const size = () => {
    const w = view.clientWidth, h = view.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    const far = w < h ? 6.2 : 4.6;
    camera.position.set(0, 1.15, far); camera.lookAt(0, 0.95, 0);
  };
  size(); addEventListener('resize', size);
  view.addEventListener('pointerdown', e => { drag = e.clientX; view.setPointerCapture(e.pointerId); });
  view.addEventListener('pointermove', e => { if (drag !== null) { turn += (e.clientX - drag) * 0.01; drag = e.clientX; } });
  view.addEventListener('pointerup', () => { drag = null; });
  let last = performance.now();
  renderer.setAnimationLoop(now => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (drag === null) turn += dt * 0.25;
    stage.rotation.y = turn;
    mixer?.update(dt);
    renderer.render(scene, camera);
  });
  async function show() {
    const n = ++building;
    const p = await buildPerson(contentBase, rec).catch(e => { console.warn('creator', e); return null; });
    if (!p || n !== building || !alive) return;
    stage.clear(); stage.add(p.scene);
    mixer = new THREE.AnimationMixer(p.scene);
    const idle = p.animations.find(c => c.name === 'idle');
    if (idle) mixer.clipAction(idle).play();
  }

  // the choices
  const panel = el.querySelector('.panel');
  const pal = cat.palettes.player;
  const origin = () => rec.shape.african ? 'african' : rec.shape.asian ? 'asian' : 'caucasian';
  const resk = () => { rec.skin = skinFor(rec.base, origin(), rec.shape.age || 0, skins); };
  const outfits = Object.entries(cat.outfits).filter(([, o]) => o.for === 'both' || o.for === 'player');
  const outfitOf = () => outfits.find(([, o]) => o.parts.length === rec.parts.length && o.parts.every(id => rec.parts.some(p => p.id === id)))?.[0];
  let timer = 0;
  const changed = (redraw = false) => { clearTimeout(timer); timer = setTimeout(show, 120); if (redraw) draw(); };
  const chips = (items, on, pick) => `<div class="chips">${items.map(([k, label]) => `<button class="chip${k === on ? ' on' : ''}" data-k="${k}">${label}</button>`).join('')}</div>`;
  const swatches = (list, on) => `<div class="chips">${list.map(c => `<button class="sw${c === on ? ' on' : ''}" data-c="${c}" style="background:${EYE_TINT[c] || c}" title="${c}"></button>`).join('')}</div>`;
  const slider = (key, label, [a, b], v) => `<div class="row"><label>${label}</label><input type="range" min="${a}" max="${b}" step="0.01" value="${v ?? 0}" data-s="${key}"></div>`;

  function draw() {
    const lim = cat.shape.player;
    const hairs = Object.entries(cat.hair[rec.base]).filter(([, t]) => t === 'both' || t === 'player').map(([h]) => [h, HAIR_NAMES[h] || h]);
    const hc = [...cat.hairColors.both, ...cat.hairColors.player];
    const of = outfitOf();
    panel.innerHTML = `<h1>Your traveller</h1><div class="sub">LiteWorldsQuest</div>
      <h2>Body</h2><div data-g="base">${chips([['m', 'Man'], ['f', 'Woman']], rec.base)}</div>
      <h2>Origin</h2><div data-g="origin">${chips([['caucasian', 'Fair'], ['african', 'Dark'], ['asian', 'Eastern']], origin())}</div>
      <h2>Shape</h2>
      ${slider('height', 'Height', lim.height, rec.height)}${slider('weight', 'Weight', lim.weight, rec.shape.weight)}
      ${slider('muscle', 'Build', lim.muscle, rec.shape.muscle)}${slider('age', 'Age', lim.age, rec.shape.age)}
      <details><summary>Face</summary>${cat.shape.face.map(f => slider(f, FACE_NAMES[f] || f, [-1, 1], rec.shape[f])).join('')}</details>
      <h2>Hair</h2><div data-g="hair">${chips([...hairs, ['', 'None']], rec.hair || '')}</div>
      <div data-g="hairColor" style="margin-top:8px">${swatches(hc, rec.hairColor)}</div>
      <h2>Eyes</h2><div data-g="eyes">${swatches(cat.eyes, rec.eyes)}</div>
      <h2>Clothes</h2><div data-g="outfit">${chips(outfits.map(([k]) => [k, OUTFIT_NAMES[k] || k]), of)}</div>
      ${rec.parts.filter(p => p.id !== 'tunic_skirt' || !rec.parts.some(q => q.id === 'shirt')).map(p => `<div class="row" style="align-items:flex-start"><label>${PART_NAMES[p.id] || p.id}</label>
        <div data-part="${p.id}" style="flex:1">${swatches(/boots|belt/.test(p.id) ? pal.leather : [...pal.cloth, ...pal.dyed, ...pal.light], p.color)}</div></div>`).join('')}`;
  }
  panel.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const g = b.closest('[data-g]')?.dataset.g, part = b.closest('[data-part]')?.dataset.part;
    if (part) {
      for (const p of rec.parts) if (p.id === part || (part === 'shirt' && p.id === 'tunic_skirt')) p.color = b.dataset.c;
      return changed(true);
    }
    if (g === 'base') {
      if (rec.base === b.dataset.k) return;
      rec.base = b.dataset.k;
      const hairs = Object.entries(cat.hair[rec.base]).filter(([, t]) => t === 'both' || t === 'player').map(([h]) => h);
      if (rec.hair && !hairs.includes(rec.hair)) rec.hair = hairs[0];
      resk();
    } else if (g === 'origin') {
      delete rec.shape.african; delete rec.shape.asian;
      if (b.dataset.k === 'african') rec.shape.african = 1;
      if (b.dataset.k === 'asian') rec.shape.asian = 1;
      resk();
    } else if (g === 'hair') rec.hair = b.dataset.k || null;
    else if (g === 'hairColor') { rec.hairColor = b.dataset.c; rec.browColor = b.dataset.c; }
    else if (g === 'eyes') rec.eyes = b.dataset.c;
    else if (g === 'outfit') {
      const o = cat.outfits[b.dataset.k];
      const col = id => rec.parts.find(p => p.id === id)?.color;
      const top = col('shirt') || pal.cloth[0], leg = col('trousers') || col('skirt_long') || pal.cloth[1], lea = col('boots_high') || col('boots_low') || pal.leather[0];
      rec.parts = o.parts.map(id => ({ id, color: id === 'shirt' || id === 'tunic_skirt' ? top : /boots/.test(id) ? lea : id === 'belt' ? (col('belt') || pal.leather[1]) : leg }));
    } else return;
    changed(true);
  });
  panel.addEventListener('input', e => {
    const k = e.target.dataset.s; if (!k) return;
    const v = Number(e.target.value);
    if (k === 'height') rec.height = v; else rec.shape[k] = v;
    if (k === 'age') resk();
    changed();
  });
  el.querySelector('.roll').addEventListener('click', () => { rec = dicePlayer(cat, `${id}-${++rolls}-${Date.now()}`, skins); draw(); show(); });

  draw(); show();
  return new Promise(done => {
    el.querySelector('.enter').addEventListener('click', () => {
      const ok = checkPlayer(cat, rec, skins);
      if (!ok) return;
      alive = false;
      renderer.setAnimationLoop(null); renderer.dispose();
      removeEventListener('resize', size);
      el.remove();
      player?.setTyping(false);
      onDone?.(ok);
      done(ok);
    });
  });
}
