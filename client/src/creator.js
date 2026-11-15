// The character creator: on first entering (and with C later), the player chooses how it looks from what the
// standard people have (standard.js, checkStandard; the house checks it again). A turning preview on the left, the
// choices on the right; "Roll" rolls a whole new start; "Enter" sends it to the house, which keeps it and shows it
// to everyone.

import * as THREE from 'three';
import { buildStandard, standardCatalogue, diceStandard, checkStandard } from './standard.js';

const OUTFIT_NAMES = { peasant: 'Peasant', ranger: 'Ranger' };
const HAIR_NAMES = { simpleparted: 'Parted', buzzed: 'Buzzed', long: 'Long', buns: 'Buns', buzzedfemale: 'Short' };

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


/**
 * Open the creator. opts: { contentBase, id, look (the current one or null), onDone(recipe), player (input paused) }.
 * Resolves when it is closed.
 */
export async function openCreator({ contentBase, id, look = null, onDone, player = null }) {
  if (document.getElementById('creator')) return;
  const cat = await standardCatalogue(contentBase);
  let rec = (look && checkStandard(cat, look)) || diceStandard(cat, id);
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
    const p = await buildStandard(contentBase, rec).catch(e => { console.warn('creator', e); return null; });
    if (!p || n !== building || !alive) return;
    stage.clear(); stage.add(p.scene);
    mixer = new THREE.AnimationMixer(p.scene);
    const idle = p.animations.find(c => c.name === 'idle');
    if (idle) mixer.clipAction(idle).play();
  }

  // the choices
  const panel = el.querySelector('.panel');
  const chips = (items, on) => `<div class="chips">${items.map(([k, label]) => `<button class="chip${String(k) === String(on) ? ' on' : ''}" data-k="${k}">${label}</button>`).join('')}</div>`;
  const toggle = (k, label, on) => `<button class="chip${on ? ' on' : ''}" data-t="${k}">${label}</button>`;
  const swatches = (list, on) => `<div class="chips">${list.map(c => `<button class="sw${c === on ? ' on' : ''}" data-c="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div>`;
  function draw() {
    const o = cat.outfits[rec.outfit];
    panel.innerHTML = `<h1>Your traveller</h1><div class="sub">LiteWorldsQuest</div>
      <h2>Body</h2><div data-g="base">${chips([['m', 'Man'], ['f', 'Woman']], rec.base)}</div>
      <h2>Clothes</h2><div data-g="outfit">${chips(Object.keys(cat.outfits).map(k => [k, OUTFIT_NAMES[k] || k]), rec.outfit)}</div>
      <div data-g="colours" style="margin-top:8px">${chips(o.colours.map((c, i) => [c, 'Colours ' + (i + 1)]), rec.colours)}</div>
      ${(o.extras || []).length ? `<div class="chips" style="margin-top:8px">${o.extras.map(x => toggle(x, x === 'hood' ? 'Hood' : 'Pauldrons', rec[x])).join('')}</div>` : ''}
      <h2>Hair</h2><div data-g="hair">${chips([...cat.hair[rec.base].map(h => [h, HAIR_NAMES[h] || h]), ['', 'None']], rec.hair || '')}</div>
      ${cat.beard.includes(rec.base) ? `<div class="chips" style="margin-top:8px">${toggle('beard', 'Beard', rec.beard)}</div>` : ''}
      <div data-g="hairColor" style="margin-top:8px">${swatches(cat.hairColors, rec.hairColor)}</div>`;
  }
  panel.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.t) { rec[b.dataset.t] = !rec[b.dataset.t]; return changed(); }
    const g = b.closest('[data-g]')?.dataset.g;
    if (g === 'base') { rec.base = b.dataset.k; if (!cat.hair[rec.base].includes(rec.hair)) rec.hair = cat.hair[rec.base][0]; }
    else if (g === 'outfit') { rec.outfit = b.dataset.k; rec.colours = cat.outfits[rec.outfit].colours[0]; }
    else if (g === 'colours') rec.colours = Number(b.dataset.k);
    else if (g === 'hair') rec.hair = b.dataset.k || null;
    else if (g === 'hairColor') rec.hairColor = b.dataset.c;
    else return;
    changed();
  });
  let timer = 0;
  function changed() { rec = checkStandard(cat, rec) || rec; draw(); clearTimeout(timer); timer = setTimeout(show, 100); }
  el.querySelector('.roll').addEventListener('click', () => { rec = diceStandard(cat, `${id}-${++rolls}-${Date.now()}`); draw(); show(); });

  draw(); show();
  return new Promise(done => {
    el.querySelector('.enter').addEventListener('click', () => {
      const ok = checkStandard(cat, rec);
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
