// ============================================================================
// Mochie's Water Shader — Pure CPU Math & Preset Definitions
// Exact CPU counterpart to WaterFunctions.glsl for:
//  - getWaveHeightAt(x, z, time) & full Gerstner displacement + analytical TBN
//  - Depth linearization (perspectiveDepthToViewZ, viewZToOrthographicDepth)
//  - Schlick Fresnel & Snell's Window Total Internal Reflection
//  - Curated Mochie Water & Underwater Material Presets
// ============================================================================

export interface WaveLayerConfig {
  enabled: boolean;
  steepness: number;   // Q (0..1)
  wavelength: number;  // L in meters
  direction: number;   // Degrees (0..360)
  speed: number;       // Speed multiplier
  phaseOffset: number; // Radians
}

export interface GerstnerConfig {
  wavesToggle: boolean;
  waterLevel: number;
  globalAmp: number;
  globalSpeed: number;
  globalScale: number;
  waveNormalStr: number;
  warpStrength: number;
  warpScale: number;
  warpSpeed: number;
  waves: [WaveLayerConfig, WaveLayerConfig, WaveLayerConfig, WaveLayerConfig];
}

export interface GerstnerSample {
  displacement: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
  tangent: { x: number; y: number; z: number };
  binormal: { x: number; y: number; z: number };
  crestFactor: number;
  surfaceHeight: number;
}

export interface MochieWaterPreset {
  id: string;
  name: string;
  tagline: string;
  // Surface
  surfaceColor: string;
  angleTint: string;
  backfaceTint: string;
  opacity: number;
  roughness: number;
  metallic: number;
  // Normal Maps & Flow
  normalStr0: number;
  normalScale0: [number, number];
  normalScroll0: [number, number];
  normalStr1: number;
  normalScale1: [number, number];
  normalScroll1: [number, number];
  detailNormalBlend: number;
  stochasticToggle: boolean;
  flowToggle: boolean;
  flowSpeed: number;
  flowStrength: number;
  flowScale: number;
  // Specular & Reflections
  reflections: boolean;
  reflStrength: number;
  reflTint: string;
  fresnelPower: number;
  specToggle: boolean;
  specStrength: number;
  specRoughness: number;
  specTint: string;
  snellsWindowPower: number;
  // Refraction, Fog & SSS
  refractionStrength: number;
  chromAberration: number;
  fogToggle: boolean;
  fogTint: string;
  fogPower: number;
  fogBrightness: number;
  sssToggle: boolean;
  sssTint: string;
  sssPower: number;
  sssIntensity: number;
  sssHeightBias: number;
  // Caustics
  causticsToggle: boolean;
  causticsColor: string;
  causticsOpacity: number;
  causticsScale: number;
  causticsSpeed: number;
  causticsPower: number;
  causticsFade: number;
  causticsDisp: number;
  causticsDistortion: number;
  causticsSurfaceFade: number;
  // Foam
  foamToggle: boolean;
  foamColor: string;
  foamOpacity: number;
  foamEdgeDepth: number;
  foamEdgePower: number;
  foamScale: [number, number];
  foamScroll: [number, number];
  foamNoiseStr: number;
  crestFoamToggle: boolean;
  crestFoamThreshold: number;
  crestFoamPower: number;
  crestFoamStrength: number;
  // Gerstner Waves
  gerstner: GerstnerConfig;
  // Underwater
  underwaterEnabled: boolean;
  underwaterFogColor: string;
  underwaterFogDensity: number;
  underwaterCausticsStr: number;
  underwaterDistortion: number;
  underwaterBlurStr: number;
  meniscusWidth: number;
  meniscusColor: string;
}

const TWO_PI = Math.PI * 2.0;

export function saturate(x: number): number {
  return Math.max(0.0, Math.min(1.0, x));
}

export function fract(x: number): number {
  return x - Math.floor(x);
}

export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hash22CPU(px: number, py: number): [number, number] {
  const d1 = px * 127.1 + py * 311.7;
  const d2 = px * 269.5 + py * 183.3;
  return [
    -1.0 + 2.0 * fract(Math.sin(d1) * 43758.5453123),
    -1.0 + 2.0 * fract(Math.sin(d2) * 43758.5453123),
  ];
}

export function gradientNoise2DCPU(px: number, py: number): number {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const fx = px - ix;
  const fy = py - iy;
  const ux = fx * fx * (3.0 - 2.0 * fx);
  const uy = fy * fy * (3.0 - 2.0 * fy);

  const g00 = hash22CPU(ix, iy);
  const g10 = hash22CPU(ix + 1, iy);
  const g01 = hash22CPU(ix, iy + 1);
  const g11 = hash22CPU(ix + 1, iy + 1);

  const n00 = g00[0] * fx + g00[1] * fy;
  const n10 = g10[0] * (fx - 1.0) + g10[1] * fy;
  const n01 = g01[0] * fx + g01[1] * (fy - 1.0);
  const n11 = g11[0] * (fx - 1.0) + g11[1] * (fy - 1.0);

  return mix(mix(n00, n10, ux), mix(n01, n11, ux), uy);
}

export function computeWaveWarpOffsetCPU(
  worldX: number,
  worldZ: number,
  warpStrength: number,
  warpScale: number,
  warpSpeed: number,
  time: number
): [number, number] {
  if (warpStrength <= 0.0001) return [0.0, 0.0];
  const px = worldX * (0.08 * warpScale) + time * warpSpeed * 0.25;
  const pz = worldZ * (0.08 * warpScale) - time * warpSpeed * 0.19;
  const nx = gradientNoise2DCPU(px, pz);
  const nz = gradientNoise2DCPU(px + 17.3, pz + 43.7);
  return [nx * warpStrength * 3.5, nz * warpStrength * 3.5];
}

export function evaluateGerstnerWavesCPU(
  worldX: number,
  worldZ: number,
  time: number,
  config: GerstnerConfig
): GerstnerSample {
  if (!config.wavesToggle) {
    return {
      displacement: { x: 0, y: 0, z: 0 },
      normal: { x: 0, y: 1, z: 0 },
      tangent: { x: 1, y: 0, z: 0 },
      binormal: { x: 0, y: 0, z: 1 },
      crestFactor: 0,
      surfaceHeight: config.waterLevel,
    };
  }

  const [warpX, warpZ] = computeWaveWarpOffsetCPU(
    worldX,
    worldZ,
    config.warpStrength,
    config.warpScale,
    config.warpSpeed,
    time
  );
  const sampleX = worldX + warpX;
  const sampleZ = worldZ + warpZ;

  let dx = 0;
  let dy = 0;
  let dz = 0;
  let tx = 1;
  let ty = 0;
  let tz = 0;
  let bx = 0;
  let by = 0;
  let bz = 1;
  let crestAccum = 0;
  let activeWeight = 0;

  for (let i = 0; i < 4; i++) {
    const w = config.waves[i];
    if (!w || !w.enabled) continue;

    const steepness = w.steepness * config.globalAmp;
    const wavelength = Math.max(w.wavelength / Math.max(config.globalScale, 0.05), 0.25);
    const rad = (w.direction * Math.PI) / 180.0;
    const dirX = Math.cos(rad);
    const dirZ = Math.sin(rad);
    const k = TWO_PI / wavelength;
    const c = Math.sqrt(9.8 / k) * w.speed * config.globalSpeed;
    const a = steepness / k;

    const f = k * (dirX * sampleX + dirZ * sampleZ - c * time) + w.phaseOffset;
    const sinF = Math.sin(f);
    const cosF = Math.cos(f);

    dx += dirX * (a * cosF);
    dy += a * sinF;
    dz += dirZ * (a * cosF);

    const wa = k * a;
    tx += -dirX * dirX * (wa * sinF);
    ty += dirX * (wa * cosF);
    tz += -dirX * dirZ * (wa * sinF);

    bx += -dirX * dirZ * (wa * sinF);
    by += dirZ * (wa * cosF);
    bz += -dirZ * dirZ * (wa * sinF);

    crestAccum += saturate(sinF * 0.5 + 0.5) * steepness;
    activeWeight += Math.max(w.steepness, 0.05);
  }

  const tLen = Math.hypot(tx, ty, tz) || 1;
  tx /= tLen;
  ty /= tLen;
  tz /= tLen;

  const bLen = Math.hypot(bx, by, bz) || 1;
  bx /= bLen;
  by /= bLen;
  bz /= bLen;

  // cross(binormal, tangent)
  let rnx = by * tz - bz * ty;
  let rny = bz * tx - bx * tz;
  let rnz = bx * ty - by * tx;
  const rnLen = Math.hypot(rnx, rny, rnz) || 1;
  rnx /= rnLen;
  rny /= rnLen;
  rnz /= rnLen;

  let nx = mix(0, rnx, config.waveNormalStr);
  let ny = mix(1, rny, config.waveNormalStr);
  let nz = mix(0, rnz, config.waveNormalStr);
  const nLen = Math.hypot(nx, ny, nz) || 1;
  nx /= nLen;
  ny /= nLen;
  nz /= nLen;

  const crestFactor = activeWeight > 0 ? saturate(crestAccum / activeWeight) : 0;

  return {
    displacement: { x: dx, y: dy, z: dz },
    normal: { x: nx, y: ny, z: nz },
    tangent: { x: tx, y: ty, z: tz },
    binormal: { x: bx, y: by, z: bz },
    crestFactor,
    surfaceHeight: config.waterLevel + dy,
  };
}

export function perspectiveDepthToViewZCPU(depth: number, near: number, far: number): number {
  const zNdc = 2.0 * depth - 1.0;
  return (2.0 * near * far) / (zNdc * (far - near) - (far + near));
}

export function viewZToOrthographicDepthCPU(viewZ: number, near: number, far: number): number {
  return saturate((-viewZ - near) / (far - near));
}

export function computeMochieWaterFresnelCPU(
  NdotV: number,
  isFrontFace: boolean,
  fresnelPower: number,
  snellsPower: number
): number {
  const clamped = saturate(NdotV);
  if (isFrontFace) {
    const f0 = 0.02;
    return saturate(f0 + (1.0 - f0) * Math.pow(1.0 - clamped, fresnelPower));
  } else {
    const criticalCos = 0.661;
    const t = saturate((clamped - (criticalCos - 0.18)) / 0.24);
    const smooth = t * t * (3.0 - 2.0 * t);
    const snellRim = 1.0 - smooth;
    const baseFresnel = Math.pow(1.0 - clamped, snellsPower);
    return saturate(mix(baseFresnel, 1.0, snellRim));
  }
}

export const MOCHIE_WATER_PRESETS: Record<string, MochieWaterPreset> = {
  emeraldPier: {
    id: 'emeraldPier',
    name: 'Emerald Coastal Pier',
    tagline: 'Mochie Showcase Default — Balanced Gerstner swells, turquoise SSS & crisp Voronoi caustics',
    surfaceColor: '#cffafe',
    angleTint: '#0369a1',
    backfaceTint: '#2dd4bf',
    opacity: 0.98,
    roughness: 0.06,
    metallic: 0.02,
    normalStr0: 0.76,
    normalScale0: [1.45, 1.45],
    normalScroll0: [0.045, 0.032],
    normalStr1: 0.58,
    normalScale1: [2.75, 2.75],
    normalScroll1: [-0.038, 0.051],
    detailNormalBlend: 0.82,
    stochasticToggle: false,
    flowToggle: true,
    flowSpeed: 0.28,
    flowStrength: 0.22,
    flowScale: 0.45,
    reflections: true,
    reflStrength: 0.94,
    reflTint: '#e0f2fe',
    fresnelPower: 3.8,
    specToggle: true,
    specStrength: 1.85,
    specRoughness: 0.058,
    specTint: '#fff7ed',
    snellsWindowPower: 3.2,
    refractionStrength: 0.068,
    chromAberration: 0.24,
    fogToggle: true,
    fogTint: '#042f42',
    fogPower: 0.48,
    fogBrightness: 0.88,
    sssToggle: true,
    sssTint: '#06b6d4',
    sssPower: 2.8,
    sssIntensity: 1.55,
    sssHeightBias: 0.22,
    causticsToggle: true,
    causticsColor: '#7dd3fc',
    causticsOpacity: 1.85,
    causticsScale: 3.6,
    causticsSpeed: 1.15,
    causticsPower: 1.65,
    causticsFade: 8.5,
    causticsDisp: 0.032,
    causticsDistortion: 0.28,
    causticsSurfaceFade: 0.16,
    foamToggle: true,
    foamColor: '#f8fafc',
    foamOpacity: 0.92,
    foamEdgeDepth: 0.72,
    foamEdgePower: 1.35,
    foamScale: [3.6, 3.6],
    foamScroll: [0.03, -0.025],
    foamNoiseStr: 0.14,
    crestFoamToggle: true,
    crestFoamThreshold: 0.54,
    crestFoamPower: 1.6,
    crestFoamStrength: 1.25,
    gerstner: {
      wavesToggle: true,
      waterLevel: 0.0,
      globalAmp: 1.0,
      globalSpeed: 1.0,
      globalScale: 1.0,
      waveNormalStr: 0.88,
      warpStrength: 0.24,
      warpScale: 1.1,
      warpSpeed: 0.75,
      waves: [
        { enabled: true, steepness: 0.28, wavelength: 14.0, direction: 18.0, speed: 1.0, phaseOffset: 0.0 },
        { enabled: true, steepness: 0.22, wavelength: 8.5, direction: -34.0, speed: 1.12, phaseOffset: 1.2 },
        { enabled: true, steepness: 0.16, wavelength: 5.2, direction: 58.0, speed: 0.95, phaseOffset: 2.5 },
        { enabled: true, steepness: 0.12, wavelength: 3.1, direction: -72.0, speed: 1.25, phaseOffset: 3.8 },
      ],
    },
    underwaterEnabled: true,
    underwaterFogColor: '#053b4e',
    underwaterFogDensity: 0.072,
    underwaterCausticsStr: 1.45,
    underwaterDistortion: 1.0,
    underwaterBlurStr: 0.75,
    meniscusWidth: 0.028,
    meniscusColor: '#e0f2fe',
  },
  tropicalLagoon: {
    id: 'tropicalLagoon',
    name: 'Tropical Coral Lagoon',
    tagline: 'Crystal-clear shallow water, vivid rainbow dispersion caustics & gentle ripples',
    surfaceColor: '#ecfeff',
    angleTint: '#06b6d4',
    backfaceTint: '#99f6e4',
    opacity: 0.96,
    roughness: 0.05,
    metallic: 0.01,
    normalStr0: 0.45,
    normalScale0: [1.5, 1.5],
    normalScroll0: [0.035, 0.025],
    normalStr1: 0.35,
    normalScale1: [2.8, 2.8],
    normalScroll1: [-0.03, 0.04],
    detailNormalBlend: 0.8,
    stochasticToggle: true,
    flowToggle: true,
    flowSpeed: 0.22,
    flowStrength: 0.18,
    flowScale: 0.4,
    reflections: true,
    reflStrength: 0.85,
    reflTint: '#f0f9ff',
    fresnelPower: 5.0,
    specToggle: true,
    specStrength: 1.65,
    specRoughness: 0.055,
    specTint: '#ffffff',
    snellsWindowPower: 3.5,
    refractionStrength: 0.08,
    chromAberration: 0.28,
    fogToggle: true,
    fogTint: '#086778',
    fogPower: 0.13,
    fogBrightness: 1.1,
    sssToggle: true,
    sssTint: '#2dd4bf',
    sssPower: 2.8,
    sssIntensity: 1.6,
    sssHeightBias: 0.22,
    causticsToggle: true,
    causticsColor: '#a5f3fc',
    causticsOpacity: 1.85,
    causticsScale: 3.8,
    causticsSpeed: 1.3,
    causticsPower: 1.6,
    causticsFade: 10.5,
    causticsDisp: 0.042,
    causticsDistortion: 0.32,
    causticsSurfaceFade: 0.18,
    foamToggle: true,
    foamColor: '#ffffff',
    foamOpacity: 0.85,
    foamEdgeDepth: 0.62,
    foamEdgePower: 1.5,
    foamScale: [3.6, 3.6],
    foamScroll: [0.02, -0.02],
    foamNoiseStr: 0.12,
    crestFoamToggle: true,
    crestFoamThreshold: 0.65,
    crestFoamPower: 1.8,
    crestFoamStrength: 0.85,
    gerstner: {
      wavesToggle: true,
      waterLevel: 0.0,
      globalAmp: 0.55,
      globalSpeed: 0.85,
      globalScale: 1.15,
      waveNormalStr: 0.75,
      warpStrength: 0.15,
      warpScale: 1.0,
      warpSpeed: 0.6,
      waves: [
        { enabled: true, steepness: 0.22, wavelength: 12.0, direction: 12.0, speed: 0.9, phaseOffset: 0.0 },
        { enabled: true, steepness: 0.18, wavelength: 7.5, direction: -28.0, speed: 1.0, phaseOffset: 1.1 },
        { enabled: true, steepness: 0.14, wavelength: 4.5, direction: 45.0, speed: 0.95, phaseOffset: 2.2 },
        { enabled: true, steepness: 0.1, wavelength: 2.8, direction: -60.0, speed: 1.1, phaseOffset: 3.3 },
      ],
    },
    underwaterEnabled: true,
    underwaterFogColor: '#065f73',
    underwaterFogDensity: 0.042,
    underwaterCausticsStr: 1.55,
    underwaterDistortion: 0.85,
    underwaterBlurStr: 0.55,
    meniscusWidth: 0.028,
    meniscusColor: '#e0f2fe',
  },
  deepAtlantic: {
    id: 'deepAtlantic',
    name: 'North Atlantic Swell',
    tagline: 'High-amplitude Gerstner chop, heavy whitecap crest foam & dense navy depth fog',
    surfaceColor: '#bae6fd',
    angleTint: '#1e3a8a',
    backfaceTint: '#38bdf8',
    opacity: 0.99,
    roughness: 0.14,
    metallic: 0.05,
    normalStr0: 0.88,
    normalScale0: [1.1, 1.1],
    normalScroll0: [0.075, 0.052],
    normalStr1: 0.72,
    normalScale1: [2.2, 2.2],
    normalScroll1: [-0.06, 0.078],
    detailNormalBlend: 0.9,
    stochasticToggle: true,
    flowToggle: true,
    flowSpeed: 0.42,
    flowStrength: 0.35,
    flowScale: 0.55,
    reflections: true,
    reflStrength: 0.98,
    reflTint: '#cbd5e1',
    fresnelPower: 4.0,
    specToggle: true,
    specStrength: 1.25,
    specRoughness: 0.12,
    specTint: '#f8fafc',
    snellsWindowPower: 2.8,
    refractionStrength: 0.055,
    chromAberration: 0.12,
    fogToggle: true,
    fogTint: '#061c2e',
    fogPower: 0.42,
    fogBrightness: 0.85,
    sssToggle: true,
    sssTint: '#0284c7',
    sssPower: 3.8,
    sssIntensity: 1.15,
    sssHeightBias: 0.25,
    causticsToggle: true,
    causticsColor: '#38bdf8',
    causticsOpacity: 0.85,
    causticsScale: 2.8,
    causticsSpeed: 1.4,
    causticsPower: 2.1,
    causticsFade: 5.5,
    causticsDisp: 0.018,
    causticsDistortion: 0.4,
    causticsSurfaceFade: 0.3,
    foamToggle: true,
    foamColor: '#f1f5f9',
    foamOpacity: 0.98,
    foamEdgeDepth: 1.15,
    foamEdgePower: 1.1,
    foamScale: [2.8, 2.8],
    foamScroll: [0.055, -0.04],
    foamNoiseStr: 0.22,
    crestFoamToggle: true,
    crestFoamThreshold: 0.46,
    crestFoamPower: 1.35,
    crestFoamStrength: 1.75,
    gerstner: {
      wavesToggle: true,
      waterLevel: 0.0,
      globalAmp: 1.55,
      globalSpeed: 1.28,
      globalScale: 0.92,
      waveNormalStr: 0.95,
      warpStrength: 0.38,
      warpScale: 1.25,
      warpSpeed: 1.05,
      waves: [
        { enabled: true, steepness: 0.34, wavelength: 16.0, direction: 22.0, speed: 1.1, phaseOffset: 0.0 },
        { enabled: true, steepness: 0.28, wavelength: 9.8, direction: -42.0, speed: 1.2, phaseOffset: 1.5 },
        { enabled: true, steepness: 0.22, wavelength: 6.0, direction: 64.0, speed: 1.05, phaseOffset: 2.9 },
        { enabled: true, steepness: 0.16, wavelength: 3.6, direction: -78.0, speed: 1.35, phaseOffset: 4.1 },
      ],
    },
    underwaterEnabled: true,
    underwaterFogColor: '#041829',
    underwaterFogDensity: 0.095,
    underwaterCausticsStr: 0.75,
    underwaterDistortion: 1.35,
    underwaterBlurStr: 1.15,
    meniscusWidth: 0.038,
    meniscusColor: '#93c5fd',
  },
};
