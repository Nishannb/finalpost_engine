/**
 * WP53 (pure): plan sparse VISUAL-BACKEND beats (clip_27..34) from the spoken transcript only — no LLM, no env, no IO. NOT a fifth skill: the beat belongs to an EXISTING toolkit (counter / emphasis / kinetic_text /
 * cutaway), the template id says WHICH move, and the backend (riso / collage_gbro / anidoodle, else the native library fallback in the stage) says HOW it is drawn. Every on-screen string and number is a substring of the
 * spoken sentence (`validateSceneSpec`); a beat that fails grounding is dropped with `visual_backend:ungrounded`.
 * Caps: <= 2 riso, 1 collage, 1 doodle, 1 quote per edit; never the same template twice; never over a blocked range or another beat; silent; ownsFrame -> mute captions.
 */
import {plateShapeAt} from '../../motionDirector/transcriptLibrarySeed.ts';
import {MOTION_TEMPLATE_SYNC_LEAD_SEC, SKILL_MOTION_TEMPLATE_ALLOWLIST, isListLikeText, motionTemplate, type MotionTemplateIntent, type MotionTemplateSkill, type MotionTemplateWord} from '../motionTemplateCatalog.ts';
import {mapPaletteToRiso, validateSceneSpec, type RisoPaletteId, type VisualBackendId, type VisualSceneSpec} from './sceneSpec.ts';

export const DOODLE_STYLE_ALLOWLIST = ['cut-paper', 'pencil-watercolor', 'isometric', 'risograph', 'marker-comic', 'pixel', 'chalkboard', 'cyanotype'] as const;
export type DoodleStyle = (typeof DOODLE_STYLE_ALLOWLIST)[number];
export const DOODLE_DEFAULT_STYLE: DoodleStyle = 'cut-paper';

export type RisoTemplateName = 'number' | 'versus' | 'compare' | 'converge' | 'quote' | 'title';
export type RisoPayload = {kind: 'riso'; template: RisoTemplateName; palette: RisoPaletteId; /** eian DATA minus nothing: palette / mast / duration included */ data: Record<string, unknown>};
export type CollagePayload = {kind: 'collage'; metaphor: {meaning: string; objects: string[]; ground: string; assemble: 'from_empty'; durationSec: number}};
export type DoodlePayload = {kind: 'doodle'; style: DoodleStyle; mechanism: string};

export type VisualBackendBeat = {
  id: string;
  start: number;
  end: number;
  templateId: string;
  backend: VisualBackendId;
  intent: MotionTemplateIntent;
  muteCaptions: boolean;
  scene: VisualSceneSpec;
  payload: RisoPayload | CollagePayload | DoodlePayload;
};

export type VisualBackendFlags = {riso: boolean; collage: boolean; anidoodle: boolean};

export type VisualBackendPlan = {beats: VisualBackendBeat[]; warnings: string[]};

export const RISO_MAX_BEATS = 2;
export const COLLAGE_MAX_BEATS = 1;
export const DOODLE_MAX_BEATS = 1;
export const SPOKEN_MIN_SEC = 2.4;
export const SPOKEN_MAX_SEC = 6.5;
export const COLLAGE_DURATION_SEC = 5;

type Sentence = {text: string; start: number; end: number; words: MotionTemplateWord[]};

export function sentencesOfWords(words: readonly MotionTemplateWord[]): Sentence[] {
  const out: Sentence[] = [];
  let current: MotionTemplateWord[] = [];
  const flush = () => {
    if (current.length === 0) return;
    out.push({text: current.map(w => w.text).join(' '), start: current[0]!.start, end: current[current.length - 1]!.end, words: current});
    current = [];
  };
  for (const [index, word] of words.entries()) {
    current.push(word);
    const next = words[index + 1];
    if (/[.!?]["')\]]*$/.test(word.text) || (next && next.start - word.end > 0.9)) flush();
  }
  flush();
  return out;
}

const STOP = new Set(['the', 'and', 'but', 'that', 'this', 'with', 'from', 'have', 'has', 'had', 'for', 'you', 'your', 'are', 'was', 'were', 'they', 'them', 'their', 'what', 'when', 'then', 'than', 'just', 'over', 'about', 'into', 'will', 'would', 'could', 'should', 'only', 'also', 'very', 'more', 'most', 'some', 'many', 'every', 'because', 'while', 'which', 'there', 'here', "i've", "i'm", "it's", "that's", 'been', 'being', 'does', 'doesn', "don't", 'like', 'actually', 'people']);

const UNIT = '(?:people|clients|customers|users|founders|creators|students|members|subscribers|companies|businesses|projects|videos|views|followers|downloads|countries|dollars|months?|years?|weeks?|days?|hours?|minutes?|seconds?|percent|times)';
const QUANTITY = new RegExp(String.raw`(\$)?(\d[\d,]*(?:\.\d+)?)(?:\s*(%|percent|k\b|million|billion|thousand))?(?:\s+(${UNIT})\b)?`, 'gi');

type Quantity = {value: number; raw: string; prefix: string; suffix: string; unit: string; index: number; end: number};

function quantitiesOf(sentence: string): Quantity[] {
  const out: Quantity[] = [];
  for (const m of sentence.matchAll(QUANTITY)) {
    const dollar = m[1] ?? '';
    const magnitude = m[3] ?? '';
    const unitWord = m[4] ?? '';
    if (!dollar && !magnitude && !unitWord) continue;
    const value = Number(m[2]!.replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    const pct = magnitude === '%' || magnitude.toLowerCase() === 'percent';
    out.push({
      value,
      raw: m[2]!,
      prefix: dollar,
      suffix: pct ? '%' : magnitude && !pct ? ` ${magnitude}` : '',
      unit: unitWord || (pct ? 'percent' : ''),
      index: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
    });
  }
  return out;
}

function digitTokens(sentence: string): number {
  return (sentence.replace(/(\d),(?=\d{3}\b)/g, '$1').match(/\d+(?:\.\d+)?/g) ?? []).length;
}

const SECONDS: Record<string, number> = {second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000};
function unitSeconds(unit: string): number | null {
  const key = unit.toLowerCase().replace(/s$/, '');
  return SECONDS[key] ?? null;
}

const clean = (text: string) => text.replace(/^[\s,;:.\-–—"'(]+|[\s,;:.!?"')]+$/g, '').trim();
const wordsIn = (text: string) => text.split(/\s+/).filter(Boolean);

function topicWord(sentence: string, used: readonly string[]): string {
  const usedNorm = used.join(' ').toLowerCase();
  for (const raw of wordsIn(sentence)) {
    const word = raw.replace(/[^A-Za-z'’]/g, '');
    if (word.length < 5 || STOP.has(word.toLowerCase())) continue;
    if (usedNorm.includes(word.toLowerCase())) continue;
    return word;
  }
  return '';
}

const pad2 = (n: number) => String(n).padStart(2, '0');

type Draft = {
  templateId: string;
  intent: MotionTemplateIntent;
  sentence: Sentence;
  priority: number;
  payload: RisoPayload | CollagePayload | DoodlePayload;
  onScreenText: string[];
  numbers?: VisualSceneSpec['numbers'];
};

const MYTH_CUE = /\b(most people|many people|everyone|everybody|people (?:think|say|believe|assume)|think|thinks|believe|assume|myth)\b/i;
const SPLITTER = /[,;:\-–—]?\s*\b(actually|in fact|the truth is|but really|but|in reality)\b[,:]?\s+/i;
const BEFORE_NOW = /\b(used to|before|back then|previously)\b[\s\S]*\b(now|today|these days|actually)\b/i;
const FROM_TO = /\bfrom\s+(\d[\d,]*\+?|dozens|hundreds)\s+([A-Za-z' -]{0,30}?)\s*\bto\b\s+(\d[\d,]*|a few|just a few|a handful|few|one|two|three|four|five|six)\b\s*([A-Za-z']+)?/i;
const DOZENS_FEW = /\b(dozens|hundreds)\b[\s\S]*?\b(a few|few|a handful)\b/i;
const CHAPTER = /^\W*(?:(part|chapter|step|rule|tip|lesson)\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\b[\s:,.\-–—]*|(first(?:ly)?|second(?:ly)?|third(?:ly)?|fourth)\s*,\s*|number\s+(one|two|three|four|five)\b[\s:,.\-–—]*)/i;
const CONCLUSION = /\b(so|that's why|thats why|remember|bottom line|in the end|at the end of the day|the takeaway|the lesson|the point is|which means|simple as that)\b/i;
const METAPHOR = /\b(?:like (?:a|an|the)|as if|imagine|picture (?:a|an|the)|it'?s a|think of (?:it )?as)\s+((?:[a-z]+\s){0,1}[a-z]+)|\b(puzzle|bridge|foundation|snowball|ripple|seed|roots?|ladder|engine|maze|iceberg|domino|compass|anchor|ecosystem)\b/i;
const MECHANISM = /\b(how (?:it|this|that|[a-z]+) works?|here'?s how|under the hood|the way it works|works by|step by step)\b/i;
const NEWS_COMPOSITIONS = new Set(['TweetCard', 'WikiCallout', 'NewspaperCallout']);

const ORDINAL: Record<string, number> = {one: 1, first: 1, firstly: 1, two: 2, second: 2, secondly: 2, three: 3, third: 3, thirdly: 3, four: 4, fourth: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10};
const TITLE_TAIL_STOP = new Set(['a', 'an', 'the', 'to', 'of', 'and', 'you', 'your', 'is', 'in', 'on', 'for', 'we', 'i', 'it', 'that', 'with', 'or', 'are']);

function numberDraft(s: Sentence): Draft | null {
  const quantities = quantitiesOf(s.text);
  if (quantities.length !== 1 || digitTokens(s.text) !== 1) return null;
  const q = quantities[0]!;
  if (!q.unit && q.suffix !== '%' && !q.prefix) return null;
  const after = clean(s.text.slice(q.end));
  const before = clean(s.text.slice(0, q.index));
  const sayWords = wordsIn(after).slice(0, 3);
  const say = sayWords.length > 0 ? sayWords.join(' ') : wordsIn(before).slice(-3).join(' ');
  const unit = q.unit;
  const used = [say, unit];
  const topic = topicWord(s.text, used);
  const onScreen = [unit, say, topic].filter(Boolean);
  const comma = q.value >= 10000;
  return {
    templateId: 'clip_27_riso_number',
    intent: 'big_number',
    sentence: s,
    priority: 1,
    onScreenText: onScreen,
    numbers: [{label: unit || 'value', value: q.value, ...(unit ? {unit} : {})}],
    payload: {kind: 'riso', template: 'number', palette: 'pal-blue', data: {topic, number: q.value, prefix: q.prefix, suffix: q.suffix, comma, unit, say}},
  };
}

function compareDraft(s: Sentence): Draft | null {
  const quantities = quantitiesOf(s.text).filter(q => q.unit && unitSeconds(q.unit) !== null);
  if (quantities.length !== 2 || digitTokens(s.text) !== 2) return null;
  const [a, b] = quantities as [Quantity, Quantity];
  const unitA = a.unit.toLowerCase().replace(/s$/, '');
  const unitB = b.unit.toLowerCase().replace(/s$/, '');
  const baseA = a.value * unitSeconds(a.unit)!;
  const baseB = b.value * unitSeconds(b.unit)!;
  if (baseA === baseB) return null;
  const cue = BEFORE_NOW.test(s.text) || unitA === unitB;
  if (!cue) return null;
  const prior = a;
  const later = b;
  const beforeLabel = /\bused to\b/i.test(s.text) ? 'used to' : /\bbefore\b/i.test(s.text) ? 'before' : /\bback then\b/i.test(s.text) ? 'back then' : '';
  const afterLabel = /\bnow\b/i.test(s.text) ? 'now' : /\btoday\b/i.test(s.text) ? 'today' : '';
  if (!beforeLabel || !afterLabel) return null;
  const preceding = wordsIn(clean(s.text.slice(0, prior.index)));
  const lastWord = (preceding[preceding.length - 1] ?? '').replace(/[^A-Za-z]/g, '');
  const title = lastWord && !STOP.has(lastWord.toLowerCase()) && !/^(to|it|used|before|take|takes)$/i.test(lastWord) ? lastWord : prior.unit;
  const topic = topicWord(s.text, [title, beforeLabel, afterLabel, prior.unit, later.unit]);
  const onScreen = [title, beforeLabel, afterLabel, prior.unit, later.unit, topic].filter(Boolean);
  return {
    templateId: 'clip_29_riso_compare',
    intent: 'before_after',
    sentence: s,
    priority: 1,
    onScreenText: [...new Set(onScreen)],
    numbers: [
      {label: beforeLabel, value: prior.value, unit: prior.unit},
      {label: afterLabel, value: later.value, unit: later.unit},
    ],
    payload: {
      kind: 'riso',
      template: 'compare',
      palette: 'pal-blue',
      data: {topic, title, before: {label: beforeLabel, value: prior.value, unit: prior.unit, base: baseA}, after: {label: afterLabel, value: later.value, unit: later.unit, base: baseB}},
    },
  };
}

function versusDraft(s: Sentence): Draft | null {
  if (quantitiesOf(s.text).length > 0 && digitTokens(s.text) > 1) return null;
  if (!MYTH_CUE.test(s.text) && !BEFORE_NOW.test(s.text)) return null;
  const split = SPLITTER.exec(s.text);
  if (!split || split.index === undefined) return null;
  const firstPart = s.text.slice(0, split.index);
  const secondPart = s.text.slice(split.index + split[0].length);
  const lead = /^(.*?\b(think|thinks|believe|believes|assume|assumes|say|says)\b)(?:\s+that)?\s+/i.exec(firstPart);
  const beforeText = clean(lead ? firstPart.slice(lead[0].length) : firstPart);
  const afterText = clean(secondPart);
  if (wordsIn(beforeText).length < 2 || wordsIn(afterText).length < 2 || wordsIn(beforeText).length > 10 || wordsIn(afterText).length > 10) return null;
  const beforeTag = lead ? lead[2]!.replace(/s$/i, '') : '';
  const afterTag = split[1]!;
  const onScreen = [beforeText, afterText, beforeTag, afterTag].filter(Boolean);
  const topic = topicWord(s.text, [beforeText, afterText]);
  if (topic) onScreen.push(topic);
  return {
    templateId: 'clip_28_riso_versus',
    intent: 'myth_fact',
    sentence: s,
    priority: 2,
    onScreenText: onScreen,
    payload: {kind: 'riso', template: 'versus', palette: 'pal-red', data: {topic, before: {tag: beforeTag, text: beforeText}, after: {tag: afterTag, text: afterText}}},
  };
}

function convergeDraft(s: Sentence): Draft | null {
  const m = FROM_TO.exec(s.text);
  let fromN: string;
  let fromCap: string;
  let toN: string;
  let toCap: string;
  if (m) {
    fromN = m[1]!;
    fromCap = clean(m[2] ?? '');
    toN = m[3]!;
    toCap = clean(m[4] ?? '');
  } else {
    const d = DOZENS_FEW.exec(s.text);
    if (!d) return null;
    fromN = d[1]!;
    fromCap = '';
    toN = d[2]!;
    toCap = '';
  }
  const num = (value: string): number | null => {
    const v = Number(value.replace(/[,+]/g, ''));
    return Number.isFinite(v) && /\d/.test(value) ? v : null;
  };
  const fromV = num(fromN);
  const toV = num(toN);
  if (fromV !== null && toV !== null && fromV <= toV) return null;
  const fromCount = fromV !== null ? Math.min(36, Math.max(6, fromV)) : 24;
  const toCount = toV !== null ? Math.min(6, Math.max(2, toV)) : 3;
  const onScreen = [fromN.replace(/\+$/, ''), toN, fromCap, toCap].filter(Boolean);
  const numbers: NonNullable<VisualSceneSpec['numbers']> = [];
  if (fromV !== null) numbers.push({label: fromCap || 'from', value: fromV});
  if (toV !== null) numbers.push({label: toCap || 'to', value: toV});
  const topic = topicWord(s.text, onScreen);
  if (topic) onScreen.push(topic);
  return {
    templateId: 'clip_30_riso_converge',
    intent: 'many_to_few',
    sentence: s,
    priority: 2,
    onScreenText: onScreen,
    ...(numbers.length > 0 ? {numbers} : {}),
    payload: {kind: 'riso', template: 'converge', palette: 'pal-blue', data: {topic, from: {n: fromN, cap: fromCap, count: fromCount}, to: {n: toN, cap: toCap, count: toCount}, names: []}},
  };
}

function chapterDraft(s: Sentence): Draft | null {
  const m = CHAPTER.exec(s.text);
  if (!m) return null;
  const kicker = clean(m[0]!);
  const key = (m[2] ?? m[3] ?? m[4] ?? '').toLowerCase();
  const ordinal = ORDINAL[key] ?? (Number(key) || 0);
  if (!ordinal) return null;
  const rest = s.text.slice(m[0]!.length);
  const head = rest.split(/[,.!?;:]/)[0] ?? '';
  const titleWords = wordsIn(head).slice(0, 4);
  while (titleWords.length > 0 && TITLE_TAIL_STOP.has(titleWords[titleWords.length - 1]!.toLowerCase())) titleWords.pop();
  const title = clean(titleWords.join(' '));
  if (!title) return null;
  const topic = topicWord(s.text, [title, kicker]);
  const onScreen = [kicker, title, topic].filter(Boolean);
  return {
    templateId: 'clip_32_riso_chapter',
    intent: 'chapter',
    sentence: s,
    priority: 3,
    onScreenText: onScreen,
    payload: {kind: 'riso', template: 'title', palette: 'pal-blue', data: {topic, flood: ordinal % 2 === 1, index: pad2(ordinal), kicker, title, sub: ''}},
  };
}

function quoteDraft(s: Sentence, all: readonly MotionTemplateWord[], durationSec: number, warnings: string[]): Draft | null {
  const count = wordsIn(s.text).length;
  if (count < 4 || count > 12 || /\d/.test(s.text)) return null;
  if (s.start < durationSec * 0.6 || !CONCLUSION.test(s.text)) return null;
  // WP52 callout discipline: a news / tweet / wiki line belongs to its callout, never to the riso quote.
  const shape = plateShapeAt(all, (s.start + s.end) / 2);
  if (shape && NEWS_COMPOSITIONS.has(shape.composition)) {
    warnings.push('visual_backend:quote:skipped:wp52_callout');
    return null;
  }
  const quoteText = clean(s.text);
  const parts = wordsIn(quoteText);
  const lines: string[] = [];
  for (let i = 0; i < parts.length; i += 3) lines.push(parts.slice(i, i + 3).join(' '));
  if (lines.length < 2) return null;
  const last = lines[lines.length - 1]!.split(' ');
  last[last.length - 1] = `[${last[last.length - 1]}]`;
  lines[lines.length - 1] = last.join(' ');
  return {
    templateId: 'clip_31_riso_quote',
    intent: 'speaker_conclusion',
    sentence: s,
    priority: 4,
    onScreenText: [quoteText],
    payload: {kind: 'riso', template: 'quote', palette: 'pal-red', data: {topic: '', lead: '', quote: lines.join('\n')}},
  };
}

function collageDraft(s: Sentence, ground: string): Draft | null {
  if (/\d/.test(s.text) || isListLikeText(s.text) || wordsIn(s.text).length < 5) return null;
  const m = METAPHOR.exec(s.text);
  if (!m) return null;
  const object = clean(m[1] ?? m[2] ?? '').toLowerCase();
  if (!object) return null;
  return {
    templateId: 'clip_33_collage_assemble',
    intent: 'visual_metaphor',
    sentence: s,
    priority: 5,
    onScreenText: [],
    payload: {kind: 'collage', metaphor: {meaning: clean(s.text), objects: [object], ground, assemble: 'from_empty', durationSec: COLLAGE_DURATION_SEC}},
  };
}

function doodleDraft(s: Sentence): Draft | null {
  if (/\d/.test(s.text) || !MECHANISM.test(s.text)) return null;
  return {
    templateId: 'clip_34_doodle_explain',
    intent: 'illustrated_explain',
    sentence: s,
    priority: 6,
    onScreenText: [],
    payload: {kind: 'doodle', style: DOODLE_DEFAULT_STYLE, mechanism: clean(s.text)},
  };
}

export function planVisualBackendBeats(input: {
  skill: MotionTemplateSkill;
  durationSec: number;
  words: readonly MotionTemplateWord[];
  flags: VisualBackendFlags;
  /** ANIDOODLE_ENGINE_ROOT set and present (the stage resolves it; the planner stays pure). WP54: informational only — the native DoodleDrawOn covers an unconfigured engine. */
  anidoodleConfigured?: boolean;
  blockedRanges?: ReadonlyArray<{start: number; end: number}>;
  accent?: string;
  ground?: string;
  ink?: string;
}): VisualBackendPlan {
  const warnings: string[] = [];
  const {flags} = input;
  if (!flags.riso && !flags.collage && !flags.anidoodle) return {beats: [], warnings: ['visual_backend:skipped:flag_off']};
  const durationSec = Math.max(0, input.durationSec);
  const allowed = new Set<string>(SKILL_MOTION_TEMPLATE_ALLOWLIST[input.skill] ?? []);
  const doodleOn = flags.anidoodle && !flags.collage; // never double-cover a collage beat
  // WP54: no engine root is no longer a skip — the native Remotion DoodleDrawOn (clip_34) draws the film. Engine root only changes the warning.
  if (flags.anidoodle && !input.anidoodleConfigured) warnings.push('visual_backend:anidoodle:engine_unconfigured');
  const sentences = sentencesOfWords(input.words);
  const palette = mapPaletteToRiso(input.accent, input.ground);

  const drafts: Draft[] = [];
  for (const s of sentences) {
    if (flags.riso) {
      const rows = [compareDraft(s) ?? numberDraft(s), convergeDraft(s), versusDraft(s), chapterDraft(s), quoteDraft(s, input.words, durationSec, warnings)];
      // one move per sentence: the first matching row in priority order wins
      const hit = rows.filter((row): row is Draft => row !== null).sort((a, b) => a.priority - b.priority)[0];
      if (hit) drafts.push(hit);
    }
    if (drafts[drafts.length - 1]?.sentence === s) continue;
    if (flags.collage) {
      const draft = collageDraft(s, input.ground ?? '#FFFFFF');
      if (draft) drafts.push(draft);
    } else if (doodleOn) {
      const draft = doodleDraft(s);
      if (draft) drafts.push(draft);
    }
  }
  drafts.sort((a, b) => a.priority - b.priority || a.sentence.start - b.sentence.start);

  const beats: VisualBackendBeat[] = [];
  const blocked = input.blockedRanges ?? [];
  const counts: Record<string, number> = {riso: 0, collage_gbro: 0, anidoodle: 0};
  const caps: Record<string, number> = {riso: RISO_MAX_BEATS, collage_gbro: COLLAGE_MAX_BEATS, anidoodle: DOODLE_MAX_BEATS};
  for (const draft of drafts) {
    const spec = motionTemplate(draft.templateId);
    if (!spec?.backend || !spec.toolkit || !allowed.has(spec.id)) continue;
    if (counts[spec.backend]! >= caps[spec.backend]!) continue;
    if (beats.some(b => b.templateId === spec.id)) continue;
    const start = Math.max(0, draft.sentence.start - MOTION_TEMPLATE_SYNC_LEAD_SEC);
    const window = draft.sentence.end - start;
    const dur = spec.backend === 'collage_gbro' ? COLLAGE_DURATION_SEC : Math.min(SPOKEN_MAX_SEC, Math.max(SPOKEN_MIN_SEC, window));
    const end = Math.min(durationSec, start + dur);
    if (end - start < (spec.backend === 'collage_gbro' ? COLLAGE_DURATION_SEC : SPOKEN_MIN_SEC) - 1e-6) continue;
    if (blocked.some(r => r.start < end && r.end > start)) continue;
    if (beats.some(b => b.start < end && b.end > start)) continue;
    const scene: VisualSceneSpec = {
      templateId: spec.id,
      toolkit: spec.toolkit as VisualSceneSpec['toolkit'], // backend rows only carry the five WP53 toolkits (zoom / lockup belong to WP54 native rows)
      backend: spec.backend,
      start,
      end,
      sentence: draft.sentence.text,
      onScreenText: draft.onScreenText,
      ...(draft.numbers ? {numbers: draft.numbers} : {}),
      ...(input.accent ? {accent: input.accent} : {}),
      ...(input.ground ? {ground: input.ground} : {}),
      ...(input.ink ? {ink: input.ink} : {}),
      aspect: '9:16',
      width: spec.backend === 'collage_gbro' ? 720 : 1080,
      height: spec.backend === 'collage_gbro' ? 1280 : 1920,
    };
    const check = validateSceneSpec(scene);
    if (!check.ok) {
      warnings.push(check.warning);
      continue;
    }
    counts[spec.backend]! += 1;
    beats.push({
      id: `vb_${beats.length + 1}_${spec.id}`,
      start,
      end,
      templateId: spec.id,
      backend: spec.backend,
      intent: draft.intent,
      muteCaptions: spec.ownsFrame,
      scene,
      payload: draft.payload,
    });
  }
  beats.sort((a, b) => a.start - b.start);

  // finish riso DATA now that the final order is known: edit palette + mast + the spoken-window duration
  const risoBeats = beats.filter(b => b.payload.kind === 'riso');
  for (const beat of risoBeats) {
    const payload = beat.payload as RisoPayload;
    const index = risoBeats.indexOf(beat) + 1;
    const topic = typeof payload.data.topic === 'string' ? payload.data.topic : '';
    const {topic: _topic, ...rest} = payload.data;
    beat.payload = {
      ...payload,
      palette,
      data: {palette, mast: [topic ? `${pad2(index)} · ${topic}` : pad2(index), `${pad2(index)} / ${pad2(risoBeats.length)}`], ...rest, duration: Number((beat.end - beat.start).toFixed(2))},
    };
  }
  warnings.push(`visual_backend:beats:${beats.length}`);
  return {beats, warnings};
}

/** WP52 craft: a number the riso beat already shows is never ALSO a semantic-emphasis count / pop on the same window. */
export function dropEmphasisCoveredByVisualBackend<E extends {start: number; end: number; text: string}>(
  emphasis: readonly E[],
  beats: ReadonlyArray<Pick<VisualBackendBeat, 'start' | 'end' | 'scene'>>,
): {kept: E[]; warnings: string[]} {
  const warnings: string[] = [];
  const kept = emphasis.filter(item => {
    const itemNumbers = (item.text.replace(/(\d),(?=\d{3}\b)/g, '$1').match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
    if (itemNumbers.length === 0) return true;
    const clash = beats.find(b => b.start < item.end && b.end > item.start && (b.scene.numbers ?? []).some(n => itemNumbers.includes(n.value)));
    if (!clash) return true;
    warnings.push(`visual_backend:emphasis_dropped:${itemNumbers[0]}`);
    return false;
  });
  return {kept, warnings};
}
