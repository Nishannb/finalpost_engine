/**
 * Real 3D text for the two glossy presets (@remotion/three + three TextGeometry). Flat presets never import this file's canvas. If the canvas throws (no WebGL in a test env) the CSS extrude fallback renders.
 * Typeface JSON files are generated from the vendored OFL fonts (scripts/kinetic/make-typeface.mjs) and bundled as modules, so nothing is fetched at render.
 */
import {ThreeCanvas} from '@remotion/three';
import React, {useMemo} from 'react';
import * as THREE from 'three';
import {FontLoader} from 'three/examples/jsm/loaders/FontLoader.js';
import {TextGeometry} from 'three/examples/jsm/geometries/TextGeometry.js';

import bebas from '../../public/fonts/typeface/bebas-neue.typeface.json';
import inter from '../../public/fonts/typeface/inter-900.typeface.json';
import playfair from '../../public/fonts/typeface/playfair-display-400.typeface.json';
import anton from '../../public/fonts/typeface/anton-400.typeface.json';
import {clamp01, lineStyle, type PresetProps} from './primitives';
import type {FontKey, RenderLine} from './spec';

const loader = new FontLoader();
const FACES = {bebas: loader.parse(bebas as never), inter: loader.parse(inter as never), playfair: loader.parse(playfair as never), anton: loader.parse(anton as never)};
const faceOf = (k: FontKey) => (k === 'bebas' ? FACES.bebas : k === 'anton' ? FACES.anton : k === 'playfair' || k === 'playfairItalic' ? FACES.playfair : FACES.inter);

class Boundary extends React.Component<{fallback: React.ReactNode; children: React.ReactNode}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  componentDidCatch(err: unknown) { console.warn('[kinetic] three canvas failed, using CSS extrude fallback:', err); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

const Word: React.FC<{line: RenderLine; local: number; mode: 'rise' | 'world'; colors: string[]}> = ({line, local, mode, colors}) => {
  const geo = useMemo(() => {
    const text = line.uppercase ? line.text.toUpperCase() : line.text;
    const g = new TextGeometry(text, {font: faceOf(line.font), size: line.fontPx * 0.72, depth: line.fontPx * 0.26, curveSegments: 6, bevelEnabled: true, bevelThickness: line.fontPx * 0.02, bevelSize: line.fontPx * 0.015, bevelSegments: 3});
    g.computeBoundingBox();
    const b = g.boundingBox!;
    g.translate(-(b.max.x + b.min.x) / 2, -(b.max.y + b.min.y) / 2, -(b.max.z + b.min.z) / 2);
    // fit the width to the planned line width
    const w = b.max.x - b.min.x;
    // leave room for the yaw so the side face (FLIP / WIEGRAPHICS) stays inside the canvas
    const s = w > 0 ? Math.min(1.15, (line.w * 0.8) / w) : 1;
    g.scale(s, s, 1);
    return g;
  }, [line.text, line.font, line.fontPx, line.uppercase, line.w]);
  const u = clamp01(local / 14);
  const rotX = mode === 'rise' ? -0.28 * (1 - u) + 0.1 : 0.12;
  const rotY = mode === 'world' ? -0.4 : 0.42;
  const albedo = colors[0] ?? '#ffffff';
  const emit = colors[1] ?? albedo;
  return (
    <mesh geometry={geo} rotation={[rotX, rotY, 0]}>
      <meshPhysicalMaterial color={albedo} metalness={0.16} roughness={0.38} clearcoat={0.55} clearcoatRoughness={0.25} emissive={emit} emissiveIntensity={0.55} />
    </mesh>
  );
};

/** CSS extrude: stacked hard shadows in a darker tone. Used by hero.extrudedStack.front and as the 3D fallback. */
export const cssExtrude = (color: string, depth: number): string => Array.from({length: depth}, (_, i) => `${i + 1}px ${i + 1}px 0 ${color}`).join(', ');
const shade = (hex: string): string => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#333333';
  const n = parseInt(m[1]!, 16);
  const ch = (v: number) => Math.round(v * 0.45).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
};

export const Extruded3DText: React.FC<PresetProps & {mode: 'rise' | 'world'}> = ({event, local, mode}) => {
  const line = event.lines.find(l => l.role === 'hero') ?? event.lines[0]!;
  const cssFallback = (
    <div style={{...lineStyle(line, event, undefined, {extrude: cssExtrude(shade(line.fill.colors[0] ?? '#FF7A18'), Math.round(line.fontPx * 0.08))}), top: 0}}>{line.text}</div>
  );
  const fov = 30;
  const camZ = (event.block.h / 2) / Math.tan((fov * Math.PI) / 360);
  return (
    <Boundary fallback={cssFallback}>
      <ThreeCanvas width={Math.ceil(event.block.w)} height={Math.ceil(event.block.h)} camera={{fov, position: [0, 0, camZ], near: 1, far: camZ * 4}} style={{position: 'absolute', left: 0, top: 0}}>
        <ambientLight intensity={1.05} />
        <directionalLight position={[-300, 400, 500]} intensity={1.6} />
        <directionalLight position={[400, -200, 300]} intensity={0.55} color={line.fill.colors[0] ?? '#ffffff'} />
        <pointLight position={[0, 0, 600]} intensity={1.1} color={line.fill.colors[0] ?? '#ffffff'} />
        <Word line={line} local={local} mode={mode} colors={line.fill.colors} />
      </ThreeCanvas>
    </Boundary>
  );
};
