// One wind for the whole world. A gust field (a soft noise picture, stretched across the wind: gust fronts are wide
// and short) is pushed over the land in the wind's direction at the wind's speed. Everything that moves in the wind
// asks the same field at its own spot: the grass lies down in a wave that runs across the meadow, a moment later the
// same gust reaches the edge of the wood and the crowns lean, the ferns under them shiver.
//
// The field runs on the world clock (seconds since 1970), so every player sees the same gust at the same time. Later
// the house can set direction and strength (weather) through set().
//
// In a shader: put wind.uniforms into the material's uniforms, wind.glsl before main(), then
//   windGust(xz)                       how strong the wind is there now (about 0.25 calm .. 1.15 in a gust)
//   windOffset(root, world, bend, flutter)   how far a point of a plant rooted at root moves (world units)
// Built-in materials get it with wind.patch(material, bend, flutter).

import * as THREE from 'three';

const N = 128;                 // the gust picture, tiling
const ALONG = 120, ACROSS = 360, ALONG2 = 40, ACROSS2 = 90;   // metres one tile covers: the big and the small gusts

let gustData = null;
// tiling value noise, three octaves, 0..255
function gustTexture() {
  const data = new Uint8Array(N * N);
  const lat = (p, s) => { const r = new Float32Array(p * p); let x = s; for (let i = 0; i < r.length; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; r[i] = x / 0x7fffffff; } return r; };
  const oct = [[8, 0.6, lat(8, 7)], [16, 0.3, lat(16, 99)], [32, 0.1, lat(32, 4242)]];
  const sm = t => t * t * (3 - 2 * t);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0;
    for (const [p, w, L] of oct) {
      const fx = x / N * p, fy = y / N * p, ix = Math.floor(fx), iy = Math.floor(fy), tx = sm(fx - ix), ty = sm(fy - iy);
      const a = L[(iy % p) * p + ix % p], b = L[(iy % p) * p + (ix + 1) % p], c = L[((iy + 1) % p) * p + ix % p], d = L[((iy + 1) % p) * p + (ix + 1) % p];
      v += w * ((a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty);
    }
    data[y * N + x] = Math.round(v * 255);
  }
  gustData = data;
  const t = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

const uniforms = {
  tWindGust: { value: gustTexture() },
  uWindDir: { value: new THREE.Vector2(Math.cos(0.6), Math.sin(0.6)) },   // where it blows to (x, z)
  uWindTime: { value: 0 },      // seconds, wrapped (for the quick motions)
  uWindShift: { value: 0 },     // how far the gust field has moved along the wind, wrapped to its tile
  uWindBase: { value: 0.25 },   // the calm between gusts
  uWindGust: { value: 0.9 },    // what a gust adds
};
let speed = 8;                  // m/s the gusts travel

const glsl = /* glsl */`
  uniform sampler2D tWindGust; uniform vec2 uWindDir; uniform float uWindTime, uWindShift, uWindBase, uWindGust;
  float windGust(vec2 xz) {
    vec2 q = vec2(dot(xz, uWindDir) - uWindShift, dot(xz, vec2(-uWindDir.y, uWindDir.x)));
    float g = texture2D(tWindGust, q / vec2(${ALONG}.0, ${ACROSS}.0)).r * 0.65
            + texture2D(tWindGust, q / vec2(${ALONG2}.0, ${ACROSS2}.0) + vec2(0.37, 0.71)).r * 0.35;
    return uWindBase + uWindGust * smoothstep(0.4, 0.74, g);
  }
  // a point of a plant rooted at root (world): it leans with the gust there, rocks around that lean, and leaves
  // flutter (flutter: metres of the quick motion)
  vec3 windOffset(vec3 root, vec3 world, float bend, float flutter) {
    float g = windGust(root.xz);
    float h = max(world.y - root.y, 0.0);
    float ph = dot(root.xz, vec2(0.37, 0.91));
    float sway = g * (1.0 + 0.22 * sin(uWindTime * 1.6 + ph)) + 0.05 * sin(uWindTime * 0.8 + ph * 1.3);
    vec2 side = vec2(-uWindDir.y, uWindDir.x) * (0.18 * g * sin(uWindTime * 1.1 + ph * 2.1));
    vec2 d = (uWindDir * sway + side) * bend * h * h;
    vec3 off = vec3(d.x, -0.5 * dot(d, d) / max(h, 0.5), d.y);   // bending, not stretching: the tip drops a little
    float f = flutter * (0.3 + g) * sin(uWindTime * 7.0 + dot(world, vec3(1.7, 2.3, 1.1)));
    return off + vec3(uWindDir.x * f, 0.5 * f, uWindDir.y * f);
  }
`;

// a built-in material (standard, basic, depth, ...) moved by the wind; replaces any earlier vertex trick of its own
function patch(mat, bend, flutter = 0) {
  const b = bend.toFixed(5), f = flutter.toFixed(4);
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = glsl + sh.vertexShader.replace('#include <project_vertex>', `
      vec4 mvPosition = vec4(transformed, 1.0);
      vec3 windRoot = modelMatrix[3].xyz;
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
        windRoot = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
      #endif
      mvPosition = modelMatrix * mvPosition;
      mvPosition.xyz += windOffset(windRoot, mvPosition.xyz, ${b}, ${f});
      mvPosition = viewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;`);
  };
  mat.customProgramCacheKey = () => `wind:${b}:${f}`;
  mat.needsUpdate = true;
  return mat;
}

// the gust picture read like the GPU reads it (bilinear, repeating), 0..1
function sample(u, v) {
  const x = u * N - 0.5, y = v * N - 0.5, ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const at = (i, j) => gustData[(((j % N) + N) % N) * N + (((i % N) + N) % N)] / 255;
  return (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy) + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
}
const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export const wind = {
  uniforms, glsl, patch,
  /** windGust(xz) of the shaders, on the CPU (for the sound of the wind where the player stands) */
  gustAt(x, z) {
    const d = uniforms.uWindDir.value, qx = x * d.x + z * d.y - uniforms.uWindShift.value, qy = -x * d.y + z * d.x;
    const g = sample(qx / ALONG, qy / ACROSS) * 0.65 + sample(qx / ALONG2 + 0.37, qy / ACROSS2 + 0.71) * 0.35;
    return uniforms.uWindBase.value + uniforms.uWindGust.value * sm(0.4, 0.74, g);
  },
  // t: the world clock in seconds (Date.now() / 1000; the film's own clock in film mode)
  update(t) {
    uniforms.uWindTime.value = t % 600;
    uniforms.uWindShift.value = (t * speed) % ALONG;
  },
  // weather: direction (radians, where it blows to), calm strength, gust strength, gust speed (m/s)
  set({ dir, base, gust, speed: s } = {}) {
    if (dir !== undefined) uniforms.uWindDir.value.set(Math.cos(dir), Math.sin(dir));
    if (base !== undefined) uniforms.uWindBase.value = base;
    if (gust !== undefined) uniforms.uWindGust.value = gust;
    if (s !== undefined) speed = s;
  },
};
