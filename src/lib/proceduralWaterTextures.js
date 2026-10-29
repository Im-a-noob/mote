// ============================================================================
// Mochie's Water Shader — High-Resolution Procedural Water Textures Generator
// Generates deterministic, seamless tileable 256x256 DataTextures for:
//  - _NormalMap0 & _NormalMap1 (6-octave directional capillary wave normals)
//  - _FlowMap (RG 2D rotational flow velocity field)
//  - _NoiseTex (RG curl / domain-distortion noise)
//  - _FoamTex (Multi-scale cellular bubble & shoreline foam webbing mask)
// ============================================================================

import * as THREE from 'three';

function hash2(x, y, seed = 0) {
  const d = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return d - Math.floor(d);
}

// Smooth periodic value noise that tiles seamlessly on [0, period)
function periodicNoise(u, v, period, seed) {
  const x = u * period;
  const y = v * period;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  // Quintic Hermite interpolation for C2-continuous derivative-free normals
  const sx = fx * fx * fx * (fx * (fx * 6.0 - 15.0) + 10.0);
  const sy = fy * fy * fy * (fy * (fy * 6.0 - 15.0) + 10.0);

  const x0 = ((ix % period) + period) % period;
  const x1 = ((ix + 1) % period + period) % period;
  const y0 = ((iy % period) + period) % period;
  const y1 = ((iy + 1) % period + period) % period;

  const n00 = hash2(x0, y0, seed);
  const n10 = hash2(x1, y0, seed);
  const n01 = hash2(x0, y1, seed);
  const n11 = hash2(x1, y1, seed);

  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

function fbmPeriodic(u, v, basePeriod, seed, octaves = 5) {
  let val = 0.0;
  let amp = 0.5;
  let p = basePeriod;
  for (let i = 0; i < octaves; i++) {
    // Ridged water wavelet shaping: 1 - |2n - 1| creates sharper wave crests and rounded troughs
    const raw = periodicNoise(u, v, p, seed + i * 19.3);
    const ridged = 1.0 - Math.abs(raw * 2.0 - 1.0);
    const mixed = raw * 0.55 + ridged * ridged * 0.45;
    val += mixed * amp;
    p *= 2;
    amp *= 0.5;
  }
  return val;
}

export function createMochieNormalTexture(size = 256, seed = 1, sharpness = 5.2) {
  const heightField = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      // Domain warp the UV slightly for organic interlocking wavelets
      const wx = periodicNoise(u, v, 4, seed + 91) * 0.06;
      const wy = periodicNoise(u, v, 4, seed + 143) * 0.06;
      const n = fbmPeriodic(u + wx, v + wy, 6, seed, 5);
      const directionalChop =
        Math.sin((u * 6.0 + v * 3.0 + wx * 4.0) * Math.PI * 2.0) * 0.08 +
        Math.cos((u * 3.0 - v * 7.0 + wy * 4.0) * Math.PI * 2.0) * 0.06;
      heightField[y * size + x] = n + directionalChop;
    }
  }

  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const yPrev = (y - 1 + size) % size;
    const yNext = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xPrev = (x - 1 + size) % size;
      const xNext = (x + 1) % size;

      // Sobel 3x3 filter for smooth, artifact-free tangent normals
      const tl = heightField[yPrev * size + xPrev];
      const tc = heightField[yPrev * size + x];
      const tr = heightField[yPrev * size + xNext];
      const ml = heightField[y * size + xPrev];
      const mr = heightField[y * size + xNext];
      const bl = heightField[yNext * size + xPrev];
      const bc = heightField[yNext * size + x];
      const br = heightField[yNext * size + xNext];

      const dX = ((tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl)) * 0.25 * sharpness;
      const dY = ((bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr)) * 0.25 * sharpness;

      let nx = -dX;
      let ny = -dY;
      let nz = 1.0;
      const len = Math.hypot(nx, ny, nz) || 1.0;
      nx /= len;
      ny /= len;
      nz /= len;

      const idx = (y * size + x) * 4;
      data[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export function createMochieFlowTexture(size = 128) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const vx = fbmPeriodic(u, v, 4, 101, 4);
      const vy = fbmPeriodic(u, v, 4, 202, 4);
      const idx = (y * size + x) * 4;
      data[idx] = Math.round(vx * 255);
      data[idx + 1] = Math.round(vy * 255);
      data[idx + 2] = 128;
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function createMochieNoiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const n1 = fbmPeriodic(u, v, 6, 303, 5);
      const n2 = fbmPeriodic(u, v, 6, 404, 5);
      const idx = (y * size + x) * 4;
      data[idx] = Math.round(n1 * 255);
      data[idx + 1] = Math.round(n2 * 255);
      data[idx + 2] = Math.round(((n1 + n2) * 0.5) * 255);
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function voronoiCellularWeb(u, v, cells, seedA, seedB) {
  const x = u * cells;
  const y = v * cells;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  let minDist1 = 8.0;
  let minDist2 = 8.0;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ((ix + dx) % cells + cells) % cells;
      const cy = ((iy + dy) % cells + cells) % cells;
      const px = dx + hash2(cx, cy, seedA) - fx;
      const py = dy + hash2(cx, cy, seedB) - fy;
      const d = Math.hypot(px, py);
      if (d < minDist1) {
        minDist2 = minDist1;
        minDist1 = d;
      } else if (d < minDist2) {
        minDist2 = d;
      }
    }
  }
  const border = minDist2 - minDist1;
  return Math.pow(Math.max(0.0, Math.min(1.0, 1.0 - border * 3.1)), 1.8);
}

export function createMochieFoamTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      // Multi-scale cellular sea-foam lace: primary web + fine micro-bubbles
      const macroWeb = voronoiCellularWeb(u, v, 8, 505, 606);
      const microBubbles = voronoiCellularWeb(u, v, 20, 707, 808);
      const dissipationMask = periodicNoise(u, v, 6, 909);

      const combined = (macroWeb * 0.65 + microBubbles * 0.45) * (0.45 + 0.65 * dissipationMask);
      const foamVal = Math.max(0.0, Math.min(1.0, combined));
      const byteVal = Math.round(foamVal * 255);

      const idx = (y * size + x) * 4;
      data[idx] = byteVal;
      data[idx + 1] = byteVal;
      data[idx + 2] = byteVal;
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
