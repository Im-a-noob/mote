// ============================================================================
// Mochie's Water Shader — WaterFrag.glsl
// 1:1 Port of Assets/Mochie/Water Shader/WaterFrag.cginc (HLSL -> GLSL)
// Implements:
//  - Dual scrolling normal maps + flowmap / stochastic + analytical capillary blend
//  - Screen-space UV refraction with foreground edge-artifact prevention
//  - Beer-Lambert chromatic spectral absorption, depth fog & wave-crest SSS
//  - Depth-projected 3D Voronoi caustics with chromatic dispersion
//  - Multi-scale cellular intersection foam & Gerstner wave crest whitecaps
//  - Backface / Snell's window Fresnel, cubemap reflections & GGX sun specular
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
  // 1. ComputeScreenPos / ComputeGrabScreenPos equivalent
  vec2 screenUV = (vClipPos.xy / max(vClipPos.w, 1e-6)) * 0.5 + 0.5;
  screenUV = clamp(screenUV, 0.001, 0.999);

  // World-space UV for seamless normal & foam tiling
  vec2 worldUV = vBaseWorldPos.xz * 0.095;

  // 2. Flowmap evaluation
  vec2 flowVec = vec2(0.0);
  if (uFlowToggle > 0.5) {
    vec2 flowSample = texture2D(uFlowMap, worldUV * uFlowScale).rg * 2.0 - 1.0;
    flowVec = flowSample;
  }

  // 3. Dual scrolling normal maps + RNM blending + analytical capillary micro-ripples
  vec3 n0 = sampleMochieNormalMap(
    uNormalMap0,
    worldUV,
    uNormalScale0,
    uNormalScroll0,
    uNormalStr0,
    uTime,
    uStochasticToggle,
    uFlowToggle,
    flowVec,
    uFlowSpeed,
    uFlowStrength
  );

  vec3 n1 = sampleMochieNormalMap(
    uNormalMap1,
    worldUV,
    uNormalScale1,
    uNormalScroll1,
    uNormalStr1,
    uTime,
    uStochasticToggle,
    uFlowToggle,
    flowVec,
    uFlowSpeed,
    uFlowStrength
  );

  vec3 combinedTexNormal = blendMochieNormals(n0, n1, uDetailNormalBlend);

  // Blend analytical per-fragment capillary ripples so foreground water has zero vertex faceting
  float distFadeCapillary = 1.0 - smoothstep(8.0, 55.0, vViewDepth);
  vec3 capillaryNormal = computeAnalyticalCapillaryNormal(
    vWorldPos.xz,
    uTime,
    (uNormalStr0 + uNormalStr1) * 0.65 * distFadeCapillary
  );
  vec3 tangentNormal = blendNormalsRNM(combinedTexNormal, capillaryNormal);

  // Re-evaluate smooth per-fragment Gerstner wave normal to eliminate low-poly vertex interpolation seams
  vec3 smoothWaveT = normalize(vWaveTangent);
  vec3 smoothWaveB = normalize(vWaveBinormal);
  vec3 smoothWaveN = normalize(vWaveNormal);
  if (uWavesToggle > 0.5 && distFadeCapillary > 0.05) {
    GerstnerResult fragG = evaluateMochieGerstnerWaves(
      vBaseWorldPos,
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
    smoothWaveT = fragG.tangent;
    smoothWaveB = fragG.binormal;
    smoothWaveN = fragG.normal;
  }

  mat3 TBN = mat3(smoothWaveT, smoothWaveB, smoothWaveN);
  vec3 worldNormal = normalize(
    TBN[0] * tangentNormal.x +
    TBN[1] * tangentNormal.y +
    TBN[2] * tangentNormal.z
  );

  bool isFrontFace = gl_FrontFacing;
  vec3 orientedNormal = isFrontFace ? worldNormal : -worldNormal;

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 lightDir = normalize(uSunDirection);

  // 4. Screen-Space Refraction & Foreground Edge-Artifact Rejection
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 refractOffset = orientedNormal.xz * uRefractionStrength * vec2(1.0 / aspect, 1.0);
  float edgeMask = smoothstep(0.0, 0.05, screenUV.x) * smoothstep(1.0, 0.95, screenUV.x) *
                   smoothstep(0.0, 0.05, screenUV.y) * smoothstep(1.0, 0.95, screenUV.y);
  refractOffset *= edgeMask / max(1.0 + vViewDepth * 0.045, 1.0);

  vec2 refractedUV = clamp(screenUV + refractOffset, 0.001, 0.999);

  float rawDepthUnrefracted = (uHasDepthTexture > 0.5) ? texture2D(uDepthTexture, screenUV).r : 0.999;
  float rawDepthRefracted = (uHasDepthTexture > 0.5) ? texture2D(uDepthTexture, refractedUV).r : 0.999;

  float sceneEyeDepthUnrefracted = linearEyeDepth(rawDepthUnrefracted, uCameraNear, uCameraFar);
  float sceneEyeDepthRefracted = linearEyeDepth(rawDepthRefracted, uCameraNear, uCameraFar);

  bool validRefraction = (sceneEyeDepthRefracted > vViewDepth - 0.02);
  vec2 finalGrabUV = validRefraction ? refractedUV : screenUV;
  float finalRawDepth = validRefraction ? rawDepthRefracted : rawDepthUnrefracted;
  float finalSceneEyeDepth = validRefraction ? sceneEyeDepthRefracted : sceneEyeDepthUnrefracted;

  float opticalDepthDiff = max(finalSceneEyeDepth - vViewDepth, 0.0);

  vec3 submergedWorldPos = reconstructWorldPositionFromDepth(
    finalGrabUV,
    finalRawDepth,
    uInverseProjectionMatrix,
    uCameraMatrixWorld
  );
  float verticalDepthDiff = max(vWorldPos.y - submergedWorldPos.y, 0.0);

  // When looking UP from underwater (!isFrontFace) through Snell's window,
  // the water path length is the distance from the camera to the water surface (vViewDepth),
  // NOT the distance to the sky dome behind the water!
  float waterColumnDepth = isFrontFace
    ? mix(opticalDepthDiff, verticalDepthDiff, 0.62)
    : min(vViewDepth * 0.28, 2.2);

  // Sample GrabPass with optional RGB chromatic aberration
  vec3 grabColor;
  if (uChromAberration > 0.0001 && validRefraction) {
    vec2 caShift = refractOffset * uChromAberration * 0.35;
    float r = texture2D(uGrabTexture, clamp(finalGrabUV + caShift, 0.001, 0.999)).r;
    float g = texture2D(uGrabTexture, finalGrabUV).g;
    float b = texture2D(uGrabTexture, clamp(finalGrabUV - caShift, 0.001, 0.999)).b;
    grabColor = vec3(r, g, b);
  } else {
    grabColor = texture2D(uGrabTexture, finalGrabUV).rgb;
  }

  // 5. Depth-Projected 3D Voronoi Caustics (applied to submerged geometry before Beer-Lambert extinction)
  if (uCausticsToggle > 0.5 && isFrontFace && finalRawDepth < 0.9995) {
    vec3 caustics = computeMochieProjectedCaustics(
      submergedWorldPos,
      lightDir,
      orientedNormal.xz,
      uCausticsScale,
      uCausticsSpeed,
      uTime,
      uCausticsPower,
      uCausticsDisp,
      uCausticsDistortion
    );
    float surfaceRamp = smoothstep(0.02, max(uCausticsSurfaceFade, 0.12), verticalDepthDiff);
    float deepFade = exp(-verticalDepthDiff / max(uCausticsFade, 0.5));
    float distAtten = 1.0 - smoothstep(28.0, 85.0, vViewDepth);
    float sunFactor = saturate(lightDir.y * 1.4 + 0.2);

    vec3 causticLight = caustics * uCausticsColor * uCausticsOpacity * surfaceRamp * deepFade * distAtten * sunFactor;
    grabColor += grabColor * causticLight * 1.15 + causticLight * 0.22;
  }

  // 6. Physically Based Beer-Lambert Spectral Absorption, Depth Fog & Subsurface Scattering (SSS)
  // Real coastal seawater attenuates Red fastest, then Green, then Blue
  vec3 spectralExtinction = vec3(0.52, 0.16, 0.11) * max(uFogPower * 2.4, 0.05);
  vec3 spectralTransmittance = exp(-spectralExtinction * waterColumnDepth);

  vec3 transmittedFloor = grabColor * uSurfaceColor * spectralTransmittance;

  float fogFactor = 0.0;
  if (uFogToggle > 0.5) {
    fogFactor = saturate(1.0 - exp(-waterColumnDepth * uFogPower * 1.35));
  }

  // Deep volume in-scattering modulated by solar elevation and view depth
  float sunInScatter = saturate(dot(lightDir, vec3(0.0, 1.0, 0.0)) * 0.75 + 0.25);
  float shallowTurquoiseGlow = exp(-waterColumnDepth * 0.35) * 0.32;
  vec3 deepOceanScatter = uFogTint * uFogBrightness * (0.45 + 0.55 * sunInScatter) +
                          uSSSTint * shallowTurquoiseGlow * 0.22;

  // Wave-crest Subsurface Scattering (back-lit translucent emerald glow through wave peaks)
  vec3 sssContribution = vec3(0.0);
  if (uSSSToggle > 0.5) {
    vec3 H_sss = normalize(lightDir + orientedNormal * 0.55);
    float backScatter = pow(saturate(dot(viewDir, -H_sss)), uSSSPower);
    float sunWrap = pow(saturate(dot(orientedNormal, lightDir) * 0.5 + 0.5), 1.5);
    float crestMask = pow(saturate(vCrestFactor + uSSSHeightBias), 1.65);
    float grazingBoost = pow(1.0 - saturate(dot(orientedNormal, viewDir)), 1.8) * 0.65 + 0.35;
    sssContribution = uSSSTint * (backScatter * 0.72 + sunWrap * 0.45) * crestMask * grazingBoost * uSSSIntensity * 0.55;
  }

  vec3 underwaterRadiance = mix(transmittedFloor, deepOceanScatter, fogFactor) + sssContribution;

  // Grazing angle depth tint / underwater backface tint
  float NdotV = saturate(dot(orientedNormal, viewDir));
  if (isFrontFace) {
    underwaterRadiance = mix(underwaterRadiance, underwaterRadiance * uAngleTint, pow(1.0 - NdotV, 2.2) * 0.65);
  } else {
    underwaterRadiance *= uBackfaceTint;
  }

  // 7. Edge (Intersection) Foam & Gerstner Wave Crest Whitecaps
  float totalFoamMask = 0.0;
  vec3 foamAlbedo = uFoamColor;
  if (uFoamToggle > 0.5 && isFrontFace) {
    vec2 noiseUV = worldUV * 1.85 + vec2(uTime * 0.04, -uTime * 0.032);
    vec2 noiseOffset = (texture2D(uNoiseTex, noiseUV).rg * 2.0 - 1.0) * uFoamNoiseStr;
    vec2 foamUV0 = worldUV * uFoamScale + uFoamScroll * uTime + noiseOffset;
    vec2 foamUV1 = worldUV * (uFoamScale * 1.85) - uFoamScroll * (uTime * 0.78) - noiseOffset * 0.65;

    float foamTex0 = texture2D(uFoamTex, foamUV0).r;
    float foamTex1 = texture2D(uFoamTex, foamUV1).r;
    float foamLace = mix(foamTex0, foamTex1, 0.48);

    // Intersection depth foam (around pier pilings, concrete column waterline & coastal rocks)
    if (finalRawDepth < 0.9995) {
      // Gate intersection foam to geometry that actually intersects or approaches the water surface
      // so submerged caustics slabs and shallow seabed stay crystal-clear for Voronoi caustics.
      float surfaceProximity = smoothstep(-0.52, -0.08, submergedWorldPos.y - uWaterLevel);
      float contactDepth = mix(opticalDepthDiff * 0.65, verticalDepthDiff, 0.55);
      float effectiveEdgeSpan = max(uFoamEdgeDepth * 0.52, 0.06);
      float edgeNormalized = saturate(1.0 - (contactDepth / effectiveEdgeSpan)) * surfaceProximity;
      // Multi-ring shoreline lapping pattern
      float lapRing = sin(edgeNormalized * 14.0 - uTime * 3.2) * 0.16 + 0.84;
      float rawEdge = pow(edgeNormalized, max(uFoamEdgePower, 0.35)) * lapRing;
      // Dissolve outer edge through cellular foam lace texture
      float edgeFoam = smoothstep(0.32, 0.80, rawEdge * (foamLace * 0.95 + 0.28));
      // Extra tight contact rim right against the timber/concrete waterline
      float tightRim = smoothstep(0.11, 0.0, contactDepth) * surfaceProximity * (0.65 + 0.35 * foamLace);
      totalFoamMask = max(totalFoamMask, max(edgeFoam * 0.86, tightRim));
    }

    // Gerstner Wave Crest Whitecaps
    if (uCrestFoamToggle > 0.5 && uWavesToggle > 0.5) {
      float crestExcess = saturate((vCrestFactor - uCrestFoamThreshold) / max(1.0 - uCrestFoamThreshold, 0.05));
      float crestEnvelope = pow(crestExcess, max(uCrestFoamPower, 0.25)) * uCrestFoamStrength;
      float crestFoam = smoothstep(0.24, 0.82, crestEnvelope * (foamLace * 1.15 + 0.12));
      totalFoamMask = max(totalFoamMask, crestFoam * 0.85);
    }

    totalFoamMask = saturate(totalFoamMask * uFoamOpacity);
    float foamDiffuse = saturate(dot(orientedNormal, lightDir) * 0.45 + 0.55);
    foamAlbedo = uFoamColor * mix(vec3(0.68, 0.78, 0.86), uSunColor * 0.95, foamDiffuse);
  }

  // 8. PBR Reflections (Environment Cubemap + Atmospheric Sky Fallback + Snell's Window)
  float fresnel = computeMochieWaterFresnel(orientedNormal, viewDir, isFrontFace, uFresnelPower, uSnellsWindowPower);
  fresnel *= (1.0 - totalFoamMask * 0.82);

  vec3 reflColor = vec3(0.0);
  if (uReflections > 0.5) {
    vec3 R = reflect(-viewDir, orientedNormal);
    if (isFrontFace) {
      R.y = max(R.y, 0.005);
      R = normalize(R);
    }

    vec3 envSample;
    if (uHasEnvMap > 0.5) {
      envSample = textureCube(uEnvMap, R).rgb;
    } else {
      float skyElev = saturate(R.y);
      envSample = mix(vec3(0.62, 0.79, 0.92), vec3(0.11, 0.32, 0.64), pow(skyElev, 0.55));
    }

    if (!isFrontFace) {
      // Underwater Total Internal Reflection outside Snell's window reflects the turquoise-teal underwater volume
      vec3 tirOceanMirror = mix(
        vec3(0.03, 0.26, 0.36),
        vec3(0.08, 0.54, 0.66),
        saturate(orientedNormal.x * 0.5 + 0.5)
      );
      reflColor = mix(tirOceanMirror, envSample * 0.55, 0.25) * uReflTint * uReflStrength;
    } else {
      reflColor = envSample * uReflTint * uReflStrength;
    }
  }

  // 9. Dual-Lobe GGX Microfacet Sun Specular (Sharp solar core + broad glittering wave sheen)
  vec3 specColor = vec3(0.0);
  if (uSpecToggle > 0.5 && isFrontFace) {
    vec3 H = normalize(viewDir + lightDir);
    float NdotL = max(dot(orientedNormal, lightDir), 0.0);
    float NdotV_spec = max(dot(orientedNormal, viewDir), 0.01);

    // Primary sharp sun glint lobe
    float roughCore = clamp(uSpecRoughness, 0.025, 1.0);
    float D1 = distributionGGX(orientedNormal, H, roughCore);
    float G1 = geometrySmith(orientedNormal, viewDir, lightDir, roughCore);

    // Secondary broader wave glitter lobe
    float roughGlitter = clamp(uSpecRoughness * 2.6, 0.08, 1.0);
    float D2 = distributionGGX(orientedNormal, H, roughGlitter);
    float G2 = geometrySmith(orientedNormal, viewDir, lightDir, roughGlitter);

    vec3 F = fresnelSchlickWater(max(dot(H, viewDir), 0.0), vec3(0.02), uFresnelPower);
    float denom = 4.0 * NdotV_spec * max(NdotL, 0.01);

    vec3 brdf = ((D1 * G1 * 0.75 + D2 * G2 * 0.35) * F) / denom;
    specColor = brdf * NdotL * uSunColor * uSunIntensity * uSpecTint * uSpecStrength * (1.0 - totalFoamMask * 0.85);
  }

  // 10. Final Radiance Composition + Atmospheric Horizon Aerial Perspective
  vec3 surfaceComposite = mix(underwaterRadiance, reflColor, fresnel * saturate(uReflStrength));
  surfaceComposite = mix(surfaceComposite, foamAlbedo, totalFoamMask);
  surfaceComposite += specColor;

  // Blend distant water seamlessly into atmospheric horizon haze at the perimeter
  if (isFrontFace) {
    float radialDist = length(vWorldPos.xz);
    float aerialHaze = smoothstep(42.0, 185.0, vViewDepth) * 0.55;
    float edgeSeamless = smoothstep(105.0, 235.0, radialDist);
    float horizonBlend = clamp(max(aerialHaze, edgeSeamless), 0.0, 1.0);
    vec3 horizonColor = vec3(0.56, 0.76, 0.90);
    surfaceComposite = mix(surfaceComposite, horizonColor, horizonBlend);
  }

  gl_FragColor = vec4(surfaceComposite, uOpacity);
}
