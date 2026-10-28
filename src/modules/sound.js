/* LiteWorldsQuest sound module: every sound made by code (WebAudio), so it costs bytes of script, not megabytes.
     const s = sound.create()          nothing plays until s.start() is called from a click (the browser's rule)
     s.start()                         wind, birds now and then, and every fire the level has
     s.fire(x, y, z)                   a crackling fire there (heard louder near it, from its side)
     s.listen(camera)                  where the ears are, each frame
     s.step(speed)                     a footstep (the engine calls it at the pace of walking)
     s.blip(kind)                      'pickup' | 'door' | 'talk' | 'coin' | 'swing' | 'hit'
     s.mute(on) -> muted               M in the game
   Everything goes through one master gain, so muting is one switch. */
(function (G) {
  'use strict';
  function create() {
    let ctx = null, master = null, noise = null, muted = false, started = false;
    const fires = [];
    const AC = G.AudioContext || G.webkitAudioContext;
    function noiseBuffer() {
      const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return b;
    }
    function loopNoise(dest) {
      const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; s.loopStart = Math.random(); s.connect(dest); s.start(); return s;
    }
    function wind() {
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 380; f.Q.value = 0.6;
      const g = ctx.createGain(); g.gain.value = 0.05; loopNoise(f); f.connect(g); g.connect(master);
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 0.035;
      lfo.connect(lg); lg.connect(g.gain); lfo.start();
      const lfo2 = ctx.createOscillator(), lg2 = ctx.createGain(); lfo2.frequency.value = 0.11; lg2.gain.value = 160;
      lfo2.connect(lg2); lg2.connect(f.frequency); lfo2.start();
    }
    function panner(x, y, z, ref) {
      const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref || 2; p.rolloffFactor = 1.3;
      if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
      p.connect(master); return p;
    }
    function startFire(f) {
      const out = f.out = panner(f.x, f.y + 0.5, f.z, 2.5);
      const rumble = ctx.createBiquadFilter(); rumble.type = 'lowpass'; rumble.frequency.value = 220;
      const rg = ctx.createGain(); rg.gain.value = 0.35; loopNoise(rumble); rumble.connect(rg); rg.connect(out);
      const crackle = () => {   /* a pop: a few milliseconds of bright noise, at random */
        if (!ctx || f.dead) return;
        const t = ctx.currentTime, s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = noise; bp.type = 'bandpass'; bp.frequency.value = 1500 + Math.random() * 3500; bp.Q.value = 2;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25 + Math.random() * 0.5, t + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02 + Math.random() * 0.06);
        s.connect(bp); bp.connect(g); g.connect(out); s.start(t, Math.random()); s.stop(t + 0.12);
        setTimeout(crackle, 30 + Math.random() * (Math.random() < 0.2 ? 400 : 120));
      };
      crackle();
    }
    function birds() {   /* now and then a short song from somewhere around */
      const sing = () => {
        if (!ctx) return;
        const a = Math.random() * Math.PI * 2, out = panner(Math.cos(a) * 25, 6, Math.sin(a) * 25, 8);
        let t = ctx.currentTime + 0.05; const notes = 2 + Math.floor(Math.random() * 5), base = 2600 + Math.random() * 1800;
        for (let i = 0; i < notes; i++) {
          const o = ctx.createOscillator(), g = ctx.createGain(), d = 0.06 + Math.random() * 0.08;
          o.type = 'sine'; o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.3), t);
          o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.4), t + d);
          g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
          o.connect(g); g.connect(out); o.start(t); o.stop(t + d + 0.02); t += d + 0.03 + Math.random() * 0.05;
        }
        setTimeout(sing, 2500 + Math.random() * 7000);
      };
      setTimeout(sing, 1500);
    }
    const api = {
      start() {
        if (started || !AC) return; started = true;
        try { ctx = new AC(); } catch (e) { ctx = null; return; }
        master = ctx.createGain(); master.gain.value = muted ? 0 : 0.8; master.connect(ctx.destination);
        noise = noiseBuffer();
        wind(); birds(); fires.forEach(startFire);
        if (ctx.state === 'suspended') ctx.resume();
      },
      fire(x, y, z) { const f = { x, y, z }; fires.push(f); if (ctx) startFire(f); },
      /* another zone: its fires go quiet (2026-10-28, zones without a reload) */
      clearFires() { for (const f of fires.splice(0)) { f.dead = true; if (f.out) f.out.disconnect(); } },
      listen(camera) {
        if (!ctx) return;
        const L = ctx.listener, p = camera.position, e = camera.matrixWorld.elements;
        const fx = -e[8], fy = -e[9], fz = -e[10], ux = e[4], uy = e[5], uz = e[6];
        if (L.positionX) {
          const t = ctx.currentTime;
          L.positionX.setTargetAtTime(p.x, t, 0.02); L.positionY.setTargetAtTime(p.y, t, 0.02); L.positionZ.setTargetAtTime(p.z, t, 0.02);
          L.forwardX.setTargetAtTime(fx, t, 0.02); L.forwardY.setTargetAtTime(fy, t, 0.02); L.forwardZ.setTargetAtTime(fz, t, 0.02);
          L.upX.setTargetAtTime(ux, t, 0.02); L.upY.setTargetAtTime(uy, t, 0.02); L.upZ.setTargetAtTime(uz, t, 0.02);
        } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(fx, fy, fz, ux, uy, uz); }
      },
      step(speed) {
        if (!ctx) return;
        const t = ctx.currentTime, s = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = noise; lp.type = 'lowpass'; lp.frequency.value = 500 + Math.random() * 300 + (speed > 5 ? 300 : 0);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(speed > 5 ? 0.22 : 0.14, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
        s.connect(lp); lp.connect(g); g.connect(master); s.start(t, Math.random()); s.stop(t + 0.12);
      },
      blip(kind) {
        if (!ctx) return;
        const t = ctx.currentTime;
        const tone = (f, at, d, type, vol) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type || 'sine'; o.frequency.value = f;
          g.gain.setValueAtTime(0.0001, t + at); g.gain.exponentialRampToValueAtTime(vol || 0.15, t + at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + at + d);
          o.connect(g); g.connect(master); o.start(t + at); o.stop(t + at + d + 0.05); };
        if (kind === 'pickup') { tone(880, 0, 0.18); tone(1320, 0.08, 0.25); }
        else if (kind === 'coin') { tone(988, 0, 0.12, 'square', 0.06); tone(1319, 0.09, 0.35, 'square', 0.06); }
        else if (kind === 'talk') { tone(320 + Math.random() * 120, 0, 0.08, 'triangle', 0.08); }
        else if (kind === 'swing' || kind === 'hit') {   /* a swish of noise; a blow that lands adds a dull thud */
          const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
          s.buffer = noise; f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(2400, t); f.frequency.exponentialRampToValueAtTime(700, t + 0.16);
          g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
          s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random()); s.stop(t + 0.2);
          if (kind === 'hit') tone(110, 0.05, 0.16, 'triangle', 0.22);
        }
        else if (kind === 'door') {   /* a creak: a sawtooth sliding down through a narrow filter */
          const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
          o.type = 'sawtooth'; o.frequency.setValueAtTime(140, t); o.frequency.linearRampToValueAtTime(90, t + 0.5);
          f.type = 'bandpass'; f.frequency.setValueAtTime(900, t); f.frequency.linearRampToValueAtTime(600, t + 0.5); f.Q.value = 8;
          g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
          o.connect(f); f.connect(g); g.connect(master); o.start(t); o.stop(t + 0.6);
        }
      },
      mute(on) { muted = on == null ? !muted : !!on; if (master) master.gain.value = muted ? 0 : 0.8; return muted; },
      get started() { return started; }
    };
    return api;
  }
  if (G.LWQ && G.LWQ.define) G.LWQ.define('sound', { api: 1, v: 3 }, () => ({ api: 1, create }));
})(typeof globalThis !== 'undefined' ? globalThis : this);
