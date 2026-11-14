// Grass on the ground around the player: clumps of blades on a grid that travels with the camera, placed, sized and
// thinned entirely in the vertex shader (height from the baked ground, density from where the land is grassy), so
// walking costs the CPU nothing. Bends in the wind, fades out at its edge. How far it reaches follows the quality.

import * as THREE from 'three';

const SPACING = 0.34;   // metres between clumps
const GRID = 260;       // clumps per side at most (radius = GRID * SPACING / 2)

function clump() {
  // three blades, each two segments, tapering, standing at a little angle to each other
  const pos = [], uv = [], ind = [];
  for (let b = 0; b < 5; b++) {
    const a = b * 1.37 + 0.3, ca = Math.cos(a), sa = Math.sin(a), lean = 0.10 + (b % 3) * 0.06;
    const ox = Math.cos(a * 2.3) * 0.11, oz = Math.sin(a * 2.3) * 0.11, tall = 0.75 + (b % 2) * 0.35;
    const base = pos.length / 3;
    const rows = [[0, 0.036], [0.55 * tall, 0.022], [tall, 0.0]];
    for (const [t, w] of rows) {
      const bend = lean * t * t;
      for (const side of [-1, 1]) {
        pos.push(ox + ca * w * side + sa * bend, t, oz + sa * w * side - ca * bend);
        uv.push(side < 0 ? 0 : 1, t);
      }
    }
    for (let r = 0; r < 2; r++) { const i = base + r * 2; ind.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(ind);
  return g;
}

export function createGrass(ground, scene) {
  const [x0, z0, x1, z1] = ground.meta.extent;
  const geo = new THREE.InstancedBufferGeometry().copy(clump());
  // nearest first: drawing the first n clumps draws a disc, so the radius only changes a count
  const cells = [];
  // whole cell numbers: the shader adds them to the camera's cell exactly (metres would round differently from
  // every camera cell, and the hash would scatter the blades anew each time the camera crosses a cell)
  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) cells.push([i - GRID / 2, j - GRID / 2]);
  cells.sort((a, b) => (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]));
  const offsets = new Float32Array(cells.flat());
  const within = r => { let lo = 0, hi = cells.length; while (lo < hi) { const m = (lo + hi) >> 1; if (Math.hypot(...cells[m]) * SPACING <= r) lo = m + 1; else hi = m; } return lo; };
  geo.setAttribute('offset', new THREE.InstancedBufferAttribute(offsets, 2));
  geo.instanceCount = GRID * GRID;

  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uHeight: { value: ground.heightTex }, uWeights: { value: ground.weights }, uWeights2: { value: ground.weights2 },
    uExt: { value: new THREE.Vector4(x0, z0, x1 - x0, z1 - z0) }, uSize: { value: new THREE.Vector2(ground.meta.nx, ground.meta.nz) },
    uCenter: { value: new THREE.Vector2() }, uRadius: { value: 30 }, uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.4).normalize() }, uSpacing: { value: SPACING },
    uMask: { value: null }, uMaskExt: { value: new THREE.Vector4(0, 0, 0, 0) },
  }]);
  uniforms.uHeight.value = ground.heightTex; uniforms.uWeights.value = ground.weights; uniforms.uWeights2.value = ground.weights2;
  const mat = new THREE.ShaderMaterial({
    uniforms, fog: true, side: THREE.DoubleSide,
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>
      attribute vec2 offset;
      uniform sampler2D uHeight, uWeights, uWeights2, uMask; uniform vec4 uExt, uMaskExt; uniform vec2 uSize, uCenter; uniform float uRadius, uTime, uSpacing;
      // integer hash (exact for the same cell from anywhere): a cell number and a salt to [0, 1)
      uint ihash(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
      float h01(vec2 c, uint salt) { ivec2 i = ivec2(c); return float(ihash(uint(i.x) * 1664525u ^ ihash(uint(i.y) + salt * 2654435761u)) >> 8) / 16777216.0; }
      varying float vT; varying float vShade; varying float vHue; varying float vDry; varying vec3 vFlower;
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
        // no grass where a place says so (floors of huts, the well, the fire, solid things)
        vec2 mu = (xz - uMaskExt.xy) / uMaskExt.zw;
        float masked = (uMaskExt.z > 0.0 && mu.x > 0.0 && mu.y > 0.0 && mu.x < 1.0 && mu.y < 1.0) ? texture2D(uMask, mu).r : 0.0;
        vec4 w = texture2D(uWeights, (xz - uExt.xy) / uExt.zw);
        float grassy = (w.r + w.g * 0.6) * (1.0 - smoothstep(150.0, 210.0, heightAt(cell)));   // grass, some in the forest floor; thinning up the mountains
        // the edge: thinned out over a wide band (each clump has its own distance where it goes), no line in the field
        float fade = 1.0 - smoothstep(uRadius * 0.5, uRadius, dist);
        float keep = step(h3, grassy * 1.15 - 0.15) * step(h4, fade) * (0.55 + 0.45 * fade) * step(masked, 0.5);
        // height varies a lot: low fescue, normal clumps, now and then a tall tussock
        float size = (0.22 + 0.5 * pow(h1, 1.4)) * keep * (0.6 + 0.4 * grassy);
        if (h3 > 0.86) size *= 1.7;
        float ang = h2 * 6.2831;
        vec3 p = position;
        p.xz = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p.xz;
        p *= vec3(1.0, size, 1.0) * (keep > 0.0 ? 1.0 : 0.0);
        // wind: a slow wave over the field and a quick shiver, stronger at the tip
        float wave = sin(uTime * 1.3 + xz.x * 0.08 + xz.y * 0.05) * 0.5 + sin(uTime * 3.1 + h1 * 20.0) * 0.15;
        p.x += wave * position.y * position.y * 0.35 * size;
        p.z += wave * position.y * position.y * 0.18 * size;
        vec3 world = vec3(xz.x, heightAt(xz) - 0.03, xz.y) + p;
        vT = position.y; vHue = h3;
        vDry = smoothstep(0.55, 0.8, vn2(xz * 0.045) * 0.75 + vn2(xz * 0.21) * 0.25);   // dry patches across the field
        float fl = h01(ci, 5u);
        vFlower = fl > 0.972 ? (fl > 0.99 ? vec3(0.62, 0.42, 0.75) : fl > 0.981 ? vec3(0.92, 0.82, 0.25) : vec3(0.9, 0.9, 0.86)) : vec3(-1.0);
        // the ground's hollows, and the shade of the wood (forest floor share) darken the blades too
        vShade = (0.75 + 0.25 * h2) * texture2D(uWeights2, (xz - uExt.xy) / uExt.zw).a * (1.0 - 0.45 * w.g);
        vec4 mvPosition = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 uSunDir; varying float vT; varying float vShade; varying float vHue; varying float vDry; varying vec3 vFlower;
      void main() {
        vec3 root = vec3(0.04, 0.055, 0.02), tip = mix(vec3(0.19, 0.23, 0.09), vec3(0.29, 0.27, 0.12), vHue * 0.8);
        tip = mix(tip, vec3(0.40, 0.35, 0.17), vDry * 0.85);                         // straw
        vec3 c = mix(root, tip, vT) * vShade;
        if (vFlower.x >= 0.0 && vT > 0.82) c = vFlower * 0.8;
        c *= 0.75 + 0.55 * clamp(uSunDir.y, 0.0, 1.0);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);
  let radius = 30;
  return {
    configure(r) {
      radius = Math.min(r, GRID * SPACING / 2 - SPACING); uniforms.uRadius.value = radius; mesh.visible = r > 0;
      geo.instanceCount = within(radius + SPACING);
    },
    get count() { return mesh.visible ? geo.instanceCount : 0; },
    update(px, pz, t) { uniforms.uCenter.value.set(px, pz); uniforms.uTime.value = t; },
    /** where no grass grows: {data: Uint8Array (255 = none), w, h, x0, z0, res (m per texel)} */
    setMask(m) {
      if (!m) return;
      const tex = new THREE.DataTexture(m.data, m.w, m.h, THREE.RedFormat, THREE.UnsignedByteType);
      tex.magFilter = tex.minFilter = THREE.NearestFilter;
      tex.needsUpdate = true;
      uniforms.uMask.value = tex;
      uniforms.uMaskExt.value.set(m.x0, m.z0, m.w * m.res, m.h * m.res);
    },
  };
}
