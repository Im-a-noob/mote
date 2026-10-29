// ============================================================================
// Mochie's Water & Underwater Shader — Interactive Coastal Pier Demo Scene
// (src/demo/main.js)
// Features:
//  - High-resolution 512x512 procedural PBR wood, concrete, and sand albedo + bump maps
//  - Weathered wooden pier pilings, X-bracing, stringers & plank decking (THREE.Group)
//  - Cylindrical reinforced concrete support pillar standing in the water
//  - Sculpted coastal seabed with submerged stone slabs & natural rock outcrops
//  - Buoyant coastal navigation buoy driven by CPU Gerstner wave sampling
//  - Custom Rayleigh/Mie Atmospheric Sky + Cirrus Clouds + Ocean Horizon Dome
//  - Camera controller with "Dip Underwater / Bobbing" toggle & OrbitControls
//  - Categorized lil-gui inspector matching Mochie's Unity Custom Editor tabs
// ============================================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import GUI from 'lil-gui';

import { MochieWaterMaterial } from '../lib/MochieWaterMaterial.js';
import { MochieWater } from '../lib/MochieWater.js';
import { MochieUnderwaterPass } from '../lib/MochieUnderwaterPass.js';
import { MOCHIE_WATER_PRESETS } from '../lib/mochieWaterMath';

// Pre-allocated math scratch objects (Zero GC in render loop)
const _sunPos = new THREE.Vector3();
const _buoySamplePos = new THREE.Vector3(6.6, 0, 5.0);
const _upVec = new THREE.Vector3(0, 1, 0);
const _targetNormal = new THREE.Vector3();
const _buoyQuat = new THREE.Quaternion();

const _camForward = new THREE.Vector3();

export const CAMERA_VIEW_PRESETS = {
  overview: {
    id: 'overview',
    label: 'Pier Overview',
    position: [13.2, 4.2, 15.0],
    target: [-1.2, -0.5, -0.2],
  },
  caustics: {
    id: 'caustics',
    label: 'Caustics & Pillar',
    position: [4.8, 3.1, 5.6],
    target: [-0.8, -1.6, -0.6],
  },
  meniscus: {
    id: 'meniscus',
    label: 'Split Meniscus',
    position: [7.6, 0.02, 8.2],
    target: [-1.5, -0.05, -0.5],
  },
  underwater: {
    id: 'underwater',
    label: 'Submerged View',
    position: [7.2, -1.85, 7.8],
    target: [-1.4, -0.95, -0.6],
  },
};

function smoothHash2D(x, y, seed = 0) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3.0 - 2.0 * fx);
  const v = fy * fy * (3.0 - 2.0 * fy);

  const h = (px, py) => {
    const s = Math.sin(px * 127.1 + py * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };

  const n00 = h(ix, iy);
  const n10 = h(ix + 1, iy);
  const n01 = h(ix, iy + 1);
  const n11 = h(ix + 1, iy + 1);

  return (n00 * (1 - u) + n10 * u) * (1 - v) + (n01 * (1 - u) + n11 * u) * v;
}

function fbm2D(x, y, octaves = 4, seed = 0) {
  let val = 0;
  let amp = 0.5;
  let freq = 1.0;
  for (let i = 0; i < octaves; i++) {
    val += smoothHash2D(x * freq, y * freq, seed + i * 17) * amp;
    freq *= 2.02;
    amp *= 0.5;
  }
  return val;
}

// ----------------------------------------------------------------------------
// Physically Calibrated Rayleigh/Mie Atmospheric Sky + Cirrus Clouds +
// Deep Marine Lower Hemisphere Shader (Prevents HDR blowout & black underwater void)
// ----------------------------------------------------------------------------
function createRealisticSkyDome() {
  const skyGeo = new THREE.SphereGeometry(480, 48, 32);
  const skyMat = new THREE.ShaderMaterial({
    name: 'MochieAtmosphericSkyDome',
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uSunDirection: { value: new THREE.Vector3(0.58, 0.52, -0.62).normalize() },
      uTime: { value: 0.0 },
    },
    vertexShader: `
      varying vec3 vWorldDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldDir = wp.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uSunDirection;
      uniform float uTime;
      varying vec3 vWorldDir;

      float hash21(vec2 p) {
        p = fract(p * vec2(234.34, 435.345));
        p += dot(p, p + 34.23);
        return fract(p.x * p.y);
      }

      float valueNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
          mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }

      float cloudFBM(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
        for (int i = 0; i < 4; i++) {
          v += a * valueNoise(p);
          p = rot * p * 2.05;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec3 dir = normalize(vWorldDir);
        vec3 sunDir = normalize(uSunDirection);
        float sunCos = clamp(dot(dir, sunDir), -1.0, 1.0);
        float sunElev = clamp(sunDir.y, 0.05, 1.0);

        vec3 horizonCol = vec3(0.56, 0.76, 0.90);

        if (dir.y >= -0.005) {
          float elev = clamp(dir.y, 0.0, 1.0);
          // Rich Rayleigh sky gradient: deep cobalt zenith -> coastal azure mid-sky -> horizon haze
          vec3 zenithCol = mix(vec3(0.03, 0.14, 0.38), vec3(0.05, 0.22, 0.54), sunElev);
          vec3 midSkyCol = mix(vec3(0.12, 0.36, 0.68), vec3(0.16, 0.44, 0.78), sunElev);

          vec3 skyCol = mix(horizonCol, midSkyCol, smoothstep(0.0, 0.14, elev));
          skyCol = mix(skyCol, zenithCol, pow(smoothstep(0.10, 0.75, elev), 0.75));

          // Warm Mie forward-scattering solar aureole & horizon glow
          float mieHaze = pow(clamp(sunCos * 0.5 + 0.5, 0.0, 1.0), 4.0) * exp(-elev * 4.5);
          float solarGlow = pow(max(sunCos, 0.0), 18.0) * 0.42 + pow(max(sunCos, 0.0), 160.0) * 0.85;
          float solarDisk = smoothstep(0.9991, 0.9997, sunCos) * 4.5;

          vec3 warmSunTint = vec3(1.0, 0.88, 0.68);
          skyCol += warmSunTint * (mieHaze * 0.26 + solarGlow + solarDisk);

          // High-altitude drifting coastal clouds
          if (elev > 0.025) {
            vec2 cloudUV = dir.xz / (elev + 0.14) * 0.85 + vec2(uTime * 0.008, -uTime * 0.005);
            float c1 = cloudFBM(cloudUV);
            float c2 = cloudFBM(cloudUV * 2.1 + vec2(4.2, -1.7));
            float cloudMask = smoothstep(0.52, 0.80, c1 * 0.65 + c2 * 0.35) * smoothstep(0.025, 0.14, elev) * (1.0 - smoothstep(0.65, 0.98, elev) * 0.5);
            vec3 cloudLit = mix(vec3(0.84, 0.91, 0.97), vec3(1.0, 0.95, 0.86), pow(max(sunCos, 0.0), 2.5));
            skyCol = mix(skyCol, cloudLit, cloudMask * 0.52);
          }

          gl_FragColor = vec4(skyCol, 1.0);
        } else {
          // Lower hemisphere (underwater / below-horizon fallback): smooth blend from horizon into deep ocean
          float downDepth = clamp(-dir.y, 0.0, 1.0);
          vec3 upperSub = vec3(0.04, 0.28, 0.38);
          vec3 deepAbyss = vec3(0.01, 0.09, 0.16);
          vec3 subCol = mix(upperSub, deepAbyss, pow(downDepth, 0.65));
          float rimBlend = smoothstep(0.0, 0.04, downDepth);
          gl_FragColor = vec4(mix(horizonCol, subCol, rimBlend), 1.0);
        }
      }
    `,
  });
  const mesh = new THREE.Mesh(skyGeo, skyMat);
  mesh.name = 'AtmosphericSkyDome';
  return mesh;
}

// ----------------------------------------------------------------------------
// High-Resolution 512x512 Procedural PBR Albedo & Bump Maps
// ----------------------------------------------------------------------------
function createProceduralWoodTextures(maxAnisotropy) {
  const size = 512;
  const albedoData = new Uint8Array(size * size * 4);
  const bumpData = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      // Continuous wood grain fibers + ring distortion
      const warp = fbm2D(u * 4.0, v * 12.0, 3, 11) * 0.15;
      const grain = Math.sin((u * 28.0 + warp * 14.0) * Math.PI) * 0.5 + 0.5;
      const fineStreak = fbm2D(u * 48.0, v * 6.0, 4, 29);
      const weathering = fbm2D(u * 6.0, v * 6.0, 3, 53);

      // Plank seam grooves every 128px
      const seamDist = Math.min(x % 128, 128 - (x % 128));
      const seamMask = Math.min(1.0, seamDist / 3.5);

      const heightVal = (grain * 0.45 + fineStreak * 0.55) * seamMask;
      const baseR = 92 + (heightVal - 0.5) * 38 - (1.0 - weathering) * 18;
      const baseG = 66 + (heightVal - 0.5) * 28 - (1.0 - weathering) * 14;
      const baseB = 46 + (heightVal - 0.5) * 20 - (1.0 - weathering) * 10;

      const idx = (y * size + x) * 4;
      albedoData[idx] = Math.max(18, Math.min(255, Math.round(baseR * seamMask)));
      albedoData[idx + 1] = Math.max(14, Math.min(255, Math.round(baseG * seamMask)));
      albedoData[idx + 2] = Math.max(10, Math.min(255, Math.round(baseB * seamMask)));
      albedoData[idx + 3] = 255;

      const bumpByte = Math.max(0, Math.min(255, Math.round(heightVal * 255)));
      bumpData[idx] = bumpByte;
      bumpData[idx + 1] = bumpByte;
      bumpData[idx + 2] = bumpByte;
      bumpData[idx + 3] = 255;
    }
  }

  const map = new THREE.DataTexture(albedoData, size, size, THREE.RGBAFormat);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = maxAnisotropy;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.needsUpdate = true;

  const bumpMap = new THREE.DataTexture(bumpData, size, size, THREE.RGBAFormat);
  bumpMap.colorSpace = THREE.NoColorSpace;
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.anisotropy = maxAnisotropy;
  bumpMap.generateMipmaps = true;
  bumpMap.minFilter = THREE.LinearMipmapLinearFilter;
  bumpMap.magFilter = THREE.LinearFilter;
  bumpMap.needsUpdate = true;

  return { map, bumpMap };
}

function createProceduralConcreteTextures(maxAnisotropy) {
  const size = 512;
  const albedoData = new Uint8Array(size * size * 4);
  const bumpData = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const macroWeather = fbm2D(u * 8.0, v * 8.0, 4, 71);
      const pores = fbm2D(u * 36.0, v * 36.0, 4, 113);
      const verticalDrip = fbm2D(u * 18.0, v * 3.5, 3, 149);

      // Architectural formwork horizontal seam every 64px
      const formDist = Math.min(y % 64, 64 - (y % 64));
      const formSeam = Math.min(1.0, formDist / 2.5);

      const combined = (macroWeather * 0.45 + pores * 0.35 + verticalDrip * 0.2) * (0.82 + 0.18 * formSeam);
      const lum = Math.round(118 + (combined - 0.5) * 46);

      const idx = (y * size + x) * 4;
      albedoData[idx] = Math.max(40, Math.min(220, lum));
      albedoData[idx + 1] = Math.max(44, Math.min(225, lum + 4));
      albedoData[idx + 2] = Math.max(48, Math.min(230, lum + 9));
      albedoData[idx + 3] = 255;

      const bumpByte = Math.max(0, Math.min(255, Math.round(combined * formSeam * 255)));
      bumpData[idx] = bumpByte;
      bumpData[idx + 1] = bumpByte;
      bumpData[idx + 2] = bumpByte;
      bumpData[idx + 3] = 255;
    }
  }

  const map = new THREE.DataTexture(albedoData, size, size, THREE.RGBAFormat);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(2, 2);
  map.anisotropy = maxAnisotropy;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.needsUpdate = true;

  const bumpMap = new THREE.DataTexture(bumpData, size, size, THREE.RGBAFormat);
  bumpMap.colorSpace = THREE.NoColorSpace;
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(2, 2);
  bumpMap.anisotropy = maxAnisotropy;
  bumpMap.generateMipmaps = true;
  bumpMap.minFilter = THREE.LinearMipmapLinearFilter;
  bumpMap.magFilter = THREE.LinearFilter;
  bumpMap.needsUpdate = true;

  return { map, bumpMap };
}

function createProceduralSandTextures(maxAnisotropy) {
  const size = 512;
  const albedoData = new Uint8Array(size * size * 4);
  const bumpData = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const warp = fbm2D(u * 6.0, v * 6.0, 3, 211) * 0.22;
      const ripple = Math.sin((u * 14.0 + warp * 8.0) * Math.PI * 2.0) * 0.5 + 0.5;
      const grain = fbm2D(u * 32.0, v * 32.0, 4, 263);

      const heightVal = ripple * 0.62 + grain * 0.38;
      // Calibrated wet coastal seabed sand albedo so sunlight + caustics don't over-expose
      const base = Math.round(108 + (heightVal - 0.5) * 32);

      const idx = (y * size + x) * 4;
      albedoData[idx] = Math.max(45, Math.min(180, base + 8));
      albedoData[idx + 1] = Math.max(45, Math.min(180, base + 2));
      albedoData[idx + 2] = Math.max(40, Math.min(170, base - 12));
      albedoData[idx + 3] = 255;

      const bumpByte = Math.max(0, Math.min(255, Math.round(heightVal * 255)));
      bumpData[idx] = bumpByte;
      bumpData[idx + 1] = bumpByte;
      bumpData[idx + 2] = bumpByte;
      bumpData[idx + 3] = 255;
    }
  }

  const map = new THREE.DataTexture(albedoData, size, size, THREE.RGBAFormat);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(16, 16);
  map.anisotropy = maxAnisotropy;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.needsUpdate = true;

  const bumpMap = new THREE.DataTexture(bumpData, size, size, THREE.RGBAFormat);
  bumpMap.colorSpace = THREE.NoColorSpace;
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(16, 16);
  bumpMap.anisotropy = maxAnisotropy;
  bumpMap.generateMipmaps = true;
  bumpMap.minFilter = THREE.LinearMipmapLinearFilter;
  bumpMap.magFilter = THREE.LinearFilter;
  bumpMap.needsUpdate = true;

  return { map, bumpMap };
}

function buildCoastalPierScene(renderer, maxAnisotropy) {
  const environmentGroup = new THREE.Group();
  environmentGroup.name = 'CoastalPierEnvironment';

  const woodMaps = createProceduralWoodTextures(maxAnisotropy);
  const concreteMaps = createProceduralConcreteTextures(maxAnisotropy);
  const sandMaps = createProceduralSandTextures(maxAnisotropy);

  // 1. Sculpted Seabed Terrain
  const seabedGeo = new THREE.PlaneGeometry(180, 180, 96, 96);
  seabedGeo.rotateX(-Math.PI / 2);
  const posAttr = seabedGeo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    const distFromPillar = Math.hypot((x + 1.8) * 0.55, (z + 1.2) * 0.55);
    const undulation =
      Math.sin(x * 0.16) * Math.cos(z * 0.14) * 0.38 +
      Math.sin((x + z) * 0.32) * 0.16;
    // Gradual slope from -1.45m under the pier to -6.8m in the foreground/offshore channel
    const depthProfile = -1.55 - Math.min(5.6, Math.pow(distFromPillar / 18.0, 1.25) * 3.8) + undulation;
    posAttr.setY(i, depthProfile);
  }
  seabedGeo.computeVertexNormals();

  const seabedMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: sandMaps.map,
    bumpMap: sandMaps.bumpMap,
    bumpScale: 0.08,
    roughness: 0.9,
    metalness: 0.02,
  });
  const seabedMesh = new THREE.Mesh(seabedGeo, seabedMat);
  seabedMesh.receiveShadow = true;
  environmentGroup.add(seabedMesh);

  // 2. Hero Cylindrical Concrete Support Pillar (Multi-part THREE.Group recreating Mochie's showcase)
  const concretePillarGroup = new THREE.Group();
  concretePillarGroup.name = 'ConcreteSupportPillar';
  concretePillarGroup.position.set(-1.8, 0, -1.2);

  const concreteMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: concreteMaps.map,
    bumpMap: concreteMaps.bumpMap,
    bumpScale: 0.035,
    roughness: 0.76,
    metalness: 0.06,
  });
  const wetConcreteMat = new THREE.MeshStandardMaterial({
    color: 0x7a8896,
    map: concreteMaps.map,
    bumpMap: concreteMaps.bumpMap,
    bumpScale: 0.04,
    roughness: 0.34,
    metalness: 0.1,
  });
  const ironCollarMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.38,
    metalness: 0.85,
  });

  // Main cylindrical concrete shaft
  const shaftGeo = new THREE.CylinderGeometry(1.35, 1.48, 8.2, 48);
  const shaftMesh = new THREE.Mesh(shaftGeo, concreteMat);
  shaftMesh.position.y = 0.4;
  shaftMesh.castShadow = true;
  shaftMesh.receiveShadow = true;
  concretePillarGroup.add(shaftMesh);

  // Dark wet tidal & marine algae collar around the waterline
  const tidalBandGeo = new THREE.CylinderGeometry(1.41, 1.44, 1.35, 48);
  const tidalBandMesh = new THREE.Mesh(tidalBandGeo, wetConcreteMat);
  tidalBandMesh.position.y = -0.15;
  concretePillarGroup.add(tidalBandMesh);

  // Stepped submerged concrete plinth base (catches projected Voronoi caustics at -1.2m and -2.1m)
  const upperPlinthGeo = new THREE.CylinderGeometry(1.88, 2.18, 0.9, 40);
  const upperPlinthMesh = new THREE.Mesh(upperPlinthGeo, concreteMat);
  upperPlinthMesh.position.y = -1.25;
  upperPlinthMesh.receiveShadow = true;
  concretePillarGroup.add(upperPlinthMesh);

  const lowerFootingGeo = new THREE.CylinderGeometry(2.58, 2.88, 1.1, 40);
  const lowerFootingMesh = new THREE.Mesh(lowerFootingGeo, concreteMat);
  lowerFootingMesh.position.y = -2.15;
  lowerFootingMesh.receiveShadow = true;
  concretePillarGroup.add(lowerFootingMesh);

  // Steel reinforcement rings & flared capital cap
  for (const ringY of [1.2, 2.8, 4.1]) {
    const ringGeo = new THREE.TorusGeometry(1.38, 0.06, 14, 48);
    ringGeo.rotateX(Math.PI / 2);
    const ringMesh = new THREE.Mesh(ringGeo, ironCollarMat);
    ringMesh.position.y = ringY;
    concretePillarGroup.add(ringMesh);
  }

  const capitalGeo = new THREE.CylinderGeometry(1.72, 1.42, 0.58, 48);
  const capitalMesh = new THREE.Mesh(capitalGeo, concreteMat);
  capitalMesh.position.y = 4.55;
  capitalMesh.castShadow = true;
  concretePillarGroup.add(capitalMesh);

  environmentGroup.add(concretePillarGroup);

  // 3. Weathered Wooden Coastal Pier (Multi-part THREE.Group with pilings, X-bracing, stringers & planks)
  const pierGroup = new THREE.Group();
  pierGroup.name = 'WeatheredTimberPier';

  const timberMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: woodMaps.map,
    bumpMap: woodMaps.bumpMap,
    bumpScale: 0.04,
    roughness: 0.8,
    metalness: 0.04,
  });
  const wetTimberMat = new THREE.MeshStandardMaterial({
    color: 0x6e5239,
    map: woodMaps.map,
    bumpMap: woodMaps.bumpMap,
    bumpScale: 0.045,
    roughness: 0.34,
    metalness: 0.08,
  });

  const pilingPairsZ = [-9.0, -5.0, -1.0, 3.0, 7.0];
  const pierCenterX = -6.2;
  const pierHalfWidth = 2.1;

  for (let i = 0; i < pilingPairsZ.length; i++) {
    const zPos = pilingPairsZ[i];
    for (const side of [-1, 1]) {
      const xPos = pierCenterX + side * pierHalfWidth;

      const postGeo = new THREE.CylinderGeometry(0.26, 0.29, 7.6, 24);
      const postMesh = new THREE.Mesh(postGeo, timberMat);
      postMesh.position.set(xPos, -0.2, zPos);
      postMesh.castShadow = true;
      postMesh.receiveShadow = true;
      pierGroup.add(postMesh);

      const wetCollarGeo = new THREE.CylinderGeometry(0.272, 0.302, 4.4, 24);
      const wetCollarMesh = new THREE.Mesh(wetCollarGeo, wetTimberMat);
      wetCollarMesh.position.set(xPos, -1.8, zPos);
      pierGroup.add(wetCollarMesh);

      const bandGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.12, 24);
      const bandMesh = new THREE.Mesh(bandGeo, ironCollarMat);
      bandMesh.position.set(xPos, 2.4, zPos);
      pierGroup.add(bandMesh);
    }

    // Horizontal cross-beam connecting the piling pair
    const crossBeamGeo = new THREE.BoxGeometry(pierHalfWidth * 2 + 0.9, 0.28, 0.28);
    const crossBeam = new THREE.Mesh(crossBeamGeo, timberMat);
    crossBeam.position.set(pierCenterX, 2.65, zPos);
    crossBeam.castShadow = true;
    pierGroup.add(crossBeam);

    // Diagonal structural X-bracing between pilings
    const braceLen = Math.hypot(pierHalfWidth * 2, 2.6);
    const braceAngle = Math.atan2(2.6, pierHalfWidth * 2);
    const braceGeo = new THREE.BoxGeometry(braceLen, 0.14, 0.14);

    const braceA = new THREE.Mesh(braceGeo, timberMat);
    braceA.position.set(pierCenterX, 1.25, zPos);
    braceA.rotation.z = braceAngle;
    pierGroup.add(braceA);

    const braceB = new THREE.Mesh(braceGeo, timberMat);
    braceB.position.set(pierCenterX, 1.25, zPos);
    braceB.rotation.z = -braceAngle;
    pierGroup.add(braceB);

    // Submerged lower cross-brace (catches underwater caustics & depth fog at y = -0.85m)
    const subBeamGeo = new THREE.BoxGeometry(pierHalfWidth * 2 + 0.5, 0.22, 0.22);
    const subBeam = new THREE.Mesh(subBeamGeo, wetTimberMat);
    subBeam.position.set(pierCenterX, -0.85, zPos);
    pierGroup.add(subBeam);
  }

  // Longitudinal timber stringers beneath the planks
  for (const side of [-0.85, 0, 0.85]) {
    const stringer = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.24, 18.2),
      timberMat
    );
    stringer.position.set(pierCenterX + side * pierHalfWidth, 2.74, -1.0);
    stringer.castShadow = true;
    pierGroup.add(stringer);
  }

  // Pier wooden deck planks
  const numPlanks = 28;
  const plankGeo = new THREE.BoxGeometry(pierHalfWidth * 2 + 0.7, 0.11, 0.55);
  for (let p = 0; p < numPlanks; p++) {
    const zPlank = -9.6 + p * 0.65;
    const plank = new THREE.Mesh(plankGeo, timberMat);
    plank.position.set(pierCenterX, 2.86, zPlank);
    plank.castShadow = true;
    plank.receiveShadow = true;
    pierGroup.add(plank);
  }

  // Standalone foreground weathered timber pilings in the water (classic Mochie pier showcase)
  const standalonePilings = [
    { x: 2.6, z: -2.8, h: 2.2 },
    { x: 4.1, z: -1.1, h: 1.75 },
    { x: 1.9, z: 2.9, h: 1.45 },
    { x: -0.4, z: 4.4, h: 1.95 },
  ];
  for (const sp of standalonePilings) {
    const pGroup = new THREE.Group();
    pGroup.position.set(sp.x, 0, sp.z);

    const dryPole = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.27, sp.h + 4.4, 24), timberMat);
    dryPole.position.y = (sp.h - 4.4) * 0.5;
    dryPole.castShadow = true;
    dryPole.receiveShadow = true;
    pGroup.add(dryPole);

    const wetBase = new THREE.Mesh(new THREE.CylinderGeometry(0.252, 0.282, 4.4, 24), wetTimberMat);
    wetBase.position.y = -1.85;
    pGroup.add(wetBase);

    for (const rOffset of [-0.14, -0.22, -0.30]) {
      const ropeCap = new THREE.Mesh(new THREE.TorusGeometry(0.255, 0.036, 12, 24), ironCollarMat);
      ropeCap.rotation.x = Math.PI / 2;
      ropeCap.position.y = sp.h + rOffset;
      pGroup.add(ropeCap);
    }

    pierGroup.add(pGroup);
  }

  environmentGroup.add(pierGroup);

  // 4. Submerged Stepped Stone Caustic Calibration Slabs & Coastal Rocks
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    map: concreteMaps.map,
    bumpMap: concreteMaps.bumpMap,
    bumpScale: 0.05,
    roughness: 0.82,
    metalness: 0.04,
  });

  const submergedSlabs = [
    { x: 1.2, y: -0.62, z: -0.2, sx: 2.2, sy: 0.45, sz: 1.8, ry: 0.25 },
    { x: 2.8, y: -1.18, z: 1.1, sx: 2.5, sy: 0.5, sz: 2.1, ry: -0.4 },
    { x: 0.4, y: -1.78, z: 2.6, sx: 2.8, sy: 0.55, sz: 2.2, ry: 0.15 },
    { x: 4.5, y: -2.35, z: 3.2, sx: 3.1, sy: 0.6, sz: 2.5, ry: 0.6 },
  ];
  for (const s of submergedSlabs) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(s.sx, s.sy, s.sz), rockMat);
    slab.position.set(s.x, s.y, s.z);
    slab.rotation.y = s.ry;
    slab.receiveShadow = true;
    environmentGroup.add(slab);
  }

  // Submerged coastal reef boulders resting on the seafloor to catch projected 3D Voronoi caustics
  const coastalGraniteMat = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    map: concreteMaps.map,
    bumpMap: concreteMaps.bumpMap,
    bumpScale: 0.065,
    roughness: 0.88,
    metalness: 0.04,
  });

  const boulderSpecs = [
    { x: -3.8, y: -1.95, z: 3.4, rx: 1.4, ry: 0.65, rz: 1.2, seed: 13 },
    { x: 3.2, y: -2.15, z: -2.4, rx: 1.6, ry: 0.72, rz: 1.35, seed: 47 },
    { x: -0.6, y: -2.05, z: 4.8, rx: 1.25, ry: 0.58, rz: 1.1, seed: 89 },
  ];
  for (const b of boulderSpecs) {
    const boulderGeo = new THREE.IcosahedronGeometry(1.0, 3);
    const bPos = boulderGeo.attributes.position;
    for (let i = 0; i < bPos.count; i++) {
      const vx = bPos.getX(i);
      const vy = bPos.getY(i);
      const vz = bPos.getZ(i);
      const crag1 = Math.abs(fbm2D(vx * 1.9 + b.seed, vz * 1.9 - b.seed, 4, b.seed) * 2.0 - 1.0);
      const crag2 = fbm2D(vy * 3.2 + b.seed, vx * 2.4 + vz * 2.4, 3, b.seed + 19);
      const radialDisp = 0.74 + 0.28 * (1.0 - crag1) + 0.14 * crag2;
      bPos.setXYZ(
        i,
        vx * b.rx * radialDisp,
        vy * b.ry * radialDisp,
        vz * b.rz * radialDisp
      );
    }
    boulderGeo.computeVertexNormals();
    const boulder = new THREE.Mesh(boulderGeo, coastalGraniteMat);
    boulder.position.set(b.x, b.y, b.z);
    boulder.receiveShadow = true;
    environmentGroup.add(boulder);
  }

  // 5. Buoyant Coastal Navigation Buoy (Multi-part THREE.Group driven by Gerstner CPU wave height)
  const buoyGroup = new THREE.Group();
  buoyGroup.name = 'CoastalNavigationBuoy';
  buoyGroup.position.copy(_buoySamplePos);

  const buoyRedMat = new THREE.MeshStandardMaterial({
    color: 0xb91c1c,
    bumpMap: concreteMaps.bumpMap,
    bumpScale: 0.015,
    roughness: 0.38,
    metalness: 0.28,
  });
  const buoyWhiteMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.42,
    metalness: 0.18,
  });
  const beaconMat = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.9,
    roughness: 0.2,
    metalness: 0.1,
  });

  const hullLower = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.42, 0.72, 32), buoyRedMat);
  hullLower.position.y = -0.15;
  buoyGroup.add(hullLower);

  const hullRubRail = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.055, 12, 32), ironCollarMat);
  hullRubRail.rotation.x = Math.PI / 2;
  hullRubRail.position.y = 0.18;
  buoyGroup.add(hullRubRail);

  const hullCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.62, 0.32, 32), buoyWhiteMat);
  hullCollar.position.y = 0.34;
  buoyGroup.add(hullCollar);

  const cageCone = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.46, 0.92, 24), buoyRedMat);
  cageCone.position.y = 0.94;
  buoyGroup.add(cageCone);

  const beaconGuard = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 24), ironCollarMat);
  beaconGuard.position.y = 1.42;
  buoyGroup.add(beaconGuard);

  const beaconLamp = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 16), beaconMat);
  beaconLamp.position.y = 1.54;
  buoyGroup.add(beaconLamp);

  environmentGroup.add(buoyGroup);

  return {
    environmentGroup,
    buoyGroup,
  };
}

export function createMochieInspectorGUI(waterMaterial, underwaterPass) {
  const gui = new GUI({
    title: "Mochie's Water & Underwater Shader",
    width: 310,
  });

  const u = waterMaterial.uniforms;
  const uw = underwaterPass.uniforms;

  const state = {
    surfaceColor: '#' + u.uSurfaceColor.value.getHexString(),
    angleTint: '#' + u.uAngleTint.value.getHexString(),
    backfaceTint: '#' + u.uBackfaceTint.value.getHexString(),
    opacity: u.uOpacity.value,
    roughness: u.uRoughness.value,
    metallic: u.uMetallic.value,

    normalStr0: u.uNormalStr0.value,
    normalScale0: u.uNormalScale0.value.x,
    normalStr1: u.uNormalStr1.value,
    normalScale1: u.uNormalScale1.value.x,
    detailNormalBlend: u.uDetailNormalBlend.value,
    stochasticToggle: u.uStochasticToggle.value > 0.5,
    flowToggle: u.uFlowToggle.value > 0.5,
    flowSpeed: u.uFlowSpeed.value,
    flowStrength: u.uFlowStrength.value,

    reflections: u.uReflections.value > 0.5,
    reflStrength: u.uReflStrength.value,
    reflTint: '#' + u.uReflTint.value.getHexString(),
    fresnelPower: u.uFresnelPower.value,
    specToggle: u.uSpecToggle.value > 0.5,
    specStrength: u.uSpecStrength.value,
    specRoughness: u.uSpecRoughness.value,
    snellsWindowPower: u.uSnellsWindowPower.value,

    refractionStrength: u.uRefractionStrength.value,
    chromAberration: u.uChromAberration.value,

    fogToggle: u.uFogToggle.value > 0.5,
    fogTint: '#' + u.uFogTint.value.getHexString(),
    fogPower: u.uFogPower.value,
    fogBrightness: u.uFogBrightness.value,
    sssToggle: u.uSSSToggle.value > 0.5,
    sssTint: '#' + u.uSSSTint.value.getHexString(),
    sssPower: u.uSSSPower.value,
    sssIntensity: u.uSSSIntensity.value,

    foamToggle: u.uFoamToggle.value > 0.5,
    foamColor: '#' + u.uFoamColor.value.getHexString(),
    foamOpacity: u.uFoamOpacity.value,
    foamEdgeDepth: u.uFoamEdgeDepth.value,
    foamEdgePower: u.uFoamEdgePower.value,
    foamNoiseStr: u.uFoamNoiseStr.value,
    crestFoamToggle: u.uCrestFoamToggle.value > 0.5,
    crestFoamThreshold: u.uCrestFoamThreshold.value,
    crestFoamStrength: u.uCrestFoamStrength.value,

    causticsToggle: u.uCausticsToggle.value > 0.5,
    causticsColor: '#' + u.uCausticsColor.value.getHexString(),
    causticsOpacity: u.uCausticsOpacity.value,
    causticsScale: u.uCausticsScale.value,
    causticsSpeed: u.uCausticsSpeed.value,
    causticsPower: u.uCausticsPower.value,
    causticsFade: u.uCausticsFade.value,
    causticsDisp: u.uCausticsDisp.value,

    wavesToggle: u.uWavesToggle.value > 0.5,
    waveGlobalAmp: u.uWaveGlobalAmp.value,
    waveGlobalSpeed: u.uWaveGlobalSpeed.value,
    waveGlobalScale: u.uWaveGlobalScale.value,
    waveNormalStr: u.uWaveNormalStr.value,
    waveWarpStrength: u.uWaveWarpStrength.value,
    waveWarpScale: u.uWaveWarpScale.value,
    waveWarpSpeed: u.uWaveWarpSpeed.value,

    underwaterEnabled: uw.uUnderwaterEnabled.value > 0.5,
    underwaterFogColor: '#' + uw.uUnderwaterFogColor.value.getHexString(),
    underwaterFogDensity: uw.uUnderwaterFogDensity.value,
    underwaterCausticsStr: uw.uUnderwaterCausticsStr.value,
    underwaterDistortion: uw.uUnderwaterDistortion.value,
    underwaterBlurStr: uw.uUnderwaterBlurStr.value,
    meniscusWidth: uw.uMeniscusWidth.value,
  };

  const folders = {};

  const fSurface = gui.addFolder('Surface');
  fSurface.addColor(state, 'surfaceColor').name('Surface Tint').onChange((v) => u.uSurfaceColor.value.set(v));
  fSurface.addColor(state, 'angleTint').name('Grazing Angle Tint').onChange((v) => u.uAngleTint.value.set(v));
  fSurface.addColor(state, 'backfaceTint').name('Backface Tint').onChange((v) => u.uBackfaceTint.value.set(v));
  fSurface.add(state, 'opacity', 0.2, 1.0, 0.01).name('Opacity').onChange((v) => (u.uOpacity.value = v));
  fSurface.close();
  folders.Surface = fSurface;

  const fNormals = gui.addFolder('Normal Maps');
  fNormals.add(state, 'normalStr0', 0.0, 2.0, 0.01).name('Primary Strength').onChange((v) => (u.uNormalStr0.value = v));
  fNormals.add(state, 'normalScale0', 0.2, 6.0, 0.05).name('Primary Scale').onChange((v) => u.uNormalScale0.value.set(v, v));
  fNormals.add(state, 'normalStr1', 0.0, 2.0, 0.01).name('Detail Strength').onChange((v) => (u.uNormalStr1.value = v));
  fNormals.add(state, 'normalScale1', 0.2, 8.0, 0.05).name('Detail Scale').onChange((v) => u.uNormalScale1.value.set(v, v));
  fNormals.add(state, 'detailNormalBlend', 0.0, 1.0, 0.01).name('RNM Blend Weight').onChange((v) => (u.uDetailNormalBlend.value = v));
  fNormals.add(state, 'stochasticToggle').name('Stochastic Sampling').onChange((v) => (u.uStochasticToggle.value = v ? 1.0 : 0.0));
  fNormals.add(state, 'flowToggle').name('Flowmap Distortion').onChange((v) => (u.uFlowToggle.value = v ? 1.0 : 0.0));
  fNormals.add(state, 'flowSpeed', 0.05, 1.5, 0.01).name('Flow Speed').onChange((v) => (u.uFlowSpeed.value = v));
  fNormals.add(state, 'flowStrength', 0.0, 1.0, 0.01).name('Flow Strength').onChange((v) => (u.uFlowStrength.value = v));
  fNormals.close();
  folders['Normal Maps'] = fNormals;

  const fSpec = gui.addFolder('Specular & Reflections');
  fSpec.add(state, 'reflections').name('Cubemap Reflections').onChange((v) => (u.uReflections.value = v ? 1.0 : 0.0));
  fSpec.add(state, 'reflStrength', 0.0, 2.0, 0.01).name('Reflection Strength').onChange((v) => (u.uReflStrength.value = v));
  fSpec.addColor(state, 'reflTint').name('Reflection Tint').onChange((v) => u.uReflTint.value.set(v));
  fSpec.add(state, 'fresnelPower', 1.0, 10.0, 0.1).name('Fresnel Power').onChange((v) => (u.uFresnelPower.value = v));
  fSpec.add(state, 'specToggle').name('GGX Sun Specular').onChange((v) => (u.uSpecToggle.value = v ? 1.0 : 0.0));
  fSpec.add(state, 'specStrength', 0.0, 4.0, 0.05).name('Specular Strength').onChange((v) => (u.uSpecStrength.value = v));
  fSpec.add(state, 'specRoughness', 0.03, 0.5, 0.005).name('GGX Roughness').onChange((v) => (u.uSpecRoughness.value = v));
  fSpec.add(state, 'snellsWindowPower', 1.0, 8.0, 0.1).name("Snell's Window Power").onChange((v) => (u.uSnellsWindowPower.value = v));
  fSpec.close();
  folders['Specular & Reflections'] = fSpec;

  const fRefract = gui.addFolder('Refraction');
  fRefract.add(state, 'refractionStrength', 0.0, 0.25, 0.002).name('Refraction Offset').onChange((v) => (u.uRefractionStrength.value = v));
  fRefract.add(state, 'chromAberration', 0.0, 1.0, 0.01).name('Chromatic Aberration').onChange((v) => (u.uChromAberration.value = v));
  fRefract.close();
  folders.Refraction = fRefract;

  const fFog = gui.addFolder('Depth Fog & SSS');
  fFog.add(state, 'fogToggle').name('Enable Depth Fog').onChange((v) => (u.uFogToggle.value = v ? 1.0 : 0.0));
  fFog.addColor(state, 'fogTint').name('Depth Fog Tint').onChange((v) => u.uFogTint.value.set(v));
  fFog.add(state, 'fogPower', 0.02, 1.5, 0.01).name('Fog Extinction Power').onChange((v) => (u.uFogPower.value = v));
  fFog.add(state, 'fogBrightness', 0.2, 2.0, 0.02).name('Fog Brightness').onChange((v) => (u.uFogBrightness.value = v));
  fFog.add(state, 'sssToggle').name('Subsurface Scattering').onChange((v) => (u.uSSSToggle.value = v ? 1.0 : 0.0));
  fFog.addColor(state, 'sssTint').name('SSS Crest Tint').onChange((v) => u.uSSSTint.value.set(v));
  fFog.add(state, 'sssPower', 1.0, 8.0, 0.1).name('SSS Falloff Power').onChange((v) => (u.uSSSPower.value = v));
  fFog.add(state, 'sssIntensity', 0.0, 3.0, 0.05).name('SSS Strength').onChange((v) => (u.uSSSIntensity.value = v));
  fFog.close();
  folders['Depth Fog & SSS'] = fFog;

  const fFoam = gui.addFolder('Foam');
  fFoam.add(state, 'foamToggle').name('Enable Foam').onChange((v) => (u.uFoamToggle.value = v ? 1.0 : 0.0));
  fFoam.addColor(state, 'foamColor').name('Foam Albedo').onChange((v) => u.uFoamColor.value.set(v));
  fFoam.add(state, 'foamOpacity', 0.0, 1.0, 0.01).name('Foam Opacity').onChange((v) => (u.uFoamOpacity.value = v));
  fFoam.add(state, 'foamEdgeDepth', 0.1, 3.0, 0.02).name('Intersection Depth').onChange((v) => (u.uFoamEdgeDepth.value = v));
  fFoam.add(state, 'foamEdgePower', 0.3, 4.0, 0.05).name('Edge Falloff Power').onChange((v) => (u.uFoamEdgePower.value = v));
  fFoam.add(state, 'foamNoiseStr', 0.0, 0.5, 0.01).name('Noise Distortion').onChange((v) => (u.uFoamNoiseStr.value = v));
  fFoam.add(state, 'crestFoamToggle').name('Gerstner Crest Foam').onChange((v) => (u.uCrestFoamToggle.value = v ? 1.0 : 0.0));
  fFoam.add(state, 'crestFoamThreshold', 0.1, 0.95, 0.01).name('Crest Threshold').onChange((v) => (u.uCrestFoamThreshold.value = v));
  fFoam.add(state, 'crestFoamStrength', 0.0, 3.0, 0.05).name('Crest Foam Strength').onChange((v) => (u.uCrestFoamStrength.value = v));
  fFoam.close();
  folders.Foam = fFoam;

  const fCaustics = gui.addFolder('Caustics');
  fCaustics.add(state, 'causticsToggle').name('3D Voronoi Caustics').onChange((v) => (u.uCausticsToggle.value = v ? 1.0 : 0.0));
  fCaustics.addColor(state, 'causticsColor').name('Caustics Tint').onChange((v) => u.uCausticsColor.value.set(v));
  fCaustics.add(state, 'causticsOpacity', 0.0, 3.0, 0.05).name('Caustics Intensity').onChange((v) => (u.uCausticsOpacity.value = v));
  fCaustics.add(state, 'causticsScale', 0.5, 8.0, 0.1).name('Voronoi Scale').onChange((v) => (u.uCausticsScale.value = v));
  fCaustics.add(state, 'causticsSpeed', 0.1, 3.5, 0.05).name('Animation Speed').onChange((v) => (u.uCausticsSpeed.value = v));
  fCaustics.add(state, 'causticsPower', 0.5, 4.0, 0.05).name('Filament Sharpness').onChange((v) => (u.uCausticsPower.value = v));
  fCaustics.add(state, 'causticsFade', 1.0, 20.0, 0.2).name('Depth Attenuation').onChange((v) => (u.uCausticsFade.value = v));
  fCaustics.add(state, 'causticsDisp', 0.0, 0.1, 0.002).name('RGB Dispersion').onChange((v) => (u.uCausticsDisp.value = v));
  fCaustics.close();
  folders.Caustics = fCaustics;

  const fWaves = gui.addFolder('Gerstner Waves');
  fWaves.add(state, 'wavesToggle').name('4-Wave Gerstner').onChange((v) => (u.uWavesToggle.value = v ? 1.0 : 0.0));
  fWaves.add(state, 'waveGlobalAmp', 0.0, 2.5, 0.02).name('Global Amplitude').onChange((v) => (u.uWaveGlobalAmp.value = v));
  fWaves.add(state, 'waveGlobalSpeed', 0.0, 2.5, 0.02).name('Global Speed').onChange((v) => (u.uWaveGlobalSpeed.value = v));
  fWaves.add(state, 'waveGlobalScale', 0.25, 2.5, 0.02).name('Global Scale').onChange((v) => (u.uWaveGlobalScale.value = v));
  fWaves.add(state, 'waveNormalStr', 0.0, 1.5, 0.02).name('Analytical Normal').onChange((v) => (u.uWaveNormalStr.value = v));
  fWaves.add(state, 'waveWarpStrength', 0.0, 1.0, 0.01).name('Crest Warp Strength').onChange((v) => (u.uWaveWarpStrength.value = v));
  fWaves.add(state, 'waveWarpScale', 0.2, 3.0, 0.05).name('Crest Warp Scale').onChange((v) => (u.uWaveWarpScale.value = v));
  fWaves.add(state, 'waveWarpSpeed', 0.0, 2.5, 0.05).name('Crest Warp Speed').onChange((v) => (u.uWaveWarpSpeed.value = v));
  fWaves.close();
  folders['Gerstner Waves'] = fWaves;

  const fUnderwater = gui.addFolder('Underwater');
  fUnderwater.add(state, 'underwaterEnabled').name('Underwater Volume').onChange((v) => (uw.uUnderwaterEnabled.value = v ? 1.0 : 0.0));
  fUnderwater.addColor(state, 'underwaterFogColor').name('Volume Fog Color').onChange((v) => uw.uUnderwaterFogColor.value.set(v));
  fUnderwater.add(state, 'underwaterFogDensity', 0.01, 0.25, 0.002).name('Volume Fog Density').onChange((v) => (uw.uUnderwaterFogDensity.value = v));
  fUnderwater.add(state, 'underwaterCausticsStr', 0.0, 2.5, 0.05).name('Submerged Caustics').onChange((v) => (uw.uUnderwaterCausticsStr.value = v));
  fUnderwater.add(state, 'underwaterDistortion', 0.0, 2.5, 0.05).name('Lens Distortion').onChange((v) => (uw.uUnderwaterDistortion.value = v));
  fUnderwater.add(state, 'underwaterBlurStr', 0.0, 2.0, 0.05).name('Distance Blur').onChange((v) => (uw.uUnderwaterBlurStr.value = v));
  fUnderwater.add(state, 'meniscusWidth', 0.008, 0.08, 0.002).name('Meniscus Line Width').onChange((v) => (uw.uMeniscusWidth.value = v));
  fUnderwater.close();
  folders.Underwater = fUnderwater;

  function syncFromMaterial() {
    state.surfaceColor = '#' + u.uSurfaceColor.value.getHexString();
    state.angleTint = '#' + u.uAngleTint.value.getHexString();
    state.backfaceTint = '#' + u.uBackfaceTint.value.getHexString();
    state.opacity = u.uOpacity.value;
    state.normalStr0 = u.uNormalStr0.value;
    state.normalScale0 = u.uNormalScale0.value.x;
    state.normalStr1 = u.uNormalStr1.value;
    state.normalScale1 = u.uNormalScale1.value.x;
    state.detailNormalBlend = u.uDetailNormalBlend.value;
    state.stochasticToggle = u.uStochasticToggle.value > 0.5;
    state.flowToggle = u.uFlowToggle.value > 0.5;
    state.flowSpeed = u.uFlowSpeed.value;
    state.flowStrength = u.uFlowStrength.value;
    state.reflections = u.uReflections.value > 0.5;
    state.reflStrength = u.uReflStrength.value;
    state.reflTint = '#' + u.uReflTint.value.getHexString();
    state.fresnelPower = u.uFresnelPower.value;
    state.specToggle = u.uSpecToggle.value > 0.5;
    state.specStrength = u.uSpecStrength.value;
    state.specRoughness = u.uSpecRoughness.value;
    state.snellsWindowPower = u.uSnellsWindowPower.value;
    state.refractionStrength = u.uRefractionStrength.value;
    state.chromAberration = u.uChromAberration.value;
    state.fogToggle = u.uFogToggle.value > 0.5;
    state.fogTint = '#' + u.uFogTint.value.getHexString();
    state.fogPower = u.uFogPower.value;
    state.fogBrightness = u.uFogBrightness.value;
    state.sssToggle = u.uSSSToggle.value > 0.5;
    state.sssTint = '#' + u.uSSSTint.value.getHexString();
    state.sssPower = u.uSSSPower.value;
    state.sssIntensity = u.uSSSIntensity.value;
    state.foamToggle = u.uFoamToggle.value > 0.5;
    state.foamColor = '#' + u.uFoamColor.value.getHexString();
    state.foamOpacity = u.uFoamOpacity.value;
    state.foamEdgeDepth = u.uFoamEdgeDepth.value;
    state.foamEdgePower = u.uFoamEdgePower.value;
    state.foamNoiseStr = u.uFoamNoiseStr.value;
    state.crestFoamToggle = u.uCrestFoamToggle.value > 0.5;
    state.crestFoamThreshold = u.uCrestFoamThreshold.value;
    state.crestFoamStrength = u.uCrestFoamStrength.value;
    state.causticsToggle = u.uCausticsToggle.value > 0.5;
    state.causticsColor = '#' + u.uCausticsColor.value.getHexString();
    state.causticsOpacity = u.uCausticsOpacity.value;
    state.causticsScale = u.uCausticsScale.value;
    state.causticsSpeed = u.uCausticsSpeed.value;
    state.causticsPower = u.uCausticsPower.value;
    state.causticsFade = u.uCausticsFade.value;
    state.causticsDisp = u.uCausticsDisp.value;
    state.wavesToggle = u.uWavesToggle.value > 0.5;
    state.waveGlobalAmp = u.uWaveGlobalAmp.value;
    state.waveGlobalSpeed = u.uWaveGlobalSpeed.value;
    state.waveGlobalScale = u.uWaveGlobalScale.value;
    state.waveNormalStr = u.uWaveNormalStr.value;
    state.waveWarpStrength = u.uWaveWarpStrength.value;
    state.waveWarpScale = u.uWaveWarpScale.value;
    state.waveWarpSpeed = u.uWaveWarpSpeed.value;
    state.underwaterEnabled = uw.uUnderwaterEnabled.value > 0.5;
    state.underwaterFogColor = '#' + uw.uUnderwaterFogColor.value.getHexString();
    state.underwaterFogDensity = uw.uUnderwaterFogDensity.value;
    state.underwaterCausticsStr = uw.uUnderwaterCausticsStr.value;
    state.underwaterDistortion = uw.uUnderwaterDistortion.value;
    state.underwaterBlurStr = uw.uUnderwaterBlurStr.value;
    state.meniscusWidth = uw.uMeniscusWidth.value;

    gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }

  function openFolderExclusive(folderName) {
    Object.entries(folders).forEach(([key, folder]) => {
      if (key === folderName) {
        folder.open();
      } else {
        folder.close();
      }
    });
  }

  return {
    gui,
    folders,
    syncFromMaterial,
    openFolderExclusive,
  };
}

export function initMochieDemoScene(mountEl, callbacks = {}) {
  const isSoftwareGl = (() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  })();

  const width = mountEl.clientWidth || window.innerWidth || 1440;
  const height = mountEl.clientHeight || window.innerHeight || 900;

  const renderer = new THREE.WebGLRenderer({
    antialias: !isSoftwareGl,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  const pixelRatio = isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height);
  renderer.shadowMap.enabled = !isSoftwareGl;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  mountEl.innerHTML = '';
  renderer.domElement.setAttribute('data-testid', 'mochie-water-canvas');
  renderer.domElement.className = 'block w-full h-full outline-none';
  mountEl.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xa5cce6, 0.0042);

  // Studio environment reflection via RoomEnvironment + PMREMGenerator
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
  pmremGenerator.dispose();

  // Camera & OrbitControls (near = 0.28m so the meniscus lens intersection spans ~26cm vertically)
  const camera = new THREE.PerspectiveCamera(50, width / height, 0.28, 600.0);
  const initialCam = CAMERA_VIEW_PRESETS.overview;
  camera.position.set(...initialCam.position);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...initialCam.target);
  controls.enableDamping = !isSoftwareGl;
  controls.dampingFactor = 0.06;
  controls.maxDistance = 58.0;
  controls.minDistance = 2.0;
  controls.minPolarAngle = 0.05;
  controls.maxPolarAngle = Math.PI * 0.92;
  controls.update();

  // Custom Calibrated Rayleigh/Mie Atmospheric Sky Dome + Cubemap Reflection Bake
  const skyDome = createRealisticSkyDome();
  scene.add(skyDome);

  const cubeRenderTarget = new THREE.WebGLCubeRenderTarget(128, {
    format: THREE.RGBAFormat,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
  });
  const cubeCamera = new THREE.CubeCamera(0.5, 500, cubeRenderTarget);

  // Warm Key Directional Sunlight + Cool Hemisphere Fill
  const sunLight = new THREE.DirectionalLight(0xfff7ed, 2.2);
  sunLight.castShadow = !isSoftwareGl;
  sunLight.shadow.mapSize.width = 1024;
  sunLight.shadow.mapSize.height = 1024;
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 65;
  const d = 18;
  sunLight.shadow.camera.left = -d;
  sunLight.shadow.camera.right = d;
  sunLight.shadow.camera.top = d;
  sunLight.shadow.camera.bottom = -d;
  sunLight.shadow.bias = -0.0005;
  sunLight.shadow.normalBias = 0.02;
  scene.add(sunLight);

  const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x1e3a5f, 0.72);
  scene.add(hemiLight);

  // Build Coastal Pier, Concrete Support Pillar, Seabed & Buoy
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const { environmentGroup, buoyGroup } = buildCoastalPierScene(renderer, maxAniso);
  scene.add(environmentGroup);

  // Create MochieWater Mesh & MochieUnderwaterPass
  const waterMaterial = new MochieWaterMaterial({
    preset: MOCHIE_WATER_PRESETS.emeraldPier,
    envMap: cubeRenderTarget.texture,
  });

  const water = new MochieWater({
    size: 160,
    segments: isSoftwareGl ? 128 : 220,
    material: waterMaterial,
    width: width * pixelRatio,
    height: height * pixelRatio,
    prePassScale: isSoftwareGl ? 0.6 : 0.9,
  });
  scene.add(water);

  function updateSunAngles(elevationDeg, azimuthDeg) {
    const phi = THREE.MathUtils.degToRad(90 - elevationDeg);
    const theta = THREE.MathUtils.degToRad(azimuthDeg);
    _sunPos.setFromSphericalCoords(1, phi, theta).normalize();

    skyDome.material.uniforms.uSunDirection.value.copy(_sunPos);
    sunLight.position.copy(_sunPos).multiplyScalar(28);
    waterMaterial.uniforms.uSunDirection.value.copy(_sunPos);

    // Bake atmospheric sky + clouds into water reflection cubemap
    const prevWaterVis = water.visible;
    const prevEnvVis = environmentGroup.visible;
    water.visible = false;
    environmentGroup.visible = false;
    cubeCamera.update(renderer, scene);
    water.visible = prevWaterVis;
    environmentGroup.visible = prevEnvVis;
    waterMaterial.setEnvironmentCubemap(cubeRenderTarget.texture);
  }

  updateSunAngles(28, 138);

  // Post-Processing Composer (RenderPass -> MochieUnderwaterPass -> OutputPass)
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  const underwaterPass = new MochieUnderwaterPass(water, camera, {
    preset: MOCHIE_WATER_PRESETS.emeraldPier,
  });
  const outputPass = new OutputPass();

  composer.addPass(renderPass);
  composer.addPass(underwaterPass);
  composer.addPass(outputPass);

  // Categorized lil-gui Inspector mounted on document.body (.lil-gui.root) so it sits cleanly at z-40
  const inspector = createMochieInspectorGUI(waterMaterial, underwaterPass);
  inspector.gui.domElement.style.display = 'none';

  // Camera transition & Auto-Dip Bobbing controller
  let activeCamTransition = null;
  let activePresetId = 'overview';
  let autoDipEnabled = false;
  let timeScale = 1.0;
  let elapsedSimTime = 0.0;
  let lastTimestamp = performance.now();

  function renderFrameNow() {
    water.renderPrePass(renderer, scene, camera);
    composer.render();
  }

  function emitTelemetryNow() {
    const waveYAtCam = water.getWaveHeightAt(camera.position.x, camera.position.z, elapsedSimTime);
    const signedDepth = waveYAtCam - camera.position.y;
    let mediumState = 'Above Surface';
    if (Math.abs(signedDepth) < 0.22) {
      mediumState = 'Meniscus Interface';
    } else if (signedDepth >= 0.22) {
      mediumState = 'Submerged Volume';
    }
    callbacks.onTelemetryUpdate?.({
      cameraY: camera.position.y,
      waveY: waveYAtCam,
      submersionDepth: signedDepth,
      mediumState,
    });
  }

  controls.addEventListener('start', () => {
    activeCamTransition = null;
    if (activePresetId === 'meniscus') {
      activePresetId = 'custom';
    }
    if (autoDipEnabled) {
      autoDipEnabled = false;
      callbacks.onAutoDipChange?.(false);
    }
  });

  function computeMeniscusLockedCamY() {
    camera.updateMatrixWorld();
    camera.getWorldDirection(_camForward);
    const lensCenterX = camera.position.x + _camForward.x * camera.near;
    const lensCenterZ = camera.position.z + _camForward.z * camera.near;
    const waveAtLens = water.getWaveHeightAt(lensCenterX, lensCenterZ, elapsedSimTime);
    return waveAtLens - _camForward.y * camera.near;
  }

  function setCameraPreset(presetId) {
    const normalizedId = presetId === 'submerged' ? 'underwater' : presetId;
    const targetPreset = CAMERA_VIEW_PRESETS[normalizedId];
    if (!targetPreset) return;
    activePresetId = normalizedId;
    autoDipEnabled = false;
    callbacks.onAutoDipChange?.(false);
    if (isSoftwareGl || normalizedId === 'meniscus') {
      camera.position.set(...targetPreset.position);
      controls.target.set(...targetPreset.target);
      controls.update();
      if (normalizedId === 'meniscus') {
        camera.position.y = computeMeniscusLockedCamY();
        controls.update();
      }
      activeCamTransition = null;
      renderFrameNow();
      emitTelemetryNow();
    } else {
      activeCamTransition = {
        position: new THREE.Vector3(...targetPreset.position),
        target: new THREE.Vector3(...targetPreset.target),
      };
    }
  }

  function setAutoDip(enabled) {
    autoDipEnabled = enabled;
    if (enabled) {
      activeCamTransition = null;
    }
    callbacks.onAutoDipChange?.(enabled);
  }

  function applyWaterPreset(presetId) {
    const preset = MOCHIE_WATER_PRESETS[presetId];
    if (!preset) return;
    waterMaterial.applyPreset(preset);
    underwaterPass.applyPreset(preset);
    inspector.syncFromMaterial();
    if (isSoftwareGl) renderFrameNow();
  }

  function setInspectorVisible(visible, activeFolder = null) {
    inspector.gui.domElement.style.display = visible ? 'block' : 'none';
    if (visible && activeFolder) {
      inspector.openFolderExclusive(activeFolder);
    }
  }

  // Resize handler — immediately re-renders and schedules a rAF render so buffer is never blank
  function onResize() {
    const w = mountEl.clientWidth || window.innerWidth;
    const h = mountEl.clientHeight || window.innerHeight;
    if (w <= 0 || h <= 0) return;

    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    water.setSize(w, h, pixelRatio);
    renderFrameNow();
    requestAnimationFrame(() => {
      if (!disposed) renderFrameNow();
    });
  }
  window.addEventListener('resize', onResize);

  if (!isSoftwareGl) {
    renderer.compile(scene, camera);
  }

  let frameId = 0;
  let disposed = false;
  let lastHudEmitTime = 0;

  function afterDraw(cb) {
    const gl = renderer.getContext();
    const sync = gl && gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
    if (gl) gl.flush();
    const poll = () => {
      if (disposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        frameId = window.setTimeout(cb, 80);
      }
    };
    frameId = window.setTimeout(poll, 5);
  }

  function tick(now = performance.now()) {
    if (disposed) return;
    const rawDelta = Math.min(0.1, Math.max(0.001, (now - lastTimestamp) / 1000));
    lastTimestamp = now;

    elapsedSimTime += rawDelta * timeScale;
    water.updateTime(elapsedSimTime);
    skyDome.material.uniforms.uTime.value = elapsedSimTime;

    // Update buoyant coastal navigation buoy from CPU Gerstner wave evaluator
    const buoySample = water.getWaveSampleAt(_buoySamplePos.x, _buoySamplePos.z, elapsedSimTime);
    buoyGroup.position.set(
      _buoySamplePos.x + buoySample.displacement.x * 0.45,
      buoySample.surfaceHeight,
      _buoySamplePos.z + buoySample.displacement.z * 0.45
    );
    _targetNormal.set(buoySample.normal.x * 0.55, buoySample.normal.y, buoySample.normal.z * 0.55).normalize();
    _buoyQuat.setFromUnitVectors(_upVec, _targetNormal);
    buoyGroup.quaternion.slerp(_buoyQuat, 1.0 - Math.exp(-8.0 * rawDelta));

    if (autoDipEnabled) {
      const cycle = elapsedSimTime * 0.52;
      const targetY = 0.65 * Math.cos(cycle) - 0.55;
      const targetX = 8.4 + Math.sin(cycle * 0.5) * 1.4;
      const targetZ = 8.8 + Math.cos(cycle * 0.5) * 1.4;

      camera.position.x = THREE.MathUtils.damp(camera.position.x, targetX, 3.5, rawDelta);
      camera.position.y = THREE.MathUtils.damp(camera.position.y, targetY, 3.5, rawDelta);
      camera.position.z = THREE.MathUtils.damp(camera.position.z, targetZ, 3.5, rawDelta);

      controls.target.x = THREE.MathUtils.damp(controls.target.x, -1.5, 4.0, rawDelta);
      controls.target.y = THREE.MathUtils.damp(controls.target.y, targetY * 0.45 - 0.5, 4.0, rawDelta);
      controls.target.z = THREE.MathUtils.damp(controls.target.z, -0.8, 4.0, rawDelta);
    } else if (activeCamTransition) {
      const dampFactor = isSoftwareGl ? 12.0 : 5.5;
      camera.position.x = THREE.MathUtils.damp(camera.position.x, activeCamTransition.position.x, dampFactor, rawDelta);
      camera.position.y = THREE.MathUtils.damp(camera.position.y, activeCamTransition.position.y, dampFactor, rawDelta);
      camera.position.z = THREE.MathUtils.damp(camera.position.z, activeCamTransition.position.z, dampFactor, rawDelta);

      controls.target.x = THREE.MathUtils.damp(controls.target.x, activeCamTransition.target.x, dampFactor, rawDelta);
      controls.target.y = THREE.MathUtils.damp(controls.target.y, activeCamTransition.target.y, dampFactor, rawDelta);
      controls.target.z = THREE.MathUtils.damp(controls.target.z, activeCamTransition.target.z, dampFactor, rawDelta);

      if (
        camera.position.distanceTo(activeCamTransition.position) < 0.03 &&
        controls.target.distanceTo(activeCamTransition.target) < 0.03
      ) {
        activeCamTransition = null;
      }
    }

    if (activePresetId === 'meniscus' && !autoDipEnabled && !activeCamTransition) {
      camera.position.y = computeMeniscusLockedCamY();
    }

    controls.update();
    renderFrameNow();

    if (now - lastHudEmitTime > 120) {
      lastHudEmitTime = now;
      emitTelemetryNow();
    }

    if (isSoftwareGl) {
      afterDraw(() => tick(performance.now()));
    } else {
      frameId = requestAnimationFrame(tick);
    }
  }

  tick(performance.now());

  const api = {
    renderer,
    scene,
    camera,
    water,
    waterMaterial,
    underwaterPass,
    inspector,
    renderFrameNow,
    setCameraPreset,
    setCameraView: setCameraPreset,
    setCameraViewpoint: setCameraPreset,
    getTelemetry() {
      const waveYAtCam = water.getWaveHeightAt(camera.position.x, camera.position.z, elapsedSimTime);
      const signedDepth = waveYAtCam - camera.position.y;
      return {
        cameraY: camera.position.y,
        waveY: waveYAtCam,
        submersionDepth: signedDepth,
        submersionState: Math.abs(signedDepth) < 0.22 ? 'Meniscus Interface' : signedDepth >= 0.22 ? 'Submerged Volume' : 'Above Surface',
      };
    },
    setAutoDip,
    applyWaterPreset,
    updateSunAngles,
    setTimeScale: (s) => {
      timeScale = s;
    },
    setInspectorVisible,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', onResize);
      inspector.gui.destroy();
      controls.dispose();
      water.dispose();
      underwaterPass.dispose();
      composer.dispose();
      cubeRenderTarget.dispose();
      renderer.dispose();
    },
  };

  if (typeof window !== 'undefined') {
    window.__MOCHIE_SCENE__ = api;
  }

  return api;
}
