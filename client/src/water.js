// Water: the sea and the rivers at sea level. One plane, its own shader: colour by depth (read from the baked
// ground), clear and lighter in the shallows, foam on the shore, small waves from layered noise, the sky reflected
// by angle (Fresnel) and the sun's glitter. No second render of the scene: cheap enough for an integrated GPU.

import * as THREE from 'three';

export function createWater(ground, sky, scene) {
  const [x0, z0, x1, z1] = ground.meta.extent;
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uHeight: { value: null }, uExt: { value: new THREE.Vector4(x0, z0, x1 - x0, z1 - z0) },
    uSize: { value: new THREE.Vector2(ground.meta.nx, ground.meta.nz) }, uLevel: { value: ground.meta.sea },
    uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(0xffe2bc) },
    uZenith: { value: new THREE.Color(0x4a6c96) }, uHorizon: { value: new THREE.Color(0xa7b4c0) },
  }]);
  uniforms.uHeight.value = ground.heightTex;
  const mat = new THREE.ShaderMaterial({
    uniforms, fog: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>
      varying vec3 vWP;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform sampler2D uHeight; uniform vec4 uExt; uniform vec2 uSize; uniform float uLevel, uTime;
      uniform vec3 uSunDir, uSunColor, uZenith, uHorizon;
      varying vec3 vWP;
      float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
      float waves(vec2 p) {
        return vn(p * 0.22 + vec2(uTime * 0.10, uTime * 0.04)) * 0.6 + vn(p * 0.6 - vec2(uTime * 0.16, -uTime * 0.11)) * 0.4;
      }
      float ground(vec2 xz) {
        vec2 f = clamp((xz - uExt.xy) / uExt.zw, 0.0, 1.0) * (uSize - 1.0);
        vec2 i = floor(f), t = f - i;
        float a = texture2D(uHeight, (i + 0.5) / uSize).r, b = texture2D(uHeight, (i + vec2(1.5, 0.5)) / uSize).r;
        float c = texture2D(uHeight, (i + vec2(0.5, 1.5)) / uSize).r, d = texture2D(uHeight, (i + 1.5) / uSize).r;
        return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
      }
      void main() {
        bool inside = vWP.x > uExt.x && vWP.z > uExt.y && vWP.x < uExt.x + uExt.z && vWP.z < uExt.y + uExt.w;
        float depth = inside ? uLevel - ground(vWP.xz) : 30.0;
        if (depth < 0.0) discard;
        // the surface: a normal from the slope of the wave field
        float e = 0.35, w0 = waves(vWP.xz);
        vec3 n = normalize(vec3(w0 - waves(vWP.xz + vec2(e, 0.0)), 1.8, w0 - waves(vWP.xz + vec2(0.0, e))));
        vec3 v = normalize(cameraPosition - vWP);
        float fres = 0.03 + 0.62 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
        vec3 r = reflect(-v, n);
        vec3 skyc = mix(uHorizon, uZenith, pow(clamp(r.y, 0.0, 1.0), 0.6)) * 0.72;
        vec3 deep = vec3(0.02, 0.06, 0.08), shallow = vec3(0.12, 0.22, 0.20);
        vec3 body = mix(shallow, deep, smoothstep(0.0, 6.0, depth));
        vec3 c = mix(body, skyc, fres);
        c += uSunColor * pow(max(dot(r, normalize(uSunDir)), 0.0), 400.0) * 1.6;          // glitter
        float foam = (1.0 - smoothstep(0.0, 0.45, depth)) * smoothstep(0.35, 0.75, vn(vWP.xz * 1.7 + uTime * 0.3) + 0.3);
        c = mix(c, vec3(0.85, 0.88, 0.88), foam * 0.7);
        float alpha = clamp(smoothstep(0.0, 1.2, depth) * 0.85 + fres * 0.3 + foam * 0.5, 0.0, 0.97);
        gl_FragColor = vec4(c, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(9000, 7000, 1, 1), mat);
  mesh.rotation.x = -Math.PI / 2; mesh.position.set((x0 + x1) / 2, ground.meta.sea, (z0 + z1) / 2);
  mesh.renderOrder = 1;
  scene.add(mesh);
  return {
    update(t, sunDir) { uniforms.uTime.value = t; if (sunDir) uniforms.uSunDir.value.copy(sunDir); },
  };
}
