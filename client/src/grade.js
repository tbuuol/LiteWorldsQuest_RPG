// The look: one full-screen pass after the scene. Tone mapping, then a grade towards a cool, muted northern palette:
// less saturation, blue-grey shadows, warm highlights, a little contrast and a soft vignette. Off on the lowest level.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const Grade = {
  uniforms: { tDiffuse: { value: null }, uSat: { value: 0.72 }, uContrast: { value: 1.08 }, uVignette: { value: 0.28 },
              uShadow: { value: new THREE.Vector3(0.92, 0.97, 1.06) }, uLight: { value: new THREE.Vector3(1.05, 1.0, 0.92) } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uSat, uContrast, uVignette; uniform vec3 uShadow, uLight; varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
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
  return {
    setOn(v) { on = v; },
    setSize(w, h) { composer.setSize(w, h); },
    setPixelRatio(r) { composer.setPixelRatio(r); },
    render() { if (on) composer.render(); else renderer.render(scene, camera); },
  };
}
