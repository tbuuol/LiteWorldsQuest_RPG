// Sky, sun, light and haze: a physical sky (three's Sky), a sun that casts soft shadows around the player, light
// from the sky's colour, and height-aware fog that blends the distance into the sky.

import * as THREE from 'three';

// the sky: a dome with the zenith's blue, a bright horizon in the fog's colour (so the distance melts into it),
// the sun's disc and its glow. Its own shader, so the colours are ours and not what a physical model makes of them.
function skyDome(fogColor) {
  const u = {
    zenith: { value: new THREE.Color(0x4a6c96) }, horizon: { value: fogColor.clone() }, below: { value: fogColor.clone().multiplyScalar(0.85) },
    sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color(0xffe6c4) }, uTime: { value: 0 },
  };
  const m = new THREE.ShaderMaterial({
    uniforms: u, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `uniform vec3 zenith, horizon, below, sunDir, sunColor; uniform float uTime; varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p) { float a = 0.0, w = 0.5; for (int i = 0; i < 5; i++) { a += w * vnoise(p); p = p * 2.03 + 17.1; w *= 0.5; } return a; }
      void main() {
        vec3 d = normalize(vDir); float h = d.y;
        vec3 c = h > 0.0 ? mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(horizon, below, clamp(-h * 6.0, 0.0, 1.0));
        vec3 sd = normalize(sunDir);
        float s = max(dot(d, sd), 0.0);
        c += sunColor * (pow(s, 1200.0) * 8.0 + pow(s, 32.0) * 0.25 + pow(s, 5.0) * 0.10);
        // clouds: a layer seen from below, drifting; lit on the sun's side, grey underneath, thinning to the horizon
        if (h > 0.0) {
          vec2 uv = d.xz / (h + 0.12) * 1.6 + vec2(uTime * 0.004, uTime * 0.0015);
          float n = fbm(uv) * 0.7 + fbm(uv * 2.7 + 3.0) * 0.3;
          float cover = smoothstep(0.48, 0.78, n) * smoothstep(0.0, 0.18, h);
          float lit = 0.55 + 0.45 * pow(s, 3.0) + 0.25 * smoothstep(0.55, 0.9, n);
          vec3 cloud = mix(vec3(0.42, 0.45, 0.50), mix(vec3(0.93, 0.92, 0.90), sunColor, 0.25), lit);
          c = mix(c, cloud, cover * 0.92);
        }
        // haze over the horizon
        c = mix(c, horizon, smoothstep(0.18, 0.0, abs(h)) * 0.55);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), m);
  mesh.frustumCulled = false; mesh.renderOrder = -1;
  return { mesh, u };
}

export function createSky(scene, renderer) {
  const fogColor = new THREE.Color(0xa7b4c0);   // a grey-blue haze: far hills turn blue-grey, as in the north
  const sky = skyDome(fogColor);
  scene.add(sky.mesh);
  const hemi = new THREE.HemisphereLight(0xb8c8dc, 0x4e4a3a, 1.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe2bc, 3.9);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);

  scene.fog = new THREE.FogExp2(fogColor, 0.0016);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.72;

  const dir = new THREE.Vector3();
  let elevation = 38, azimuth = 210, shadowSize = 0, baseFog = 0.0016;

  function setSun(elev, azim) {
    elevation = elev; azimuth = azim;
    const phi = THREE.MathUtils.degToRad(90 - elev), theta = THREE.MathUtils.degToRad(azim);
    dir.setFromSphericalCoords(1, phi, theta);
    sky.u.sunDir.value.copy(dir);
    const low = THREE.MathUtils.clamp(elev / 25, 0, 1);
    sun.color.setHSL(0.09, 0.55 * (1 - low) + 0.2, 0.62 + 0.25 * low);
    sun.intensity = 0.8 + 2.8 * low;
    hemi.intensity = 0.7 + 0.9 * low;
  }
  setSun(elevation, azimuth);

  return {
    setSun,
    // shadows: 0 off, else the map size; the sun's box follows the player
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
    tick(t) { sky.u.uTime.value = t; },
    follow(p) {
      // the haze lies in the valleys: from up high one sees far
      scene.fog.density = baseFog * (1 - 0.65 * THREE.MathUtils.smoothstep(p.y, 40, 260));
      sun.target.position.set(p.x, p.y, p.z);
      sun.position.set(p.x + dir.x * 200, p.y + dir.y * 200, p.z + dir.z * 200);
      sky.mesh.position.set(p.x, p.y, p.z);
      // the fog takes the sky's colour near the horizon in the direction one looks is too costly; one tone fits
    },
  };
}
