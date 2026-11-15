// Grass on the ground around the player: clumps of blades on a grid that travels with the camera, placed, sized and
// thinned entirely in the vertex shader (height from the baked ground, density from where the land is grassy), so
// walking costs the CPU nothing. Bends in the wind. How far it reaches follows the quality.
// Two rings: near, dense clumps of five bending blades; around them, out to three and a half times as far, a loose
// ring of wider, simpler clumps (three flat blades) that fades in where the near ring thins out, so the meadow does not
// end in a line and the distance is not bare. Blades widen with distance so they never shrink below a pixel.

import * as THREE from 'three';
import { wind } from './wind.js';

const SPACING = 0.34;   // metres between clumps
const GRID = 260;       // clumps per side at most (radius = GRID * SPACING / 2)
const FAR_SPACING = 0.9, FAR_MAX = 120, FAR_GRID = Math.ceil(2 * FAR_MAX / FAR_SPACING) + 4;
const FAR_TIMES = 3.5;  // the far ring reaches this many times the near radius (at most FAR_MAX)
// the third ring: thinner still, out to twice the far ring
const WIDE_SPACING = 2.0, WIDE_MAX = 240, WIDE_GRID = Math.ceil(2 * WIDE_MAX / WIDE_SPACING) + 4, WIDE_TIMES = 2;

function clump(blades = 5, segments = 2, width = 0.036) {
  // blades of one or two segments, tapering, standing at a little angle to each other. Per vertex also: across (from
  // the blade's middle line out to this edge) and the blade's facing normal, for the shading and for widening blades
  // seen edge-on
  const pos = [], uv = [], ind = [], across = [], bnorm = [];
  for (let b = 0; b < blades; b++) {
    const a = b * 1.37 + 0.3, ca = Math.cos(a), sa = Math.sin(a), lean = 0.10 + (b % 3) * 0.06;
    const rr = 0.04 + 0.08 * ((b * 0.618) % 1), ox = Math.cos(a * 2.3) * rr, oz = Math.sin(a * 2.3) * rr, tall = 0.7 + ((b * 0.382) % 1) * 0.5;
    const base = pos.length / 3;
    const rows = segments === 2 ? [[0, width], [0.55 * tall, width * 0.62], [tall, 0.0]] : [[0, width], [tall, 0.0]];
    for (const [t, w] of rows) {
      const bend = lean * t * t;
      for (const side of [-1, 1]) {
        pos.push(ox + ca * w * side + sa * bend, t, oz + sa * w * side - ca * bend);
        uv.push(side < 0 ? 0 : 1, t);
        across.push(ca * w * side, 0, sa * w * side);
        bnorm.push(sa, 0.25 * lean / 0.22, -ca);
      }
    }
    for (let r = 0; r < segments; r++) { const i = base + r * 2; ind.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('across', new THREE.Float32BufferAttribute(across, 3));
  g.setAttribute('bnorm', new THREE.Float32BufferAttribute(bnorm, 3));
  g.setIndex(ind);
  return g;
}

const within = (L, r) => L.within(r + L.spacing);

export function createGrass(ground, scene) {
  const [x0, z0, x1, z1] = ground.meta.extent;
  // what both rings share (one object each: changing it changes both)
  const shared = {
    uHeight: { value: ground.heightTex }, uWeights: { value: ground.weights }, uWeights2: { value: ground.weights2 },
    uExt: { value: new THREE.Vector4(x0, z0, x1 - x0, z1 - z0) }, uSize: { value: new THREE.Vector2(ground.meta.nx, ground.meta.nz) },
    uCenter: { value: new THREE.Vector2() }, uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.4).normalize() },
    uSunCol: { value: new THREE.Color(1.0, 0.93, 0.80) }, uAmb: { value: new THREE.Color(0.50, 0.55, 0.62) },
    uDry: { value: 0.05 }, uFlowers: { value: 1 }, uSnow: { value: 0 },
    uMask: { value: null }, uMaskExt: { value: new THREE.Vector4(0, 0, 0, 0) },
    ...wind.uniforms,
  };
  // near: eight fine blades a clump (was five, twice as wide): the look of real grass, not of ribbons
  const near = layer(clump(8, 2, 0.017), SPACING, GRID, { uWiden: 1, uFar: 0.004, uTone: 1, uWindLook: 1 });
  // wide blades show more of their light tips: a little darker; far away a gust is seen as a light wave running over
  // the meadow more than as bending blades, so the far ring bends more and brightens much more in a gust
  const far = layer(clump(3, 1), FAR_SPACING, FAR_GRID, { uWiden: 2.1, uFar: 0.02, uTone: 0.86, uWindLook: 2.2 });
  const wide = layer(clump(3, 1), WIDE_SPACING, WIDE_GRID, { uWiden: 3.4, uFar: 0.02, uTone: 0.82, uWindLook: 2.6 });
  const rings = [near, far, wide];

  function layer(g, spacing, grid, own) {
  const geo = new THREE.InstancedBufferGeometry().copy(g);
  // nearest first: drawing the first n clumps draws a disc, so the radius only changes a count
  const cells = [];
  // whole cell numbers: the shader adds them to the camera's cell exactly (metres would round differently from
  // every camera cell, and the hash would scatter the blades anew each time the camera crosses a cell)
  for (let j = 0; j < grid; j++) for (let i = 0; i < grid; i++) cells.push([i - grid / 2, j - grid / 2]);
  cells.sort((a, b) => (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]));
  const offsets = new Float32Array(cells.flat());
  const within = r => { let lo = 0, hi = cells.length; while (lo < hi) { const m = (lo + hi) >> 1; if (Math.hypot(...cells[m]) * spacing <= r) lo = m + 1; else hi = m; } return lo; };
  geo.setAttribute('offset', new THREE.InstancedBufferAttribute(offsets, 2));
  geo.instanceCount = 0;

  const uniforms = { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...shared,
    uRadius: { value: 30 }, uInner: { value: 0 }, uSpacing: { value: spacing } };
  for (const k in own) uniforms[k] = { value: own[k] };
  const mat = new THREE.ShaderMaterial({
    uniforms, fog: true, side: THREE.DoubleSide,
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>
      attribute vec2 offset; attribute vec3 across, bnorm;
      varying vec3 vN, vAc, vWPos; varying float vU;
      uniform sampler2D uHeight, uWeights, uWeights2, uMask; uniform vec4 uExt, uMaskExt; uniform vec2 uSize, uCenter; uniform float uRadius, uInner, uTime, uSpacing, uWiden, uFar, uWindLook, uDry, uFlowers, uSnow;
      // integer hash (exact for the same cell from anywhere): a cell number and a salt to [0, 1)
      uint ihash(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
      float h01(vec2 c, uint salt) { ivec2 i = ivec2(c); return float(ihash(uint(i.x) * 1664525u ^ ihash(uint(i.y) + salt * 2654435761u)) >> 8) / 16777216.0; }
      varying float vT; varying float vShade; varying float vHue; varying float vDry; varying vec3 vFlower; varying float vWind;
      ${wind.glsl}
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
      float heightAt(vec2 xz) {   // bilinear by hand: float textures need not be filterable
        vec2 f = (xz - uExt.xy) / uExt.zw * (uSize - 1.0);
        vec2 i = floor(f), t = f - i;
        float a = texture2D(uHeight, (i + 0.5) / uSize).r, b = texture2D(uHeight, (i + vec2(1.5, 0.5)) / uSize).r;
        float c = texture2D(uHeight, (i + vec2(0.5, 1.5)) / uSize).r, d = texture2D(uHeight, (i + 1.5) / uSize).r;
        return t.x >= t.y ? a + (b - a) * t.x + (d - b) * t.y : a + (d - c) * t.x + (c - a) * t.y;
      }
      void main() {
        // the grid stays put in the world: snapped to its spacing, only the window moves with the player
        vec2 ci = floor(uCenter / uSpacing) + offset;   // whole numbers, exact
        vec2 cell = ci * uSpacing;
        float h1 = h01(ci, 1u), h2 = h01(ci, 2u), h3 = h01(ci, 3u), h4 = h01(ci, 4u);
        vec2 xz = cell + (vec2(h1, h2) - 0.5) * uSpacing;
        float dist = length(xz - uCenter);
        // the edge: thinned out over a wide band (each clump has its own distance where it goes), no line in the field
        // the far ring comes in exactly where the near ring goes (the near ring's fade, turned round)
        float fade = (1.0 - smoothstep(uRadius * 0.5, uRadius, dist))
                   * (uInner > 0.0 ? smoothstep(uInner * 0.5, uInner, dist) : 1.0);
        // a clump that is not drawn stops here, before any texture is read (most clumps of the outer rings' inner
        // discs, of the fade bands, the forest floor and the paths): all its vertices land outside the view
        #define SKIP { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        if (h4 > fade) SKIP
        // no grass where a place says so (floors of huts, the well, the fire, solid things)
        vec2 mu = (xz - uMaskExt.xy) / uMaskExt.zw;
        if (uMaskExt.z > 0.0 && mu.x > 0.0 && mu.y > 0.0 && mu.x < 1.0 && mu.y < 1.0 && texture2D(uMask, mu).r > 0.5) SKIP
        vec4 w = texture2D(uWeights, (xz - uExt.xy) / uExt.zw);
        if (h3 > (w.r + w.g * 0.6) * 1.15 - 0.15) SKIP
        if (h4 < uSnow * 0.8) SKIP   // under snow most of the grass is gone
        float groundY = heightAt(xz);
        float grassy = (w.r + w.g * 0.6) * (1.0 - smoothstep(150.0, 210.0, groundY));   // grass, some in the forest floor; thinning up the mountains
        float keep = step(h3, grassy * 1.15 - 0.15) * (0.35 + 0.65 * fade);
        if (keep <= 0.0) SKIP
        // height varies a lot: low fescue, normal clumps, now and then a tall tussock
        // clumping (as in Ghost of Tsushima): patches of a few metres share height, colour and much of the direction
        float patchN = vn2(xz * 0.45 + 13.0);
        float size = (0.22 + 0.5 * pow(h1, 1.4)) * keep * (0.6 + 0.4 * grassy) * (0.65 + 0.7 * patchN) * (1.0 - 0.55 * uSnow);
        if (h3 > 0.86) size *= 1.7;
        float ang = mix(h2 * 6.2831, vn2(xz * 0.3 + 5.0) * 12.566, 0.55);
        mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
        float wide = uWiden * (1.0 + dist * uFar);   // wider far away: a blade never thinner than a pixel
        vec3 p = position;
        p.xz *= wide;
        p.xz = rot * p.xz;
        // a blade seen edge-on is widened (in its own plane), so it does not thin out to a flickering line
        vec2 acr = rot * across.xz * wide, nb = rot * bnorm.xz;
        float edgeOn = 1.0 - abs(dot(normalize(nb), normalize(cameraPosition.xz - xz + 1e-4)));
        p.xz += acr * edgeOn * 1.3;
        vN = normalize(vec3(nb.x, bnorm.y, nb.y)); vAc = vec3(acr.x, 0.0, acr.y) + 1e-5; vU = uv.x;
        p *= vec3(1.0, size, 1.0);
        // wind: the blades lie down with the gust passing over them, rock a little around that, and shiver
        float g = windGust(xz);
        float bend = g * (0.55 + 0.1 * sin(uWindTime * 2.2 + h2 * 6.3)) + sin(uWindTime * 3.1 + h1 * 20.0) * 0.07 * (0.4 + g);
        float tip = position.y * position.y * size * (0.6 + 0.4 * uWindLook);
        p.xz += uWindDir * bend * tip * 0.75;
        p.y -= bend * bend * tip * 0.25;
        vWind = smoothstep(0.35, 1.0, g) * uWindLook;
        vec3 world = vec3(xz.x, groundY - 0.03, xz.y) + p;
        vT = position.y; vHue = mix(h3, vn2(xz * 0.3 + 7.0), 0.7); vWPos = world;
        // dry patches across the field, and the season's dryness over all (straw in autumn, dead in winter)
        vDry = clamp(smoothstep(0.55, 0.8, vn2(xz * 0.045) * 0.75 + vn2(xz * 0.21) * 0.25) * 0.7 + uDry * (0.8 + 0.4 * h2), 0.0, 1.0);
        float fl = h01(ci, 5u);
        vFlower = fl > 1.0 - 0.035 * uFlowers ? (fl > 0.99 ? vec3(0.62, 0.42, 0.75) : fl > 0.981 ? vec3(0.92, 0.82, 0.25) : vec3(0.9, 0.9, 0.86)) : vec3(-1.0);
        // the ground's hollows, and the shade of the wood (forest floor share) darken the blades too
        vShade = (0.75 + 0.25 * h2) * texture2D(uWeights2, (xz - uExt.xy) / uExt.zw).a * (1.0 - 0.45 * w.g);
        vec4 mvPosition = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 uSunDir, uSunCol, uAmb; uniform float uTone; varying vec3 vN, vAc, vWPos; varying float vU; varying float vT; varying float vShade; varying float vHue; varying float vDry; varying vec3 vFlower; varying float vWind;
      void main() {
        vec3 root = vec3(0.04, 0.055, 0.02), tip = mix(vec3(0.19, 0.23, 0.09), vec3(0.29, 0.27, 0.12), vHue * 0.8);
        tip = mix(tip, vec3(0.40, 0.35, 0.17), vDry * 0.85);                         // straw
        tip = mix(tip, vec3(0.30, 0.24, 0.14), smoothstep(0.75, 1.0, vDry) * 0.6);   // dead, brown
        vec3 c = mix(root, tip, vT) * vShade;
        c *= 1.0 + 0.4 * vWind * vT;   // blades bent by a gust show their light side: the wave can be seen running
        if (vFlower.x >= 0.0 && vT > 0.82) c = vFlower * 0.8;
        // light: the blade is round across (its normal turns from one edge to the other), lit by the sky from above and
        // the sun with a soft wrap; with the sun behind it, light comes through the blade (translucency); a faint sheen
        vec3 nb = normalize(vN); if (!gl_FrontFacing) nb = -nb;
        vec3 n = normalize(nb + normalize(vAc) * (vU * 2.0 - 1.0) * 0.9 + vec3(0.0, 0.35, 0.0));
        vec3 L = normalize(uSunDir), V = normalize(cameraPosition - vWPos);
        float sunUp = clamp(L.y * 4.0, 0.0, 1.0);
        float diff = clamp((dot(n, L) + 0.35) / 1.35, 0.0, 1.0);
        float trans = pow(clamp(dot(-V, L), 0.0, 1.0), 3.0) * (0.25 + 0.75 * vT) * 0.8;
        float spec = pow(max(dot(n, normalize(L + V)), 0.0), 24.0) * 0.1 * vT;
        vec3 light = uAmb * (0.65 + 0.35 * n.y) + uSunCol * (diff * 0.85 + trans) * sunUp;
        c = c * light * 1.3 + spec * sunUp;
        c *= uTone;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return { mesh, geo, uniforms, within, max: grid * spacing / 2 - spacing, spacing };
  }

  return {
    configure(r) {
      const rn = Math.min(r, near.max), rf = r > 0 ? Math.min(rn * FAR_TIMES, FAR_MAX, far.max) : 0;
      const rw = r > 0 ? Math.min(rf * WIDE_TIMES, WIDE_MAX, wide.max) : 0;
      // each ring comes in where the one inside it fades out
      [[near, rn, 0], [far, rf, rn], [wide, rw, rf]].forEach(([L, R, inner]) => {
        L.uniforms.uRadius.value = R; L.uniforms.uInner.value = inner; L.mesh.visible = R > 0; L.geo.instanceCount = within(L, R);
      });
    },
    get count() { return rings.reduce((n, L) => n + (L.mesh.visible ? L.geo.instanceCount : 0), 0); },
    /** the season (seasons.js) and how much snow lies */
    setSeason(season, snow) { shared.uDry.value = season.dry; shared.uFlowers.value = season.flowers; shared.uSnow.value = snow; },
    // light: { dir, color, ambient } of the sky (sun by day, a moon by night)
    update(px, pz, t, light) {
      shared.uCenter.value.set(px, pz); shared.uTime.value = t;
      if (light) { shared.uSunDir.value.copy(light.dir); shared.uSunCol.value.copy(light.color); shared.uAmb.value.copy(light.ambient); }
    },
    /** where no grass grows: {data: Uint8Array (255 = none), w, h, x0, z0, res (m per texel)} */
    setMask(m) {
      if (!m) return;
      const tex = new THREE.DataTexture(m.data, m.w, m.h, THREE.RedFormat, THREE.UnsignedByteType);
      tex.magFilter = tex.minFilter = THREE.NearestFilter;
      tex.needsUpdate = true;
      shared.uMask.value = tex;
      shared.uMaskExt.value.set(m.x0, m.z0, m.w * m.res, m.h * m.res);
    },
  };
}
