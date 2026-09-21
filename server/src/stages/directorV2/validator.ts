/**
 * Stage 4 hard rules only. No counts, spacing, or variety.
 */

import {CAPTION_BAND, legalSlots, overlapArea, slotRectForAnchor} from '../layout/occupancy.ts';
import {overlayTextIsFactual} from '../broll/geminiDirector.ts';
import type {DirectorViolation} from '../../types/blueprint.ts';
import {resolveWordRange} from './perception.ts';
import type {CompiledElement, PerceptionPack} from './types.ts';

export function occupancyAt(pack: PerceptionPack, atSec: number) {
  const slices = pack.occupancySlices;
  if (slices.length === 0) {
    return null;
  }
  return slices.reduce((best, slice) =>
    Math.abs(slice.atSec - atSec) < Math.abs(best.atSec - atSec) ? slice : best,
  ).occupancy;
}

export function compileWordRanges(
  pack: PerceptionPack,
  elements: Array<{
    id: string;
    kind: string;
    wordRange: {startWordId: string; endWordId: string; preRollMs?: number; postRollMs?: number};
    overlayText?: string;
    text?: string;
    layout?: string;
    anchor?: string;
    [key: string]: unknown;
  }>,
): {elements: CompiledElement[]; violations: DirectorViolation[]; drops: string[]} {
  const compiled: CompiledElement[] = [];
  const violations: DirectorViolation[] = [];
  const drops: string[] = [];

  for (const element of elements) {
    const range = resolveWordRange(
      pack.words,
      element.wordRange.startWordId,
      element.wordRange.endWordId,
      element.wordRange.preRollMs,
      element.wordRange.postRollMs,
    );
    if (!range) {
      violations.push({
        code: 'bad_word_range',
        elementId: element.id,
        reason: `Missing word ids ${element.wordRange.startWordId}–${element.wordRange.endWordId}`,
      });
      drops.push(`drop:${element.id}:bad_word_range`);
      continue;
    }
    if (range.start >= pack.outputDurationSec || range.end <= 0) {
      violations.push({
        code: 'out_of_timeline',
        elementId: element.id,
        reason: `Window ${range.start.toFixed(2)}–${range.end.toFixed(2)} is outside the output`,
      });
      drops.push(`drop:${element.id}:out_of_timeline`);
      continue;
    }
    compiled.push({
      ...(element as CompiledElement),
      start: Math.max(0, range.start),
      end: Math.min(pack.outputDurationSec, range.end),
    });
  }

  return {elements: compiled, violations, drops};
}

export function validateCompiled(
  pack: PerceptionPack,
  elements: CompiledElement[],
): DirectorViolation[] {
  const violations: DirectorViolation[] = [];
  const faceLayouts = new Set(['cutout', 'split', 'cutaway', 'composite', 'depth_overlay', 'inset_reveal']);

  for (const element of elements) {
    const hold = element.end - element.start;
    const copy = (element.overlayText || element.text || '').trim();
    if (copy && element.kind !== 'hook_title') {
      const words = copy.split(/\s+/).filter(Boolean).length;
      if (hold < words * 0.35) {
        violations.push({
          code: 'unreadably_short',
          elementId: element.id,
          reason: `"${copy}" needs ~${(words * 0.35).toFixed(1)}s, has ${hold.toFixed(1)}s`,
        });
      }
      if (!overlayTextIsFactual(copy, pack.transcript)) {
        violations.push({
          code: 'unfactual_text',
          elementId: element.id,
          reason: `Overlay copy is not in the transcript: ${copy}`,
        });
      }
    }

    if (
      faceLayouts.has(element.kind) ||
      faceLayouts.has(element.layout || '') ||
      element.kind === 'hook_title'
    ) {
      continue;
    }
    const occupancy = occupancyAt(pack, (element.start + element.end) / 2);
    if (!occupancy) {
      continue;
    }
    if (occupancy.source === 'fallback') {
      continue;
    }
    const anchor = element.anchor || 'top_right';
    const rect = slotRectForAnchor(anchor);
    if (overlapArea(rect, occupancy.speaker) > 0.05) {
      const legal = legalSlots(occupancy);
      if (legal.length > 0) {
        violations.push({
          code: 'occludes_speaker',
          elementId: element.id,
          reason: `Anchor ${anchor} covers the speaker box`,
        });
      }
    }
    if (overlapArea(rect, CAPTION_BAND) > 0.02) {
      violations.push({
        code: 'caption_band',
        elementId: element.id,
        reason: `Anchor ${anchor} sits in the caption band`,
      });
    }
  }

  const zooms = elements.filter(element => element.kind === 'zoom');
  const plates = elements.filter(
    element =>
      element.kind === 'cutaway' ||
      element.kind === 'cutout' ||
      element.kind === 'split' ||
      element.kind === 'depth_overlay' ||
      element.kind === 'inset_reveal',
  );
  for (const zoom of zooms) {
    if (plates.some(plate => rangesOverlap(zoom, plate))) {
      violations.push({
        code: 'zoom_on_cutaway',
        elementId: zoom.id,
        reason: 'Zoom overlaps a cutaway/cutout/split/depth_overlay/inset_reveal',
      });
    }
  }

  return violations;
}

export function dropUnfactual(pack: PerceptionPack, elements: CompiledElement[]): {
  elements: CompiledElement[];
  drops: string[];
} {
  const kept: CompiledElement[] = [];
  const drops: string[] = [];
  for (const element of elements) {
    const copy = (element.overlayText || element.text || '').trim();
    if (element.kind === 'hook_title') {
      kept.push(element);
      continue;
    }
    if (copy && !overlayTextIsFactual(copy, pack.transcript)) {
      drops.push(`drop:${element.id}:unfactual`);
      continue;
    }
    kept.push(element);
  }
  return {elements: kept, drops};
}

function rangesOverlap(
  a: {start: number; end: number},
  b: {start: number; end: number},
): boolean {
  return a.start < b.end && b.start < a.end;
}
