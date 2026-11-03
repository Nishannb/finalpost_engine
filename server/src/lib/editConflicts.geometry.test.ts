/**
 * The validator's text boxes, checked against bounding boxes MEASURED from rendered Remotion stills
 * (phase 9: each element rendered alone and diffed against a text-free baseline, 540x960 frames).
 * A text box is acceptable when the estimate covers at least 90% of the measured one and is not wildly larger.
 */
import {describe, expect, it} from 'vitest';

import {emphasisRect, hookRect, kineticTextRect} from './editConflicts.ts';

type Box = {x: number; y: number; w: number; h: number};
const covered = (actual: Box, estimate: Box) => {
  const w = Math.max(0, Math.min(actual.x + actual.w, estimate.x + estimate.w) - Math.max(actual.x, estimate.x));
  const h = Math.max(0, Math.min(actual.y + actual.h, estimate.y + estimate.h) - Math.max(actual.y, estimate.y));
  return (w * h) / (actual.w * actual.h);
};

const kinetic = (text: string, over: Record<string, unknown> = {}) => ({text, role: 'primary' as const, fontScale: 0.82, anchor: 'top_left' as const, ...over});
const emphasis = (text: string, anchor: 'top_left' | 'top_right') => ({text, weight: 'primary' as const, treatment: 'color' as const, anchor});

const cases: Array<[string, Box, Box]> = [
  ['hook (minimal, top_left)', {x: 0.046, y: 0.073, w: 0.4, h: 0.042}, hookRect('top_left')],
  ['kinetic underline, italic', {x: 0.07, y: 0.078, w: 0.656, h: 0.042}, kineticTextRect(kinetic('True presence opens real connection', {shape: 'underline', italic: true}))],
  ['emphasis, top_left', {x: 0.054, y: 0.091, w: 0.296, h: 0.031}, emphasisRect(emphasis('true presence', 'top_left'))],
  ['emphasis, top_right', {x: 0.657, y: 0.091, w: 0.3, h: 0.03}, emphasisRect(emphasis('True Presence', 'top_right'))],
  ['emphasis, top_left (long)', {x: 0.044, y: 0.087, w: 0.402, h: 0.036}, emphasisRect(emphasis('Strangely Intimate', 'top_left'))],
  ['kinetic pill, top_right', {x: 0.546, y: 0.078, w: 0.396, h: 0.045}, kineticTextRect(kinetic('Embrace The Pause', {shape: 'pill', anchor: 'top_right'}))],
];

describe('estimated text boxes vs rendered frames', () => {
  it.each(cases)('%s', (_name, actual, estimate) => {
    expect(covered(actual, estimate)).toBeGreaterThanOrEqual(0.9);
    expect(estimate.w).toBeLessThanOrEqual(actual.w * 1.25);
  });
});
