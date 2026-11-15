// The curtain while the world is made: a night view of Blockshire (hills, forest, huts with lit windows, smoke,
// stars, a fire's glow), a progress bar with what is being done and how far, and tips between. It stays until the
// world is ready to play smoothly: the land around, the people near (no stand-ins), every shader compiled, and the
// first frames running steadily behind it; then it fades.

// how far the whole is when a step reports (the loaders say these lines)
const STEPS = [
  ['Lighting the sky', 2], ['Loading the land', 5], ['Painting the land', 11], ['Shading the hollows', 16],
  ['Loading the materials', 21], ['Growing the forest', 26], ['Scattering stones', 46], ['Raising Blockshire', 50],
  ['Knocking at the house', 55], ['Raising the land', 58], ['Waking the villagers', 76], ['Preparing the light', 88],
  ['Settling in', 93],
];
const TIPS = [
  'WASD to walk, Shift to run, Space to jump.',
  'Press E near a villager to speak with them.',
  'Enter opens the chat. Everyone near you can read it.',
  'The world keeps its own time: days, nights and three moons.',
  'Elder Bram sits by the fire. He knows the old stories.',
  'Mara cooks for the whole village. Do not come empty-handed.',
  'Tobin the woodcutter knows every tree beyond the fence.',
  'Pip claims to be the fastest in Blockshire. Try to catch him.',
  'Some say a wish at the well is heard, if you give something for it.',
  'Beyond the fence the world is wide, and not all of it is friendly.',
];

const CSS = `
#boot { position:absolute; inset:0; z-index:50; overflow:hidden; color:#eadfc4; font-family:Georgia,'Times New Roman',serif;
  background:#05070b; transition:opacity .9s ease; display:block; }
#boot.gone { opacity:0; pointer-events:none; }
#boot svg.scene { position:absolute; inset:0; width:100%; height:100%; }
#boot .veil { position:absolute; inset:0; background:radial-gradient(ellipse at 50% 38%, rgba(5,7,11,0) 0%, rgba(5,7,11,.55) 70%, rgba(5,7,11,.9) 100%); }
#boot .card { position:absolute; left:50%; top:30%; transform:translate(-50%,-50%); text-align:center; width:min(640px,88vw); }
#boot .title { font-size:clamp(36px,7vw,72px); letter-spacing:.07em; color:#f3e6c4;
  text-shadow:0 0 18px rgba(255,190,90,.25), 0 3px 18px rgba(0,0,0,.9); }
#boot .orn { display:flex; align-items:center; gap:12px; justify-content:center; margin:6px 0 4px; color:#c9a35a; }
#boot .orn i { display:block; height:1px; width:min(120px,22vw); background:linear-gradient(90deg,transparent,#c9a35a); }
#boot .orn i:last-child { transform:scaleX(-1); }
#boot .sub { font-size:14px; letter-spacing:.6em; text-transform:uppercase; color:#c9a35a; padding-left:.6em; }
#boot .panel { position:absolute; left:50%; bottom:max(6vh,32px); transform:translateX(-50%); width:min(600px,90vw); padding:16px 20px 12px;
  box-sizing:border-box; background:radial-gradient(ellipse at center, rgba(4,5,8,.72) 0%, rgba(4,5,8,.45) 60%, transparent 100%); }
#boot .what { display:flex; justify-content:space-between; align-items:baseline; font:14px system-ui,sans-serif; margin-bottom:8px;
  color:#e8dcc0; text-shadow:0 1px 3px #000; }
#boot .what b { font:600 13px system-ui,sans-serif; color:#f0c66a; font-variant-numeric:tabular-nums; }
#boot .bar { position:relative; height:10px; border-radius:6px; background:rgba(20,16,10,.75);
  box-shadow:inset 0 1px 3px rgba(0,0,0,.8), 0 0 0 1px rgba(201,163,90,.55), 0 0 18px rgba(0,0,0,.6); overflow:hidden; }
#boot .fill { position:absolute; inset:0 auto 0 0; width:0%; border-radius:6px; transition:width .35s ease;
  background:linear-gradient(180deg,#ffe2a0 0%,#e3a640 45%,#a8661c 100%); box-shadow:0 0 12px rgba(255,180,70,.6); }
#boot .fill::after { content:''; position:absolute; inset:0; background:linear-gradient(90deg,transparent,rgba(255,255,255,.45),transparent);
  width:40%; animation:bootshine 1.6s linear infinite; }
@keyframes bootshine { from { transform:translateX(-100%); } to { transform:translateX(260%); } }
#boot .detail { font:12px system-ui,sans-serif; color:#a99c80; margin-top:7px; min-height:15px; }
#boot .tip { font-style:italic; font-size:15px; color:#d9cba8; margin-top:18px; min-height:20px; text-align:center;
  text-shadow:0 1px 3px #000; transition:opacity .5s ease; }
#boot .err { color:#ff9a7a; }
#boot .twinkle { animation:boottw 3.2s ease-in-out infinite; }
@keyframes boottw { 0%,100% { opacity:.25; } 50% { opacity:1; } }
#boot .smoke { animation:bootsmoke 7s ease-in-out infinite; transform-origin:bottom; }
@keyframes bootsmoke { 0% { transform:translateY(0) scaleY(1); opacity:.5; } 50% { transform:translateY(-6px) scaleY(1.06); opacity:.35; } 100% { transform:translateY(0) scaleY(1); opacity:.5; } }
#boot .glow { animation:bootglow 2.4s ease-in-out infinite; }
@keyframes bootglow { 0%,100% { opacity:.75; } 45% { opacity:1; } 60% { opacity:.65; } }
`;

function rnd(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

/** the night view: drawn once, scaled to any screen (slice) */
function sceneSvg() {
  const r = rnd(7);
  let stars = '';
  for (let i = 0; i < 140; i++) {
    const x = r() * 1600, y = r() * 520, s = r() < 0.08 ? 1.6 : r() * 0.9 + 0.3;
    stars += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${s.toFixed(2)}" fill="#fff" ${i % 3 ? '' : `class="twinkle" style="animation-delay:${(r() * 3).toFixed(2)}s"`} opacity="${(0.35 + r() * 0.6).toFixed(2)}"/>`;
  }
  const pines = (y0, n, h, col, seed, gap = null) => {
    const q = rnd(seed); let d = '';
    for (let i = 0; i < n; i++) {
      const x = (i / n) * 1700 - 50 + q() * 30, hh = h * (0.6 + q() * 0.7), w = hh * 0.32, y = y0 + q() * 18;
      if (gap && x > gap[0] && x < gap[1]) continue;
      d += `M${x - w},${y} L${x},${y - hh} L${x + w},${y} Z `;
    }
    return `<path d="${d}" fill="${col}"/>`;
  };
  const hut = (x, y, s) => `
    <g transform="translate(${x},${y}) scale(${s})">
      <rect x="-34" y="-30" width="68" height="30" fill="#0b0d0c"/>
      <path d="M-44,-28 L0,-62 L44,-28 Z" fill="#090a09"/>
      <rect x="-20" y="-22" width="10" height="10" fill="#ffb24a" class="glow"/>
      <rect x="12" y="-22" width="10" height="10" fill="#ffb24a" class="glow" style="animation-delay:.7s"/>
      <rect x="18" y="-74" width="9" height="20" fill="#0b0d0c"/>
      <path class="smoke" filter="url(#bblur)" d="M22,-76 C14,-100 34,-118 22,-146 C12,-170 30,-186 24,-210" stroke="rgba(190,190,200,.22)" stroke-width="12" fill="none" stroke-linecap="round"/>
    </g>`;
  return `<svg class="scene" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="bsky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#05070f"/><stop offset=".55" stop-color="#101a2e"/><stop offset="1" stop-color="#2a2a33"/>
      </linearGradient>
      <radialGradient id="bmoon" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#f4f1e4"/><stop offset=".7" stop-color="#d9d4c0"/><stop offset="1" stop-color="#d9d4c0" stop-opacity="0"/></radialGradient>
      <radialGradient id="bhalo" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#b9c4e0" stop-opacity=".35"/><stop offset="1" stop-color="#b9c4e0" stop-opacity="0"/></radialGradient>
      <filter id="bblur" x="-50%" y="-20%" width="200%" height="140%"><feGaussianBlur stdDeviation="4"/></filter>
      <radialGradient id="bfire" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffb04a" stop-opacity=".55"/><stop offset="1" stop-color="#ff8a2a" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="1600" height="900" fill="url(#bsky)"/>
    ${stars}
    <circle cx="1210" cy="190" r="140" fill="url(#bhalo)"/>
    <circle cx="1210" cy="190" r="46" fill="url(#bmoon)"/>
    <circle cx="1080" cy="120" r="9" fill="#e8b48a" opacity=".85"/>
    <path d="M0,600 C220,520 380,560 560,520 C760,476 900,540 1100,500 C1300,462 1460,520 1600,490 L1600,900 L0,900 Z" fill="#141a20"/>
    ${pines(610, 90, 70, '#0f1419', 3)}
    <path d="M0,690 C200,650 420,672 640,650 C880,626 1080,668 1300,646 C1440,632 1540,650 1600,640 L1600,900 L0,900 Z" fill="#0c1013"/>
    ${pines(690, 60, 110, '#0a0d10', 11, [520, 1080])}
    <ellipse cx="800" cy="650" rx="240" ry="60" fill="url(#bfire)" class="glow"/>
    ${hut(640, 668, 1.0)}${hut(960, 672, 1.1)}${hut(800, 646, .75)}
    <circle cx="800" cy="664" r="7" fill="#ffcf7a" class="glow"/>
    <path d="M0,760 C300,740 600,756 900,748 C1200,740 1400,758 1600,750 L1600,900 L0,900 Z" fill="#070908"/>
    ${pines(905, 26, 210, '#050606', 21, [380, 1220])}
  </svg>`;
}

export function createBoot(el) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  el.innerHTML = `${sceneSvg()}<div class="veil"></div>
    <div class="card"><div class="title">LiteWorldsQuest</div><div class="orn"><i></i><span>&#10022;</span><i></i></div><div class="sub">Beta</div></div>
    <div class="panel"><div class="what"><span class="step">Starting…</span><b class="pct">0 %</b></div>
      <div class="bar"><div class="fill"></div></div><div class="detail"></div><div class="tip"></div></div>`;
  el.style.display = 'block';
  const q = s => el.querySelector(s);
  let pct = 0, base = 0, next = 2, tipAt = 0, tipNo = Math.floor(Math.random() * TIPS.length), gone = false;
  const show = () => { q('.fill').style.width = `${pct.toFixed(1)}%`; q('.pct').textContent = `${Math.floor(pct)} %`; };
  const tip = () => {
    const t = q('.tip'); t.style.opacity = 0;
    setTimeout(() => { t.textContent = TIPS[tipNo++ % TIPS.length]; t.style.opacity = 1; }, 450);
  };
  tip(); tipAt = setInterval(tip, 5500);
  const at = p => { if (p > pct) { pct = Math.min(100, p); show(); } };
  return {
    /** a loader's line: the step it names moves the bar there; a line of the same step only adds detail */
    say(text) {
      if (gone) return;
      const i = STEPS.findIndex(s => text.startsWith(s[0]));
      if (i >= 0) {
        q('.step').textContent = text.replace(/\s*\(.*\)\s*$/, '');
        base = STEPS[i][1]; next = STEPS[i + 1] ? STEPS[i + 1][1] : 100;
        const m = text.match(/\((.*)\)/); q('.detail').textContent = m ? m[1] : '';
        at(base);
        if (m) at(Math.min(next - 1, pct + (next - base) / 6));   // the forest names its kinds as it grows them
      } else {
        q('.step').textContent = text; q('.detail').textContent = '';
        if (/house says|could not|failed|error/i.test(text)) q('.step').classList.add('err');
      }
    },
    /** within the current step: f in 0..1 of it done, and what (e.g. "tiles 34 / 120") */
    part(f, detail) {
      if (gone) return;
      at(base + (next - base) * Math.max(0, Math.min(1, f)));
      if (detail !== undefined) q('.detail').textContent = detail;
    },
    /** lift the curtain */
    done() {
      if (gone) return;
      gone = true; at(100); clearInterval(tipAt);
      el.classList.add('gone');
      setTimeout(() => { el.style.display = 'none'; el.classList.remove('gone'); }, 950);
    },
    /** back (the house closed): the message stays readable */
    back(text) {
      gone = false; el.style.display = 'block'; el.classList.remove('gone');
      q('.step').textContent = text; q('.step').classList.add('err');
    },
  };
}
