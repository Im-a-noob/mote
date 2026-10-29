// ============================================================================
// Mochie's Underwater Shader — UnderwaterFrag.glsl
// 1:1 Port of Assets/Mochie/Underwater Shader/Underwater.shader (HLSL -> GLSL)
// Full-screen post-processing pass with:
//  - Analytical Gerstner wave height evaluation across the camera lens
//  - Dual-layer optical split-screen meniscus line & lens refraction
//  - Beer-Lambert spectral depth absorption & vertical ocean gradient fog
//  - World-space reconstructed 3D Voronoi caustics on submerged geometry
//  - Volumetric crepuscular sun shafts (god-rays) & depth scattering blur
// ============================================================================

#include "WaterDefines.glsl"
#include "WaterFunctions.glsl"

uniform sampler2D tDiffuse;
uniform float uUnderwaterEnabled;
uniform vec3 uCameraPos;
uniform vec3 uCameraForward;
uniform vec3 uCameraRight;
uniform vec3 uCameraUp;
uniform float uCameraFovRad;
uniform vec3 uUnderwaterFogColor;
uniform float uUnderwaterFogDensity;
uniform float uUnderwaterCausticsStr;
uniform float uUnderwaterDistortion;
uniform float uUnderwaterBlurStr;
uniform float uMeniscusWidth;
uniform vec3 uMeniscusColor;

varying vec2 vUv;

// Evaluates the exact Gerstner wave surface Y at world (x, z) so the
// camera lens meniscus line matches the 3D water mesh 1:1.
float sampleWaterHeightAtLens(vec2 worldXZ) {
  if (uWavesToggle < 0.5) return uWaterLevel;
  GerstnerResult g = evaluateMochieGerstnerWaves(
    vec3(worldXZ.x, uWaterLevel, worldXZ.y),
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
  return uWaterLevel + g.displacement.y;
}

void main() {
  vec4 baseScene = texture2D(tDiffuse, vUv);
  if (uUnderwaterEnabled < 0.5) {
    gl_FragColor = baseScene;
    return;
  }

  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 ndc = vUv * 2.0 - 1.0;
  float halfHeight = tan(uCameraFovRad * 0.5);
  float halfWidth = halfHeight * aspect;

  vec3 rayDir = normalize(
    uCameraForward +
    uCameraRight * (ndc.x * halfWidth) +
    uCameraUp * (ndc.y * halfHeight)
  );

  // Sample the exact point where the view ray intersects the camera near clipping plane.
  // Because the 3D water mesh is clipped at z_view = -uCameraNear, evaluating the Gerstner
  // wave height on this exact plane guarantees a 1:1 geometric match between the 3D water
  // surface edge and the post-processing meniscus line.
  float forwardDot = max(dot(rayDir, uCameraForward), 0.2);
  float lensDist = uCameraNear / forwardDot;
  vec3 lensWorldPos = uCameraPos + rayDir * lensDist;

  float surfaceYAtLens = sampleWaterHeightAtLens(lensWorldPos.xz);
  float signedSubmersion = surfaceYAtLens - lensWorldPos.y;

  // Dual-band meniscus at the air-water lens interface (scaled to near-plane height)
  float nearPlaneHeight = 2.0 * uCameraNear * halfHeight;
  float meniscusHalf = max(uMeniscusWidth * nearPlaneHeight * 0.45, 0.0025);
  float underwaterMask = smoothstep(-meniscusHalf, meniscusHalf, signedSubmersion);
  float meniscusCore = exp(-pow(signedSubmersion / (meniscusHalf * 0.42), 2.0) * 3.2);
  float meniscusDarkRim = exp(-pow((signedSubmersion - meniscusHalf * 0.52) / (meniscusHalf * 0.65), 2.0) * 2.4);

  if (underwaterMask <= 0.001) {
    gl_FragColor = baseScene;
    return;
  }

  // Screen-space fluid lens wave distortion
  vec2 waveUVOffset = vec2(
    sin(vUv.y * 16.0 + uTime * 2.1) + cos(vUv.x * 12.0 - uTime * 1.5),
    cos(vUv.x * 14.0 + uTime * 1.9) + sin(vUv.y * 11.0 + uTime * 1.7)
  ) * 0.0014 * uUnderwaterDistortion * underwaterMask;

  // Refract rays slightly near the meniscus line due to surface tension curvature
  waveUVOffset.y -= meniscusDarkRim * 0.010 * uUnderwaterDistortion;

  vec2 sampleUV = clamp(vUv + waveUVOffset, 0.002, 0.998);

  // Depth lookup & world-position reconstruction for underwater volume
  float rawDepth = (uHasDepthTexture > 0.5) ? texture2D(uDepthTexture, sampleUV).r : 0.65;
  float rawEyeDepth = (uHasDepthTexture > 0.5)
    ? linearEyeDepth(rawDepth, uCameraNear, uCameraFar)
    : 22.0;

  // Cap background sky depth when underwater so distant water fogs smoothly
  float eyeDepth = (rawDepth > 0.9992) ? 48.0 : min(rawEyeDepth, 55.0);

  // Distance-based scattering blur (5-tap cross kernel weighted by depth)
  float blurFactor = saturate((eyeDepth - 1.5) / 38.0) * uUnderwaterBlurStr * underwaterMask;
  vec2 texel = (1.0 / max(uResolution, vec2(1.0))) * blurFactor * 3.0;

  vec3 sceneCol = texture2D(tDiffuse, sampleUV).rgb * 0.44;
  sceneCol += texture2D(tDiffuse, clamp(sampleUV + vec2(texel.x, 0.0), 0.002, 0.998)).rgb * 0.14;
  sceneCol += texture2D(tDiffuse, clamp(sampleUV - vec2(texel.x, 0.0), 0.002, 0.998)).rgb * 0.14;
  sceneCol += texture2D(tDiffuse, clamp(sampleUV + vec2(0.0, texel.y), 0.002, 0.998)).rgb * 0.14;
  sceneCol += texture2D(tDiffuse, clamp(sampleUV - vec2(0.0, texel.y), 0.002, 0.998)).rgb * 0.14;

  // Reconstruct world position to project underwater caustics onto submerged geometry
  vec3 lightDir = normalize(uSunDirection);
  if (uHasDepthTexture > 0.5 && rawDepth < 0.9992 && uUnderwaterCausticsStr > 0.01) {
    vec3 worldGeomPos = reconstructWorldPositionFromDepth(
      sampleUV,
      rawDepth,
      uInverseProjectionMatrix,
      uCameraMatrixWorld
    );
    if (worldGeomPos.y < surfaceYAtLens + 0.15) {
      vec3 caustics = computeMochieProjectedCaustics(
        worldGeomPos,
        lightDir,
        vec2(0.0),
        uCausticsScale,
        uCausticsSpeed,
        uTime,
        uCausticsPower,
        uCausticsDisp,
        uCausticsDistortion
      );
      float subDepth = max(surfaceYAtLens - worldGeomPos.y, 0.0);
      float surfaceRamp = smoothstep(0.02, 0.25, subDepth);
      float depthAtten = exp(-subDepth / max(uCausticsFade, 1.0));
      float distFade = 1.0 - smoothstep(12.0, 46.0, eyeDepth);
      sceneCol += sceneCol * caustics * uCausticsColor * uUnderwaterCausticsStr * surfaceRamp * depthAtten * distFade * 1.15;
    }
  }

  // Beer-Lambert spectral absorption (attenuates red & orange wavelengths with distance)
  vec3 absorption = exp(-vec3(0.18, 0.052, 0.028) * min(eyeDepth, 28.0) * uUnderwaterFogDensity * 5.2);
  vec3 absorbedCol = sceneCol * mix(vec3(1.0), absorption, 0.72);

  // Vertical water column gradient: sunlit turquoise-cyan looking upward, deep marine teal-navy downward
  float verticalGrad = saturate(rayDir.y * 0.65 + 0.45);
  vec3 deepWaterColor = uUnderwaterFogColor * 0.68;
  vec3 shallowSunlitWater = mix(uUnderwaterFogColor * 1.35, uSSSTint * 0.85, 0.42);
  vec3 directionalWaterFog = mix(deepWaterColor, shallowSunlitWater, pow(verticalGrad, 1.25));

  // Volumetric Crepuscular God-Ray Sun Shafts through the wave surface
  float sunAlign = pow(saturate(dot(rayDir, vec3(lightDir.x, max(lightDir.y, 0.2), lightDir.z)) * 0.5 + 0.5), 2.4);
  vec2 shaftCoord = rayDir.xz / max(abs(rayDir.y) + 0.35, 0.35);
  float shaftWave1 = sin(shaftCoord.x * 11.0 + shaftCoord.y * 7.0 + uTime * 1.15);
  float shaftWave2 = cos(shaftCoord.x * 17.0 - shaftCoord.y * 13.0 - uTime * 0.85);
  float shaftStreaks = pow(saturate(shaftWave1 * 0.5 + shaftWave2 * 0.5 + 0.5), 2.6);
  float upwardMask = smoothstep(-0.35, 0.55, rayDir.y);
  vec3 godRayGlow = mix(uSSSTint, uCausticsColor, 0.45) * sunAlign * shaftStreaks * upwardMask * 0.24;

  // Exponential underwater volume fog
  float fogAmount = saturate(1.0 - exp(-eyeDepth * uUnderwaterFogDensity * 1.35));
  vec3 foggedUnderwater = mix(absorbedCol, directionalWaterFog, fogAmount) + godRayGlow * (0.4 + 0.6 * fogAmount);

  // Subtle optical vignette underwater
  float vig = smoothstep(1.35, 0.38, length(ndc * vec2(0.85, 1.0)));
  foggedUnderwater *= mix(0.82, 1.0, vig);

  // Composite above-water and underwater regions with the 2-layer optical meniscus
  vec3 finalColor = mix(baseScene.rgb, foggedUnderwater, underwaterMask);
  finalColor *= (1.0 - meniscusDarkRim * 0.38);
  finalColor = mix(finalColor, uMeniscusColor, meniscusCore * 0.88);

  gl_FragColor = vec4(finalColor, 1.0);
}
