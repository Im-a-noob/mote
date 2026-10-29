// ============================================================================
// Mochie's Water Shader — WaterFunctions.glsl
// 1:1 Port of Assets/Mochie/Water Shader/WaterFunctions.cginc (HLSL -> GLSL)
// Includes:
//  - Depth linearization & World-Space Depth Reconstruction
//  - UnpackScaleNormal, RNM Normal Blending & Analytical Capillary Micro-Ripples
//  - Stochastic Texture Sampling & Dual-Phase Flow Mapping
//  - 4-Wave Gerstner Displacement with Analytical TBN & Crest Noise Warping
//  - High-Contrast 3D Voronoi Depth-Projected Caustics with RGB Dispersion
//  - GGX Microfacet Specular & Schlick/Snell's Window Fresnel
// ============================================================================

#ifndef MOCHIE_WATER_FUNCTIONS_GLSL
#define MOCHIE_WATER_FUNCTIONS_GLSL

// ----------------------------------------------------------------------------
// 1. Depth Linearization & World-Space Position Reconstruction
// Equivalent to Unity's LinearEyeDepth(), Linear01Depth(), and Mochie's
// ReconstructWorldPos() from _CameraDepthTexture.
// ----------------------------------------------------------------------------
float perspectiveDepthToViewZ(const in float depth, const in float near, const in float far) {
  // Maps hardware depth [0, 1] -> negative view-space Z [-near, -far]
  float z_ndc = 2.0 * depth - 1.0;
  return (2.0 * near * far) / (z_ndc * (far - near) - (far + near));
}

float viewZToOrthographicDepth(const in float viewZ, const in float near, const in float far) {
  // Equivalent to Unity's Linear01Depth
  return saturate((-viewZ - near) / (far - near));
}

float linearEyeDepth(const in float rawDepth, const in float near, const in float far) {
  return -perspectiveDepthToViewZ(rawDepth, near, far);
}

vec3 reconstructWorldPositionFromDepth(vec2 screenUV, float rawDepth, mat4 invProj, mat4 camWorld) {
  vec4 ndc = vec4(screenUV * 2.0 - 1.0, rawDepth * 2.0 - 1.0, 1.0);
  vec4 viewPos = invProj * ndc;
  viewPos /= max(viewPos.w, 1e-6);
  vec4 worldPos = camWorld * viewPos;
  return worldPos.xyz;
}

// ----------------------------------------------------------------------------
// 2. Normal Unpacking & Blending (UnpackScaleNormal & BlendNormals / RNM)
// ----------------------------------------------------------------------------
vec3 unpackScaleNormal(vec4 packedNormal, float bumpScale) {
  vec3 normal = packedNormal.xyz * 2.0 - 1.0;
  normal.xy *= bumpScale;
  normal.z = sqrt(max(0.0, 1.0 - saturate(dot(normal.xy, normal.xy))));
  return normalize(normal);
}

// Unity Standard CG BlendNormals (Whiteout blend)
vec3 blendNormalsWhiteout(vec3 n1, vec3 n2) {
  return normalize(vec3(n1.xy + n2.xy, n1.z * n2.z));
}

// Reoriented Normal Mapping (RNM) used in Mochie's detail normal combiner
vec3 blendNormalsRNM(vec3 n1, vec3 n2) {
  vec3 t = n1 + vec3(0.0, 0.0, 1.0);
  vec3 u = n2 * vec3(-1.0, -1.0, 1.0);
  return normalize(t * dot(t, u) - u * t.z);
}

vec3 blendMochieNormals(vec3 n1, vec3 n2, float rnmWeight) {
  return normalize(mix(blendNormalsWhiteout(n1, n2), blendNormalsRNM(n1, n2), rnmWeight));
}

// ----------------------------------------------------------------------------
// 3. Hash, Simplex/Value Noise & Wave Crest Warping
// ----------------------------------------------------------------------------
vec2 hash22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

vec3 hash33(vec3 p) {
  p = vec3(
    dot(p, vec3(127.1, 311.7, 74.7)),
    dot(p, vec3(269.5, 183.3, 246.1)),
    dot(p, vec3(113.5, 271.9, 124.6))
  );
  return fract(sin(p) * 43758.5453123);
}

float gradientNoise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(
    mix(dot(hash22(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)),
        dot(hash22(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
    mix(dot(hash22(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
        dot(hash22(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x),
    u.y
  );
}

// Analytical per-fragment capillary wave normal layer to eliminate any
// mesh vertex faceting in the foreground and produce crisp micro-ripples.
vec3 computeAnalyticalCapillaryNormal(vec2 worldXZ, float time, float strength) {
  vec2 p0 = worldXZ * 1.35 + vec2(time * 0.95, -time * 0.72);
  vec2 p1 = worldXZ * 2.85 + vec2(-time * 1.25, time * 1.08);
  vec2 p2 = worldXZ * 5.60 + vec2(time * 1.65, time * 1.42);

  float eps = 0.06;
  float hC = gradientNoise2D(p0) * 0.55 + gradientNoise2D(p1) * 0.30 + gradientNoise2D(p2) * 0.15;
  float hX = gradientNoise2D(p0 + vec2(eps, 0.0)) * 0.55 + gradientNoise2D(p1 + vec2(eps * 2.1, 0.0)) * 0.30 + gradientNoise2D(p2 + vec2(eps * 4.1, 0.0)) * 0.15;
  float hY = gradientNoise2D(p0 + vec2(0.0, eps)) * 0.55 + gradientNoise2D(p1 + vec2(0.0, eps * 2.1)) * 0.30 + gradientNoise2D(p2 + vec2(0.0, eps * 4.1)) * 0.15;

  vec2 grad = vec2(hX - hC, hY - hC) / eps;
  vec2 xy = -grad * strength * 0.38;
  float z = sqrt(max(0.0, 1.0 - saturate(dot(xy, xy))));
  return normalize(vec3(xy, z));
}

vec2 computeWaveWarpOffset(vec2 worldXZ, float warpStrength, float warpScale, float warpSpeed, float time) {
  if (warpStrength <= 0.0001) return vec2(0.0);
  vec2 p = worldXZ * (0.08 * warpScale) + vec2(time * warpSpeed * 0.25, -time * warpSpeed * 0.19);
  float nx = gradientNoise2D(p);
  float nz = gradientNoise2D(p + vec2(17.3, 43.7));
  return vec2(nx, nz) * warpStrength * 3.5;
}

// ----------------------------------------------------------------------------
// 4. Stochastic Sampling & Flowmap UV Distortion (WaterFunctions.cginc)
// ----------------------------------------------------------------------------
vec4 tex2DStochastic(sampler2D tex, vec2 uv) {
  vec2 skewUV = mat2(1.0, 0.0, -0.57735027, 1.15470054) * (uv * 3.464);
  vec2 vxID = floor(skewUV);
  vec3 barry = vec3(fract(skewUV), 0.0);
  barry.z = 1.0 - barry.x - barry.y;

  mat4x2 bw_vx = (barry.z > 0.0)
    ? mat4x2(vxID, vxID + vec2(0.0, 1.0), vxID + vec2(1.0, 0.0), barry.zyx.xy)
    : mat4x2(vxID + vec2(1.0, 1.0), vxID + vec2(1.0, 0.0), vxID + vec2(0.0, 1.0), vec2(-barry.z, 1.0 - barry.y));

  vec2 w = bw_vx[3];
  float w2 = 1.0 - w.x - w.y;

  vec2 o0 = fract(sin(vec2(dot(bw_vx[0], vec2(127.1, 311.7)), dot(bw_vx[0], vec2(269.5, 183.3)))) * 43758.5453);
  vec2 o1 = fract(sin(vec2(dot(bw_vx[1], vec2(127.1, 311.7)), dot(bw_vx[1], vec2(269.5, 183.3)))) * 43758.5453);
  vec2 o2 = fract(sin(vec2(dot(bw_vx[2], vec2(127.1, 311.7)), dot(bw_vx[2], vec2(269.5, 183.3)))) * 43758.5453);

  return texture2D(tex, uv + o0) * w.x +
         texture2D(tex, uv + o1) * w.y +
         texture2D(tex, uv + o2) * w2;
}

vec3 sampleMochieNormalMap(
  sampler2D normalTex,
  vec2 baseUV,
  vec2 scale,
  vec2 scroll,
  float strength,
  float time,
  float useStochastic,
  float useFlow,
  vec2 flowVector,
  float flowSpeed,
  float flowStrength
) {
  vec2 uv = baseUV * scale;
  if (useFlow > 0.5) {
    float phase0 = fract(time * flowSpeed);
    float phase1 = fract(time * flowSpeed + 0.5);
    vec2 uv0 = uv - flowVector * phase0 * flowStrength + scroll * time;
    vec2 uv1 = uv - flowVector * phase1 * flowStrength + scroll * time + vec2(0.5, 0.5);
    vec4 s0 = (useStochastic > 0.5) ? tex2DStochastic(normalTex, uv0) : texture2D(normalTex, uv0);
    vec4 s1 = (useStochastic > 0.5) ? tex2DStochastic(normalTex, uv1) : texture2D(normalTex, uv1);
    float flowLerp = abs((0.5 - phase0) / 0.5);
    vec3 n0 = unpackScaleNormal(s0, strength);
    vec3 n1 = unpackScaleNormal(s1, strength);
    return normalize(mix(n0, n1, flowLerp));
  } else {
    vec2 scrolledUV = uv + scroll * time;
    vec4 sampleCol = (useStochastic > 0.5)
      ? tex2DStochastic(normalTex, scrolledUV)
      : texture2D(normalTex, scrolledUV);
    return unpackScaleNormal(sampleCol, strength);
  }
}

// ----------------------------------------------------------------------------
// 5. Gerstner Waves (4-Wave System with Analytical TBN Accumulation)
// Mirrors GerstnerWave() in WaterFunctions.cginc
// waveData = (steepness Q, wavelength L, directionDeg, speedMult)
// ----------------------------------------------------------------------------
struct GerstnerResult {
  vec3 displacement;
  vec3 tangent;
  vec3 binormal;
  vec3 normal;
  float crestFactor;
};

void accumulateSingleGerstnerWave(
  vec4 waveData,
  float phaseOffset,
  vec2 sampleXZ,
  float globalAmp,
  float globalSpeed,
  float globalScale,
  float time,
  inout vec3 disp,
  inout vec3 tangent,
  inout vec3 binormal,
  inout float crestAccum
) {
  float steepness = waveData.x * globalAmp;
  float wavelength = max(waveData.y / max(globalScale, 0.05), 0.25);
  float rad = radians(waveData.z);
  vec2 d = normalize(vec2(cos(rad), sin(rad)));
  float k = TWO_PI / wavelength;
  float c = sqrt(9.8 / k) * waveData.w * globalSpeed;
  float a = steepness / k;

  float f = k * (dot(d, sampleXZ) - c * time) + phaseOffset;
  float sinF = sin(f);
  float cosF = cos(f);

  disp.x += d.x * (a * cosF);
  disp.y += a * sinF;
  disp.z += d.y * (a * cosF);

  float wa = k * a;
  tangent += vec3(
    -d.x * d.x * (wa * sinF),
     d.x * (wa * cosF),
    -d.x * d.y * (wa * sinF)
  );
  binormal += vec3(
    -d.x * d.y * (wa * sinF),
     d.y * (wa * cosF),
    -d.y * d.y * (wa * sinF)
  );

  crestAccum += saturate(sinF * 0.5 + 0.5) * steepness;
}

GerstnerResult evaluateMochieGerstnerWaves(
  vec3 worldPos,
  float time,
  float globalAmp,
  float globalSpeed,
  float globalScale,
  float warpStrength,
  float warpScale,
  float warpSpeed,
  float waveNormalStr,
  vec4 enabledMask,
  vec4 w0,
  vec4 w1,
  vec4 w2,
  vec4 w3,
  vec4 phaseOffsets
) {
  GerstnerResult res;
  res.displacement = vec3(0.0);
  res.tangent = vec3(1.0, 0.0, 0.0);
  res.binormal = vec3(0.0, 0.0, 1.0);
  res.crestFactor = 0.0;

  vec2 warpOffset = computeWaveWarpOffset(worldPos.xz, warpStrength, warpScale, warpSpeed, time);
  vec2 warpedXZ = worldPos.xz + warpOffset;

  float activeWeight = 0.0;
  if (enabledMask.x > 0.5) {
    accumulateSingleGerstnerWave(w0, phaseOffsets.x, warpedXZ, globalAmp, globalSpeed, globalScale, time, res.displacement, res.tangent, res.binormal, res.crestFactor);
    activeWeight += max(w0.x, 0.05);
  }
  if (enabledMask.y > 0.5) {
    accumulateSingleGerstnerWave(w1, phaseOffsets.y, warpedXZ, globalAmp, globalSpeed, globalScale, time, res.displacement, res.tangent, res.binormal, res.crestFactor);
    activeWeight += max(w1.x, 0.05);
  }
  if (enabledMask.z > 0.5) {
    accumulateSingleGerstnerWave(w2, phaseOffsets.z, warpedXZ, globalAmp, globalSpeed, globalScale, time, res.displacement, res.tangent, res.binormal, res.crestFactor);
    activeWeight += max(w2.x, 0.05);
  }
  if (enabledMask.w > 0.5) {
    accumulateSingleGerstnerWave(w3, phaseOffsets.w, warpedXZ, globalAmp, globalSpeed, globalScale, time, res.displacement, res.tangent, res.binormal, res.crestFactor);
    activeWeight += max(w3.x, 0.05);
  }

  res.tangent = normalize(res.tangent);
  res.binormal = normalize(res.binormal);
  vec3 rawNormal = normalize(cross(res.binormal, res.tangent));
  res.normal = normalize(mix(vec3(0.0, 1.0, 0.0), rawNormal, waveNormalStr));
  res.crestFactor = (activeWeight > 0.0) ? saturate(res.crestFactor / activeWeight) : 0.0;
  return res;
}

// ----------------------------------------------------------------------------
// 6. Depth-Projected 3D Voronoi Caustics (WaterFunctions.cginc)
// Projects directional-light-aligned 3D Voronoi cellular caustics onto
// reconstructed world-space geometry with sharp refractive filaments & RGB split.
// ----------------------------------------------------------------------------
mat3 buildLightProjectionBasis(vec3 lightDir) {
  vec3 f = normalize(lightDir);
  vec3 up = abs(f.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 r = normalize(cross(up, f));
  vec3 u = cross(f, r);
  return mat3(r, u, f);
}

float voronoi3DCausticCell(vec3 p) {
  vec3 b = floor(p);
  vec3 f = fract(p);
  float minDist1 = 8.0;
  float minDist2 = 8.0;

  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec3 neighbor = vec3(float(x), float(y), float(z));
        vec3 point = hash33(b + neighbor);
        point = 0.5 + 0.5 * sin(TWO_PI * point);
        vec3 diff = neighbor + point - f;
        float d = dot(diff, diff);
        if (d < minDist1) {
          minDist2 = minDist1;
          minDist1 = d;
        } else if (d < minDist2) {
          minDist2 = d;
        }
      }
    }
  }
  // Sharp cellular boundary creates authentic focused caustic light filaments
  float edge = sqrt(minDist2) - sqrt(minDist1);
  float filament = saturate(1.0 - smoothstep(0.0, 0.36, edge));
  return filament * filament;
}

vec3 computeMochieProjectedCaustics(
  vec3 worldPos,
  vec3 sunDir,
  vec2 surfaceNormalXZ,
  float scale,
  float speed,
  float time,
  float power,
  float chromaticDisp,
  float distortionStr
) {
  mat3 lightBasis = buildLightProjectionBasis(sunDir);
  vec3 lightSpacePos = lightBasis * worldPos;
  vec2 uv = lightSpacePos.xy * scale * 0.28 + surfaceNormalXZ * distortionStr;
  float zSlice = time * speed * 0.42 + lightSpacePos.z * 0.07;

  vec3 pR1 = vec3(uv + vec2(chromaticDisp, 0.0), zSlice);
  vec3 pG1 = vec3(uv, zSlice + chromaticDisp * 1.4);
  vec3 pB1 = vec3(uv - vec2(0.0, chromaticDisp), zSlice - chromaticDisp * 1.4);

  vec2 uv2 = uv * 1.42 + vec2(3.7, -2.1);
  float zSlice2 = -time * speed * 0.34 - lightSpacePos.z * 0.06;

  float cR = 0.58 * voronoi3DCausticCell(pR1) + 0.42 * voronoi3DCausticCell(vec3(uv2 + chromaticDisp, zSlice2));
  float cG = 0.58 * voronoi3DCausticCell(pG1) + 0.42 * voronoi3DCausticCell(vec3(uv2, zSlice2));
  float cB = 0.58 * voronoi3DCausticCell(pB1) + 0.42 * voronoi3DCausticCell(vec3(uv2 - chromaticDisp, zSlice2));

  vec3 caustics = pow(max(vec3(cR, cG, cB), vec3(0.0001)), vec3(power)) * 2.8;
  return caustics;
}

// ----------------------------------------------------------------------------
// 7. GGX Specular & Schlick / Snell's Window Fresnel (WaterFunctions.cginc)
// ----------------------------------------------------------------------------
float distributionGGX(vec3 N, vec3 H, float roughness) {
  float a = roughness * roughness;
  float a2 = max(a * a, 1e-4);
  float NdotH = max(dot(N, H), 0.0);
  float NdotH2 = NdotH * NdotH;
  float denom = (NdotH2 * (a2 - 1.0) + 1.0);
  denom = PI * denom * denom;
  return a2 / max(denom, 1e-5);
}

float geometrySchlickGGX(float NdotV, float roughness) {
  float r = (roughness + 1.0);
  float k = (r * r) / 8.0;
  return NdotV / max(NdotV * (1.0 - k) + k, 1e-5);
}

float geometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
  float NdotV = max(dot(N, V), 0.0);
  float NdotL = max(dot(N, L), 0.0);
  return geometrySchlickGGX(NdotV, roughness) * geometrySchlickGGX(NdotL, roughness);
}

vec3 fresnelSchlickWater(float cosTheta, vec3 F0, float power) {
  return F0 + (1.0 - F0) * pow(saturate(1.0 - cosTheta), power);
}

// Handles both above-water Schlick Fresnel and underwater Snell's Window (Total Internal Reflection)
float computeMochieWaterFresnel(vec3 N, vec3 V, bool isFrontFace, float fresnelPower, float snellsPower) {
  float NdotV = saturate(dot(N, V));
  if (isFrontFace) {
    float f0 = 0.02; // Water IOR = 1.333 -> F0 = 0.02
    return saturate(f0 + (1.0 - f0) * pow(1.0 - NdotV, fresnelPower));
  } else {
    // Looking up from underwater: critical angle for water->air is ~48.6 deg (cos(48.6) = 0.661)
    float criticalCos = 0.661;
    float snellRim = 1.0 - smoothstep(criticalCos - 0.18, criticalCos + 0.06, NdotV);
    float baseFresnel = pow(1.0 - NdotV, snellsPower);
    return saturate(mix(baseFresnel, 1.0, snellRim));
  }
}

#endif
