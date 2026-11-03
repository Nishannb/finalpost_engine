/**
 * WP55 KINETIC_TYPE_STORYTELLING: what the Director may know about each template (pure). Not a registry: ids, compositions, durations and allowlists are READ from motionTemplateCatalog (the one registry); this table only
 * adds the Director-facing description. `kineticTypeCapabilitiesFor(skill)` returns only rows that are registered in the catalog, implemented (library entry + Remotion comp name present) and allowed for the active L1 skill,
 * so a template that is not allowed never reaches the prompt.
 */
import {
  MOTION_TEMPLATE_CATALOG,
  SKILL_MOTION_TEMPLATE_ALLOWLIST,
  type MotionTemplateId,
  type MotionTemplateSkill,
} from './motionTemplateCatalog.ts';

export type KineticTypeCapability = {
  /** Family name the Director uses in plans ("type_environmental_hero"). */
  name: string;
  templateId: MotionTemplateId;
  description: string;
  bestUse: string;
  required: readonly string[];
  optional: readonly string[];
  /** Subject-matte requirement. */
  matte: 'none' | 'optional' | 'recommended';
  cost: string;
  fallback: string;
};

export const KINETIC_TYPE_FAMILY: readonly KineticTypeCapability[] = [
  {
    name: 'type_environmental_hero',
    templateId: 'clip_45_type_environmental_hero',
    description: 'One oversized word at head / chest height. With a person matte the presenter is drawn IN FRONT of the type and the word SCROLLS behind them (marquee) so every letter is fully clear of the head for part of the beat; no matte, or a subject with no usable side gutter -> the type stays in the headroom above the subject.',
    bestUse: 'a strong claim or key concept (one or two spoken words, optional spoken lead-in)',
    required: ['text (spoken word(s))'],
    optional: ['lead (spoken)', 'subjectBox', 'person matte asset', 'tone'],
    matte: 'recommended',
    cost: 'no extra render cost without a matte; with a matte one cached segmentation pass per SOURCE video (not per template) + one extra alpha-video layer while the beat plays',
    fallback: 'no matte, or a subject that fills the frame (no usable side gutter) -> occlusion "none": type sits in the headroom above the subject (skipped when there is no headroom). Ordinary z-order is never presented as occlusion.',
  },
  {
    name: 'type_impact_number',
    templateId: 'clip_46_type_impact_number',
    description: 'Very large spoken number that pops with one controlled overshoot, optional label, short sequences, optional count-up.',
    bestUse: 'a statistic or number the speaker states',
    required: ['values (numbers said aloud)'],
    optional: ['prefix', 'suffix', 'label (spoken)', 'labelPosition', 'countUp'],
    matte: 'none',
    cost: 'pure Remotion, no assets',
    fallback: 'a number that is not spoken refuses the beat',
  },
  {
    name: 'type_staggered_phrase',
    templateId: 'clip_47_type_staggered_phrase',
    description: 'Words enter from different directions on the rhythm of the speech; one accent word.',
    bestUse: 'a short memorable statement (3-7 words)',
    required: ['text (spoken phrase)'],
    optional: ['wordStarts (from transcript timing)', 'emphasisIndex'],
    matte: 'none',
    cost: 'pure Remotion, no assets',
    fallback: 'timing not alignable -> even stagger',
  },
  {
    name: 'type_split_color_headline',
    templateId: 'clip_48_type_split_color_headline',
    description: 'Small accent lead-in over a large contrast-colour keyword; every group enters differently.',
    bestUse: 'a contrast or two-part message',
    required: ['groups (2-3, exactly one large, all spoken)'],
    optional: ['tone per group'],
    matte: 'none',
    cost: 'pure Remotion, no assets',
    fallback: 'no single dominant group -> refused',
  },
  {
    name: 'type_kinetic_word_pop',
    templateId: 'clip_49_type_kinetic_word_pop',
    description: 'One word pops beside the presenter (or in headroom), short and expressive, then leaves. Never behind the presenter: small type under a shoulder is unreadable.',
    bestUse: 'one important individual word',
    required: ['word (spoken)'],
    optional: ['anchor', 'subjectBox'],
    matte: 'none',
    cost: 'pure Remotion, no assets, never uses the person matte',
    fallback: 'no free side space -> headroom',
  },
  {
    name: 'type_stacked_statement',
    templateId: 'clip_50_type_stacked_statement',
    description: 'Layered lead / key / support lines with scale hierarchy around one dominant key line.',
    bestUse: 'a concluding argument',
    required: ['lines (2-4, exactly one key, all spoken)'],
    optional: ['lineStarts'],
    matte: 'none',
    cost: 'pure Remotion, no assets',
    fallback: 'no single key line -> refused',
  },
  {
    name: 'type_floating_social_proof',
    templateId: 'clip_51_type_floating_social_proof',
    description: 'Floating reaction icons and phone-framed creator stills at three depths.',
    bestUse: 'followers / engagement / social performance mentioned, ONLY with creator assets or a spoken figure',
    required: ['creator-provided stills OR a number the speaker said'],
    optional: ['icons', 'figureLabel'],
    matte: 'none',
    cost: 'pure Remotion + up to two creator stills (prefetched)',
    fallback: 'no assets and no spoken figure -> no beat (engagement is never invented)',
  },
  {
    name: 'type_logo_reveal',
    templateId: 'clip_52_type_logo_reveal',
    description: 'Logo chip + title reveal on footage, subtle motion.',
    bestUse: 'a brand introduction, ONLY with a logo or brand name',
    required: ['logoSrc OR brandName'],
    optional: ['subtitle (spoken)'],
    matte: 'none',
    cost: 'pure Remotion + one logo still',
    fallback: 'no logo and no brand name -> no beat',
  },
  {
    name: 'type_kinetic_cta',
    templateId: 'clip_53_type_kinetic_cta',
    description: 'Large final call to action: small lead-in, giant action phrase, short tag.',
    bestUse: 'a final invitation or instruction in the closing stretch',
    required: ['parts (2-3, exactly one large, all spoken)'],
    optional: ['partStarts'],
    matte: 'none',
    cost: 'pure Remotion, no assets',
    fallback: 'only planned after 55 % of the video',
  },
  {
    name: 'type_illustrated_emphasis',
    templateId: 'clip_54_type_illustrated_emphasis',
    description: 'A drawn accent (underline / circle / arrow / burst / bracket) reinforces one spoken word.',
    bestUse: 'a pointed, superlative or size word where a drawn mark adds meaning',
    required: ['word (spoken)', 'mark'],
    optional: ['lead (spoken)', 'subjectBox'],
    matte: 'none',
    cost: 'pure Remotion, no assets',
    fallback: 'no cue word -> no beat (never decoration)',
  },
  {
    name: 'type_text_match_cut',
    templateId: 'clip_55_type_text_match_cut',
    description: 'TEXT MATCH CUT: one spoken keyword stays locked in a sharp highlight box at a fixed screen anchor while the whole layout (typeface, scale, rotation, background) hard-cuts every 0.16-0.23 s. The surrounding type is the speaker\'s own words, cropped and blurred. Three grammars: memo (typewriter / documentary), editorial (push-in, fashion magazine), newsprint (per-cut tinted paper).',
    bestUse: 'a concept being NAMED or defined ("what is X", "the power of X", "from X to Y"): the keyword is the noun that carries the message (one spoken word, 4-12 chars; a second spoken word may swap in halfway for a from-X-to-Y contrast); at most ~1 per 20 s',
    required: ['keyword (spoken)', 'phrase (the spoken sentence, >= 5 words)'],
    optional: ['swapKeyword (spoken)', 'variant memo|editorial|newsprint'],
    matte: 'none',
    cost: 'pure Remotion, no assets; ~1.2-2 s full-frame (captions muted for its length)',
    fallback: 'no clear concept word or fewer than 5 spoken words -> no beat',
  },
];

export type KineticTypeCapabilityRow = KineticTypeCapability & {
  compositionId: string;
  durationSec: number;
  aspect: string;
  ownsFrame: boolean;
  rendering: string;
  /** L1 skills (polish lanes) that may use this template. */
  skills: MotionTemplateSkill[];
};

/** Capability rows the active L1 skill may use (registered + implemented + allowed). */
export function kineticTypeCapabilitiesFor(skill: MotionTemplateSkill, implemented: ReadonlySet<string>): KineticTypeCapabilityRow[] {
  const allow = new Set<string>(SKILL_MOTION_TEMPLATE_ALLOWLIST[skill] ?? []);
  const out: KineticTypeCapabilityRow[] = [];
  for (const cap of KINETIC_TYPE_FAMILY) {
    const spec = MOTION_TEMPLATE_CATALOG.find(row => row.id === cap.templateId);
    if (!spec || !allow.has(spec.id) || !implemented.has(spec.compositionId)) continue;
    const skills = (Object.keys(SKILL_MOTION_TEMPLATE_ALLOWLIST) as MotionTemplateSkill[]).filter(k => SKILL_MOTION_TEMPLATE_ALLOWLIST[k].includes(spec.id));
    out.push({...cap, compositionId: spec.compositionId, durationSec: spec.durationSec, aspect: spec.aspect, ownsFrame: spec.ownsFrame, rendering: `Remotion ${spec.compositionId} (${spec.ownsFrame ? 'full-frame' : 'overlay'}, silent, deterministic)`, skills});
  }
  return out;
}

/** Director appendix: one short block, only for the rows the active skill may use. Empty string when nothing qualifies. */
export function formatKineticTypeForDirector(skill: MotionTemplateSkill, implemented: ReadonlySet<string>): string {
  const rows = kineticTypeCapabilitiesFor(skill, implemented);
  if (rows.length === 0) return '';
  return [
    'KINETIC_TYPE_STORYTELLING (toolkit kinetic_text; overlays, captions stay on; pick by what the sentence MEANS, sparse, one treatment per sentence):',
    ...rows.map(r => `- ${r.name} (${r.templateId}, ${r.durationSec}s): ${r.bestUse}. Needs: ${r.required.join('; ')}. Fallback: ${r.fallback}`),
    '- Every displayed string must be spoken in the transcript window (or be creator brand data). Never invent statistics, claims, testimonials or engagement numbers. Do not animate every sentence.',
  ].join('\n');
}
