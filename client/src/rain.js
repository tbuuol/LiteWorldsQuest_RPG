// Rain around the player: streaks in a box that tiles the world (so walking does not drag the rain along), falling
// at the drops' speed and blown by the one wind (wind.js): the slant of each streak is its fall speed against the
// wind where it falls, so rain leans with the same gusts that bend the grass and the trees. Drizzle: fine, slow,
// short drops; rain and heavy rain: more, faster, longer streaks; a storm drives them almost sideways in the gusts.
// Below freezing the same box is snow: soft round flakes, falling slowly, swaying, carried far by the wind.
// Nothing falls through things: every few seconds the land around the player is drawn once from above into a small
// height map (roofs, crowns, rocks, the ground); a drop below what is above it is not drawn. The same map tells
// whether the player stands under cover (for the sound).

import * as THREE from 'three';
import { wind } from './wind.js';

const OCC = 256, OSIZE = 64, OTOP = 70, ODEPTH = 160;   // the cover map: texels, metres across, camera height, depth
const MAX = 26000, BOX = 22, HEIGHT = 16;   // close around the player; the distance is the rain haze (weather fog)

export function createRain(scene, renderer) {
  // the cover map: depth from straight above, packed into colour (so it can also be read back)
  const occRT = new THREE.WebGLRenderTarget(OCC, OCC, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
  const occCam = new THREE.OrthographicCamera(-OSIZE / 2, OSIZE / 2, OSIZE / 2, -OSIZE / 2, 0.5, ODEPTH);
  occCam.up.set(0, 0, -1);
  const occMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  const occPix = new Uint8Array(OCC * OCC * 4);
  let occAt = { x: 1e9, z: 1e9, t: -1e9 }, occTop = 0, occCx = 0, occCz = 0;
  const g = new THREE.InstancedBufferGeometry();
  // one quad: x across (-1..1), y along the streak (0 head .. 1 tail)
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3));
  g.setIndex([0, 1, 2, 1, 3, 2]);
  const seed = new Float32Array(MAX * 3);
  for (let i = 0; i < MAX * 3; i++) seed[i] = Math.random();
  g.setAttribute('seed', new THREE.InstancedBufferAttribute(seed, 3));
  g.instanceCount = 0;
  const u = {
    uT: { value: 0 }, uFall: { value: 8 }, uLen: { value: 0.5 }, uWidth: { value: 0.012 }, uDrift: { value: 5 },
    uOcc: { value: occRT.texture }, uOccC: { value: new THREE.Vector3(1e9, 0, 1e9) },
    uCol: { value: new THREE.Color(0.6, 0.65, 0.7) }, uAlpha: { value: 0.3 }, uSnow: { value: 0 }, ...wind.uniforms, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
  };
  const m = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>
      #include <packing>
      attribute vec3 seed;
      uniform sampler2D uOcc; uniform vec3 uOccC;   // the cover map's centre x, z and its camera's height
      uniform float uT, uFall, uLen, uWidth, uDrift, uSnow;
      ${wind.glsl}
      varying float vA; varying vec2 vQ;
      void main() {
        // the mean fall of all drops (keeps the box wrapping steady), and the slant from the gust where this one is
        vec2 drift = uWindDir * uDrift;
        vec3 p = vec3(seed.x * ${BOX}.0, seed.y * ${HEIGHT}.0, seed.z * ${BOX}.0) + vec3(drift.x, -uFall, drift.y) * (uT + seed.x * 7.0);
        p.xz = cameraPosition.xz + mod(p.xz - cameraPosition.xz + ${BOX}.0 * 0.5, ${BOX}.0) - ${BOX}.0 * 0.5;
        float y0 = cameraPosition.y - 6.0;
        p.y = y0 + mod(p.y - y0, ${HEIGHT}.0);
        // flakes sway and tumble on their way down
        p.xz += uSnow * vec2(sin(uT * (0.9 + seed.y) + seed.z * 40.0), cos(uT * (0.7 + seed.x) + seed.y * 40.0)) * 0.35;
        vec2 side2 = uWindDir * uDrift * (0.6 + windGust(p.xz) * 0.6);
        vec3 vel = vec3(side2.x, -uFall, side2.y);
        vec3 along = normalize(vel);
        vec3 toCam = normalize(cameraPosition - p);
        vec3 side = normalize(cross(along, toCam));
        float dist = length(cameraPosition - p);
        // about a pixel or two wide at any distance (a drop is millimetres; its streak is the eye's motion blur)
        vec3 q = p - along * uLen * position.y + side * position.x * (uWidth + dist * 0.0011);
        if (uSnow > 0.5) {   // a flake: a small round disc facing the camera
          vec3 up2 = normalize(cross(toCam, side));
          float r = (uWidth + dist * 0.0012) * (0.6 + 0.8 * seed.y);
          q = p + side * position.x * r + up2 * (position.y * 2.0 - 1.0) * r;
        }
        vQ = vec2(position.x, position.y * 2.0 - 1.0);
        // under a roof, a crown, a rock (or below the ground): not drawn
        vec2 ouv = vec2((p.x - uOccC.x) / ${OSIZE}.0 + 0.5, (uOccC.z - p.z) / ${OSIZE}.0 + 0.5);
        float covered = 0.0;
        if (ouv.x > 0.0 && ouv.y > 0.0 && ouv.x < 1.0 && ouv.y < 1.0) {
          float od = unpackRGBAToDepth(texture2D(uOcc, ouv));
          float top = uOccC.y - (0.5 + od * ${ODEPTH - 0.5});
          covered = step(p.y, top - 0.05) * step(od, 0.999);
        }
        vA = (1.0 - covered) * (uSnow > 0.5 ? 1.0 : 1.0 - position.y * 0.8) * smoothstep(${BOX}.0 * 0.5, ${BOX}.0 * 0.3, length(p.xz - cameraPosition.xz)) * smoothstep(1.0, 3.0, dist);
        vec4 mvPosition = viewMatrix * vec4(q, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 uCol; uniform float uAlpha, uSnow; varying float vA; varying vec2 vQ;
      void main() {
        float a = uSnow > 0.5 ? smoothstep(1.0, 0.3, length(vQ)) : 1.0;
        gl_FragColor = vec4(uCol, uAlpha * vA * a);
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false; mesh.renderOrder = 5;
  scene.add(mesh);
  let density = 1;
  // draw the cover map around (x, y, z): only solid things, with one plain depth material (no sky, grass, water,
  // impostors, rain: those are custom shaders), shadows untouched
  function drawCover(x, y, z, t) {
    const texel = OSIZE / OCC;
    occCx = Math.round(x / texel) * texel; occCz = Math.round(z / texel) * texel; occTop = y + OTOP;
    occCam.position.set(occCx, occTop, occCz); occCam.lookAt(occCx, y, occCz); occCam.updateMatrixWorld();
    const hidden = [];
    scene.traverse(o => { if (o.visible && (o.isPoints || o.isSprite || (o.material && o.material.isShaderMaterial))) { o.visible = false; hidden.push(o); } });
    const old = renderer.getRenderTarget(), oldOverride = scene.overrideMaterial, oldColor = new THREE.Color(), oldAlpha = renderer.getClearAlpha();
    const sm = renderer.shadowMap.needsUpdate, fog = scene.fog, bg = scene.background;
    renderer.getClearColor(oldColor);
    renderer.shadowMap.needsUpdate = false; scene.fog = null; scene.background = null;
    scene.overrideMaterial = occMat;
    renderer.setRenderTarget(occRT); renderer.setClearColor(0xffffff, 1); renderer.clear();
    renderer.render(scene, occCam);
    renderer.readRenderTargetPixels(occRT, 0, 0, OCC, OCC, occPix);
    renderer.setRenderTarget(old); renderer.setClearColor(oldColor, oldAlpha);
    scene.overrideMaterial = oldOverride; scene.fog = fog; scene.background = bg; renderer.shadowMap.needsUpdate = sm;
    for (const o of hidden) o.visible = true;
    u.uOccC.value.set(occCx, occTop, occCz);
    occAt = { x, z, t };
  }
  // the height of what is above (x, z) by the cover map (-Infinity: nothing / outside)
  function coverAt(x, z) {
    const i = Math.floor((x - occCx) / OSIZE * OCC + OCC / 2), j = Math.floor((occCz - z) / OSIZE * OCC + OCC / 2);
    if (i < 0 || j < 0 || i >= OCC || j >= OCC) return -Infinity;
    const k = (j * OCC + i) * 4, P = occPix;
    // three's RGBA depth packing (packDepthToRGBA / unpackRGBAToDepth): r is the coarsest byte
    const d = P[k] / 256 + P[k + 1] / 65536 + P[k + 2] / 16777216 + P[k + 3] / 255 / 16777216;
    if (d >= 0.999) return -Infinity;
    return occTop - (0.5 + d * (ODEPTH - 0.5));
  }
  return {
    /** is (x, y, z) under something (roof, crown, rock)? by the last cover map */
    covered(x, y, z) { return coverAt(x, z) > y + 0.3; },
    /** quality: share of the drops drawn (0 .. 1) */
    configure(d) { density = d; },
    // weather: from weather.js; light: the sky's light (rain shines in the light there is); flash: lightning 0..1
    // pos: the player (the cover map follows)
    update(t, weather, light, flash = 0, pos = null) {
      const r = weather.rain;
      if (pos && r > 0.01 && (Math.hypot(pos.x - occAt.x, pos.z - occAt.z) > 4 || t - occAt.t > 2.5)) drawCover(pos.x, pos.y, pos.z, t);
      g.instanceCount = Math.round(MAX * density * (weather.drizzle ? 0.5 : Math.min(1, 0.25 + r)) * (r > 0.01 ? 1 : 0));
      mesh.visible = g.instanceCount > 0;
      if (!mesh.visible) return;
      u.uT.value = t % 1000;
      const snow = weather.snow;
      u.uSnow.value = snow ? 1 : 0;
      if (snow) {   // flakes: slow, light, blown far
        u.uFall.value = 1.0 + 0.6 * r; u.uLen.value = 0; u.uWidth.value = 0.012 + 0.01 * r;
        u.uDrift.value = 0.6 + 7 * weather.wind.base; u.uAlpha.value = 0.75;
        u.uCol.value.copy(light.ambient).multiplyScalar(1.8).add(new THREE.Color(0.32, 0.33, 0.36));
        return;
      }
      u.uFall.value = weather.drizzle ? 3 : 7 + 3 * r;
      u.uLen.value = weather.drizzle ? 0.06 : 0.16 + 0.22 * r;
      u.uWidth.value = weather.drizzle ? 0.0012 : 0.0018 + 0.0012 * r;
      u.uDrift.value = 1 + 6 * weather.wind.base;   // m/s sideways at the mean wind; gusts add (see windGust)
      u.uAlpha.value = weather.drizzle ? 0.35 : 0.4 + 0.25 * r;
      u.uCol.value.copy(light.ambient).multiplyScalar(1.6).add(new THREE.Color(0.2, 0.21, 0.24)).addScalar(flash * 0.8);
    },
  };
}
