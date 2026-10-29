/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Waves,
  Eye,
  Code2,
  Sliders,
  ChevronDown,
  ChevronUp,
  Sun,
  Compass,
  Check,
  Copy,
  X,
} from 'lucide-react';
import { initMochieDemoScene, CAMERA_VIEW_PRESETS } from './demo/main.js';
import { MOCHIE_SHADER_SOURCES } from './lib/MochieWaterMaterial.js';
import { MOCHIE_WATER_PRESETS } from './lib/mochieWaterMath';

const INSPECTOR_TABS = [
  'Surface',
  'Normal Maps',
  'Specular & Reflections',
  'Refraction',
  'Depth Fog & SSS',
  'Foam',
  'Caustics',
  'Gerstner Waves',
  'Underwater',
] as const;

const SHADER_FILE_KEYS = Object.keys(MOCHIE_SHADER_SOURCES) as Array<
  keyof typeof MOCHIE_SHADER_SOURCES
>;

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const sceneApiRef = useRef<ReturnType<typeof initMochieDemoScene> | null>(null);

  const [activeCamPreset, setActiveCamPreset] = useState<string>('overview');
  const [autoDip, setAutoDip] = useState<boolean>(false);
  const [activeWaterPreset, setActiveWaterPreset] = useState<string>('emeraldPier');
  const [sunElevation, setSunElevation] = useState<number>(28);
  const [sunAzimuth, setSunAzimuth] = useState<number>(138);
  const [waveSpeedMult, setWaveSpeedMult] = useState<number>(1.0);

  const [inspectorOpen, setInspectorOpen] = useState<boolean>(false);
  const [activeInspectorTab, setActiveInspectorTab] = useState<string>('Gerstner Waves');
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
  const [glslModalOpen, setGlslModalOpen] = useState<boolean>(false);
  const [selectedGlslFile, setSelectedGlslFile] = useState<keyof typeof MOCHIE_SHADER_SOURCES>('WaterFrag.glsl');
  const [copiedGlsl, setCopiedGlsl] = useState<boolean>(false);

  const [telemetry, setTelemetry] = useState({
    cameraY: 4.6,
    waveY: 0.0,
    submersionDepth: -4.6,
    mediumState: 'Above Surface',
  });

  useEffect(() => {
    const mountEl = canvasMountRef.current;
    if (!mountEl) return;

    const api = initMochieDemoScene(mountEl, {
      onAutoDipChange: (enabled: boolean) => {
        setAutoDip(enabled);
      },
      onTelemetryUpdate: (data: typeof telemetry) => {
        setTelemetry(data);
      },
    });
    sceneApiRef.current = api;

    return () => {
      api.dispose();
      sceneApiRef.current = null;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'h' || e.key === 'H') {
        setDockCollapsed((prev) => !prev);
      } else if (e.key === 'Escape' && glslModalOpen) {
        setGlslModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [glslModalOpen]);

  const handleSelectCameraPreset = (presetId: string) => {
    setActiveCamPreset(presetId);
    setAutoDip(false);
    sceneApiRef.current?.setCameraPreset(presetId);
  };

  const handleToggleAutoDip = () => {
    const next = !autoDip;
    setAutoDip(next);
    if (next) {
      setActiveCamPreset('autodip');
    }
    sceneApiRef.current?.setAutoDip(next);
  };

  const handleSelectWaterPreset = (presetId: string) => {
    setActiveWaterPreset(presetId);
    sceneApiRef.current?.applyWaterPreset(presetId);
  };

  const handleSunElevationChange = (val: number) => {
    setSunElevation(val);
    sceneApiRef.current?.updateSunAngles(val, sunAzimuth);
  };

  const handleSunAzimuthChange = (val: number) => {
    setSunAzimuth(val);
    sceneApiRef.current?.updateSunAngles(sunElevation, val);
  };

  const handleWaveSpeedChange = (val: number) => {
    setWaveSpeedMult(val);
    sceneApiRef.current?.setTimeScale(val);
  };

  const handleSelectInspectorTab = (tabName: string) => {
    if (inspectorOpen && activeInspectorTab === tabName) {
      setInspectorOpen(false);
      sceneApiRef.current?.setInspectorVisible(false);
    } else {
      setActiveInspectorTab(tabName);
      setInspectorOpen(true);
      sceneApiRef.current?.setInspectorVisible(true, tabName);
    }
  };

  const handleCopyGlsl = () => {
    const code = MOCHIE_SHADER_SOURCES[selectedGlslFile] || '';
    navigator.clipboard?.writeText(code);
    setCopiedGlsl(true);
    setTimeout(() => setCopiedGlsl(false), 1800);
  };

  return (
    <div
      className="relative w-screen h-screen overflow-hidden bg-[#070b12] text-slate-100 select-none"
      data-state={telemetry.mediumState}
    >
      {/* Dedicated Isolated WebGL Canvas Mount */}
      <div
        ref={canvasMountRef}
        className="absolute inset-0 w-full h-full z-0"
        aria-label="Mochie Water and Underwater Shader 3D Interactive Coastal Pier Viewport"
      />

      {/* Top Navigation Bar (Strict 3-Zone Contract) */}
      <header className="relative z-20 flex items-center justify-between gap-8 px-6 py-3.5 bg-[#090f1a]/90 border-b border-white/10">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            handleSelectCameraPreset('overview');
          }}
          className="text-base font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
        >
          Mochie Water Shader
        </a>

        {/* Zone 2: 4 concise single-line camera view links */}
        <nav aria-label="Camera Viewpoints" className="hidden md:flex items-center gap-6 text-sm font-medium">
          {Object.values(CAMERA_VIEW_PRESETS).map((cam) => (
            <a
              key={cam.id}
              href={`#${cam.id}`}
              onClick={(e) => {
                e.preventDefault();
                handleSelectCameraPreset(cam.id);
              }}
              className={`transition-colors whitespace-nowrap shrink-0 pb-0.5 ${
                activeCamPreset === cam.id && !autoDip
                  ? 'text-sky-400 border-b border-sky-400'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              {cam.label}
            </a>
          ))}
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setGlslModalOpen((prev) => !prev)}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-sky-400 rounded-lg hover:bg-sky-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {glslModalOpen ? 'Close GLSL Source' : 'Inspect GLSL Source'}
          </button>
        </div>
      </header>

      {/* Unified Collapsible Bottom Control Dock (Zero Center Viewport Occlusion) */}
      <aside
        aria-label="Mochie Water Shader Controls and Inspector"
        className="fixed bottom-4 left-1/2 z-20 w-[min(960px,95vw)] transition-transform duration-200 ease-out"
        style={{
          transform: dockCollapsed
            ? 'translate(-50%, calc(100% - 38px))'
            : 'translate(-50%, 0)',
        }}
      >
        {/* Collapse / Expand Handle Bar */}
        <div className="flex items-center justify-between px-4 py-1.5 bg-[#0b1322]/95 border border-b-0 border-white/15 rounded-t-xl">
          <div className="flex items-center gap-2 text-xs text-slate-300 font-mono tabular-nums overflow-x-auto whitespace-nowrap">
            <span className="font-sans font-semibold text-sky-400">{telemetry.mediumState}</span>
            <span aria-hidden="true">·</span>
            <span>Cam Y: {telemetry.cameraY >= 0 ? `+${telemetry.cameraY.toFixed(2)}` : telemetry.cameraY.toFixed(2)}m</span>
            <span aria-hidden="true">·</span>
            <span>Gerstner Y: {telemetry.waveY >= 0 ? `+${telemetry.waveY.toFixed(2)}` : telemetry.waveY.toFixed(2)}m</span>
            <span aria-hidden="true">·</span>
            <span>
              Submersion: {telemetry.submersionDepth >= 0 ? `+${telemetry.submersionDepth.toFixed(2)}` : telemetry.submersionDepth.toFixed(2)}m
            </span>
          </div>

          <button
            type="button"
            onClick={() => setDockCollapsed((prev) => !prev)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            aria-expanded={!dockCollapsed}
          >
            {dockCollapsed ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                <span>Show Controls (H)</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                <span>Hide Controls (H)</span>
              </>
            )}
          </button>
        </div>

        {/* Main Dock Body */}
        <div className="p-4 bg-[#0b1322]/95 border border-white/15 rounded-b-xl shadow-2xl space-y-3">
          {/* Row 1: Material Presets, Camera Dip Toggle, and Lighting / Speed Sliders */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/10">
            {/* Material Presets */}
            <div className="flex items-center gap-1 p-1 bg-[#111c30] rounded-lg border border-white/10">
              {Object.values(MOCHIE_WATER_PRESETS).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectWaterPreset(preset.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activeWaterPreset === preset.id
                      ? 'bg-sky-500 text-slate-950 font-semibold'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {preset.name}
                </button>
              ))}
            </div>

            {/* Automated Dip Underwater / Bobbing & Quick Camera Views */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleToggleAutoDip}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  autoDip
                    ? 'bg-teal-400 text-slate-950 border-teal-300'
                    : 'bg-[#132038] text-slate-200 border-white/15 hover:bg-[#1a2b49]'
                }`}
              >
                <Waves className="w-3.5 h-3.5" />
                <span>{autoDip ? 'Stop Underwater Dip' : 'Dip Underwater / Bobbing'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const nextOpen = !inspectorOpen;
                  setInspectorOpen(nextOpen);
                  sceneApiRef.current?.setInspectorVisible(nextOpen, activeInspectorTab);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  inspectorOpen
                    ? 'bg-sky-500/20 text-sky-300 border-sky-400/50'
                    : 'bg-[#132038] text-slate-300 border-white/15 hover:text-white'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>{inspectorOpen ? 'Hide Parameter GUI' : 'Open Parameter GUI'}</span>
              </button>
            </div>

            {/* Environment Sliders */}
            <div className="flex items-center gap-4 text-xs text-slate-300">
              <label className="flex items-center gap-2 whitespace-nowrap">
                <Sun className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                <span>Sun Elev</span>
                <input
                  type="range"
                  aria-label="Sun Elevation Angle"
                  min={6}
                  max={78}
                  step={1}
                  value={sunElevation}
                  onChange={(e) => handleSunElevationChange(Number(e.target.value))}
                  className="w-20 accent-sky-400 cursor-pointer"
                />
                <span className="font-mono tabular-nums w-8 text-right">{sunElevation}°</span>
              </label>

              <label className="flex items-center gap-2 whitespace-nowrap">
                <Compass className="w-3.5 h-3.5 text-sky-300 shrink-0" />
                <span>Azimuth</span>
                <input
                  type="range"
                  aria-label="Sun Azimuth Angle"
                  min={0}
                  max={360}
                  step={2}
                  value={sunAzimuth}
                  onChange={(e) => handleSunAzimuthChange(Number(e.target.value))}
                  className="w-20 accent-sky-400 cursor-pointer"
                />
                <span className="font-mono tabular-nums w-9 text-right">{sunAzimuth}°</span>
              </label>

              <label className="hidden sm:flex items-center gap-2 whitespace-nowrap">
                <span>Wave Speed</span>
                <input
                  type="range"
                  aria-label="Gerstner Wave Speed Multiplier"
                  min={0}
                  max={2.5}
                  step={0.05}
                  value={waveSpeedMult}
                  onChange={(e) => handleWaveSpeedChange(Number(e.target.value))}
                  className="w-16 accent-sky-400 cursor-pointer"
                />
                <span className="font-mono tabular-nums w-9 text-right">{waveSpeedMult.toFixed(1)}x</span>
              </label>
            </div>
          </div>

          {/* Row 2: Mochie's 9 Unity Custom Editor Inspector Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            <span className="text-[11px] font-medium text-slate-400 whitespace-nowrap shrink-0 mr-1">
              Inspector Tabs:
            </span>
            {INSPECTOR_TABS.map((tab) => {
              const isSelected = inspectorOpen && activeInspectorTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => handleSelectInspectorTab(tab)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isSelected
                      ? 'bg-sky-400 text-slate-950 font-semibold'
                      : 'bg-[#132038] text-slate-300 hover:bg-[#1c2f50] hover:text-white'
                  }`}
                >
                  {tab}
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      {/* Ported GLSL Shader Source Inspector Modal */}
      {glslModalOpen && (
        <dialog
          open
          aria-label="Ported Three.js GLSL Shader Source Code"
          className="fixed inset-0 z-50 flex items-center justify-center w-full h-full bg-black/75 p-4 md:p-8 m-0"
        >
          <div className="flex flex-col w-full max-w-5xl h-[min(82vh,760px)] bg-[#0b1322] border border-white/15 rounded-xl shadow-2xl overflow-hidden text-slate-100">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-3.5 bg-[#0f1a2e] border-b border-white/10">
              <div className="flex items-center gap-3">
                <Code2 className="w-5 h-5 text-sky-400" />
                <div>
                  <h2 className="text-sm font-bold text-white">
                    Ported Mochie Water &amp; Underwater GLSL Shaders (1:1 Unity HLSL Translation)
                  </h2>
                  <p className="text-xs text-slate-400">
                    src/lib/shaders/ · Gerstner 4-Wave TBN · 3D Voronoi Caustics · GrabPass Refraction · Underwater Meniscus
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyGlsl}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#182744] hover:bg-[#223559] text-slate-200 rounded-lg border border-white/10 transition-colors cursor-pointer"
                >
                  {copiedGlsl ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Copied GLSL</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy File</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setGlslModalOpen(false)}
                  aria-label="Close GLSL Source Modal"
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* File Selector Tabs */}
            <div className="flex items-center gap-1.5 px-5 py-2.5 bg-[#0c1526] border-b border-white/10 overflow-x-auto">
              {SHADER_FILE_KEYS.map((fileKey) => (
                <button
                  key={fileKey}
                  type="button"
                  onClick={() => setSelectedGlslFile(fileKey)}
                  className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    selectedGlslFile === fileKey
                      ? 'bg-sky-400 text-slate-950 font-semibold'
                      : 'bg-[#14223b] text-slate-300 hover:text-white'
                  }`}
                >
                  {fileKey}
                </button>
              ))}
            </div>

            {/* Code Content */}
            <div className="flex-1 overflow-y-auto p-5 bg-[#070c16]">
              <pre className="text-xs font-mono leading-relaxed text-sky-100/90 whitespace-pre overflow-x-auto select-text">
                <code>{MOCHIE_SHADER_SOURCES[selectedGlslFile]}</code>
              </pre>
            </div>
          </div>
        </dialog>
      )}
    </div>
  );
}
