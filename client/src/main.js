// LiteWorldsQuest beta, the client: draws what the house says, sends what the player does. Decides nothing.
//   ?ws=<url>   the house (default: /lwq/ws on this site)       ?as=<name>  only for a house in dev mode
//   ?q=0..4     fix the quality level                              ?content=<url>  the content modules

import * as THREE from 'three';
import { connect } from './net.js';
import { loadGround } from './ground.js';
import { loadFlora } from './flora.js';
import { createGrass } from './grass.js';
import { loadClutter } from './clutter.js';
import { loadPlaces, collide } from './places.js';
import { createSky } from './sky.js';
import { createPlayer } from './player.js';
import { createRemotes } from './remotes.js';
import { createSelf } from './self.js';
import { openCreator } from './creator.js';
import { createBoot } from './boot.js';
import { createQuality } from './quality.js';
import { createGrade } from './grade.js';
import { createWater } from './water.js';

const Q = new URLSearchParams(location.search);
const $ = s => document.querySelector(s);
const boot = createBoot($('#boot'));   // the curtain while the world is made (boot.js)
const say = t => boot.say(t);
const CONTENT = Q.get('content') || new URL('../content', location.href).href.replace(/\/$/, '');

async function start() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  $('#view').appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 3000);

  say('Lighting the sky…');
  const sky = createSky(scene, renderer);
  const grade = createGrade(renderer, scene, camera);
  let rays = 0, shadowEvery = 1, frameNo = 0;
  const ground = await loadGround(CONTENT, say);
  scene.add(ground.group);
  say('Growing the forest…');
  const flora = await loadFlora(CONTENT, ground, scene, renderer, say);
  const grass = createGrass(ground, scene);
  const clutter = await loadClutter(CONTENT, ground, scene, say);
  const water = createWater(ground, sky, scene);
  const places = await loadPlaces(CONTENT, ground, scene, say);
  grass.setMask(places.mask);
  const remotes = createRemotes(scene, camera, $('#hud'), CONTENT);
  remotes.people(places.npcs);   // the villagers as their places describe them
  const own = createSelf(scene, CONTENT, camera);   // the own body; the camera rides its eyes

  const quality = createQuality((L) => {
    renderer.setPixelRatio(Math.min(devicePixelRatio, L.dprMax || 1) * L.scale);
    renderer.setSize(innerWidth, innerHeight);
    grade.setPixelRatio(renderer.getPixelRatio()); grade.setSize(innerWidth, innerHeight); grade.setOn(L.grade !== false);
    rays = L.rays || 0;
    sky.setShadows(L.shadows, renderer);
    sky.setFog(L.fog);
    ground.setViewDist(L.view);
    ground.setDetail(L.detail);
    ground.setSoft(L.soft || 1);
    camera.far = L.view + 400; camera.updateProjectionMatrix();
    flora.configure({ near: L.near, dist: L.trees, density: L.density, shadows: L.shadows > 0, leafShadows: L.shadows >= 2048 });
    shadowEvery = L.shadowEvery || 1;
    grass.configure(L.grass);
    clutter.configure(L.clutter);
  }, Q.has('q') ? Number(Q.get('q')) : 2);
  if (Q.has('q')) quality.setFixed(Number(Q.get('q')));

  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); grade.setSize(innerWidth, innerHeight); });

  // the house
  say('Knocking at the house…');
  const wsUrl = Q.get('ws') || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/lwq/ws`;
  const url = Q.has('as') ? `${wsUrl}?as=${encodeURIComponent(Q.get('as'))}` : wsUrl;
  let me = null, player = null, closed = null, myLook = null;
  const chatlog = $('#chatlog');
  const line = (who, text, npc) => {
    const d = document.createElement('div');
    d.innerHTML = who ? `<b></b> ` : '';
    if (who) d.querySelector('b').textContent = npc ? who + ':' : '@' + who;
    d.appendChild(document.createTextNode(text));
    chatlog.appendChild(d);
    while (chatlog.children.length > 12) chatlog.firstChild.remove();
  };
  const net = connect(url, {
    welcome(m) {
      me = m;
      player.place(m.pos[0], m.pos[1], m.pos[2], m.yaw);
      myLook = m.look || null;
      own.set(m.id, myLook);
      $('#who').textContent = m.tag ? '@' + m.tag : 'guest';
      line(null, 'Welcome to LiteWorldsQuest. WASD to walk, Shift to run, Space to jump, Enter to chat, E to speak to villagers.');
    },
    spawn(m) { remotes.spawn(m); },
    despawn(m) { remotes.despawn(m); },
    look(m) { if (me && m.id === me.id) { myLook = m.look; own.set(me.id, m.look); } else remotes.setLook(m.id, m.look); },
    snap(tick, list) { remotes.snap(list); },
    fix(seq, x, y, z) { player.fix(x, y, z); },
    say(m) { line(m.from, m.text, !!m.npc); if (m.npc) remotes.talking(m.npc); },
    close(why) { closed = why; },
  });
  player = createPlayer(camera, renderer.domElement, ground, net);
  player.setSolids(places.solids, collide);

  // chat
  const chat = $('#chat'), hint = $('#hint');
  // how one looks: chosen on first entering, changed with C (creator.js; the house keeps it)
  const creator = () => openCreator({ contentBase: CONTENT, id: me.id, look: myLook, player,
    onDone: rec => { myLook = rec; net.look(rec); own.set(me.id, rec); } });
  let near = null;   // the villager one could talk to now
  addEventListener('keydown', e => {
    if (e.code === 'Enter') {
      if (chat.style.display === 'block') {
        if (chat.value.trim()) net.say(chat.value.trim());
        chat.value = ''; chat.style.display = 'none'; player.setTyping(false); chat.blur();
      } else {
        chat.style.display = 'block'; player.setTyping(true); document.exitPointerLock && document.exitPointerLock(); chat.focus();
      }
      e.preventDefault();
    } else if (e.code === 'KeyC' && chat.style.display !== 'block' && me && !document.getElementById('creator')) {
      creator();
    } else if (e.code === 'KeyE' && chat.style.display !== 'block' && near) {
      net.talk(near.id);
    } else if (e.code === 'Escape' && chat.style.display === 'block') {
      chat.value = ''; chat.style.display = 'none'; player.setTyping(false);
    }
  });

  // the first tiles before the curtain lifts
  say('Raising the land…');
  let tilesMax = 1;
  await new Promise(r => {
    const wait = () => {
      if (closed) { say(`The house says: ${closed}`); return; }
      if (!me) return setTimeout(wait, 100);
      const left = ground.update(player.pos.x, player.pos.z, 40);
      tilesMax = Math.max(tilesMax, left);
      if (left > 0) { boot.part(1 - left / tilesMax, `${tilesMax - left} / ${tilesMax} pieces of land`); return setTimeout(wait, 0); }
      r();
    };
    wait();
  });
  // the people near as they are, not their stand-ins: the house names them right after the welcome
  say('Waking the villagers…');
  await new Promise(r => setTimeout(r, 500));
  for (const t0 = performance.now(); performance.now() - t0 < 25000;) {
    const f = remotes.figures();
    boot.part(f.total ? f.done / f.total : 1, f.total ? `${f.done} / ${f.total} figures` : '');
    if (!f.total || f.done >= f.total) break;
    await new Promise(r => setTimeout(r, 150));
  }
  await Promise.race([own.ready(), new Promise(r => setTimeout(r, 15000))]);
  // compile every shader now (the figures' too), behind the curtain, not in the first seconds of play
  say('Preparing the light…');
  flora.update(player.pos.x, player.pos.z, 0);
  clutter.update(player.pos.x, player.pos.z, 0);
  sky.follow(player.pos);
  player.update(0, performance.now());
  if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
  for (let i = 0; i < 3; i++) { renderer.render(scene, camera); await new Promise(r => requestAnimationFrame(r)); }
  // the first frames run behind the curtain (textures go up, the last shaders settle); it lifts once they run steadily
  say('Settling in…');
  let warm = 0, steady = 0;
  const warmUntil = performance.now() + 6000;
  const warmed = dt => {
    if (warm < 0) return;
    warm++; steady = dt < 0.05 ? steady + 1 : 0;
    boot.part(Math.min(1, warm / 45));
    if ((warm >= 45 && steady >= 15) || performance.now() > warmUntil) { warm = -1; boot.done(); $('#beta').style.display = 'block'; if (!myLook && !FILM) creator(); }
  };

  let last = performance.now(), statAt = 0, floraAt = 0;
  // ?film=1: no clock of its own; LWQ.filmFrame(t, ...) moves the camera along a path, steps the world by exactly
  // the frame time and renders one picture (a steady video however slow the machine is)
  const FILM = Q.has('film');
  function frame(now, film) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (closed) { boot.back(`The house says: ${closed}`); renderer.setAnimationLoop(null); return; }
    if (film) {
      player.pos.x = film.x; player.pos.z = film.z; player.pos.y = ground.height(film.x, film.z);
      // everything around the camera fully there before the picture (no tiles popping in the film)
      for (let i = 0; i < 200 && ground.update(film.x, film.z, 8) > 0; i++);
    } else {
      player.update(dt, now);
    }
    const pending = film ? 0 : ground.update(player.pos.x, player.pos.z, 2);
    flora.update(player.pos.x, player.pos.z, dt);
    grass.update(player.pos.x, player.pos.z, now / 1000);
    clutter.update(player.pos.x, player.pos.z, dt);
    places.update(now / 1000);
    sky.follow(player.pos);
    if (film) {
      camera.position.set(film.x, film.y, film.z);
      camera.lookAt(film.tx, film.ty, film.tz);
    }
    remotes.update(now, dt);
    own.update(player.pos, player.yaw, player.state, dt, !film, player.pitch);
    warmed(dt);
    const n = remotes.nearestNpc(player.pos.x, player.pos.z, 3.5);
    if ((n && n.id) !== (near && near.id)) {
      near = n; hint.style.display = n ? 'block' : 'none';
      if (n) { hint.innerHTML = '<b>E</b>'; hint.append(`Talk to ${n.name}`); }
    }
    sky.tick(now / 1000);
    grade.setSun(sky.sunDir, rays);
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = !!film || (frameNo++ % shadowEvery) === 0;
    water.update(now / 1000, sky.sunDir);
    grade.render();
    if (film) return;
    quality.frame(now, pending > 6);
    if (now - statAt > 500) {
      statAt = now;
      const p = player.pos;
      const fs = flora.stats();
      $('#stats').textContent = `${quality.fps.toFixed(0)} fps · ${quality.name}\n${remotes.count + 1} here\n${p.x.toFixed(0)}, ${p.z.toFixed(0)} · ${p.y.toFixed(1)} m\ntrees ${fs.near} + ${fs.far} · grass ${grass.count} · clutter ${clutter.stats()}`;
    }
  }
  if (FILM) {
    for (const id of ['#hud', '#beta']) { const e = $(id); if (e) e.style.display = 'none'; }
  } else {
    renderer.setAnimationLoop(now => frame(now));
  }
  window.LWQ = { scene, camera, renderer, ground, flora, quality, player, remotes,
    tp(x, z, yaw, pitch) { net.tp(x, z); player.place(x, ground.height(x, z), z, yaw, pitch); },
    /** one film frame at film time t (s): camera at (x, ground + above, z) looking at (tx, ground + tabove, tz) */
    filmFrame(t, x, z, above, tx, tz, tabove, q = 0.9, gdx = 0) {
      const film = { x, z, y: ground.height(x, z) + above, tx, tz, ty: ground.height(tx, tz) + tabove };
      frame(10000 + t * 1000, film);
      if (gdx) {   // test: the grass grid's centre moved, the camera not (stable grass must look the same)
        grass.update(x + gdx, z, t);
        grade.render();
      }
      return renderer.domElement.toDataURL('image/jpeg', q);
    } };
  window.LWQ_READY = true;
}

start().catch(e => { console.error(e); say('Could not start: ' + (e && e.message || e)); });
