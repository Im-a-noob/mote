// ============================================================================
// Mochie's Water Shader — WaterDefines.glsl
// 1:1 Port of Assets/Mochie/Water Shader/WaterDefines.cginc (HLSL -> GLSL)
// ============================================================================

#ifndef MOCHIE_WATER_DEFINES_GLSL
#define MOCHIE_WATER_DEFINES_GLSL

#define PI 3.14159265359
#define TWO_PI 6.28318530718
#define HALF_PI 1.57079632679
#define EPSILON 1e-5

// HLSL -> GLSL Intrinsic Aliases
#define saturate(x) clamp((x), 0.0, 1.0)
#define lerp(a, b, t) mix((a), (b), (t))
#define frac(x) fract((x))

// Time & Camera Matrices
uniform float uTime;
uniform float uWaterLevel;
uniform float uCameraNear;
uniform float uCameraFar;
uniform vec2 uResolution;
uniform mat4 uInverseProjectionMatrix;
uniform mat4 uCameraMatrixWorld;

// Lighting & Environment
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform samplerCube uEnvMap;
uniform float uHasEnvMap;

// Pre-Pass Grab & Depth Buffers (_MWGrab & _CameraDepthTexture)
uniform sampler2D uGrabTexture;
uniform sampler2D uDepthTexture;
uniform float uHasDepthTexture;

// Surface Textures
uniform sampler2D uNormalMap0;
uniform sampler2D uNormalMap1;
uniform sampler2D uFlowMap;
uniform sampler2D uNoiseTex;
uniform sampler2D uFoamTex;

// 1. Surface Properties
uniform vec3 uSurfaceColor;       // _Color
uniform vec3 uAngleTint;          // _AngleTint
uniform vec3 uBackfaceTint;       // _BackfaceColor
uniform float uOpacity;           // _Opacity
uniform float uRoughness;         // _Roughness
uniform float uMetallic;          // _Metallic

// 2. Normal Maps & Flow
uniform float uNormalStr0;        // _NormalStr0
uniform vec2 uNormalScale0;       // _NormalMap0_ST.xy
uniform vec2 uNormalScroll0;      // _NormalMapScroll0
uniform float uNormalStr1;        // _NormalStr1
uniform vec2 uNormalScale1;       // _NormalMap1_ST.xy
uniform vec2 uNormalScroll1;      // _NormalMapScroll1
uniform float uDetailNormalBlend; // RNM vs Whiteout blend weight
uniform float uStochasticToggle;  // _Stochastic0 / _Stochastic1
uniform float uFlowToggle;        // _FlowToggle
uniform float uFlowSpeed;         // _FlowSpeed
uniform float uFlowStrength;      // _FlowStrength
uniform float uFlowScale;         // _FlowScale

// 3. Specular & Reflections
uniform float uReflections;       // _Reflections
uniform float uReflStrength;      // _ReflStrength
uniform vec3 uReflTint;           // _ReflTint
uniform float uFresnelPower;      // _FresnelPower
uniform float uSpecToggle;        // _SpecToggle
uniform float uSpecStrength;      // _SpecStrength
uniform float uSpecRoughness;     // _SpecRoughness
uniform vec3 uSpecTint;           // _SpecTint
uniform float uSnellsWindowPower; // Underwater total internal reflection power

// 4. Refraction, Depth Fog & Subsurface Scattering (SSS)
uniform float uRefractionStrength;// _Refract
uniform float uChromAberration;   // _RefractChromatic
uniform float uFogToggle;         // _FogToggle
uniform vec3 uFogTint;            // _FogTint
uniform float uFogPower;          // _FogPower (exponential extinction coefficient)
uniform float uFogBrightness;     // _FogBrightness
uniform float uSSSToggle;         // _SubsurfaceToggle
uniform vec3 uSSSTint;            // _SubsurfaceTint
uniform float uSSSPower;          // _SubsurfacePower
uniform float uSSSIntensity;      // _SubsurfaceStrength
uniform float uSSSHeightBias;     // Crest height contribution to SSS

// 5. Depth-Projected 3D Voronoi Caustics
uniform float uCausticsToggle;    // _CausticsToggle
uniform vec3 uCausticsColor;      // _CausticsColor
uniform float uCausticsOpacity;   // _CausticsOpacity
uniform float uCausticsScale;     // _CausticsScale
uniform float uCausticsSpeed;     // _CausticsSpeed
uniform float uCausticsPower;     // _CausticsPower
uniform float uCausticsFade;      // _CausticsFade (depth attenuation)
uniform float uCausticsDisp;      // _CausticsDisp (RGB chromatic phase split)
uniform float uCausticsDistortion;// _CausticsDistortion (normal/noise warp)
uniform float uCausticsSurfaceFade;// Fade near water surface

// 6. Edge (Intersection) Foam & Gerstner Crest Foam
uniform float uFoamToggle;        // _FoamToggle
uniform vec3 uFoamColor;          // _FoamColor
uniform float uFoamOpacity;       // _FoamOpacity
uniform float uFoamEdgeDepth;     // _FoamPower (intersection depth threshold)
uniform float uFoamEdgePower;     // _FoamEdgeStrength
uniform vec2 uFoamScale;          // _FoamTex_ST.xy
uniform vec2 uFoamScroll;         // _FoamTexScroll
uniform float uFoamNoiseStr;      // _FoamDistortionStrength
uniform float uCrestFoamToggle;   // _FoamCrestToggle
uniform float uCrestFoamThreshold;// _FoamCrestThreshold
uniform float uCrestFoamPower;    // _FoamCrestPower
uniform float uCrestFoamStrength; // _FoamCrestStrength

// 7. Gerstner Waves (4-Wave System + Domain Warping)
uniform float uWavesToggle;       // _VertOffsetMode == Gerstner
uniform float uWaveGlobalAmp;     // _WaveStrengthGlobal
uniform float uWaveGlobalSpeed;   // _WaveSpeedGlobal
uniform float uWaveGlobalScale;   // _WaveScaleGlobal
uniform float uWaveNormalStr;     // _WaveNormalStr
uniform float uWaveWarpStrength;  // _Turbulence / Wave Crest Warp Strength
uniform float uWaveWarpScale;     // _TurbulenceScale
uniform float uWaveWarpSpeed;     // _TurbulenceSpeed
uniform vec4 uWaveEnabled;        // Individual toggles for Wave 0, 1, 2, 3
// Each vec4 = (steepness Q, wavelength L, directionDegrees, speedMultiplier)
uniform vec4 uWave0;
uniform vec4 uWave1;
uniform vec4 uWave2;
uniform vec4 uWave3;
uniform vec4 uWavePhaseOffsets;   // Phase offset per wave

#endif
