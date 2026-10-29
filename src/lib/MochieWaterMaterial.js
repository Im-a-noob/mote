// ============================================================================
// Mochie's Water Shader — MochieWaterMaterial.js
// Extends THREE.ShaderMaterial with all ported uniforms mapped to Mochie's
// Unity Material Inspector tabs (Surface, Normal Maps, Specular & Reflections,
// Refraction, Depth Fog & SSS, Foam, Caustics, Gerstner Waves).
// ============================================================================

import * as THREE from 'three';
import WaterDefinesGlsl from './shaders/WaterDefines.glsl';
import WaterFunctionsGlsl from './shaders/WaterFunctions.glsl';
import WaterVertGlsl from './shaders/WaterVert.glsl';
import WaterFragGlsl from './shaders/WaterFrag.glsl';
import UnderwaterFragGlsl from './shaders/UnderwaterFrag.glsl';
import { MOCHIE_WATER_PRESETS } from './mochieWaterMath';
import {
  createMochieNormalTexture,
  createMochieFlowTexture,
  createMochieNoiseTexture,
  createMochieFoamTexture,
} from './proceduralWaterTextures.js';

export function resolveMochieShaderIncludes(rawSource) {
  return rawSource
    .replace('#include "WaterDefines.glsl"', WaterDefinesGlsl)
    .replace('#include "WaterFunctions.glsl"', WaterFunctionsGlsl);
}

export const MOCHIE_SHADER_SOURCES = {
  'WaterDefines.glsl': WaterDefinesGlsl,
  'WaterFunctions.glsl': WaterFunctionsGlsl,
  'WaterVert.glsl': WaterVertGlsl,
  'WaterFrag.glsl': WaterFragGlsl,
  'UnderwaterFrag.glsl': UnderwaterFragGlsl,
};

export class MochieWaterMaterial extends THREE.ShaderMaterial {
  constructor(options = {}) {
    const preset = options.preset || MOCHIE_WATER_PRESETS.emeraldPier;

    const normalMap0 = options.normalMap0 || createMochieNormalTexture(256, 11, 5.2);
    const normalMap1 = options.normalMap1 || createMochieNormalTexture(256, 37, 4.6);
    const flowMap = options.flowMap || createMochieFlowTexture(128);
    const noiseTex = options.noiseTex || createMochieNoiseTexture(256);
    const foamTex = options.foamTex || createMochieFoamTexture(256);

    const w0 = preset.gerstner.waves[0];
    const w1 = preset.gerstner.waves[1];
    const w2 = preset.gerstner.waves[2];
    const w3 = preset.gerstner.waves[3];

    const uniforms = {
      // Time & Camera
      uTime: { value: 0.0 },
      uWaterLevel: { value: preset.gerstner.waterLevel },
      uCameraNear: { value: 0.1 },
      uCameraFar: { value: 300.0 },
      uResolution: { value: new THREE.Vector2(1440, 900) },
      uInverseProjectionMatrix: { value: new THREE.Matrix4() },
      uCameraMatrixWorld: { value: new THREE.Matrix4() },

      // Sun & Environment
      uSunDirection: { value: new THREE.Vector3(0.58, 0.52, -0.62).normalize() },
      uSunColor: { value: new THREE.Color('#fff7ed') },
      uSunIntensity: { value: 2.2 },
      uEnvMap: { value: options.envMap || null },
      uHasEnvMap: { value: options.envMap ? 1.0 : 0.0 },

      // Pre-Pass Grab & Depth Textures
      uGrabTexture: { value: null },
      uDepthTexture: { value: null },
      uHasDepthTexture: { value: 0.0 },

      // Surface Textures
      uNormalMap0: { value: normalMap0 },
      uNormalMap1: { value: normalMap1 },
      uFlowMap: { value: flowMap },
      uNoiseTex: { value: noiseTex },
      uFoamTex: { value: foamTex },

      // 1. Surface
      uSurfaceColor: { value: new THREE.Color(preset.surfaceColor) },
      uAngleTint: { value: new THREE.Color(preset.angleTint) },
      uBackfaceTint: { value: new THREE.Color(preset.backfaceTint) },
      uOpacity: { value: preset.opacity },
      uRoughness: { value: preset.roughness },
      uMetallic: { value: preset.metallic },

      // 2. Normal Maps & Flow
      uNormalStr0: { value: preset.normalStr0 },
      uNormalScale0: { value: new THREE.Vector2(...preset.normalScale0) },
      uNormalScroll0: { value: new THREE.Vector2(...preset.normalScroll0) },
      uNormalStr1: { value: preset.normalStr1 },
      uNormalScale1: { value: new THREE.Vector2(...preset.normalScale1) },
      uNormalScroll1: { value: new THREE.Vector2(...preset.normalScroll1) },
      uDetailNormalBlend: { value: preset.detailNormalBlend },
      uStochasticToggle: { value: preset.stochasticToggle ? 1.0 : 0.0 },
      uFlowToggle: { value: preset.flowToggle ? 1.0 : 0.0 },
      uFlowSpeed: { value: preset.flowSpeed },
      uFlowStrength: { value: preset.flowStrength },
      uFlowScale: { value: preset.flowScale },

      // 3. Specular & Reflections
      uReflections: { value: preset.reflections ? 1.0 : 0.0 },
      uReflStrength: { value: preset.reflStrength },
      uReflTint: { value: new THREE.Color(preset.reflTint) },
      uFresnelPower: { value: preset.fresnelPower },
      uSpecToggle: { value: preset.specToggle ? 1.0 : 0.0 },
      uSpecStrength: { value: preset.specStrength },
      uSpecRoughness: { value: preset.specRoughness },
      uSpecTint: { value: new THREE.Color(preset.specTint) },
      uSnellsWindowPower: { value: preset.snellsWindowPower },

      // 4. Refraction, Depth Fog & SSS
      uRefractionStrength: { value: preset.refractionStrength },
      uChromAberration: { value: preset.chromAberration },
      uFogToggle: { value: preset.fogToggle ? 1.0 : 0.0 },
      uFogTint: { value: new THREE.Color(preset.fogTint) },
      uFogPower: { value: preset.fogPower },
      uFogBrightness: { value: preset.fogBrightness },
      uSSSToggle: { value: preset.sssToggle ? 1.0 : 0.0 },
      uSSSTint: { value: new THREE.Color(preset.sssTint) },
      uSSSPower: { value: preset.sssPower },
      uSSSIntensity: { value: preset.sssIntensity },
      uSSSHeightBias: { value: preset.sssHeightBias },

      // 5. Depth-Projected Caustics
      uCausticsToggle: { value: preset.causticsToggle ? 1.0 : 0.0 },
      uCausticsColor: { value: new THREE.Color(preset.causticsColor) },
      uCausticsOpacity: { value: preset.causticsOpacity },
      uCausticsScale: { value: preset.causticsScale },
      uCausticsSpeed: { value: preset.causticsSpeed },
      uCausticsPower: { value: preset.causticsPower },
      uCausticsFade: { value: preset.causticsFade },
      uCausticsDisp: { value: preset.causticsDisp },
      uCausticsDistortion: { value: preset.causticsDistortion },
      uCausticsSurfaceFade: { value: preset.causticsSurfaceFade },

      // 6. Foam (Edge Intersection & Crest)
      uFoamToggle: { value: preset.foamToggle ? 1.0 : 0.0 },
      uFoamColor: { value: new THREE.Color(preset.foamColor) },
      uFoamOpacity: { value: preset.foamOpacity },
      uFoamEdgeDepth: { value: preset.foamEdgeDepth },
      uFoamEdgePower: { value: preset.foamEdgePower },
      uFoamScale: { value: new THREE.Vector2(...preset.foamScale) },
      uFoamScroll: { value: new THREE.Vector2(...preset.foamScroll) },
      uFoamNoiseStr: { value: preset.foamNoiseStr },
      uCrestFoamToggle: { value: preset.crestFoamToggle ? 1.0 : 0.0 },
      uCrestFoamThreshold: { value: preset.crestFoamThreshold },
      uCrestFoamPower: { value: preset.crestFoamPower },
      uCrestFoamStrength: { value: preset.crestFoamStrength },

      // 7. Gerstner Waves
      uWavesToggle: { value: preset.gerstner.wavesToggle ? 1.0 : 0.0 },
      uWaveGlobalAmp: { value: preset.gerstner.globalAmp },
      uWaveGlobalSpeed: { value: preset.gerstner.globalSpeed },
      uWaveGlobalScale: { value: preset.gerstner.globalScale },
      uWaveNormalStr: { value: preset.gerstner.waveNormalStr },
      uWaveWarpStrength: { value: preset.gerstner.warpStrength },
      uWaveWarpScale: { value: preset.gerstner.warpScale },
      uWaveWarpSpeed: { value: preset.gerstner.warpSpeed },
      uWaveEnabled: {
        value: new THREE.Vector4(
          w0.enabled ? 1 : 0,
          w1.enabled ? 1 : 0,
          w2.enabled ? 1 : 0,
          w3.enabled ? 1 : 0
        ),
      },
      uWave0: { value: new THREE.Vector4(w0.steepness, w0.wavelength, w0.direction, w0.speed) },
      uWave1: { value: new THREE.Vector4(w1.steepness, w1.wavelength, w1.direction, w1.speed) },
      uWave2: { value: new THREE.Vector4(w2.steepness, w2.wavelength, w2.direction, w2.speed) },
      uWave3: { value: new THREE.Vector4(w3.steepness, w3.wavelength, w3.direction, w3.speed) },
      uWavePhaseOffsets: {
        value: new THREE.Vector4(w0.phaseOffset, w1.phaseOffset, w2.phaseOffset, w3.phaseOffset),
      },
    };

    super({
      name: 'MochieWaterShaderMaterial',
      uniforms,
      vertexShader: resolveMochieShaderIncludes(WaterVertGlsl),
      fragmentShader: resolveMochieShaderIncludes(WaterFragGlsl),
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: true,
      depthTest: true,
    });

    this.currentPresetId = preset.id;
  }

  setEnvironmentCubemap(cubeTexture) {
    this.uniforms.uEnvMap.value = cubeTexture;
    this.uniforms.uHasEnvMap.value = cubeTexture ? 1.0 : 0.0;
  }

  applyPreset(preset) {
    if (!preset) return;
    this.currentPresetId = preset.id;
    const u = this.uniforms;

    u.uSurfaceColor.value.set(preset.surfaceColor);
    u.uAngleTint.value.set(preset.angleTint);
    u.uBackfaceTint.value.set(preset.backfaceTint);
    u.uOpacity.value = preset.opacity;
    u.uRoughness.value = preset.roughness;
    u.uMetallic.value = preset.metallic;

    u.uNormalStr0.value = preset.normalStr0;
    u.uNormalScale0.value.set(...preset.normalScale0);
    u.uNormalScroll0.value.set(...preset.normalScroll0);
    u.uNormalStr1.value = preset.normalStr1;
    u.uNormalScale1.value.set(...preset.normalScale1);
    u.uNormalScroll1.value.set(...preset.normalScroll1);
    u.uDetailNormalBlend.value = preset.detailNormalBlend;
    u.uStochasticToggle.value = preset.stochasticToggle ? 1.0 : 0.0;
    u.uFlowToggle.value = preset.flowToggle ? 1.0 : 0.0;
    u.uFlowSpeed.value = preset.flowSpeed;
    u.uFlowStrength.value = preset.flowStrength;
    u.uFlowScale.value = preset.flowScale;

    u.uReflections.value = preset.reflections ? 1.0 : 0.0;
    u.uReflStrength.value = preset.reflStrength;
    u.uReflTint.value.set(preset.reflTint);
    u.uFresnelPower.value = preset.fresnelPower;
    u.uSpecToggle.value = preset.specToggle ? 1.0 : 0.0;
    u.uSpecStrength.value = preset.specStrength;
    u.uSpecRoughness.value = preset.specRoughness;
    u.uSpecTint.value.set(preset.specTint);
    u.uSnellsWindowPower.value = preset.snellsWindowPower;

    u.uRefractionStrength.value = preset.refractionStrength;
    u.uChromAberration.value = preset.chromAberration;
    u.uFogToggle.value = preset.fogToggle ? 1.0 : 0.0;
    u.uFogTint.value.set(preset.fogTint);
    u.uFogPower.value = preset.fogPower;
    u.uFogBrightness.value = preset.fogBrightness;
    u.uSSSToggle.value = preset.sssToggle ? 1.0 : 0.0;
    u.uSSSTint.value.set(preset.sssTint);
    u.uSSSPower.value = preset.sssPower;
    u.uSSSIntensity.value = preset.sssIntensity;
    u.uSSSHeightBias.value = preset.sssHeightBias;

    u.uCausticsToggle.value = preset.causticsToggle ? 1.0 : 0.0;
    u.uCausticsColor.value.set(preset.causticsColor);
    u.uCausticsOpacity.value = preset.causticsOpacity;
    u.uCausticsScale.value = preset.causticsScale;
    u.uCausticsSpeed.value = preset.causticsSpeed;
    u.uCausticsPower.value = preset.causticsPower;
    u.uCausticsFade.value = preset.causticsFade;
    u.uCausticsDisp.value = preset.causticsDisp;
    u.uCausticsDistortion.value = preset.causticsDistortion;
    u.uCausticsSurfaceFade.value = preset.causticsSurfaceFade;

    u.uFoamToggle.value = preset.foamToggle ? 1.0 : 0.0;
    u.uFoamColor.value.set(preset.foamColor);
    u.uFoamOpacity.value = preset.foamOpacity;
    u.uFoamEdgeDepth.value = preset.foamEdgeDepth;
    u.uFoamEdgePower.value = preset.foamEdgePower;
    u.uFoamScale.value.set(...preset.foamScale);
    u.uFoamScroll.value.set(...preset.foamScroll);
    u.uFoamNoiseStr.value = preset.foamNoiseStr;
    u.uCrestFoamToggle.value = preset.crestFoamToggle ? 1.0 : 0.0;
    u.uCrestFoamThreshold.value = preset.crestFoamThreshold;
    u.uCrestFoamPower.value = preset.crestFoamPower;
    u.uCrestFoamStrength.value = preset.crestFoamStrength;

    const g = preset.gerstner;
    u.uWavesToggle.value = g.wavesToggle ? 1.0 : 0.0;
    u.uWaterLevel.value = g.waterLevel;
    u.uWaveGlobalAmp.value = g.globalAmp;
    u.uWaveGlobalSpeed.value = g.globalSpeed;
    u.uWaveGlobalScale.value = g.globalScale;
    u.uWaveNormalStr.value = g.waveNormalStr;
    u.uWaveWarpStrength.value = g.warpStrength;
    u.uWaveWarpScale.value = g.warpScale;
    u.uWaveWarpSpeed.value = g.warpSpeed;

    const [w0, w1, w2, w3] = g.waves;
    u.uWaveEnabled.value.set(
      w0.enabled ? 1 : 0,
      w1.enabled ? 1 : 0,
      w2.enabled ? 1 : 0,
      w3.enabled ? 1 : 0
    );
    u.uWave0.value.set(w0.steepness, w0.wavelength, w0.direction, w0.speed);
    u.uWave1.value.set(w1.steepness, w1.wavelength, w1.direction, w1.speed);
    u.uWave2.value.set(w2.steepness, w2.wavelength, w2.direction, w2.speed);
    u.uWave3.value.set(w3.steepness, w3.wavelength, w3.direction, w3.speed);
    u.uWavePhaseOffsets.value.set(w0.phaseOffset, w1.phaseOffset, w2.phaseOffset, w3.phaseOffset);
  }

  getGerstnerConfig() {
    const u = this.uniforms;
    const en = u.uWaveEnabled.value;
    const w0 = u.uWave0.value;
    const w1 = u.uWave1.value;
    const w2 = u.uWave2.value;
    const w3 = u.uWave3.value;
    const ph = u.uWavePhaseOffsets.value;

    return {
      wavesToggle: u.uWavesToggle.value > 0.5,
      waterLevel: u.uWaterLevel.value,
      globalAmp: u.uWaveGlobalAmp.value,
      globalSpeed: u.uWaveGlobalSpeed.value,
      globalScale: u.uWaveGlobalScale.value,
      waveNormalStr: u.uWaveNormalStr.value,
      warpStrength: u.uWaveWarpStrength.value,
      warpScale: u.uWaveWarpScale.value,
      warpSpeed: u.uWaveWarpSpeed.value,
      waves: [
        { enabled: en.x > 0.5, steepness: w0.x, wavelength: w0.y, direction: w0.z, speed: w0.w, phaseOffset: ph.x },
        { enabled: en.y > 0.5, steepness: w1.x, wavelength: w1.y, direction: w1.z, speed: w1.w, phaseOffset: ph.y },
        { enabled: en.z > 0.5, steepness: w2.x, wavelength: w2.y, direction: w2.z, speed: w2.w, phaseOffset: ph.z },
        { enabled: en.w > 0.5, steepness: w3.x, wavelength: w3.y, direction: w3.z, speed: w3.w, phaseOffset: ph.w },
      ],
    };
  }
}
