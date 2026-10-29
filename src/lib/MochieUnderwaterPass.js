// ============================================================================
// Mochie's Underwater Shader — MochieUnderwaterPass.js
// Custom post-processing pass for seamless above/below water camera transitions,
// including a partial split-screen meniscus line when the camera lens
// intersects the Gerstner wave surface, underwater depth fog, world-projected
// 3D Voronoi caustics, and distance scattering blur.
// ============================================================================

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import UnderwaterFragGlsl from './shaders/UnderwaterFrag.glsl';
import { resolveMochieShaderIncludes } from './MochieWaterMaterial.js';
import { MOCHIE_WATER_PRESETS } from './mochieWaterMath';

const UnderwaterVertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const _camForward = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _camUp = new THREE.Vector3();
const _camQuat = new THREE.Quaternion();

export class MochieUnderwaterPass extends Pass {
  constructor(waterMesh, camera, options = {}) {
    super();
    this.waterMesh = waterMesh;
    this.camera = camera;

    const preset = options.preset || MOCHIE_WATER_PRESETS.emeraldPier;
    const waterUniforms = waterMesh.waterMaterial.uniforms;

    // Share wave, caustics, and depth uniforms directly with MochieWaterMaterial
    // so the lens meniscus line & underwater caustics stay 100% synchronized.
    this.uniforms = {
      tDiffuse: { value: null },
      uTime: waterUniforms.uTime,
      uWaterLevel: waterUniforms.uWaterLevel,
      uCameraNear: waterUniforms.uCameraNear,
      uCameraFar: waterUniforms.uCameraFar,
      uResolution: waterUniforms.uResolution,
      uInverseProjectionMatrix: waterUniforms.uInverseProjectionMatrix,
      uCameraMatrixWorld: waterUniforms.uCameraMatrixWorld,
      uSunDirection: waterUniforms.uSunDirection,
      uSunColor: waterUniforms.uSunColor,
      uSunIntensity: waterUniforms.uSunIntensity,
      uDepthTexture: waterUniforms.uDepthTexture,
      uHasDepthTexture: waterUniforms.uHasDepthTexture,
      uSSSTint: waterUniforms.uSSSTint,

      // Caustics shared uniforms
      uCausticsToggle: waterUniforms.uCausticsToggle,
      uCausticsColor: waterUniforms.uCausticsColor,
      uCausticsOpacity: waterUniforms.uCausticsOpacity,
      uCausticsScale: waterUniforms.uCausticsScale,
      uCausticsSpeed: waterUniforms.uCausticsSpeed,
      uCausticsPower: waterUniforms.uCausticsPower,
      uCausticsFade: waterUniforms.uCausticsFade,
      uCausticsDisp: waterUniforms.uCausticsDisp,
      uCausticsDistortion: waterUniforms.uCausticsDistortion,
      uCausticsSurfaceFade: waterUniforms.uCausticsSurfaceFade,

      // Gerstner wave shared uniforms
      uWavesToggle: waterUniforms.uWavesToggle,
      uWaveGlobalAmp: waterUniforms.uWaveGlobalAmp,
      uWaveGlobalSpeed: waterUniforms.uWaveGlobalSpeed,
      uWaveGlobalScale: waterUniforms.uWaveGlobalScale,
      uWaveNormalStr: waterUniforms.uWaveNormalStr,
      uWaveWarpStrength: waterUniforms.uWaveWarpStrength,
      uWaveWarpScale: waterUniforms.uWaveWarpScale,
      uWaveWarpSpeed: waterUniforms.uWaveWarpSpeed,
      uWaveEnabled: waterUniforms.uWaveEnabled,
      uWave0: waterUniforms.uWave0,
      uWave1: waterUniforms.uWave1,
      uWave2: waterUniforms.uWave2,
      uWave3: waterUniforms.uWave3,
      uWavePhaseOffsets: waterUniforms.uWavePhaseOffsets,

      // Underwater pass specific uniforms
      uUnderwaterEnabled: { value: preset.underwaterEnabled ? 1.0 : 0.0 },
      uCameraPos: { value: new THREE.Vector3() },
      uCameraForward: { value: new THREE.Vector3(0, 0, -1) },
      uCameraRight: { value: new THREE.Vector3(1, 0, 0) },
      uCameraUp: { value: new THREE.Vector3(0, 1, 0) },
      uCameraFovRad: { value: THREE.MathUtils.degToRad(camera.fov || 50) },
      uUnderwaterFogColor: { value: new THREE.Color(preset.underwaterFogColor) },
      uUnderwaterFogDensity: { value: preset.underwaterFogDensity },
      uUnderwaterCausticsStr: { value: preset.underwaterCausticsStr },
      uUnderwaterDistortion: { value: preset.underwaterDistortion },
      uUnderwaterBlurStr: { value: preset.underwaterBlurStr },
      uMeniscusWidth: { value: preset.meniscusWidth },
      uMeniscusColor: { value: new THREE.Color(preset.meniscusColor) },
    };

    this.material = new THREE.ShaderMaterial({
      name: 'MochieUnderwaterPostShader',
      uniforms: this.uniforms,
      vertexShader: UnderwaterVertexShader,
      fragmentShader: resolveMochieShaderIncludes(UnderwaterFragGlsl),
      depthWrite: false,
      depthTest: false,
    });

    this.fsQuad = new FullScreenQuad(this.material);
  }

  applyPreset(preset) {
    if (!preset) return;
    this.uniforms.uUnderwaterEnabled.value = preset.underwaterEnabled ? 1.0 : 0.0;
    this.uniforms.uUnderwaterFogColor.value.set(preset.underwaterFogColor);
    this.uniforms.uUnderwaterFogDensity.value = preset.underwaterFogDensity;
    this.uniforms.uUnderwaterCausticsStr.value = preset.underwaterCausticsStr;
    this.uniforms.uUnderwaterDistortion.value = preset.underwaterDistortion;
    this.uniforms.uUnderwaterBlurStr.value = preset.underwaterBlurStr;
    this.uniforms.uMeniscusWidth.value = preset.meniscusWidth;
    this.uniforms.uMeniscusColor.value.set(preset.meniscusColor);
  }

  updateCameraUniforms() {
    const cam = this.camera;
    cam.getWorldPosition(this.uniforms.uCameraPos.value);
    cam.getWorldQuaternion(_camQuat);

    _camForward.set(0, 0, -1).applyQuaternion(_camQuat).normalize();
    _camRight.set(1, 0, 0).applyQuaternion(_camQuat).normalize();
    _camUp.set(0, 1, 0).applyQuaternion(_camQuat).normalize();

    this.uniforms.uCameraForward.value.copy(_camForward);
    this.uniforms.uCameraRight.value.copy(_camRight);
    this.uniforms.uCameraUp.value.copy(_camUp);
    this.uniforms.uCameraFovRad.value = THREE.MathUtils.degToRad(cam.fov || 50);
  }

  render(renderer, writeBuffer, readBuffer) {
    this.updateCameraUniforms();
    this.uniforms.tDiffuse.value = readBuffer.texture;

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
      this.fsQuad.render(renderer);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
      this.fsQuad.render(renderer);
    }
  }

  dispose() {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}
