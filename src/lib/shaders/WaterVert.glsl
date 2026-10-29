// ============================================================================
// Mochie's Water Shader — WaterVert.glsl
// 1:1 Port of Assets/Mochie/Water Shader/WaterVert.cginc (HLSL -> GLSL)
// Evaluates 4-Wave Gerstner displacement, analytical TBN basis, crest factor,
// and clip-space screen position (ComputeGrabScreenPos / ComputeScreenPos).
// ============================================================================

#include "WaterDefines.glsl"
#include "WaterFunctions.glsl"

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vBaseWorldPos;
varying vec4 vClipPos;
varying vec3 vWaveTangent;
varying vec3 vWaveBinormal;
varying vec3 vWaveNormal;
varying float vCrestFactor;
varying float vViewDepth;

void main() {
  vUv = uv;

  vec4 baseWorld = modelMatrix * vec4(position, 1.0);
  vBaseWorldPos = baseWorld.xyz;

  vec3 displacedWorld = baseWorld.xyz;
  vec3 waveT = vec3(1.0, 0.0, 0.0);
  vec3 waveB = vec3(0.0, 0.0, 1.0);
  vec3 waveN = vec3(0.0, 1.0, 0.0);
  float crest = 0.0;

  if (uWavesToggle > 0.5) {
    GerstnerResult g = evaluateMochieGerstnerWaves(
      baseWorld.xyz,
      uTime,
      uWaveGlobalAmp,
      uWaveGlobalSpeed,
      uWaveGlobalScale,
      uWaveWarpStrength,
      uWaveWarpScale,
      uWaveWarpSpeed,
      uWaveNormalStr,
      uWaveEnabled,
      uWave0,
      uWave1,
      uWave2,
      uWave3,
      uWavePhaseOffsets
    );
    displacedWorld += g.displacement;
    waveT = g.tangent;
    waveB = g.binormal;
    waveN = g.normal;
    crest = g.crestFactor;
  }

  vWorldPos = displacedWorld;
  vWaveTangent = waveT;
  vWaveBinormal = waveB;
  vWaveNormal = waveN;
  vCrestFactor = crest;

  vec4 viewPos = viewMatrix * vec4(displacedWorld, 1.0);
  vViewDepth = -viewPos.z;

  gl_Position = projectionMatrix * viewPos;
  vClipPos = gl_Position;
}
