// The look: one full-screen pass after the scene. Tone mapping, then a grade towards a cool, muted northern palette:
// less saturation, blue-grey shadows, warm highlights, a little contrast and a soft vignette. Off on the lowest level.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const Grade = {
  uniforms: { tDiffuse: { value: null }, uSat: { value: 0.72 }, uContrast: { value: 1.08 }, uVignette: { value: 0.28 },
              uShadow: { value: new THREE.Vector3(0.92, 0.97, 1.06) }, uLight: { value: new THREE.Vector3(1.05, 1.0, 0.92) },
              uSun: { value: new THREE.Vector3(0.5, 0.5, 0) }, uRays: { value: 0.0 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uSat, uContrast, uVignette, uRays; uniform vec3 uShadow, uLight, uSun; varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // light shafts: march towards the sun on screen and gather the bright sky between leaves and clouds
      if (uRays > 0.0 && uSun.z > 0.0) {
        vec2 d = (uSun.xy - vUv) / 20.0; vec2 p = vUv; float acc = 0.0, w = 1.0;
        for (int i = 0; i < 20; i++) { p += d; vec3 s = texture2D(tDiffuse, p).rgb; acc += smoothstep(0.72, 1.0, dot(s, vec3(0.33))) * w; w *= 0.93; }
        float fall = 1.0 - smoothstep(0.0, 0.75, length(uSun.xy - vUv));
        c += vec3(1.0, 0.92, 0.78) * acc * 0.06 * fall * uRays * uSun.z;
      }
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);
      c = mix(c * uShadow, c * uLight, smoothstep(0.05, 0.6, l));
      c = (c - 0.18) * uContrast + 0.18;
      vec2 v = vUv - 0.5; c *= 1.0 - uVignette * dot(v, v) * 2.2;
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

export function createGrade(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const output = new OutputPass();          // tone mapping and sRGB, then the grade on display colours
  composer.addPass(output);
  const grade = new ShaderPass(Grade);
  composer.addPass(grade);
  let on = true;
  const sp = new THREE.Vector3();
  return {
    // where the sun is on screen, and how much it shows (0 behind the camera)
    setSun(sunDir, rays) {
      sp.copy(sunDir).multiplyScalar(1000).add(camera.position).project(camera);
      const facing = camera.getWorldDirection(new THREE.Vector3()).dot(sunDir);
      grade.uniforms.uSun.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5, Math.max(0, facing));
      grade.uniforms.uRays.value = rays;
    },
    setOn(v) { on = v; },
    setSize(w, h) { composer.setSize(w, h); },
    setPixelRatio(r) { composer.setPixelRatio(r); },
    render() { if (on) composer.render(); else renderer.render(scene, camera); },
  };
}
