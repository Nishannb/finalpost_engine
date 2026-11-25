/**
 * P6 Edit Direction: how THIS video should feel, decided once for the whole edit. Tone (hype / educational / business / story / calm) from the words, an energy level, the toolkit of
 * compositions the video leans on (4..7, seeded so two videos of the same tone still differ), the motion palette and how often the plate is treated.
 *
 * The deterministic direction always exists. The Director (one LLM call, the existing DirectorCall plumbing) may replace tone / toolkit and tag beats; its output is validated with
 * zod and clamped: it can only choose among known names, and the variety controller still enforces every variety and safety rule. Any failure = the deterministic direction.
 */
import {z} from 'zod';

import {normToken} from '../transcript.ts';
import type {KineticWord} from '../schema.ts';
import type {DirectorCall} from '../director.ts';
import {hashString, rng} from './kit.ts';
import {PALETTES} from './voice.ts';
import {BEAT_TYPES, COMPOSITIONS, type Beat, type CompositionName, type EditDirection, type ExitVerb, type Tone, type Verb} from './types.ts';

const LEXICON: Record<Tone, RegExp> = {
  hype: /^(viral|crazy|insane|money|cash|k|million|millions|views|grow|growth|secret|hack|hacks|explode|fast|fastest|huge|massive|traffic|followers|effects|edit|editor|win|winning)$/,
  educational: /^(step|steps|first|second|third|how|learn|tip|tips|because|reason|reasons|example|means|exercise|method|strategy|lesson|understand|mistake|mistakes|guide|number)$/,
  business: /^(business|clients|client|sales|revenue|market|brand|course|creators|audience|group|paid|free|offer|product|profit|account|trade|trades|traders|broker|capital|plan)$/,
  story: /^(i|me|my|remember|when|was|then|years|ago|started|journey|life|felt|story|dream|trips)$/,
  calm: /^(feel|feeling|love|relationship|relationships|silence|quiet|moment|moments|presence|heart|connection|breathe|peace|gentle|bonds|emotional|deepen)$/,
};

/** base weights per tone (1 = neutral). The controller multiplies them with beat affinity. */
const TONE_WEIGHTS: Record<Tone, Partial<Record<CompositionName, number>>> = {
  hype: {giantWord: 1.3, wordSwap: 1.3, takeover: 1.2, heroStack: 1.0, counterStat: 1.2, contrastSplit: 1.1, sideStack: 1.0, markerHighlight: 0.9, calloutBar: 0.8, lineWipe: 0.7, ctaCard: 1.1, listItem: 1.0, questionCard: 0.9, topHeadline: 0.9},
  educational: {listItem: 1.3, markerHighlight: 1.2, calloutBar: 1.2, lineWipe: 1.1, heroStack: 1.0, counterStat: 1.2, contrastSplit: 1.1, questionCard: 1.1, sideStack: 1.0, giantWord: 0.9, wordSwap: 0.8, takeover: 0.8, ctaCard: 1.0, topHeadline: 1.0},
  business: {calloutBar: 1.2, counterStat: 1.3, contrastSplit: 1.2, markerHighlight: 1.1, heroStack: 1.0, sideStack: 1.1, listItem: 1.2, giantWord: 1.0, lineWipe: 1.0, wordSwap: 0.9, takeover: 1.0, ctaCard: 1.1, questionCard: 1.0, topHeadline: 1.0},
  story: {lineWipe: 1.3, heroStack: 1.1, sideStack: 1.0, giantWord: 0.9, markerHighlight: 1.0, questionCard: 1.1, contrastSplit: 1.0, calloutBar: 0.8, wordSwap: 0.8, takeover: 0.9, counterStat: 1.0, listItem: 1.0, ctaCard: 1.0, topHeadline: 1.0},
  calm: {lineWipe: 1.4, heroStack: 1.0, questionCard: 1.2, sideStack: 1.0, markerHighlight: 0.9, giantWord: 0.8, contrastSplit: 1.0, calloutBar: 0.7, wordSwap: 0.6, takeover: 0.7, counterStat: 1.0, listItem: 1.0, ctaCard: 0.9, topHeadline: 1.1},
};
const TONE_VERBS: Record<Tone, Verb[]> = {
  hype: ['slam', 'zoomThrough', 'whip', 'glitch', 'pop', 'drop', 'slide'],
  educational: ['pop', 'slide', 'rise', 'whip', 'drop', 'flip'],
  business: ['slide', 'whip', 'pop', 'slam', 'drop', 'flip'],
  story: ['blurIn', 'slide', 'rise', 'flip', 'spin', 'drop'],
  calm: ['blurIn', 'rise', 'slide', 'spin', 'track'],
};
const TONE_EXITS: Record<Tone, ExitVerb[]> = {
  hype: ['whipOut', 'scaleOut', 'slideOut', 'lift', 'cut'],
  educational: ['slideOut', 'fade', 'sink', 'lift', 'whipOut'],
  business: ['slideOut', 'whipOut', 'fade', 'lift', 'sink'],
  story: ['blurOut', 'slideOut', 'fade', 'sink'],
  calm: ['blurOut', 'fade', 'slideOut', 'sink'],
};
const TONE_ENERGY: Record<Tone, number> = {hype: 0.88, business: 0.72, educational: 0.66, story: 0.52, calm: 0.38};
const TONE_SHARE: Record<Tone, number> = {hype: 0.78, business: 0.72, educational: 0.72, story: 0.64, calm: 0.58};
const TONE_PLATE: Record<Tone, number> = {hype: 0.5, business: 0.38, educational: 0.32, story: 0.3, calm: 0.22};

export function toneOf(words: readonly KineticWord[]): {tone: Tone; scores: Record<Tone, number>} {
  const scores: Record<Tone, number> = {hype: 0, educational: 0, business: 0, story: 0, calm: 0};
  for (const w of words) {
    const n = normToken(w.text);
    for (const t of Object.keys(LEXICON) as Tone[]) if (LEXICON[t].test(n)) scores[t] += t === 'story' ? 0.35 : 1;
    if (/^\d|k$/.test(n) && /\d/.test(n)) scores.hype += 0.6;
  }
  const tone = (Object.keys(scores) as Tone[]).sort((a, b) => scores[b] - scores[a])[0]!;
  return {tone: scores[tone] > 0 ? tone : 'educational', scores};
}

function shuffle<T>(xs: T[], r: () => number): T[] { const a = [...xs]; for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; } return a; }

/** The deterministic direction: tone from the words, a seeded toolkit (the tone's strongest compositions, reshuffled per video), the tone's motion palette. */
export function deterministicDirection(words: readonly KineticWord[], beats: readonly Beat[], salt = ''): EditDirection {
  const {tone} = toneOf(words);
  const seed = hashString(words.map(w => w.text).join(' ') + salt);
  const r = rng(seed);
  const base = TONE_WEIGHTS[tone];
  // jitter every weight +-25% per video: the same tone never yields the same mix twice
  const weights: Partial<Record<CompositionName, number>> = {};
  for (const c of COMPOSITIONS) weights[c] = Math.round((base[c] ?? 1) * (0.75 + 0.5 * r()) * 100) / 100;
  // content-driven compositions are always in the toolkit when the content exists
  const forced: CompositionName[] = [];
  if (beats.some(b => b.type === 'stat')) forced.push('counterStat');
  if (beats.some(b => b.type === 'list')) forced.push('listItem');
  if (beats.some(b => b.type === 'contrast')) forced.push('contrastSplit');
  if (beats.some(b => b.type === 'question')) forced.push('questionCard');
  if (beats.some(b => b.type === 'cta')) forced.push('ctaCard');
  const general = (COMPOSITIONS as readonly CompositionName[]).filter(c => !forced.includes(c) && !['counterStat', 'listItem', 'contrastSplit', 'questionCard', 'ctaCard'].includes(c));
  const ranked = general.sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0));
  const generalPick = shuffle(ranked.slice(0, 7), r).slice(0, 5);
  const toolkit = [...forced, ...generalPick];
  for (const c of toolkit) weights[c] = Math.round(((weights[c] ?? 1) + 0.35) * 100) / 100;
  const verbs = shuffle(TONE_VERBS[tone], r);
  const aligns = ['left', 'center', 'right', 'mixed'] as const;
  const look = {alignBias: aligns[Math.floor(r() * aligns.length)]!, radius: [0, 8, 18, 30][Math.floor(r() * 4)]!, accentMode: (['accent', 'accent2', 'alternate'] as const)[Math.floor(r() * 3)]!, tiltBias: tone === 'calm' ? 0 : [0, 6, -6][Math.floor(r() * 3)]!};
  return {source: 'deterministic', tone, energy: TONE_ENERGY[tone], toolkit, weights, verbs, exits: shuffle(TONE_EXITS[tone], r), designedShare: TONE_SHARE[tone], plateRate: TONE_PLATE[tone], seed, look};
}

// ------------------------------------------------------------------------------------------------ Director (optional LLM)

export const COMPOSER_DIRECTOR_SYSTEM = `You are the art director of a kinetic-typography edit for a vertical talking-head video. You do NOT place anything; a deterministic engine does.
You decide how this video should FEEL and which typographic compositions suit its moments. Return ONLY JSON:
{"tone":"hype"|"educational"|"business"|"story"|"calm","energy":0..1,"toolkit":[4-7 composition names],"beats":[{"id":"b3","type":"<beat type>","composition":"<composition name>"}]}
Compositions: giantWord (one word fills the width), wordSwap (rapid words replace each other in one spot), lineWipe (editorial sentence reveal with a larger key word), sideStack (vertical stack on one side),
topHeadline (headline above the head), contrastSplit (the old word dims away as the new word lands), counterStat (a spoken number counts up), listItem (spoken list marker in a chip + the item),
questionCard (question in a card), calloutBar (lower-third accent bars), markerHighlight (highlighter swipe behind the key word), ctaCard (call to action), takeover (full-frame type card for the hook or the peak, rare), heroStack (lead-in small, key word big).
Beat types: ${BEAT_TYPES.join(', ')}. Tag only beats whose meaning you are sure of (a number that matters, a real contrast, a list item, a question, the call to action, the hook, the peak). Do not tag every beat.
Variety matters: a strong edit uses 6+ different compositions, never the same one twice in a row, with quiet beats between loud ones.`;

/** sent only when the composer has a usable person matte for this edit */
export const BEHIND_BRIEF = `TEXT BEHIND THE SPEAKER: this edit can set ONE big key word BEHIND the speaker (their head and shoulders pass in front of it). Add "behind":["<beat id>", ...] with the 1-3 beats
where that would look best: a short punchy beat whose key word is the emotional or topical peak (a name, a result, a big claim), spaced through the video, not the quiet connective lines.
Leave it out when no beat deserves it. The engine still checks the framing and skips it when there is no room above the head.`;

/** sent when the edit may carry a text match cut (V1 Match Cut) */
export const MATCH_CUT_BRIEF = `TEXT MATCH CUT (rare, intentional): a ~1.3 s full-frame montage that keeps ONE spoken keyword locked while the layout and typeface change on every cut. It is used at most ONCE in a
short video and ONLY at one of these moments: "openingHook" (2.5-10 s in, the video's recurring TOPIC is being introduced), "chapterTransition" (after a finished thought and a pause, a new
section starts with a genuinely new topic), "evidenceMontage" (one sentence of 8+ words carries both scale/consensus and impact, e.g. millions of people talking about it),
"beforeReveal" (a setup line like "here's the secret" / "the real reason is" with the reveal still to come in the NEXT sentence). Add
"matchCut":{"beat":"<beat id>","keyword":"<one spoken word, 4-12 letters, a content word>","moment":"<one of the four>","why":"<one short sentence>"} ONLY when one of these moments
genuinely happens; otherwise "matchCut":null. A keyword that is merely important, a statistic, or a strong word is NOT enough. When in doubt, null.`;

/** the colour brief, sent only when the composer's colours are the Director's to choose (POLISH_KINETIC_AI_PALETTE) */
export const COLOUR_BRIEF = `COLOUR: also add "palette":"<name>" to the JSON: the text colours that best suit THIS video (its subject, its mood, and the footage colour above; pick an accent that stands out
against the footage, not one that blends into it), or "preset" to keep the creator's preset colours when they already suit it. Palettes: ${Object.entries(PALETTES).map(([k, p]) => `${k} (accent ${p.accent}, ${p.mood})`).join('; ')}.`;

const directorSchema = z.object({
  tone: z.enum(['hype', 'educational', 'business', 'story', 'calm']),
  energy: z.number().min(0).max(1).optional(),
  toolkit: z.array(z.string()).max(10).optional(),
  beats: z.array(z.object({id: z.string(), type: z.string().optional(), composition: z.string().optional()})).max(80).optional(),
  palette: z.string().max(40).optional(),
  behind: z.array(z.string()).max(6).optional(),
  matchCut: z.object({beat: z.string(), keyword: z.string().max(40), moment: z.enum(['openingHook', 'chapterTransition', 'evidenceMontage', 'beforeReveal']), why: z.string().max(240).optional()}).nullable().optional(),
});

/** which optional briefs the Director gets for this edit */
export type DirectorOffers = {behind?: boolean; matchCut?: boolean};

/** what the Director knows about the footage and the preset when it picks colours */
export type ColourContext = {footageColor?: string; footageLuminance?: number; presetText?: string; presetAccent?: string};

export function buildComposerDirectorPrompt(words: readonly KineticWord[], beats: readonly Beat[], colour?: ColourContext, offers: DirectorOffers = {}): string {
  const look = colour
    ? `FOOTAGE: average colour ${colour.footageColor ?? 'unknown'}, brightness ${colour.footageLuminance !== undefined ? colour.footageLuminance.toFixed(2) : 'unknown'} (0 dark .. 1 bright). PRESET COLOURS: text ${colour.presetText ?? '#FFFFFF'}, accent ${colour.presetAccent ?? '#FFD400'}.\n${COLOUR_BRIEF}\n\n`
    : '';
  const extra = `${offers.behind ? `${BEHIND_BRIEF}\n\n` : ''}${offers.matchCut ? `${MATCH_CUT_BRIEF}\n\n` : ''}`;
  return `${look}${extra}BEATS (id | detected type | words):\n${beats.map(b => `${b.id} | ${b.type} | ${words.slice(b.wordRange[0], b.wordRange[1] + 1).map(w => w.text).join(' ')}`).join('\n')}\n\nReturn the JSON.`;
}

/** merge a raw Director reply into the deterministic direction; anything unknown is ignored */
export function mergeDirector(raw: unknown, base: EditDirection, beats: readonly Beat[], words: readonly KineticWord[] = [], offers: DirectorOffers = {}): EditDirection {
  const parsed = directorSchema.safeParse(raw);
  if (!parsed.success) return {...base, reason: `director_invalid:${parsed.error.issues[0]?.message ?? 'schema'}`};
  const d = parsed.data;
  const known = new Set<string>(COMPOSITIONS);
  const toolkit = (d.toolkit ?? []).filter(c => known.has(c)) as CompositionName[];
  const tone = d.tone;
  const weights = {...base.weights};
  for (const c of toolkit) weights[c] = Math.round(((weights[c] ?? 1) + 0.4) * 100) / 100;
  const ids = new Set(beats.map(b => b.id));
  const beatTags: NonNullable<EditDirection['beatTags']> = {};
  for (const b of d.beats ?? []) {
    if (!ids.has(b.id)) continue;
    const type = b.type && (BEAT_TYPES as readonly string[]).includes(b.type) ? (b.type as Beat['type']) : undefined;
    const composition = b.composition && known.has(b.composition) ? (b.composition as CompositionName) : undefined;
    if (type || composition) beatTags[b.id] = {...(type ? {type} : {}), ...(composition ? {composition} : {})};
  }
  return {
    ...base, source: 'director', tone, energy: d.energy ?? TONE_ENERGY[tone], toolkit: toolkit.length >= 3 ? [...new Set([...toolkit, ...base.toolkit])].slice(0, 8) : base.toolkit, weights,
    verbs: tone === base.tone ? base.verbs : TONE_VERBS[tone], exits: tone === base.tone ? base.exits : TONE_EXITS[tone], designedShare: TONE_SHARE[tone], plateRate: TONE_PLATE[tone], beatTags,
    ...(d.palette && PALETTES[d.palette.trim().toLowerCase()] ? {palette: d.palette.trim().toLowerCase()} : {}),
    ...(offers.behind && d.behind?.length ? {behindBeats: [...new Set(d.behind.filter(id => ids.has(id)))].slice(0, 3)} : {}),
    ...(offers.matchCut && d.matchCut && ids.has(d.matchCut.beat) && beatHasWord(beats.find(b => b.id === d.matchCut!.beat)!, words, d.matchCut.keyword)
      ? {matchCut: {beatId: d.matchCut.beat, keyword: d.matchCut.keyword, moment: d.matchCut.moment, why: (d.matchCut.why ?? '').slice(0, 160)}} : {}),
  };
}

/** the Director's keyword must be a word actually spoken in that beat (nothing invented) */
function beatHasWord(b: Beat, words: readonly KineticWord[], keyword: string): boolean {
  if (words.length === 0) return true;
  const k = normToken(keyword);
  for (let i = b.wordRange[0]; i <= b.wordRange[1]; i += 1) if (normToken(words[i]!.text) === k) return true;
  return false;
}

export async function resolveDirection(words: readonly KineticWord[], beats: readonly Beat[], call: DirectorCall | null | undefined, salt = '', colour?: ColourContext, offers: DirectorOffers = {}): Promise<EditDirection> {
  const base = deterministicDirection(words, beats, salt);
  if (!call) return base;
  try {
    const text = await call({system: COMPOSER_DIRECTOR_SYSTEM, user: buildComposerDirectorPrompt(words, beats, colour, offers)});
    const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/u, '');
    return mergeDirector(JSON.parse(t), base, beats, words, offers);
  } catch (err) {
    return {...base, reason: `director_failed:${err instanceof Error ? err.message.slice(0, 80) : String(err)}`};
  }
}
