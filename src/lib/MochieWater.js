// ============================================================================
// Mochie's Water Shader — MochieWater.js
// Extends THREE.Mesh. Manages:
//  1. Pre-pass WebGLRenderTarget (GrabPass "_MWGrab" + _CameraDepthTexture)
//     using THREE.DepthTexture with THREE.FloatType / UnsignedIntType fallback.
//  2. Frustum / viewport resize synchronization.
//  3. CPU-side Gerstner wave evaluator getWaveHeightAt(x, z, time) and
//     getWaveSampleAt(x, z, time) for camera submersion & buoyant props.
// ============================================================================

import * as THREE from 'three';
import { MochieWaterMaterial } from './MochieWaterMaterial.js';
import { evaluateGerstnerWavesCPU } from './mochieWaterMath';

export class MochieWater extends THREE.Mesh {
  constructor(options = {}) {
    const size = options.size || 180;
    const segments = options.segments || 192;
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    // Keep high vertex density within 22m of the pier/camera while stretching
    // the outer perimeter smoothly out to ~245m radius for a seamless horizon.
    const posAttr = geometry.attributes.position;
    const halfSize = size * 0.5;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      const r = Math.hypot(x, z);
      if (r > 18.0) {
        const t = (r - 18.0) / Math.max(halfSize - 18.0, 1.0);
        const expandedR = 18.0 + (r - 18.0) * (1.0 + 1.85 * t * t);
        const scale = expandedR / r;
        posAttr.setX(i, x * scale);
        posAttr.setZ(i, z * scale);
      }
    }
    posAttr.needsUpdate = true;
    geometry.computeBoundingSphere();

    const material =
      options.material instanceof MochieWaterMaterial
        ? options.material
        : new MochieWaterMaterial(options);

    super(geometry, material);
    this.name = 'MochieWaterSurface';
    this.frustumCulled = false;
    this.receiveShadow = false;
    this.castShadow = false;

    this.waterMaterial = material;
    this.prePassScale = options.prePassScale || 1.0;

    // Create _MWGrab & _CameraDepthTexture pre-pass render target
    const width = options.width || 1024;
    const height = options.height || 768;
    this.grabRenderTarget = this._createGrabRenderTarget(width, height);

    this.waterMaterial.uniforms.uGrabTexture.value = this.grabRenderTarget.texture;
    this.waterMaterial.uniforms.uDepthTexture.value = this.grabRenderTarget.depthTexture;
    this.waterMaterial.uniforms.uHasDepthTexture.value = 1.0;
  }

  _createGrabRenderTarget(width, height) {
    const w = Math.max(64, Math.floor(width * this.prePassScale));
    const h = Math.max(64, Math.floor(height * this.prePassScale));

    const depthTexture = new THREE.DepthTexture(w, h);
    depthTexture.type = THREE.FloatType;
    depthTexture.format = THREE.DepthFormat;
    depthTexture.minFilter = THREE.NearestFilter;
    depthTexture.magFilter = THREE.NearestFilter;

    const rt = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    rt.depthTexture = depthTexture;
    return rt;
  }

  setSize(width, height, pixelRatio = 1) {
    const effectiveW = Math.max(64, Math.floor(width * pixelRatio));
    const effectiveH = Math.max(64, Math.floor(height * pixelRatio));
    this.waterMaterial.uniforms.uResolution.value.set(effectiveW, effectiveH);

    const rtW = Math.max(64, Math.floor(effectiveW * this.prePassScale));
    const rtH = Math.max(64, Math.floor(effectiveH * this.prePassScale));
    this.grabRenderTarget.setSize(rtW, rtH);
  }

  /**
   * Renders the opaque scene pre-pass into uGrabTexture and uDepthTexture
   * while hiding the water surface mesh (equivalent to Unity's GrabPass {"_MWGrab"}).
   */
  renderPrePass(renderer, scene, camera) {
    camera.updateMatrixWorld();
    const u = this.waterMaterial.uniforms;
    u.uCameraNear.value = camera.near;
    u.uCameraFar.value = camera.far;
    u.uInverseProjectionMatrix.value.copy(camera.projectionMatrixInverse);
    u.uCameraMatrixWorld.value.copy(camera.matrixWorld);

    const prevVisible = this.visible;
    const prevRenderTarget = renderer.getRenderTarget();
    const prevToneMapping = renderer.toneMapping;

    this.visible = false;
    // Render linear scene into GrabPass so water shader doesn't double-tonemap
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setRenderTarget(this.grabRenderTarget);
    renderer.clear();
    renderer.render(scene, camera);

    renderer.setRenderTarget(prevRenderTarget);
    renderer.toneMapping = prevToneMapping;
    this.visible = prevVisible;
  }

  updateTime(elapsedTime) {
    this.waterMaterial.uniforms.uTime.value = elapsedTime;
  }

  /**
   * Exact CPU counterpart of the vertex shader's Gerstner wave height at (x, z, time).
   * Used for camera submersion detection and floating object buoyancy.
   */
  getWaveHeightAt(x, z, time = this.waterMaterial.uniforms.uTime.value) {
    const config = this.waterMaterial.getGerstnerConfig();
    config.waterLevel = this.position.y + this.waterMaterial.uniforms.uWaterLevel.value;
    const sample = evaluateGerstnerWavesCPU(x, z, time, config);
    return sample.surfaceHeight;
  }

  /**
   * Returns full displacement, analytical normal/tangent/binormal, and crest factor.
   */
  getWaveSampleAt(x, z, time = this.waterMaterial.uniforms.uTime.value) {
    const config = this.waterMaterial.getGerstnerConfig();
    config.waterLevel = this.position.y + this.waterMaterial.uniforms.uWaterLevel.value;
    return evaluateGerstnerWavesCPU(x, z, time, config);
  }

  dispose() {
    this.geometry.dispose();
    this.waterMaterial.dispose();
    this.grabRenderTarget.dispose();
    if (this.grabRenderTarget.depthTexture) {
      this.grabRenderTarget.depthTexture.dispose();
    }
  }
}
