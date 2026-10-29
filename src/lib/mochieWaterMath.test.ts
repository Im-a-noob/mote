import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateGerstnerWavesCPU,
  perspectiveDepthToViewZCPU,
  viewZToOrthographicDepthCPU,
  computeMochieWaterFresnelCPU,
  MOCHIE_WATER_PRESETS,
} from './mochieWaterMath';

test('Gerstner wave evaluator returns flat water level when wavesToggle is disabled', () => {
  const baseConfig = structuredClone(MOCHIE_WATER_PRESETS.emeraldPier.gerstner);
  baseConfig.wavesToggle = false;
  baseConfig.waterLevel = 1.25;

  const sample = evaluateGerstnerWavesCPU(12.5, -8.3, 4.2, baseConfig);
  assert.equal(sample.surfaceHeight, 1.25);
  assert.equal(sample.displacement.x, 0);
  assert.equal(sample.displacement.y, 0);
  assert.equal(sample.displacement.z, 0);
  assert.equal(sample.normal.x, 0);
  assert.equal(sample.normal.y, 1);
  assert.equal(sample.normal.z, 0);
});

test('Gerstner wave evaluator produces normalized TBN basis and bounded wave height', () => {
  const config = structuredClone(MOCHIE_WATER_PRESETS.emeraldPier.gerstner);
  const sample = evaluateGerstnerWavesCPU(5.0, 10.0, 2.5, config);

  const normalLen = Math.hypot(sample.normal.x, sample.normal.y, sample.normal.z);
  const tangentLen = Math.hypot(sample.tangent.x, sample.tangent.y, sample.tangent.z);
  const binormalLen = Math.hypot(sample.binormal.x, sample.binormal.y, sample.binormal.z);

  assert.ok(Math.abs(normalLen - 1.0) < 1e-5, 'Normal vector must be unit length');
  assert.ok(Math.abs(tangentLen - 1.0) < 1e-5, 'Tangent vector must be unit length');
  assert.ok(Math.abs(binormalLen - 1.0) < 1e-5, 'Binormal vector must be unit length');
  assert.ok(sample.normal.y > 0.0, 'Upward surface normal Y component must be positive');
  assert.ok(sample.crestFactor >= 0.0 && sample.crestFactor <= 1.0, 'Crest factor must be in [0,1]');
});

test('Depth linearization matches Unity LinearEyeDepth and Linear01Depth boundary conditions', () => {
  const near = 0.1;
  const far = 300.0;

  const viewZNear = perspectiveDepthToViewZCPU(0.0, near, far);
  const viewZFar = perspectiveDepthToViewZCPU(1.0, near, far);

  assert.ok(Math.abs(-viewZNear - near) < 1e-5, 'Depth 0 maps to near plane');
  assert.ok(Math.abs(-viewZFar - far) < 1e-5, 'Depth 1 maps to far plane');

  assert.ok(Math.abs(viewZToOrthographicDepthCPU(viewZNear, near, far) - 0.0) < 1e-5);
  assert.ok(Math.abs(viewZToOrthographicDepthCPU(viewZFar, near, far) - 1.0) < 1e-5);
});

test('Fresnel term enforces Schlick above water and Snell Window Total Internal Reflection underwater', () => {
  // Looking straight down at water from above -> low F0 (~0.02)
  const fPerpendicularAbove = computeMochieWaterFresnelCPU(1.0, true, 5.0, 3.0);
  // Grazing angle above water -> approaches 1.0
  const fGrazingAbove = computeMochieWaterFresnelCPU(0.02, true, 5.0, 3.0);
  assert.ok(fPerpendicularAbove < 0.05);
  assert.ok(fGrazingAbove > 0.85);

  // Underwater looking outside Snell's window critical angle (cosTheta < 0.45) -> Total Internal Reflection (1.0)
  const fUnderwaterTIR = computeMochieWaterFresnelCPU(0.3, false, 5.0, 3.0);
  assert.equal(fUnderwaterTIR, 1.0);
});
