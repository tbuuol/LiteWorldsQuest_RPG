// LiteWorldsQuest beta, the client: draws what the house says, sends what the player does. Decides nothing.
//   ?ws=<url>   the house (default: /lwq/ws on this site)       ?as=<name>  only for a house in dev mode
//   ?q=0..4     fix the quality level                              ?content=<url>  the content modules

import * as THREE from 'three';
import { connect } from './net.js';
import { loadGround } from './ground.js';
import { loadFlora } from './flora.js';
import { createGrass } from './grass.js';
import { loadClutter } from './clutter.js';
import { createSky } from './sky.js';
import { createPlayer } from './player.js';
import { createRemotes } from './remotes.js';
import { createQuality } from './quality.js';
import { createGrade } from './grade.js';
import { createWater } from './water.js';

const Q = new URLSearchParams(location.search);
const $ = s => document.querySelector(s);
const say = t => { $('#bootmsg').textContent = t; };
const CONTENT = Q.get('content') || new URL('../content', location.href).href.replace(/\/$/, '');

async function start() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  $('#view').appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 3000);

  const sky = createSky(scene, renderer);
  const grade = createGrade(renderer, scene, camera);
  let rays = 0;
  const ground = await loadGround(CONTENT, say);
  scene.add(ground.group);
  say('Growing the forest…');
  const flora = await loadFlora(CONTENT, ground, scene, renderer, say);
  const grass = createGrass(ground, scene);
  const clutter = await loadClutter(CONTENT, ground, scene, say);
  const water = createWater(ground, sky, scene);
  const remotes = createRemotes(scene, camera, $('#hud'));

  const quality = createQuality((L) => {
    renderer.setPixelRatio(Math.min(devicePixelRatio, L.dprMax || 1) * L.scale);
    renderer.setSize(innerWidth, innerHeight);
    grade.setPixelRatio(renderer.getPixelRatio()); grade.setSize(innerWidth, innerHeight); grade.setOn(L.grade !== false);
    rays = L.rays || 0;
    sky.setShadows(L.shadows, renderer);
    sky.setFog(L.fog);
    ground.setViewDist(L.view);
    ground.setDetail(L.detail);
    camera.far = L.view + 400; camera.updateProjectionMatrix();
    flora.configure({ near: L.near, dist: L.trees, density: L.density, shadows: L.shadows > 0 });
    grass.configure(L.grass);
    clutter.configure(L.clutter);
  }, Q.has('q') ? Number(Q.get('q')) : 2);
  if (Q.has('q')) quality.setFixed(Number(Q.get('q')));

  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); grade.setSize(innerWidth, innerHeight); });

  // the house
  say('Knocking at the house…');
  const wsUrl = Q.get('ws') || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/lwq/ws`;
  const url = Q.has('as') ? `${wsUrl}?as=${encodeURIComponent(Q.get('as'))}` : wsUrl;
  let me = null, player = null, closed = null;
  const chatlog = $('#chatlog');
  const line = (who, text) => {
    const d = document.createElement('div');
    d.innerHTML = who ? `<b></b> ` : '';
    if (who) d.querySelector('b').textContent = '@' + who;
    d.appendChild(document.createTextNode(text));
    chatlog.appendChild(d);
    while (chatlog.children.length > 12) chatlog.firstChild.remove();
  };
  const net = connect(url, {
    welcome(m) {
      me = m;
      player.place(m.pos[0], m.pos[1], m.pos[2], m.yaw);
      $('#who').textContent = m.tag ? '@' + m.tag : 'guest';
      line(null, 'Welcome to LiteWorldsQuest. WASD to walk, Shift to run, Space to jump, Enter to talk.');
    },
    spawn(m) { remotes.spawn(m); },
    despawn(m) { remotes.despawn(m); },
    snap(tick, list) { remotes.snap(list); },
    fix(seq, x, y, z) { player.fix(x, y, z); },
    say(m) { line(m.from, m.text); },
    close(why) { closed = why; },
  });
  player = createPlayer(camera, renderer.domElement, ground, net);

  // chat
  const chat = $('#chat');
  addEventListener('keydown', e => {
    if (e.code === 'Enter') {
      if (chat.style.display === 'block') {
        if (chat.value.trim()) net.say(chat.value.trim());
        chat.value = ''; chat.style.display = 'none'; player.setTyping(false); chat.blur();
      } else {
        chat.style.display = 'block'; player.setTyping(true); document.exitPointerLock && document.exitPointerLock(); chat.focus();
      }
      e.preventDefault();
    } else if (e.code === 'Escape' && chat.style.display === 'block') {
      chat.value = ''; chat.style.display = 'none'; player.setTyping(false);
    }
  });

  // the first tiles before the curtain lifts
  say('Raising the land…');
  await new Promise(r => {
    const wait = () => {
      if (closed) { say(`The house says: ${closed}`); return; }
      if (!me) return setTimeout(wait, 100);
      const left = ground.update(player.pos.x, player.pos.z, 40);
      if (left > 0) return setTimeout(wait, 0);
      r();
    };
    wait();
  });
  // compile every shader now, behind the curtain, not in the first seconds of play
  say('Preparing the light…');
  flora.update(player.pos.x, player.pos.z, 0);
  clutter.update(player.pos.x, player.pos.z, 0);
  sky.follow(player.pos);
  player.update(0, performance.now());
  if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
  for (let i = 0; i < 3; i++) { renderer.render(scene, camera); await new Promise(r => requestAnimationFrame(r)); }
  $('#boot').style.display = 'none';
  $('#beta').style.display = 'block';

  let last = performance.now(), statAt = 0, floraAt = 0;
  renderer.setAnimationLoop(now => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (closed) { $('#boot').style.display = 'flex'; say(`The house says: ${closed}`); renderer.setAnimationLoop(null); return; }
    player.update(dt, now);
    const pending = ground.update(player.pos.x, player.pos.z, 2);
    flora.update(player.pos.x, player.pos.z, dt);
    grass.update(player.pos.x, player.pos.z, now / 1000);
    clutter.update(player.pos.x, player.pos.z, dt);
    sky.follow(player.pos);
    remotes.update(now);
    sky.tick(now / 1000);
    grade.setSun(sky.sunDir, rays);
    water.update(now / 1000, sky.sunDir);
    grade.render();
    quality.frame(now, pending > 6);
    if (now - statAt > 500) {
      statAt = now;
      const p = player.pos;
      const fs = flora.stats();
      $('#stats').textContent = `${quality.fps.toFixed(0)} fps · ${quality.name}\n${remotes.count + 1} here\n${p.x.toFixed(0)}, ${p.z.toFixed(0)} · ${p.y.toFixed(1)} m\ntrees ${fs.near} + ${fs.far} · grass ${grass.count} · clutter ${clutter.stats()}`;
    }
  });
  window.LWQ = { scene, camera, renderer, ground, flora, quality, player, remotes,
    tp(x, z, yaw, pitch) { net.tp(x, z); player.place(x, ground.height(x, z), z, yaw, pitch); } };
}

start().catch(e => { console.error(e); say('Could not start: ' + (e && e.message || e)); });
