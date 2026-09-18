/**
 * List beats from spoken enumerations.
 *
 * When a creator says "first… second… third…" or "three things: A, B, and C",
 * each item deserves its own related cutaway/split so the viewer can follow.
 */

import {ensureEnglishSearchQuery} from './englishSearch.ts';
import {applySubjectToQuery, inferStockSubject, type StockSubject} from './visualQuery.ts';

export type ListBeat = {
  order: number;
  label: string;
  /** English Pexels scene for this item in the video's topic. */
  searchKeyword: string;
};

const ORDINAL =
  /\b(?:first|second|third|fourth|fifth|one|two|three|four|five|1st|2nd|3rd|4th|5th)\b/i;

export function listBeatsFromTranscript(transcript: string, max = 5): ListBeat[] {
  const subject = inferStockSubject(transcript);
  const numbered = numberedList(transcript, subject);
  if (numbered.length >= 2) {
    return numbered.slice(0, max);
  }
  const ordinal = ordinalList(transcript, subject);
  if (ordinal.length >= 2) {
    return ordinal.slice(0, max);
  }
  const colon = colonList(transcript, subject);
  if (colon.length >= 2) {
    return colon.slice(0, max);
  }
  return [];
}

function numberedList(transcript: string, subject: StockSubject): ListBeat[] {
  const matches = [
    ...transcript.matchAll(
      /(?:^|[.\n;]|)\s*(?:(?:number\s*)?([1-5])[\).:]|\b([1-5])\s*[-–—]\s*)\s*([^.\n;]{3,60})/gi,
    ),
  ];
  const out: ListBeat[] = [];
  for (const match of matches) {
    const order = Number(match[1] || match[2] || 0);
    const label = cleanLabel(match[3] ?? '');
    if (!order || !label) {
      continue;
    }
    out.push({
      order,
      label,
      searchKeyword: sceneForLabel(label, subject, transcript),
    });
  }
  return dedupe(out);
}

function ordinalList(transcript: string, subject: StockSubject): ListBeat[] {
  if (!ORDINAL.test(transcript)) {
    return [];
  }
  const matches = [
    ...transcript.matchAll(
      /\b(first|second|third|fourth|fifth|one|two|three|four|five)\b[,:]?\s+([^.\n;]{3,70})/gi,
    ),
  ];
  const orderMap: Record<string, number> = {
    first: 1,
    one: 1,
    second: 2,
    two: 2,
    third: 3,
    three: 3,
    fourth: 4,
    four: 4,
    fifth: 5,
    five: 5,
  };
  const out: ListBeat[] = [];
  for (const match of matches) {
    const key = (match[1] ?? '').toLowerCase();
    const order = orderMap[key];
    const label = cleanLabel(match[2] ?? '');
    if (!order || !label || label.split(/\s+/).length > 10) {
      continue;
    }
    out.push({
      order,
      label,
      searchKeyword: sceneForLabel(label, subject, transcript),
    });
  }
  return dedupe(out);
}

function colonList(transcript: string, subject: StockSubject): ListBeat[] {
  const match = transcript.match(
    /\b(?:things?|steps?|ways?|tips?|reasons?|ideas?|movements?|exercises?|habits?)\b[^.\n:]{0,40}:\s*([^.\n]{8,160})/i,
  );
  if (match) {
    const chunk = match[1] ?? '';
    const parts = chunk
      .split(/,|，|、|\band\b|\bor\b/i)
      .map(cleanLabel)
      .filter(part => part.split(/\s+/).length >= 1 && part.split(/\s+/).length <= 6);
    if (parts.length >= 2) {
      return parts.slice(0, 5).map((label, index) => ({
        order: index + 1,
        label,
        searchKeyword: sceneForLabel(label, subject, transcript),
      }));
    }
  }

  // "three movements that…" without a colon — pull following noun phrases.
  const counted = transcript.match(
    /\b(?:three|3|four|4|five|5)\s+(?:essential\s+)?(?:low[\s-]?impact\s+)?(?:daily\s+)?(things?|steps?|ways?|tips?|movements?|exercises?|habits?)\b[^.\n]{0,80}/i,
  );
  if (!counted) {
    return [];
  }
  const after = transcript.slice((counted.index ?? 0) + counted[0].length, (counted.index ?? 0) + counted[0].length + 180);
  const parts = after
    .split(/,|，|\band\b|\bor\b|\.|\!|\?/i)
    .map(cleanLabel)
    .filter(part => part.split(/\s+/).length >= 2 && part.split(/\s+/).length <= 7)
    .slice(0, 5);
  if (parts.length < 2) {
    return [];
  }
  return parts.map((label, index) => ({
    order: index + 1,
    label,
    searchKeyword: sceneForLabel(label, subject, transcript),
  }));
}

function sceneForLabel(label: string, subject: StockSubject, transcript: string): string {
  const base = ensureEnglishSearchQuery(label) || label.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
  const words = base.split(/\s+/).filter(Boolean).slice(0, 4);
  if (words.length === 0) {
    return applySubjectToQuery('person working at desk', subject);
  }
  const scene =
    words.length === 1
      ? `${words[0]} cinematic closeup`
      : words.join(' ');
  // Keep topic gender when the overall talk is about people.
  if (/\b(women|woman|travel|trip|people)\b/i.test(transcript)) {
    return applySubjectToQuery(scene, subject);
  }
  return scene;
}

function cleanLabel(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/^[^a-zA-Z0-9\u0900-\u097F\u0B80-\u0BFF]+/, '')
    .replace(/[^a-zA-Z0-9\u0900-\u097F\u0B80-\u0BFF\s'-]+$/u, '')
    .trim();
}

function dedupe(beats: ListBeat[]): ListBeat[] {
  const seen = new Set<string>();
  const out: ListBeat[] = [];
  for (const beat of beats.sort((a, b) => a.order - b.order)) {
    const key = beat.label.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(beat);
  }
  return out;
}
