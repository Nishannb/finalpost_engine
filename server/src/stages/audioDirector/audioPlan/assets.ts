/**
 * Assets a plan can name. A plan never carries a URL or a path: it names an id here, and the compiler resolves it.
 *
 *  - Music: an injected catalogue (`MusicAsset`), built by the caller from whatever supplies beds (the existing generated-bed pool, a licensed
 *    library). Placement metadata is the existing `BedPlacementMeta` (stages/music/placementMeta.ts), measured by agents/music_specialist.
 *  - SFX: the three renderer built-ins (remotion/public/sfx, measured below) and the existing human SFX catalogue (lib/sfxCatalog.ts).
 *
 * Rights are fail-closed: an asset without `rights.cleared === true` is unavailable.
 */

import type {BedPlacementMeta} from '../../music/placementMeta.ts';

export type MusicAsset = {
  id: string;
  kind: 'music';
  /** Which resolver arm supplied it (AudioDesign.musicSource). */
  source: 'licensed' | 'generated';
  /** Played file (AudioDesign.musicUrl). Lambda needs public HTTPS; anything else is a warning, not an error. */
  url: string;
  /** The full bed played once (AudioDesign.musicFullUrl); defaults to `url`. */
  fullUrl?: string;
  /** Bar-aligned loop body (AudioDesign.musicLoopUrl). */
  loopUrl?: string;
  /** Voice-carved twin (AudioDesign.musicCarvedUrl). */
  carvedUrl?: string;
  fullDurationSec: number;
  integratedLufs?: number;
  bpm?: number;
  placement?: BedPlacementMeta;
  rights: {cleared: boolean; licence: string; note?: string};
};

/**
 * Phase 1.5: an SFX file registered for a plan to name (`sound: {kind: 'asset'}`), e.g. one generated for a specific event
 * (audioDirector/generation/manifest.ts). Measured like the built-ins, so the compiler places and levels it the same way.
 */
export type SfxAsset = {
  id: string;
  kind: 'sfx';
  source: 'generated' | 'licensed';
  /** Renderer source: `staticFile:<path under remotion/public>` (remotion/src/lib/mediaSrc.ts). */
  src: string;
  durationSec: number;
  /** Sample peak of the file. */
  peakDbfs: number;
  /** First sample at or above 50 % of the peak (the same onset rule as BUILTIN_SFX). */
  transientOffsetSec: number;
  rights: {cleared: boolean; licence: string; note?: string};
  /** Phase SFX-3D: channels of the file, when measured (1 = mono: the renderer compensates its upmix). Absent = not compensated. */
  channels?: 1 | 2;
  /** Visual Event Sound Design: the file was speech-band carved at ingest (required for an under-speech onset accent). */
  speechBandCarved?: boolean;
  /** A carved file is levelled from its PRE-carve peak, so carving is a real speech-band reduction and never turns into a level boost. */
  levelPeakDbfs?: number;
};

export type AudioAssetCatalog = {music: ReadonlyMap<string, MusicAsset>; sfx?: ReadonlyMap<string, SfxAsset>};

export type BuiltinSfx = {
  name: 'whoosh' | 'hit' | 'pop';
  /** Path the renderer resolves with staticFile (remotion/src/components/SfxTrack.tsx FILES). */
  staticPath: string;
  durationSec: number;
  /** Sample peak of the file. */
  peakDbfs: number;
  /** Onset reference: the first sample at or above 50 % of the peak. The point that lands on an anchor with `align: transient`. */
  transientOffsetSec: number;
  /** Phase SFX-3D: channels of the file (all three built-ins are mono; assets.test.ts re-measures). */
  channels: 1 | 2;
};

/**
 * Measured from the files in remotion/public/sfx (22.05 kHz mono 16-bit) on 2026-11-12; assets.test.ts re-measures the files and fails if they change.
 */
export const BUILTIN_SFX: Readonly<Record<BuiltinSfx['name'], BuiltinSfx>> = Object.freeze({
  whoosh: {name: 'whoosh', staticPath: 'sfx/whoosh.wav', durationSec: 0.32, peakDbfs: -8.53, transientOffsetSec: 0.0554, channels: 1},
  hit: {name: 'hit', staticPath: 'sfx/hit.wav', durationSec: 0.18, peakDbfs: -8.67, transientOffsetSec: 0.0005, channels: 1},
  pop: {name: 'pop', staticPath: 'sfx/pop.wav', durationSec: 0.14, peakDbfs: -8.54, transientOffsetSec: 0.0002, channels: 1},
});

export const musicCatalog = (assets: readonly MusicAsset[]): AudioAssetCatalog => ({music: new Map(assets.map(asset => [asset.id, asset]))});
/** Phase 1.5: music and registered SFX assets together. */
export const audioCatalog = (music: readonly MusicAsset[], sfx: readonly SfxAsset[]): AudioAssetCatalog => ({
  music: new Map(music.map(asset => [asset.id, asset])),
  sfx: new Map(sfx.map(asset => [asset.id, asset])),
});
