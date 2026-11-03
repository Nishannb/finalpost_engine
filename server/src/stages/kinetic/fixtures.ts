/** Test / storyboard fixtures (pure). */
import type {KineticShot, KineticWord} from './schema.ts';
import {toKineticWords, type RawWord} from './transcript.ts';

const SENTENCE = 'You are TIRED of waiting. Believe in yourself! Stand out every single day, because extraordinary people never quit.';
export function fixtureRawWords(fps = 30): RawWord[] {
  let t = 0.2;
  return SENTENCE.split(' ').map(text => {
    const dur = 0.18 + Math.min(0.4, text.replace(/\W/g, '').length * 0.035);
    const w = {text, start: +t.toFixed(3), end: +(t + dur).toFixed(3)};
    t += dur + (/[.!?,]$/.test(text) ? 0.32 : 0.04);
    return w;
  });
}
export const fixtureWords = (fps = 30): KineticWord[] => toKineticWords(fixtureRawWords(fps), fps);
export const fixtureShots = (words: KineticWord[]): KineticShot[] => [{id: 'shot-0', startFrame: 0, endFrame: (words[words.length - 1]?.endFrame ?? 30) + 30}];
