// The sound of the weather, made in the browser (Web Audio, no sound files): rain, wind and thunder from shaped noise.
//   rain     a hiss whose loudness and brightness follow how hard it rains; drizzle a soft whisper; under a roof or a
//            crown it turns to a dull drumming (lower, softer); snow falls silently
//   wind     a low rush that swells with the gust where the player stands (the same gusts as grass and trees), a
//            whistle on top in a gale
//   thunder  after each lightning flash, a rumble that comes some seconds later (as from a strike a kilometre or so
//            away), with a crack at the start when it is near
// Browsers only allow sound after the player has done something (a click, a key): it starts then. M mutes.

const ctxClass = window.AudioContext || window.webkitAudioContext;

export function createAudio() {
  let ctx = null, master = null, muted = false, nodes = null;
  const want = { volume: 0.7 };

  function noiseBuffer(c, seconds, brown = false) {
    const n = Math.floor(c.sampleRate * seconds), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }
  function loop(buf) { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; }
  const filt = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  const gain = v => { const g = ctx.createGain(); g.gain.value = v; return g; };

  function start() {
    if (ctx || !ctxClass) return;
    ctx = new ctxClass();
    master = gain(muted ? 0 : want.volume);
    master.connect(ctx.destination);
    const white = noiseBuffer(ctx, 4), brown = noiseBuffer(ctx, 6, true);
    // rain: a band of hiss (the many drops), and a lower patter
    const rainSrc = loop(white), rainHP = filt('highpass', 500), rainLP = filt('lowpass', 7000), rainG = gain(0);
    rainSrc.connect(rainHP).connect(rainLP).connect(rainG).connect(master);
    const patSrc = loop(white), patBP = filt('bandpass', 1400, 0.9), patG = gain(0);
    patSrc.connect(patBP).connect(patG).connect(master);
    // wind: a rush of brown noise through a moving low-pass, and a whistle (narrow band) in strong wind
    const windSrc = loop(brown), windLP = filt('lowpass', 400, 0.9), windG = gain(0);
    windSrc.connect(windLP).connect(windG).connect(master);
    const whSrc = loop(white), whBP = filt('bandpass', 900, 12), whG = gain(0);
    whSrc.connect(whBP).connect(whG).connect(master);
    nodes = { rainLP, rainG, patBP, patG, windLP, windG, whBP, whG, white, brown };
  }
  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { start(); if (ctx && ctx.state === 'suspended') ctx.resume(); });
  addEventListener('keydown', e => {
    if (e.code === 'KeyM' && !(document.activeElement && document.activeElement.tagName === 'INPUT')) {
      muted = !muted; if (master) master.gain.setTargetAtTime(muted ? 0 : want.volume, ctx.currentTime, 0.1);
    }
  });

  function thunder(near) {
    const t0 = ctx.currentTime + 0.4 + (1 - near) * 4 + Math.random() * 1.5;   // light first, sound later
    const src = ctx.createBufferSource(); src.buffer = nodes.brown; src.loop = true;
    const lp = filt('lowpass', 160 + 260 * near, 0.8), g = gain(0);
    src.connect(lp).connect(g).connect(master);
    const peak = 0.5 + 0.7 * near, len = 4 + 3 * Math.random();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.15 + (1 - near) * 0.6);
    // the rolling: a few swells while it fades
    for (let i = 1; i < 5; i++) g.gain.linearRampToValueAtTime(peak * (0.35 + 0.5 * Math.random()) * (1 - i / 6), t0 + len * i / 5);
    g.gain.linearRampToValueAtTime(0, t0 + len);
    src.start(t0, Math.random() * 3); src.stop(t0 + len + 0.1);
    if (near > 0.6) {   // a crack when it is close
      const c = ctx.createBufferSource(); c.buffer = nodes.white;
      const hp = filt('highpass', 1500), cg = gain(0);
      c.connect(hp).connect(cg).connect(master);
      cg.gain.setValueAtTime(0.6 * near, t0 - 0.05); cg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
      c.start(t0 - 0.05); c.stop(t0 + 0.6);
    }
  }

  let lastFlash = 0;
  return {
    get on() { return !!ctx && !muted; },
    /** weather (weather.js), gust: the wind's strength where the player is, covered: under a roof or a crown,
     *  flash: the lightning now (0..1) */
    update(weather, gust, covered, flash) {
      if (!ctx || !nodes) return;
      const t = ctx.currentTime, n = nodes, set = (p, v) => p.setTargetAtTime(v, t, 0.25);
      const r = weather.snow ? 0 : weather.rain;
      const drizzle = weather.drizzle && !weather.snow;
      // rain
      const loud = r <= 0 ? 0 : drizzle ? 0.06 : 0.1 + 0.32 * r;
      set(n.rainG.gain, loud * (covered ? 0.45 : 1));
      set(n.rainLP.frequency, covered ? 900 : drizzle ? 4000 : 5000 + 3000 * r);
      set(n.patG.gain, r <= 0 ? 0 : (covered ? 0.32 : 0.1) * (0.4 + r));   // drumming on the roof
      set(n.patBP.frequency, covered ? 380 : 1400);
      // wind (a little of it always; snow muffles the land)
      const w = Math.max(0, gust);
      set(n.windG.gain, Math.min(0.9, 0.03 + 0.35 * w * w) * (covered ? 0.7 : 1));
      set(n.windLP.frequency, 220 + 700 * Math.min(1.6, w));
      set(n.whG.gain, Math.max(0, w - 1.0) * 0.05);
      set(n.whBP.frequency, 700 + 500 * Math.min(1, w - 0.8));
      // thunder: one rumble for each new flash
      if (flash > 0.3 && lastFlash <= 0.3) thunder(Math.random());
      lastFlash = flash;
    },
  };
}
