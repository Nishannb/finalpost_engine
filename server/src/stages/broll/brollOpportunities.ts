/**
 * B-ROLL OPPORTUNITY DETECTION (2026-11-26). Think like a short-form editor, not a keyword matcher.
 *
 * One model call reads the WHOLE cleaned transcript and proposes the moments where a visual would help the viewer understand, recognise,
 * imagine or remember what is said (people, brands, products, places, events, processes, comparisons, screens, ...), with the visual
 * treatment that fits the sentence. The model only points at WORD INDICES; every timestamp comes from the real transcript words.
 * Deterministic rules then decide what survives (confidence, talking-head moments, spacing, repeats, count and screen-time caps), so
 * "no strong opportunity" is a valid, confident answer.
 *
 * Layers (kept separate on purpose):
 *   detection   detectBrollOpportunities()      -> BrollOpportunity[] (this file; the only part that calls a model)
 *   asks        brollOpportunitiesToSlots()     -> LabeledAssetSlot[] for the creator's upload tags (uploadable treatments only)
 *   retrieval / rendering stay where they are (the asset gate, labeledAssetPlacement.ts, the Kinetic engine).
 *
 * Pure except detectBrollOpportunities(), which takes an injected `call` (stages/kinetic/director.ts DirectorCall).
 */
import {z} from 'zod';

import type {DirectorCall} from '../kinetic/director.ts';
import {askKey, type LabeledAssetKind, type LabeledAssetSlot} from './labeledAssetBrief.ts';

export type BrollWord = {text: string; start: number; end: number};

export const BROLL_CATEGORIES = [
  'people', 'organization', 'product_object', 'place', 'event', 'process_action', 'abstract_concept', 'comparison',
  'problem_outcome', 'screen_document', 'quote_claim', 'nature', 'science_tech', 'time_transformation',
] as const;
export type BrollCategory = (typeof BROLL_CATEGORIES)[number];

export const BROLL_VISUAL_TYPES = [
  'ENTITY_IMAGE', 'CONTEXTUAL_FOOTAGE', 'PRODUCT_VISUAL', 'SCREEN_VISUAL', 'INFOGRAPHIC', 'KINETIC_TYPOGRAPHY', 'CONCEPTUAL_VISUAL',
] as const;
export type BrollVisualType = (typeof BROLL_VISUAL_TYPES)[number];

/** Treatments the creator can supply as an upload. The rest are engine-owned (Kinetic type already covers KINETIC_TYPOGRAPHY). */
export const UPLOADABLE_VISUALS: ReadonlySet<BrollVisualType> = new Set(['ENTITY_IMAGE', 'CONTEXTUAL_FOOTAGE', 'PRODUCT_VISUAL', 'SCREEN_VISUAL']);

/** The structured opportunity (field names follow the product brief). Timestamps are output-timeline seconds taken from real words. */
export type BrollOpportunity = {
  id: string;
  timestamp_start: number;
  timestamp_end: number;
  category: BrollCategory;
  detected_entity: string;
  visual_type: BrollVisualType;
  /** further treatments that may accompany the primary one (a sentence may need more than one) */
  secondary_visual_types: BrollVisualType[];
  visual_description: string;
  /** what the creator is asked to upload, a short noun phrase ("Steve Jobs at the 2007 iPhone launch") */
  upload_label: string;
  asset_search_query: string;
  priority: 'high' | 'medium' | 'low';
  visual_confidence: number;
  reason_for_insertion: string;
  recommended_duration: number;
  screen_occupancy: 'full' | 'partial' | 'split';
  speaker_visibility: 'hidden' | 'pip' | 'visible';
  continuity_group: string | null;
  asset_source_preference: 'creator_upload' | 'official' | 'archival' | 'stock' | 'generated';
  factuality_requirement: 'exact' | 'representative' | 'illustrative';
  avoid_visual: string;
  /** the words the window covers (for the app's hint) */
  spoken: string;
};

export const BROLL_DETECTOR_LABEL = 'Gemini broll opportunities';

export const BROLL_OPPORTUNITY_SYSTEM = `You are a senior short-form video editor planning B-roll for a vertical talking-head video. The talking head is the primary visual; B-roll SUPPORTS it.
Read the whole transcript first and understand the story. Propose a visual only where it helps the viewer understand, recognise, imagine or remember what is said. Never insert a visual just because a noun or keyword appears.

CATEGORIES (pick one): people, organization, product_object, place, event, process_action, abstract_concept, comparison, problem_outcome, screen_document, quote_claim, nature, science_tech, time_transformation.
VISUAL TYPES (primary + optional secondary): ENTITY_IMAGE (the actual person / company / product / place / object), CONTEXTUAL_FOOTAGE (real-world or archival footage of the action or event), PRODUCT_VISUAL (product shots, close-ups, demos), SCREEN_VISUAL (the real website / app / document / dashboard), INFOGRAPHIC (diagram, process, comparison chart), KINETIC_TYPOGRAPHY (the phrase itself animated), CONCEPTUAL_VISUAL (metaphor, illustration, 3D scene).

RULES
1. Specific over generic: Steve Jobs -> Steve Jobs (ideally at the 2007 launch), not "tech footage". Logo only when the logo communicates more than the product or event.
2. Information value: the visual must add something; never repeat what the viewer already sees or understands.
3. Narrative importance first: revelations, key examples, major events, important people, transitions, complex explanations, important comparisons.
4. Abstract ideas: prefer INFOGRAPHIC / CONCEPTUAL_VISUAL / KINETIC_TYPOGRAPHY over unrelated stock footage.
5. Rhythm: do not interrupt every sentence; let important moments breathe. Keep related visuals of ONE explanation together in one continuity_group (a transformation = an ordered sequence of shots).
6. Keep the speaker on screen (set talking_head_moment=true and it will be skipped) for emotional statements, personal stories, punchlines, strong opinions, direct-to-camera asks, and moments where the face carries meaning.
7. Scientific and historical accuracy: never a misleading but pretty visual. factuality_requirement "exact" when only the real thing is acceptable.
8. ONE ask per picture: never return two opportunities that need the same upload (the YouTube logo once, not as a logo, a product and a clip). If a later moment needs a DIFFERENT picture of the same subject, its upload_label must say exactly how it differs ("YouTube Studio analytics screen", not "YouTube logo").
9. If there is no strong visual opportunity, return an empty list. Fewer, better moments beat many.

TIMING: point at the transcript by WORD INDEX. start_word = the word that introduces the subject (the strongest relevant phrase), end_word = where the visual has done its job. Never start before the statement. Typical durations: person / brand 1-2.5 s, product 1.5-3 s, contextual footage or an event 2-4 s, a complex explanation 3-5 s.

Return ONLY JSON: {"opportunities":[{"start_word":int,"end_word":int,"category":string,"detected_entity":string,"visual_type":string,"secondary_visual_types":[string],"visual_description":string,"upload_label":string (<= 7 words, what the creator should upload),"asset_search_query":string,"priority":"high"|"medium"|"low","visual_confidence":0..1,"reason_for_insertion":string,"recommended_duration":seconds,"screen_occupancy":"full"|"partial"|"split","speaker_visibility":"hidden"|"pip"|"visible","continuity_group":string|null,"asset_source_preference":"creator_upload"|"official"|"archival"|"stock"|"generated","factuality_requirement":"exact"|"representative"|"illustrative","avoid_visual":string,"talking_head_moment":boolean}]}`;

/** The user prompt: sentences of indexed words with their real start times. */
export function buildBrollOpportunityPrompt(words: readonly BrollWord[], durationSec: number): string {
  const lines: string[] = [];
  let line: string[] = [];
  let lineStart = 0;
  words.forEach((w, i) => {
    if (line.length === 0) lineStart = w.start;
    line.push(`${i}:${w.text}`);
    if (/[.!?]["')\]]?$/.test(w.text) || i === words.length - 1) {
      lines.push(`[${lineStart.toFixed(1)}s] ${line.join(' ')}`);
      line = [];
    }
  });
  return `Video length: ${durationSec.toFixed(1)} s (vertical talking head). Transcript, one sentence per line, as index:word with the sentence start time:\n${lines.join('\n')}`;
}

const VisualType = z.enum(BROLL_VISUAL_TYPES);
const rawSchema = z.object({
  opportunities: z.array(z.object({
    start_word: z.number().int(),
    end_word: z.number().int(),
    category: z.string(),
    detected_entity: z.string().default(''),
    visual_type: z.string(),
    secondary_visual_types: z.array(z.string()).optional().default([]),
    visual_description: z.string().default(''),
    upload_label: z.string().optional().default(''),
    asset_search_query: z.string().optional().default(''),
    priority: z.string().optional().default('medium'),
    visual_confidence: z.number().optional().default(0),
    reason_for_insertion: z.string().optional().default(''),
    recommended_duration: z.number().optional().default(0),
    screen_occupancy: z.string().optional().default('full'),
    speaker_visibility: z.string().optional().default('hidden'),
    continuity_group: z.string().nullable().optional().default(null),
    asset_source_preference: z.string().optional().default('creator_upload'),
    factuality_requirement: z.string().optional().default('representative'),
    avoid_visual: z.string().optional().default(''),
    talking_head_moment: z.boolean().optional().default(false),
  }).passthrough()).default([]),
}).passthrough();

const pick = <T extends string>(value: string, allowed: readonly T[], fallback: T): T => ((allowed as readonly string[]).includes(value) ? (value as T) : fallback);

/** Seconds a treatment may hold the screen: [min, max] from the brief's suggested ranges. */
export function durationRange(category: BrollCategory, visual: BrollVisualType): [number, number] {
  if (visual === 'INFOGRAPHIC' || visual === 'CONCEPTUAL_VISUAL') return [2.5, 5];
  if (category === 'people' || category === 'organization') return [1, 2.5];
  if (visual === 'PRODUCT_VISUAL' || category === 'product_object') return [1.5, 3];
  if (category === 'event' || visual === 'CONTEXTUAL_FOOTAGE') return [2, 4];
  return [1.5, 4];
}

export type SelectOptions = {
  /** hard cap on kept opportunities (default: 1 per ~7 s, at most 6) */
  maxCount?: number;
  /** minimum confidence kept (default 0.55) */
  minConfidence?: number;
  /** seconds of plain talking head between two different moments (default 2.5; shots of one continuity group may sit back to back) */
  minGapSec?: number;
  /** share of the video B-roll may cover (default 0.35) */
  maxCoverage?: number;
  /** keep the opening face on screen for this long (default 1.0 s) */
  headSec?: number;
};

const RANK = {high: 3, medium: 2, low: 1} as const;

/**
 * Validate and select. Timestamps come only from `words`; anything out of range, low-confidence, flagged as a talking-head moment, too close to
 * another moment, a repeat of the same entity, or beyond the count / screen-time caps is dropped. Returns kept opportunities in time order and the
 * reasons for every drop (diagnostics).
 */
export function selectBrollOpportunities(raw: unknown, words: readonly BrollWord[], durationSec: number, opts: SelectOptions = {}): {kept: BrollOpportunity[]; dropped: string[]} {
  const dropped: string[] = [];
  const parsed = rawSchema.safeParse(raw);
  if (!parsed.success || words.length === 0 || !(durationSec > 0)) return {kept: [], dropped: parsed.success ? [] : ['schema']};
  const minConfidence = opts.minConfidence ?? 0.55;
  const headSec = opts.headSec ?? 1;
  const minGap = opts.minGapSec ?? 2.5;
  const maxCount = opts.maxCount ?? Math.min(6, Math.max(1, Math.round(durationSec / 7)));
  const maxCover = (opts.maxCoverage ?? 0.35) * durationSec;
  const end = durationSec - 0.3;

  const candidates: BrollOpportunity[] = [];
  parsed.data.opportunities.forEach((o, k) => {
    const tag = `${k}:${(o.detected_entity || o.visual_description).slice(0, 30)}`;
    const a = Math.min(o.start_word, o.end_word);
    const b = Math.max(o.start_word, o.end_word);
    if (a < 0 || b >= words.length) return void dropped.push(`${tag}:word_range`);
    if (o.talking_head_moment) return void dropped.push(`${tag}:talking_head_moment`);
    const confidence = Math.max(0, Math.min(1, o.visual_confidence));
    if (confidence < minConfidence) return void dropped.push(`${tag}:confidence_${confidence.toFixed(2)}`);
    const parsedVisual = VisualType.safeParse(o.visual_type);
    if (!parsedVisual.success) return void dropped.push(`${tag}:visual_type`);
    const visual = parsedVisual.data;
    const category = pick(o.category, BROLL_CATEGORIES, 'process_action');
    const [minD, maxD] = durationRange(category, visual);
    const start = words[a]!.start;
    if (start < headSec) return void dropped.push(`${tag}:opening_face`);
    const spokenEnd = words[b]!.end;
    const wanted = o.recommended_duration > 0 ? o.recommended_duration : spokenEnd - start;
    const finish = Math.min(end, start + Math.max(minD, Math.min(maxD, wanted)));
    if (finish - start < Math.min(minD, 1)) return void dropped.push(`${tag}:no_room`);
    candidates.push({
      id: `opp_${k + 1}`,
      timestamp_start: round(start),
      timestamp_end: round(finish),
      category,
      detected_entity: o.detected_entity.trim().slice(0, 80),
      visual_type: visual,
      secondary_visual_types: o.secondary_visual_types.map(v => VisualType.safeParse(v)).flatMap(r => (r.success && r.data !== visual ? [r.data] : [])),
      visual_description: o.visual_description.trim().slice(0, 240),
      upload_label: (o.upload_label || o.detected_entity || o.visual_description).trim().split(/\s+/).slice(0, 7).join(' '),
      asset_search_query: o.asset_search_query.trim().slice(0, 120),
      priority: pick(o.priority, ['high', 'medium', 'low'] as const, 'medium'),
      visual_confidence: round(confidence),
      reason_for_insertion: o.reason_for_insertion.trim().slice(0, 240),
      recommended_duration: round(finish - start),
      screen_occupancy: pick(o.screen_occupancy, ['full', 'partial', 'split'] as const, 'full'),
      speaker_visibility: pick(o.speaker_visibility, ['hidden', 'pip', 'visible'] as const, 'hidden'),
      continuity_group: o.continuity_group ? o.continuity_group.trim().slice(0, 40) || null : null,
      asset_source_preference: pick(o.asset_source_preference, ['creator_upload', 'official', 'archival', 'stock', 'generated'] as const, 'creator_upload'),
      factuality_requirement: pick(o.factuality_requirement, ['exact', 'representative', 'illustrative'] as const, 'representative'),
      avoid_visual: o.avoid_visual.trim().slice(0, 160),
      spoken: words.slice(a, b + 1).map(w => w.text).join(' ').slice(0, 160),
    });
  });

  // strongest first; ties keep the earlier moment
  const ranked = [...candidates].sort((x, y) => RANK[y.priority] - RANK[x.priority] || y.visual_confidence - x.visual_confidence || x.timestamp_start - y.timestamp_start);
  const kept: BrollOpportunity[] = [];
  const entities = new Set<string>();
  let covered = 0;
  for (const c of ranked) {
    const entity = c.detected_entity.toLowerCase();
    const sameGroup = (o: BrollOpportunity) => c.continuity_group !== null && o.continuity_group === c.continuity_group;
    if (kept.length >= maxCount) { dropped.push(`${c.id}:count_cap`); continue; }
    if (entity && entities.has(entity) && !kept.some(sameGroup)) { dropped.push(`${c.id}:repeat_entity`); continue; }
    if (kept.some(o => c.timestamp_start < o.timestamp_end && o.timestamp_start < c.timestamp_end)) { dropped.push(`${c.id}:overlap`); continue; }
    if (kept.some(o => !sameGroup(o) && Math.min(Math.abs(c.timestamp_start - o.timestamp_end), Math.abs(o.timestamp_start - c.timestamp_end)) < minGap)) { dropped.push(`${c.id}:too_close`); continue; }
    const len = c.timestamp_end - c.timestamp_start;
    if (covered + len > maxCover) { dropped.push(`${c.id}:screen_time_cap`); continue; }
    kept.push(c);
    covered += len;
    if (entity) entities.add(entity);
  }
  kept.sort((x, y) => x.timestamp_start - y.timestamp_start);
  return {kept, dropped};
}

const round = (n: number) => Math.round(n * 100) / 100;

/** What the creator can upload for an opportunity, or null when the treatment is engine-owned (diagram, metaphor, kinetic type). */
export function slotKindFor(o: Pick<BrollOpportunity, 'visual_type' | 'category'>): {kind: LabeledAssetKind; accept: Array<'image' | 'video'>} | null {
  switch (o.visual_type) {
    case 'SCREEN_VISUAL': return {kind: 'screenshot', accept: ['image', 'video']};
    case 'PRODUCT_VISUAL': return {kind: 'product', accept: ['image', 'video']};
    case 'ENTITY_IMAGE':
      if (o.category === 'people') return {kind: 'person', accept: ['image']};
      if (o.category === 'organization') return {kind: 'logo', accept: ['image']};
      if (o.category === 'product_object') return {kind: 'product', accept: ['image', 'video']};
      return {kind: 'broll_clip', accept: ['image', 'video']};
    case 'CONTEXTUAL_FOOTAGE': return {kind: 'broll_clip', accept: ['video', 'image']};
    default: return null;
  }
}

/** The creator's upload tags: one per uploadable opportunity, labelled with what to upload, timed on the real words. */
export function brollOpportunitiesToSlots(opportunities: readonly BrollOpportunity[]): Array<Omit<LabeledAssetSlot, 'status'>> {
  const out: Array<Omit<LabeledAssetSlot, 'status'>> = [];
  const asked = new Set<string>();
  for (const o of opportunities) {
    const ask = slotKindFor(o);
    if (!ask) continue;
    // one ask per asset: two moments that need the same picture (the YouTube logo twice) ask for it once
    const key = askKey({kind: ask.kind, label: o.upload_label || o.detected_entity || ''});
    if (asked.has(key)) continue;
    asked.add(key);
    const n = out.length + 1;
    out.push({
      id: `asset_ai_${n}`,
      label: o.upload_label || o.detected_entity || 'Supporting visual',
      kind: ask.kind,
      reason: `${o.reason_for_insertion || o.visual_description} (around ${o.timestamp_start.toFixed(1)}s, about ${o.recommended_duration.toFixed(1)}s on screen)`.trim(),
      startSec: o.timestamp_start,
      endSec: o.timestamp_end,
      accept: ask.accept,
      spokenHint: o.spoken,
      required: false,
      motionIntent: `ai_broll:${o.visual_type.toLowerCase()}:${o.screen_occupancy}`,
      ...(o.continuity_group ? {groupId: `ai_${o.continuity_group.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`} : {}),
      opportunityId: o.id,
    });
  }
  return out;
}

export type BrollDetection =
  | {source: 'ai'; opportunities: BrollOpportunity[]; slots: Array<Omit<LabeledAssetSlot, 'status'>>; warnings: string[]}
  | {source: 'unavailable'; reason: string; warnings: string[]};

/** Run the detector. Any failure (no call configured, budget refusal, bad JSON) is `unavailable`: the caller keeps its previous asks. */
export async function detectBrollOpportunities(input: {words: readonly BrollWord[]; durationSec: number; call: DirectorCall | null; options?: SelectOptions}): Promise<BrollDetection> {
  if (!input.call) return {source: 'unavailable', reason: 'not_configured', warnings: ['broll_opportunities:unavailable:not_configured']};
  if (input.words.length < 4) return {source: 'ai', opportunities: [], slots: [], warnings: ['broll_opportunities:ai:too_short']};
  let text: string;
  try {
    text = await input.call({system: BROLL_OPPORTUNITY_SYSTEM, user: buildBrollOpportunityPrompt(input.words, input.durationSec)});
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).slice(0, 80);
    return {source: 'unavailable', reason, warnings: [`broll_opportunities:unavailable:call_failed:${reason}`]};
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return {source: 'unavailable', reason: 'bad_json', warnings: ['broll_opportunities:unavailable:bad_json']};
  }
  if (!rawSchema.safeParse(raw).success) return {source: 'unavailable', reason: 'schema', warnings: ['broll_opportunities:unavailable:schema']};
  const {kept, dropped} = selectBrollOpportunities(raw, input.words, input.durationSec, input.options);
  const slots = brollOpportunitiesToSlots(kept);
  return {
    source: 'ai',
    opportunities: kept,
    slots,
    warnings: [
      `broll_opportunities:ai:kept=${kept.length},asked=${slots.length},dropped=${dropped.length}`,
      ...kept.map(o => `broll_opportunities:moment:${o.timestamp_start}-${o.timestamp_end}:${o.visual_type}:${o.detected_entity.slice(0, 40)}`),
      ...(dropped.length ? [`broll_opportunities:dropped:${dropped.slice(0, 8).join('|').slice(0, 180)}`] : []),
    ],
  };
}
