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
    const rows = [[0, 0.028], [0.55 * tall, 0.018], [tall, 0.0]];
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
  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) cells.push([(i - GRID / 2) * SPACING, (j - GRID / 2) * SPACING]);
  cells.sort((a, b) => (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]));
  const offsets = new Float32Array(cells.flat());
  const within = r => { let lo = 0, hi = cells.length; while (lo < hi) { const m = (lo + hi) >> 1; if (Math.hypot(...cells[m]) <= r) lo = m + 1; else hi = m; } return lo; };
  geo.setAttribute('offset', new THREE.InstancedBufferAttribute(offsets, 2));
  geo.instanceCount = GRID * GRID;

  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uHeight: { value: ground.heightTex }, uWeights: { value: ground.weights },
    uExt: { value: new THREE.Vector4(x0, z0, x1 - x0, z1 - z0) }, uSize: { value: new THREE.Vector2(ground.meta.nx, ground.meta.nz) },
    uCenter: { value: new THREE.Vector2() }, uRadius: { value: 30 }, uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.4).normalize() }, uSpacing: { value: SPACING },
  }]);
  uniforms.uHeight.value = ground.heightTex; uniforms.uWeights.value = ground.weights;
  const mat = new THREE.ShaderMaterial({
    uniforms, fog: true, side: THREE.DoubleSide,
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>
      attribute vec2 offset;
      uniform sampler2D uHeight, uWeights; uniform vec4 uExt; uniform vec2 uSize, uCenter; uniform float uRadius, uTime, uSpacing;
      varying float vT; varying float vShade; varying float vHue;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float heightAt(vec2 xz) {   // bilinear by hand: float textures need not be filterable
        vec2 f = (xz - uExt.xy) / uExt.zw * (uSize - 1.0);
        vec2 i = floor(f), t = f - i;
        float a = texture2D(uHeight, (i + 0.5) / uSize).r, b = texture2D(uHeight, (i + vec2(1.5, 0.5)) / uSize).r;
        float c = texture2D(uHeight, (i + vec2(0.5, 1.5)) / uSize).r, d = texture2D(uHeight, (i + 1.5) / uSize).r;
        return t.x >= t.y ? a + (b - a) * t.x + (d - b) * t.y : a + (d - c) * t.x + (c - a) * t.y;
      }
      void main() {
        // the grid stays put in the world: snapped to its spacing, only the window moves with the player
        vec2 cell = floor(uCenter / uSpacing) * uSpacing + offset;
        float h1 = hash(cell), h2 = hash(cell + 17.3), h3 = hash(cell + 41.9);
        vec2 xz = cell + (vec2(h1, h2) - 0.5) * uSpacing;
        float dist = length(xz - uCenter);
        vec4 w = texture2D(uWeights, (xz - uExt.xy) / uExt.zw);
        float grassy = w.r + w.g * 0.6;                    // grass, and some in the forest floor
        float keep = step(h3, grassy * 1.15 - 0.15) * (1.0 - smoothstep(uRadius * 0.75, uRadius, dist));
        float size = (0.32 + 0.38 * h1) * keep * (0.6 + 0.4 * grassy);
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
        vShade = 0.75 + 0.25 * h2;
        vec4 mvPosition = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 uSunDir; varying float vT; varying float vShade; varying float vHue;
      void main() {
        vec3 root = vec3(0.045, 0.07, 0.02), tip = mix(vec3(0.20, 0.27, 0.08), vec3(0.30, 0.30, 0.11), vHue * 0.7);
        vec3 c = mix(root, tip, vT) * vShade;
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
  };
}
