// Sky, sun, moons, stars, light and haze, through the day and the night (the clock is clock.js: one game day is six
// real hours). Drawn back to front, all at the far plane (behind everything the world draws):
//   dome     the sky's colours by the sun's height (day blue, gold and red at sunset, twilight, night), the sun's disc,
//            the glow around the moons and at night the Milky Way along the real galactic plane, with its bright
//            core in Sagittarius, the dark rift, and the bright patches of the real sky (Andromeda, Orion nebula, ...)
//   stars    the real stars (Yale Bright Star Catalogue, content/core/sky), coloured by their spectra, turning with
//            the sky about the pole at 52 degrees north
//   moons    three moons, each a lit sphere: their phase is simply where the sun lights them from
//   clouds   a layer seen from below, drifting with the wind, lit by sun or moons; its cover will follow the weather
// The light follows: sun by day, the brightest moon at night (with its shadows), sky light and haze in the sky's
// colours, the light from the sky for PBR materials baked again as the sky changes.

import * as THREE from 'three';
import { skyAt } from './clock.js';
import { wind } from './wind.js';
import { weatherAt } from './weather.js';

const FAR = 4500;   // where sky things are placed around the camera (then pushed to the far plane)

// the sky's colours by the sun's height in degrees: [height, zenith, horizon, hemisphere sky, hemisphere ground]
const KEYS = [
  [-18, 0x020409, 0x060a14, 0x0a1220, 0x050605],
  [-11, 0x050c20, 0x121a2c, 0x16203a, 0x07080a],
  [-5, 0x14254a, 0x4c4a62, 0x34446a, 0x14141a],
  [0, 0x2a4676, 0xc3805e, 0x8a90a8, 0x3a3428],
  [6, 0x3c5e8e, 0xd2a48a, 0xa8b4c8, 0x464232],
  [15, 0x4a6c96, 0xa7b4c0, 0xb8c8dc, 0x4e4a3a],
];
function sampleKeys(alt) {
  const c = (h) => new THREE.Color(h);
  if (alt <= KEYS[0][0]) return KEYS[0].slice(1).map(c);
  for (let i = 1; i < KEYS.length; i++) if (alt <= KEYS[i][0]) {
    const a = KEYS[i - 1], b = KEYS[i], t = (alt - a[0]) / (b[0] - a[0]);
    return [1, 2, 3, 4].map(k => c(a[k]).lerp(c(b[k]), t));
  }
  return KEYS[KEYS.length - 1].slice(1).map(c);
}

// equatorial (J2000) -> galactic, the IAU rotation
const GAL = new THREE.Matrix3().set(-0.0548755604, -0.8734370902, -0.4838350155, 0.4941094279, -0.4448296300, 0.7469822445, -0.8676661490, -0.1980763734, 0.4559837762);
// bright patches of the real sky: right ascension (h), declination (deg), size (deg), colour, strength
const PATCHES = [
  [0.712, 41.27, 1.6, 0xd8d2ff, 0.10],    // Andromeda galaxy
  [5.588, -5.39, 0.9, 0xff9ac8, 0.16],    // Orion nebula
  [18.06, -24.38, 1.2, 0xffa0b4, 0.12],   // Lagoon nebula
  [2.35, 57.1, 1.0, 0xc8d8ff, 0.08],      // double cluster in Perseus
  [8.67, 19.7, 1.4, 0xfff0d8, 0.07],      // Beehive
  [3.79, 24.1, 1.3, 0xb8ccff, 0.12],      // Pleiades' glow
];
const glslNoise = `
  float h31(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vn3(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z); }
  float fbm3(vec3 p) { float a = 0.0, w = 0.5; for (int i = 0; i < 5; i++) { a += w * vn3(p); p = p * 2.07 + 11.3; w *= 0.5; } return a; }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p) { float a = 0.0, w = 0.5; for (int i = 0; i < 5; i++) { a += w * vnoise(p); p = p * 2.03 + 17.1; w *= 0.5; } return a; }
`;

function skyDome() {
  const u = {
    zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, below: { value: new THREE.Color() },
    sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color(0xffe6c4) }, uSunVis: { value: 1 },
    uGlow: { value: new THREE.Color(0xff7a3c) }, uGlowK: { value: 0 },
    uNight: { value: 0 }, uWorldToEq: { value: new THREE.Matrix3() }, uGal: { value: GAL },
    uPatchDir: { value: PATCHES.map(p => new THREE.Vector4()) }, uPatchCol: { value: PATCHES.map(p => new THREE.Vector4()) },
    uMoonDir: { value: [0, 1, 2].map(() => new THREE.Vector4()) }, uMoonCol: { value: [0, 1, 2].map(() => new THREE.Color()) },
    uAurora: { value: 0 }, uT: { value: 0 },
  };
  const m = new THREE.ShaderMaterial({
    uniforms: u, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `uniform vec3 zenith, horizon, below, sunDir, sunColor, uGlow; uniform float uSunVis, uGlowK, uNight;
      uniform mat3 uWorldToEq, uGal; uniform vec4 uPatchDir[${PATCHES.length}]; uniform vec4 uPatchCol[${PATCHES.length}];
      uniform vec4 uMoonDir[3]; uniform vec3 uMoonCol[3]; uniform float uAurora, uT;
      varying vec3 vDir;
      ${glslNoise}
      void main() {
        vec3 d = normalize(vDir); float h = d.y;
        vec3 c = h > 0.0 ? mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(horizon, below, clamp(-h * 6.0, 0.0, 1.0));
        vec3 sd = normalize(sunDir);
        float s = max(dot(d, sd), 0.0);
        // sunset and sunrise: the horizon burns towards the sun, the glow climbs a little into the sky
        vec2 dh = normalize(d.xz + 1e-5), sh = normalize(sd.xz + 1e-5);
        float toward = pow(max(dot(dh, sh), 0.0), 3.0);
        c += uGlow * uGlowK * toward * exp(-max(h, 0.0) * 7.0) * (h > -0.05 ? 1.0 : 0.3);
        c += sunColor * uSunVis * (pow(s, 1200.0) * 8.0 + pow(s, 32.0) * 0.25 + pow(s, 5.0) * 0.10);
        if (uNight > 0.01 && h > -0.05) {
          vec3 e = uWorldToEq * d;
          vec3 g = uGal * e;
          float b = asin(clamp(g.z, -1.0, 1.0)), l = atan(g.y, g.x);
          // the Milky Way: our galaxy's disc seen from inside, along the real galactic plane. Thick and warm towards
          // the core in Sagittarius, thin and blue-violet away from it; knotted star clouds; dark dust lanes along
          // the middle, the Great Rift splitting it towards the core; a faint wide glow around it
          float core = exp(-l * l / 0.35);
          float width = 0.085 + 0.17 * core;
          float band = exp(-b * b / (width * width));
          float wide = exp(-b * b / 0.14);
          float n1 = fbm3(g * 5.0), n2 = fbm3(g * 13.0 + 1.7), n3 = fbm3(g * 33.0 + 4.2);
          float clouds = n1 * 0.5 + n2 * 0.32 + n3 * 0.18;
          float mw = band * (0.3 + 1.2 * smoothstep(0.32, 0.78, clouds)) * (0.45 + 1.8 * core) + wide * 0.1 * (0.5 + core);
          float ra = 1.0 - abs(fbm3(g * 8.0 + 7.0) * 2.0 - 1.0), rb = 1.0 - abs(fbm3(g * 22.0 + 2.0) * 2.0 - 1.0);
          float dust = (smoothstep(0.84, 0.97, ra) * 0.7 + smoothstep(0.86, 0.98, rb) * 0.45) * exp(-b * b / (width * width * 0.45));
          float rift = exp(-pow((b - 0.015) / 0.032, 2.0)) * smoothstep(1.7, 0.0, abs(l - 0.35)) * smoothstep(0.3, 0.6, n2);
          mw *= clamp(1.0 - dust - 0.85 * rift, 0.04, 1.0);
          vec3 mwc = mix(vec3(0.52, 0.58, 1.0), vec3(1.0, 0.8, 0.6), clamp(core * 0.95 + 0.25 * smoothstep(0.6, 0.9, clouds), 0.0, 1.0));
          mwc = mix(mwc, vec3(0.78, 0.55, 0.95), 0.3 * (1.0 - core) * smoothstep(0.2, 1.0, abs(b) / width));
          vec3 night = mwc * mw * 0.5;
          // the sky's fine stars: tens of thousands too faint for the catalogue, thicker along the band
          float px = max(length(fwidth(e)), 1e-5);
          for (int k = 0; k < 2; k++) {
            float sc = k == 0 ? 150.0 : 260.0;
            vec3 ci = floor(e * sc);
            if (h31(ci + float(k) * 13.1) < 0.08 + 0.6 * band + 0.12 * wide) {
              vec3 sd = normalize(ci + vec3(h31(ci + 1.3), h31(ci + 2.7), h31(ci + 4.1)));
              // mostly at the edge of seeing, a few a little brighter; a pixel wide (no blobs)
              float dd = length(e - sd), br = pow(h31(ci + 7.9), 9.0) * 0.9 + 0.035;
              night += mix(vec3(0.72, 0.8, 1.0), vec3(1.0, 0.86, 0.7), h31(ci + 3.3)) * exp(-dd * dd / (px * px * 0.3)) * br;
            }
          }
          for (int i = 0; i < ${PATCHES.length}; i++) {
            float k = 1.0 - dot(e, uPatchDir[i].xyz);
            night += uPatchCol[i].rgb * uPatchCol[i].a * exp(-k / uPatchDir[i].w);
          }
          // the air dims the stars' glow towards the horizon
          c += night * uNight * smoothstep(-0.02, 0.25, h);
        }
        // northern lights: green curtains with violet tops over the north, folding slowly, rays running along them
        if (uAurora > 0.01 && h > 0.0) {
          float az = atan(d.x, -d.z);
          float north = smoothstep(1.7, 0.3, abs(az));
          float x = az * 3.0;
          float fold = fbm(vec2(x * 1.6 + uT * 0.01, uT * 0.03)) * 1.6;
          float base = 0.1 + 0.14 * fbm(vec2(x * 0.6 + 3.0, uT * 0.02));
          float y = h - base - (fold - 0.8) * 0.06;
          float rays = 0.35 + pow(fbm(vec2((x + fold) * 16.0, uT * 0.15)), 2.0) * 2.2;
          float body = smoothstep(-0.015, 0.02, y) * exp(-max(y, 0.0) * 5.5);
          vec3 ac = mix(vec3(0.12, 1.0, 0.55), vec3(0.55, 0.22, 0.95), smoothstep(0.04, 0.3, y));
          c += ac * body * rays * north * uAurora * 0.45;
        }
        // the moons' halos
        for (int i = 0; i < 3; i++) {
          float k = 1.0 - dot(d, uMoonDir[i].xyz), r2 = uMoonDir[i].w, out_ = max(k - r2 * 0.5, 0.0);
          c += uMoonCol[i] * (exp(-out_ / (r2 * 0.12)) * 0.07 + exp(-out_ / (r2 * 1.5)) * 0.025);
        }
        // haze over the horizon
        c = mix(c, horizon, smoothstep(0.18, 0.0, abs(h)) * 0.55);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24), m);
  mesh.frustumCulled = false; mesh.renderOrder = -10;
  return { mesh, u };
}

// the stars: a point each, at its real place, as bright and as coloured as it is
async function loadStars(contentBase) {
  const meta = await (await fetch(`${contentBase}/core/sky/sky.json`)).json();
  const raw = new DataView(await (await fetch(`${contentBase}/core/sky/${meta.stars.file}`)).arrayBuffer());
  const n = raw.byteLength / 6, pos = new Float32Array(n * 3), mag = new Float32Array(n), col = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const ra = raw.getUint16(i * 6, true) / 65536 * Math.PI * 2, dec = raw.getInt16(i * 6 + 2, true) / 32767 * Math.PI / 2;
    const cd = Math.cos(dec);
    pos[i * 3] = cd * Math.cos(ra); pos[i * 3 + 1] = cd * Math.sin(ra); pos[i * 3 + 2] = Math.sin(dec);
    mag[i] = raw.getUint8(i * 6 + 4) / 25 - 2;
    // colour index B-V to a temperature (Ballesteros 2012), then a blackbody tint, softened (the eye sees pale colours)
    const bv = raw.getInt8(i * 6 + 5) / 60, T = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
    const t = THREE.MathUtils.clamp((T - 3000) / 9000, 0, 1);
    c.setRGB(1.0, 0.72 + 0.26 * Math.min(1, t * 1.6), 0.45 + 0.6 * t).lerp(new THREE.Color(1, 1, 1), 0.35);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = Math.min(1.1, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const u = { uEq: { value: new THREE.Matrix3() }, uVis: { value: 0 }, uTime: { value: 0 }, uPx: { value: 1 } };
  const m = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: `attribute float mag; attribute vec3 color; uniform mat3 uEq; uniform float uVis, uTime, uPx; varying vec3 vC; varying float vA;
      void main() {
        vec3 d = uEq * position;
        if (d.y < -0.02 || uVis <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        float flux = pow(10.0, -0.4 * (mag - 1.0));
        float twinkle = 1.0 + 0.35 * (1.0 - smoothstep(0.0, 0.5, d.y)) * sin(uTime * (6.0 + fract(mag * 37.0) * 9.0) + mag * 91.0);
        vA = clamp(0.14 + flux * 1.2, 0.0, 1.8) * uVis * smoothstep(-0.02, 0.2, d.y) * twinkle;
        vC = color;
        gl_PointSize = clamp(1.6 + 2.6 * sqrt(flux), 1.6, 7.0) * uPx;
        vec4 p = projectionMatrix * viewMatrix * vec4(cameraPosition + d * ${FAR}.0, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: `varying vec3 vC; varying float vA;
      void main() { vec2 q = gl_PointCoord * 2.0 - 1.0; float a = exp(-dot(q, q) * 3.5) * vA; if (a < 0.004) discard; gl_FragColor = vec4(vC * a, 1.0); }`,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false; pts.renderOrder = -9;
  return { pts, u, count: n };
}

// a moon: a quad facing the camera at the moon's place, shaded as a sphere lit by the sun (so the phase is right by
// itself), with darker seas; the dark part hides the stars behind it
function makeMoon(m) {
  const u = { uDir: { value: new THREE.Vector3() }, uR: { value: m.radius * Math.PI / 180 }, uSun: { value: new THREE.Vector3() },
              uCol: { value: new THREE.Color(...m.color) }, uDay: { value: 0 }, uSeed: { value: m.period } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    vertexShader: `uniform vec3 uDir; uniform float uR; varying vec2 vQ; varying vec3 vRight, vUp;
      void main() {
        vec3 d = normalize(uDir), up0 = abs(d.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
        vRight = normalize(cross(up0, d)); vUp = cross(d, vRight);
        vQ = position.xy * 2.0;
        vec3 p = cameraPosition + d * ${FAR}.0 + (vRight * position.x + vUp * position.y) * 2.0 * tan(uR) * ${FAR}.0;
        vec4 c = projectionMatrix * viewMatrix * vec4(p, 1.0);
        gl_Position = c.xyww;
      }`,
    fragmentShader: `uniform vec3 uDir, uSun, uCol; uniform float uDay, uSeed; varying vec2 vQ; varying vec3 vRight, vUp;
      ${glslNoise}
      void main() {
        float r2 = dot(vQ, vQ); if (r2 > 1.0) discard;
        vec3 n = normalize(vRight * vQ.x + vUp * vQ.y - normalize(uDir) * sqrt(1.0 - r2));
        float lit = smoothstep(-0.08, 0.25, dot(n, normalize(uSun)));
        vec3 local = vec3(vQ, sqrt(1.0 - r2));
        // seas (large dark plains), craters (rings of light and shadow at many sizes), fine grain
        float seas = smoothstep(0.38, 0.7, fbm3(local * 2.2 + uSeed) * 0.75 + fbm3(local * 5.0 + uSeed) * 0.25);
        float crat = 0.0;
        for (int k = 0; k < 3; k++) {
          vec3 q = local * (6.0 + float(k) * 9.0) + uSeed * 3.1 + float(k) * 7.7;
          vec3 c0 = floor(q) + 0.5 + (vec3(h31(floor(q)), h31(floor(q) + 3.1), h31(floor(q) + 5.7)) - 0.5) * 0.6;
          float dd = length(q - c0), rr = 0.18 + 0.22 * h31(floor(q) + 9.3);
          crat += (smoothstep(rr, rr * 0.7, dd) * -0.35 + smoothstep(rr * 1.25, rr, dd) * smoothstep(rr * 0.85, rr, dd) * 0.5) * (h31(floor(q) + 1.7) > 0.45 ? 1.0 : 0.0) / (1.0 + float(k));
        }
        float grain = fbm3(local * 28.0 + uSeed) - 0.5;
        float limb = 0.55 + 0.45 * pow(1.0 - r2, 0.35);
        vec3 albedo = uCol * (0.95 - 0.45 * seas + crat * 0.5 + grain * 0.25) * limb;
        // dim (it is a night light, not a lamp); the dark side keeps a faint cold ash light
        vec3 c = albedo * lit * 0.62 + mix(uCol, vec3(0.35, 0.45, 0.7), 0.6) * 0.018 * limb;
        float edge = smoothstep(1.0, 0.985, r2);
        // by day only the lit part shows, pale against the blue; by night the dark part hides most stars behind it
        float a = edge * mix(mix(0.9, 1.0, lit), lit * 0.7, uDay);
        gl_FragColor = vec4(c, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -8;
  return { mesh, u };
}

// the cloud layer (its cover is the weather's later; for now a slow drift of more and fewer clouds)
function cloudLayer() {
  const u = { uTime: { value: 0 }, uCover: { value: 0.4 }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, uLitCol: { value: new THREE.Color() },
              uShadeCol: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uWindDir: wind.uniforms.uWindDir };
  const m = new THREE.ShaderMaterial({
    uniforms: u, side: THREE.BackSide, transparent: true, depthWrite: false, fog: false,
    vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `uniform float uTime, uCover; uniform vec3 sunDir, uLitCol, uShadeCol, uHorizon; uniform vec2 uWindDir; varying vec3 vDir;
      ${glslNoise}
      void main() {
        vec3 d = normalize(vDir); float h = d.y;
        if (h <= 0.0) discard;
        vec2 uv = d.xz / (h + 0.12) * 1.6 + uWindDir * uTime * 0.004;
        float n = fbm(uv) * 0.7 + fbm(uv * 2.7 + 3.0) * 0.3;
        float lo = mix(0.78, 0.12, uCover);
        float cover = smoothstep(lo, lo + 0.3 - 0.15 * uCover, n) * smoothstep(0.0, 0.18 - 0.14 * uCover, h);
        cover = max(cover, smoothstep(0.75, 1.0, uCover) * 0.97);   // overcast: one grey lid
        if (cover < 0.004) discard;
        float s = max(dot(d, normalize(sunDir)), 0.0);
        float lit = 0.55 + 0.45 * pow(s, 3.0) + 0.25 * smoothstep(0.55, 0.9, n);
        vec3 c = mix(uShadeCol, uLitCol, clamp(lit, 0.0, 1.0));
        c = mix(c, uHorizon, smoothstep(0.25, 0.0, h) * 0.5);
        gl_FragColor = vec4(c, cover * 0.94);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(4900, 48, 24), m);
  mesh.frustumCulled = false; mesh.renderOrder = -7;
  return { mesh, u };
}

export async function createSky(scene, renderer, contentBase) {
  const fogColor = new THREE.Color(0xa7b4c0);
  const dome = skyDome();
  const clouds = cloudLayer();
  scene.add(dome.mesh, clouds.mesh);
  let stars = null;
  try { stars = await loadStars(contentBase); scene.add(stars.pts); } catch (e) { console.warn('stars', e); }
  const moons = [0, 1, 2].map(i => null);
  const hemi = new THREE.HemisphereLight(0xb8c8dc, 0x4e4a3a, 0.8);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe2bc, 3.9);   // the sun by day, the brightest moon by night
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);
  scene.fog = new THREE.FogExp2(fogColor, 0.0016);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.72;

  const { MOONS } = await import('./clock.js');
  MOONS.forEach((m, i) => { moons[i] = makeMoon(m); scene.add(moons[i].mesh); });
  for (let i = 0; i < PATCHES.length; i++) {
    const [ra, dec, size, col, k] = PATCHES[i], a = ra / 24 * Math.PI * 2, b = dec * Math.PI / 180, r = size * Math.PI / 180;
    dome.u.uPatchDir.value[i].set(Math.cos(b) * Math.cos(a), Math.cos(b) * Math.sin(a), Math.sin(b), r * r * 0.5);
    const c = new THREE.Color(col); dome.u.uPatchCol.value[i].set(c.r, c.g, c.b, k);
  }

  const dir = new THREE.Vector3();            // the sun
  const lightDir = new THREE.Vector3();       // where the scene's light comes from (sun or moon)
  const lightCol = new THREE.Color(), ambient = new THREE.Color();
  const eq = new THREE.Matrix3(), eqInv = new THREE.Matrix3();
  let auroraForce = null, weather = null, flash = 0;
  let shadowSize = 0, baseFog = 0.0016, sunAlt = 30, dark = 0, lastBake = { alt: 999, at: -1e9 }, sky = null;

  // light from the whole sky for every PBR material (rock, bark, leaves, ferns): the sky dome, prefiltered; baked
  // again when the sky has changed enough
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene(), envDome = skyDome();
  envDome.mesh.material.uniforms.sunColor.value.multiplyScalar(0.25);
  const groundDisc = new THREE.Mesh(new THREE.CircleGeometry(4000, 16), new THREE.MeshBasicMaterial({ color: 0x3a3c2c }));
  groundDisc.rotation.x = -Math.PI / 2; groundDisc.position.y = -40;
  env.add(envDome.mesh, groundDisc);
  let envRT = null;
  function bake() {
    for (const k of ['zenith', 'horizon', 'below', 'sunDir', 'uGlow']) envDome.u[k].value.copy(dome.u[k].value);
    envDome.u.uGlowK.value = dome.u.uGlowK.value; envDome.u.uSunVis.value = dome.u.uSunVis.value;
    groundDisc.material.color.setRGB(0.23, 0.235, 0.17).multiplyScalar(0.15 + 0.85 * (1 - dark));
    const rt = pmrem.fromScene(env, 0.02);
    if (envRT) envRT.dispose();
    envRT = rt; scene.environment = rt.texture;
  }

  function update(t) {
    sky = skyAt(t);
    const we = weather = weatherAt(t, sky.yearFrac, sky.hour);
    wind.set({ dir: we.wind.dir, base: we.wind.base, gust: we.wind.gust });
    // lightning: now and then in a storm a flash lights sky and land for a moment (the same strikes for everyone)
    const tick4 = Math.floor(t * 4), hz = Math.abs(Math.sin(tick4 * 91.345 + 7.1) * 43758.5453) % 1;
    flash = hz < 0.035 * we.lightning ? Math.exp(-((t * 4) % 1) * 5) * (0.6 + 0.4 * ((hz * 97) % 1)) : 0;
    const s = sky.sun;
    dir.set(s[0], s[1], s[2]);
    sunAlt = sky.sunAlt;
    eq.fromArray(sky.eqToWorld); eqInv.copy(eq).transpose();
    dark = 1 - THREE.MathUtils.smoothstep(sunAlt, -12, 2);        // 0 by day .. 1 in the full night
    const [zen, hor, hs, hg] = sampleKeys(sunAlt);
    // overcast and rain: the sky goes grey and dim
    const grey = we.cover * we.dark;
    for (const c of [zen, hor, hs]) { const l = c.r * 0.3 + c.g * 0.55 + c.b * 0.15; c.lerp(new THREE.Color(l, l * 1.02, l * 1.06), 0.75 * grey).multiplyScalar(1 - 0.45 * grey); }
    if (flash > 0) for (const c of [zen, hor, hs]) c.add(new THREE.Color(0.55, 0.6, 0.75).multiplyScalar(flash));
    // moonlight: how much the moons above the horizon light the land (Silvermoon full gives most)
    let moonLight = 0, best = null;
    const mc = new THREE.Color();
    sky.moons.forEach((m, i) => {
      const up = THREE.MathUtils.smoothstep(m.dir[1], -0.02, 0.08);
      const k = m.lit * m.albedo * (m.radius / 9) ** 2 * up;
      moonLight += k;
      if (!best || k > best.k) best = { k, m };
      const mo = moons[i];
      mo.u.uDir.value.set(m.dir[0], m.dir[1], m.dir[2]); mo.u.uSun.value.copy(dir); mo.u.uDay.value = 1 - dark;
      mo.mesh.visible = m.dir[1] > -0.05;
      const r = m.radius * Math.PI / 180;
      dome.u.uMoonDir.value[i].set(m.dir[0], m.dir[1], m.dir[2], r * r);
      dome.u.uMoonCol.value[i].setRGB(...m.color).multiplyScalar(m.lit * m.albedo * up * (0.3 + 0.7 * dark));
      mc.add(new THREE.Color(...m.color).multiplyScalar(k));
    });
    moonLight = Math.min(1.2, moonLight);
    // the night sky lightens under the moons
    const lift = new THREE.Color(0.025, 0.04, 0.07).multiplyScalar(moonLight * dark);
    zen.add(lift); hor.add(lift.clone().multiplyScalar(1.3));
    dome.u.zenith.value.copy(zen); dome.u.horizon.value.copy(hor); dome.u.below.value.copy(hor).multiplyScalar(0.85);
    dome.u.sunDir.value.copy(dir);
    dome.u.uSunVis.value = THREE.MathUtils.smoothstep(sunAlt, -1.5, 0.5);
    dome.u.uGlowK.value = Math.max(0, 1 - Math.abs(sunAlt - 1) / 9) * 0.9;
    dome.u.uNight.value = THREE.MathUtils.smoothstep(dark, 0.55, 1) * (1 - 0.45 * Math.min(1, moonLight)) * (1 - 0.9 * grey);
    dome.u.uWorldToEq.value.copy(eqInv);
    // northern lights on some nights (about one in four, by the night's number), only in the dark
    const nightNo = Math.floor(sky.days + 0.5), ah = Math.abs(Math.sin(nightNo * 12.9898 + 4.1) * 43758.5453) % 1;
    dome.u.uAurora.value = (auroraForce ?? THREE.MathUtils.smoothstep(ah, 0.72, 0.9)) * THREE.MathUtils.smoothstep(dark, 0.6, 1) * (1 - we.cover * 0.8);
    dome.u.uT.value = t % 10000;
    if (stars) {
      stars.u.uEq.value.copy(eq);
      stars.u.uVis.value = THREE.MathUtils.smoothstep(dark, 0.45, 1) * (1 - 0.3 * Math.min(1, moonLight));
      stars.u.uTime.value = t % 1000; stars.u.uPx.value = renderer.getPixelRatio();
    }
    // light: the sun while it is up, else the brightest moon (soft blue-white, its own shadows)
    const sunK = THREE.MathUtils.smoothstep(sunAlt, -3, 4);
    const low = THREE.MathUtils.clamp(sunAlt / 25, 0, 1);
    if (sunAlt > -2 || !best || best.k < 0.02) {
      lightDir.copy(dir);
      sun.color.setHSL(0.09, 0.55 * (1 - low) + 0.2, 0.62 + 0.25 * low);
      sun.intensity = (0.8 + 2.8 * low) * sunK * (1 - 0.8 * grey) * (1 - 0.35 * we.cover);
      lightCol.copy(sun.color).multiplyScalar(sun.intensity / 3.6);
    } else {
      lightDir.set(...best.m.dir);
      sun.color.copy(mc.multiplyScalar(1 / Math.max(moonLight, 1e-3))).lerp(new THREE.Color(0.7, 0.8, 1.0), 0.5);
      sun.intensity = 0.55 * moonLight * (1 - 0.9 * we.cover);
      lightCol.copy(sun.color).multiplyScalar(sun.intensity / 3.6 * 1.6);
    }
    hemi.color.copy(hs); hemi.groundColor.copy(hg);
    hemi.intensity = 0.5 + 0.35 * (1 - dark) + 0.25 * moonLight * dark * (1 - we.cover) + 1.5 * flash;
    ambient.copy(hs).multiplyScalar(0.62 * (0.55 + 0.45 * (1 - dark)) + 0.1 * moonLight * dark);
    scene.environmentIntensity = 0.55 * (1 - dark) + 0.18 * dark;
    // haze: the horizon's colour, a little of the zenith's
    fogColor.copy(hor).lerp(zen, 0.25); scene.fog.color.copy(fogColor);
    // the eye opens in the dark
    renderer.toneMappingExposure = 0.72 + 0.28 * dark;
    // clouds lit by what lights them now
    clouds.u.uTime.value = t % 100000; clouds.u.sunDir.value.copy(lightDir);
    clouds.u.uLitCol.value.setRGB(0.93, 0.92, 0.90).lerp(new THREE.Color(1.0, 0.62, 0.42), dome.u.uGlowK.value * 0.8).multiplyScalar(0.06 + 0.94 * (1 - dark)).add(new THREE.Color(0.16, 0.19, 0.25).multiplyScalar(moonLight * dark));
    clouds.u.uShadeCol.value.copy(clouds.u.uLitCol.value).multiplyScalar(0.48).add(hor.clone().multiplyScalar(0.12));
    clouds.u.uHorizon.value.copy(hor);
    clouds.u.uCover.value = we.cover;
    clouds.u.uLitCol.value.lerp(new THREE.Color(0.62, 0.66, 0.72).multiplyScalar(0.06 + 0.94 * (1 - dark)), 0.7 * we.dark).multiplyScalar(1 - 0.45 * we.dark).add(new THREE.Color(0.9, 0.92, 1.0).multiplyScalar(flash * 0.9));
    clouds.u.uShadeCol.value.multiplyScalar(1 - 0.55 * we.dark);
    if (Math.abs(sunAlt - lastBake.alt) > 1.5 || t - lastBake.at > 90) { lastBake = { alt: sunAlt, at: t }; bake(); }
  }

  update(Date.now() / 1000);
  return {
    sunDir: dir,
    /** where the light comes from now (sun, or a moon at night), its colour (1 = the noon sun) and the sky's light */
    light: { dir: lightDir, color: lightCol, ambient },
    get sunAlt() { return sunAlt; }, get dark() { return dark; }, get now() { return sky; },
    get weather() { return weather; }, get flash() { return flash; },
    setShadows(size, renderer) {
      if (size === shadowSize) return;
      shadowSize = size;
      renderer.shadowMap.enabled = size > 0;
      sun.castShadow = size > 0;
      if (size > 0) {
        sun.shadow.mapSize.set(size, size);
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
        const c = sun.shadow.camera, r = size >= 2048 ? 70 : 45;
        c.left = -r; c.right = r; c.top = r; c.bottom = -r; c.near = 1; c.far = 400; c.updateProjectionMatrix();
      }
      scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    },
    setFog(density) { baseFog = density; scene.fog.density = density; },
    /** (dev) northern lights: 0..1, or null for the clock's choice */
    setAurora(v) { auroraForce = v; },
    // t: the world clock in seconds
    tick(t) { update(t); },
    follow(p) {
      // the haze lies in the valleys: from up high one sees far
      scene.fog.density = baseFog * (weather ? weather.fog : 1) * (1 - 0.65 * THREE.MathUtils.smoothstep(p.y, 40, 260));
      sun.target.position.set(p.x, p.y, p.z);
      sun.position.set(p.x + lightDir.x * 200, p.y + lightDir.y * 200, p.z + lightDir.z * 200);
      dome.mesh.position.set(p.x, p.y, p.z); clouds.mesh.position.set(p.x, p.y, p.z);
    },
  };
}
