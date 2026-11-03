/**
 * WP54 (pure): sparse planner for the native craft templates clip_35..44 — kinetic type (35–38), logo reveal (39), mesh ground (40), gated ecommerce (41–44). No LLM, no env, no IO.
 * NOT a skill lane and not a toolkit id: toolkit = WHY (kinetic_text / lockup / card / cutaway / counter / zoom), template id = WHICH move. The Director's job is to pick the tool the SENTENCE needs, so every beat is anchored on a
 * transcript cue and carries a `hint` (phrase / lines / prices / target) the binder re-verifies against the spoken words. Never stacks with a blocked range (riso / StatHighlight / full-frame graphics) or another beat.
 *
 * Caps: kinetic type <= 2, logo <= 1, mesh ground <= 1, product templates <= 2 (and 0 unless the product gate passes), total <= the shared full-screen budget (motionCraftStandards). 4 s minimum gap between beats.
 * Gate (clip_41..44): contentType is product / sales AND (provided screenshots OR a spoken price pair with parseable numbers). A talking-head pitch without screenshots or prices plans ZERO of them (riso / kinetic cover it instead).
 */
import {CRAFT_AMBIENT_CAPS, fullscreenBudgetAllows} from './motionCraftStandards.ts';
import {
  MOTION_TEMPLATE_SYNC_LEAD_SEC,
  SKILL_MOTION_TEMPLATE_ALLOWLIST,
  motionTemplate,
  type MotionTemplateBeat,
  type MotionTemplateId,
  type MotionTemplateIntent,
  type MotionTemplateSkill,
  type MotionTemplateWord,
} from './motionTemplateCatalog.ts';
import {duplicatesCaption, kineticBeatBudget, kineticCandidateFromDirector, kineticCandidatesOf, type DirectedKineticTypeInput, type KineticCandidate} from './kineticTypeStory.ts';
import {
  KINETIC_LED_CONFIG,
  familyRepeatsTooOften,
  kineticAnchorForSubject,
  KINETIC_MATTE_BUDGET_CPU_SEC,
  KINETIC_MATTE_MIN_SPACING_SEC,
  MATTE_RANGE_PAD_SEC,
  kineticLedBeatBudget,
  kineticMatteQuota,
  kineticMotionFamily,
} from './kineticLedConfig.ts';
import {HERO_DEFAULT_SUBJECT_BOX} from './heroSweep.ts';
import {matteHeroRevealMode} from './matteTextReadable.ts';
import {sentencesOfWords} from './visualBackend/planVisualBackendBeats.ts';

export type CraftTemplatePlan = {beats: MotionTemplateBeat[]; captionMuteRanges: Array<{start: number; end: number}>; warnings: string[]};

/** Content types that can carry product / sales templates (contentProfile.contentType). */
export const PRODUCT_CONTENT_TYPES = ['sales_pitch', 'tutorial', 'announcement'] as const;

const MIN_GAP_S = 4;
const KINETIC_TYPE_IDS = ['clip_35_type_word_reveal', 'clip_36_type_line_mask', 'clip_37_type_char_stagger', 'clip_38_type_weight_morph'] as const;
/** WP55 KINETIC_TYPE_STORYTELLING overlay family (clip_45..54): planned in the same pass, never muting captions. clip_55 (text match cut) is the one exception: a full-frame montage that mutes captions for its ~1.5 s. */
export const KINETIC_STORY_IDS = [
  'clip_45_type_environmental_hero',
  'clip_46_type_impact_number',
  'clip_47_type_staggered_phrase',
  'clip_48_type_split_color_headline',
  'clip_49_type_kinetic_word_pop',
  'clip_50_type_stacked_statement',
  'clip_51_type_floating_social_proof',
  'clip_52_type_logo_reveal',
  'clip_53_type_kinetic_cta',
  'clip_54_type_illustrated_emphasis',
  'clip_55_type_text_match_cut',
] as const;
const PRODUCT_IDS = ['clip_41_product_device_frame', 'clip_42_product_cursor_click', 'clip_43_promo_price_drop', 'clip_44_photo_ken_burns'] as const;

const IMPACT = /\b(never|always|nothing|everything|only|stop|must|biggest|real|truth|secret|changed|best|worst|free|simple|ready|wrong|different)\b/i;
const WEIGHT_CUE = /\b(bigger|heavier|stronger|bold|louder|power|massive|huge|grow|scale)\b/i;
const AMBIENT_CUE = /\b(imagine|picture|feel|dream|future|vision|journey|calm|quiet|slow)\b/i;
const LOGO_CUE = /\b(follow|subscribe|link in bio|check (?:it )?out|visit|join|download|sign up|try (?:it|us)|learn more|get started)\b/i;
const APP_CUE = /\b(app|dashboard|screen|interface|platform|software|website|web ?page|page|ui|tool|inside)\b/i;
const CLICK_CUE = /\b(click|tap|press|hit|select|choose)\b/i;
const PHOTO_CUE = /\b(look at|picture|photo|here'?s|meet|this is|introducing|check this)\b/i;
const SALE_CUE = /\b(sale|off|discount|deal|offer|save|price|promo)\b/i;
/** was $79 ... now $47 | from 79 to 47 | used to be 79, now 47 | normally 79 but only 47 today */
const PRICE_PAIR = /(?:\bwas\b|\bfrom\b|used to be|originally|normally|regular(?:ly)?)\s+(\$)?(\d+(?:\.\d+)?)\b[\s\S]{0,48}?(?:\bnow\b|\btoday\b|\bfor\b|\bonly\b|\bjust\b|\bto\b)\s+(\$)?(\d+(?:\.\d+)?)\b/i;

const clean = (text: string) => text.replace(/^[\s,;:.\-–—"'(]+|[\s,;:.!?"')]+$/g, '').trim();
const wordsIn = (text: string) => text.split(/\s+/).filter(Boolean);

export type CraftGateInput = {
  contentType?: string | null;
  screenshotUrls?: readonly string[];
  /** Spoken (or asset-brief) price pair present with parseable numbers. */
  hasGroundedPrice?: boolean;
};

export type CraftGate = {pass: boolean; reason: string};

/** Product / ecommerce gate: product-or-sales profile AND (provided screenshots OR a grounded price). */
export function productGate(input: CraftGateInput): CraftGate {
  const typeOk = Boolean(input.contentType) && (PRODUCT_CONTENT_TYPES as readonly string[]).includes(input.contentType!);
  if (!typeOk) return {pass: false, reason: 'not_product_profile'};
  const shots = (input.screenshotUrls ?? []).filter(url => /^https:\/\/\S+$/i.test(url.trim())).length;
  if (shots === 0 && !input.hasGroundedPrice) return {pass: false, reason: 'no_screenshots_or_price'};
  return {pass: true, reason: shots > 0 ? 'screenshots' : 'price'};
}

export type EmphaticPhrase = {text: string; lines?: string[]; startIdx: number; endIdx: number; intent: MotionTemplateIntent; templateId: MotionTemplateId};

/**
 * One short emphatic phrase from a sentence — never a full caption clone. Rules: sentences with digits belong to the number tools; a whole sentence of 2–6 words is already a punchline; a longer sentence yields only the
 * 2–6-word clause that carries an impact cue (after a comma / colon / dash). Anything else = null (captions already carry it).
 */
export function emphaticPhraseOf(sentence: {text: string; words: readonly MotionTemplateWord[]}): EmphaticPhrase | null {
  if (/\d/.test(sentence.text)) return null;
  const words = sentence.words;
  const count = words.length;
  let from = 0;
  let to = count; // exclusive
  const bareCount = (a: number, b: number) => wordsIn(clean(words.slice(a, b).map(w => w.text).join(' '))).length;
  if (bareCount(0, count) >= 2 && bareCount(0, count) <= 6 && (IMPACT.test(sentence.text) || count <= 4)) {
    from = 0;
    to = count;
  } else if (count > 6) {
    // clause after a comma / colon / dash that carries the cue
    let found = false;
    for (let i = 0; i < count - 1 && !found; i++) {
      if (!/[,:;—–-]$/.test(words[i]!.text)) continue;
      const len = bareCount(i + 1, count);
      const clause = words.slice(i + 1, count).map(w => w.text).join(' ');
      if (len >= 2 && len <= 6 && IMPACT.test(clause)) {
        from = i + 1;
        to = count;
        found = true;
      }
    }
    if (!found) return null;
  } else {
    return null;
  }
  const picked = words.slice(from, to);
  const text = clean(picked.map(w => w.text).join(' '));
  const n = wordsIn(text).length;
  if (n < 1 || n > 6 || text.length < 4) return null;
  let lines: string[] | undefined;
  const commaAt = picked.findIndex((w, i) => i < picked.length - 1 && /[,;:]$/.test(w.text));
  if (commaAt > -1) lines = [clean(picked.slice(0, commaAt + 1).map(w => w.text).join(' ')), clean(picked.slice(commaAt + 1).map(w => w.text).join(' '))].filter(Boolean);
  let templateId: MotionTemplateId = 'clip_35_type_word_reveal';
  let intent: MotionTemplateIntent = 'emphatic_type';
  if (lines && lines.length === 2) {
    templateId = 'clip_36_type_line_mask';
    intent = 'line_type';
  } else if (WEIGHT_CUE.test(text)) {
    templateId = 'clip_38_type_weight_morph';
    intent = 'weight_type';
  } else if (Array.from(text).length <= 24 && n <= 3) {
    templateId = 'clip_37_type_char_stagger';
    intent = 'char_type';
  } else if (n < 2) {
    return null; // a lone long word reveals as nothing special
  }
  return {text, ...(lines ? {lines} : {}), startIdx: from, endIdx: to - 1, intent, templateId};
}

/** Spoken price pair (was > now) with both figures stated in the sentence, else null. */
export function spokenPricePair(text: string): {was: number; now: number; prefix: string} | null {
  const m = PRICE_PAIR.exec(text);
  if (!m) return null;
  const was = Number(m[2]);
  const now = Number(m[4]);
  if (!Number.isFinite(was) || !Number.isFinite(now) || !(now > 0) || !(now < was)) return null;
  const dollar = Boolean(m[1] || m[3]) || /\$|dollars?|bucks/i.test(text);
  return {was, now, prefix: dollar ? '$' : ''};
}

export function planCraftTemplateBeats(input: {
  skill: MotionTemplateSkill;
  durationSec: number;
  words: readonly MotionTemplateWord[];
  /** contentProfile.contentType */
  contentType?: string | null;
  /** https stills the creator PROVIDED as screenshots / product shots (asset brief). */
  screenshotUrls?: readonly string[];
  /** https stills on this edit (faceless / editorial) — only clip_44 may use them. */
  imageUrls?: readonly string[];
  logoSrc?: string;
  /** [was, now] from the labeled asset brief (grounds clip_43 when the transcript carries no pair). */
  assetBriefPrices?: readonly number[];
  blockedRanges?: ReadonlyArray<{start: number; end: number}>;
  /** Full-screen graphics already on the edit (riso, templates, plates): the shared restraint budget. */
  existingFullscreenCount?: number;
  /** WP55: set false to skip the KINETIC_TYPE_STORYTELLING overlay family (default true). Used to pin the WP54 planner in isolation. */
  kineticStory?: boolean;
  /**
   * WP55 / WP56: the live Director's kinetic-type choices (template + exact phrase + window). Validated choices win the budget.
   * `owned: true` with ≥1 accepted candidate = Director-only. WP56: owned + zero accepted (empty list or all rejected) falls back to deterministic selection — empty is not a legitimate "skip kinetic".
   */
  directed?: {candidates: readonly DirectedKineticTypeInput[]; owned: boolean};
  /** WP55: narrow the family to these template ids (e.g. a Director that was asked for one move). Still intersected with the active skill's allowlist. */
  kineticOnly?: readonly string[];
  /** WP55: the creator's brand name (gate for clip_52 together with / instead of a logo). */
  brandName?: string;
  /** WP55: https stills of the creator's own posts / profile (gate for clip_51). */
  socialImageUrls?: readonly string[];
  /** WP55: the subject matte exists (real occlusion for clip_45) and the subject's bounding box (fractions) for placement. */
  /** WP55 phase 2: MEASURED subject box (fractions) when there is no matte (e.g. the occupancy vision box); never a default. */
  subjectBox?: {x: number; y: number; w: number; h: number};
  subjectMatte?: {src?: string; hostComposited?: boolean; box?: {x: number; y: number; w: number; h: number}};
  /** WP57: Kinetic-Led spine (style bible). Default false — sparse WP55 budget. */
  kineticLed?: boolean;
  /**
   * Phase D: hard cap (seconds, padded) on matted footage when kineticLed has a usable matte. The caller derives it from the RVM device (`matteBudgetSecForDevice`: 20 s CPU / unknown, 45 s mps / cuda);
   * unset = the conservative CPU value. Ignored without kineticLed or without a matte.
   */
  matteBudgetSec?: number;
}): CraftTemplatePlan {
  const warnings: string[] = [];
  const durationSec = Math.max(0, input.durationSec);
  const allowed = new Set<string>(SKILL_MOTION_TEMPLATE_ALLOWLIST[input.skill] ?? []);
  const wp54Allowed = [...KINETIC_TYPE_IDS, ...KINETIC_STORY_IDS, 'clip_39_logo_reveal', 'clip_40_mesh_gradient_ground', ...PRODUCT_IDS].filter(id => allowed.has(id));
  if (wp54Allowed.length === 0 || durationSec < 8) {
    warnings.push('craft_templates:skipped:short_or_empty_allowlist');
    return {beats: [], captionMuteRanges: [], warnings};
  }
  const sentences = sentencesOfWords(input.words);
  const blocked = input.blockedRanges ?? [];
  const beats: MotionTemplateBeat[] = [];
  const counts = {type: 0, logo: 0, mesh: 0, product: 0};
  let fullscreen = input.existingFullscreenCount ?? 0;
  /** WP57: kinetic-led story beats may repeat a template and sit ~2s apart. Reset after the story pass. */
  let gapSec = MIN_GAP_S;
  let allowRepeat = false;

  const place = (templateId: MotionTemplateId, intent: MotionTemplateIntent, at: number, sentenceEnd: number, hint?: Record<string, unknown>, lenSec?: number): boolean => {
    const spec = motionTemplate(templateId);
    if (!spec || !allowed.has(templateId)) return false;
    const opaque = spec.ownsFrame;
    if (opaque && !fullscreenBudgetAllows(durationSec, fullscreen)) {
      if (!warnings.includes('craft_templates:budget_exhausted')) warnings.push('craft_templates:budget_exhausted');
      return false;
    }
    if (!allowRepeat && beats.some(b => b.templateId === templateId)) return false;
    const start = Math.max(0, at - MOTION_TEMPLATE_SYNC_LEAD_SEC);
    // the template plays its natural length (it may run a little past the spoken phrase, like the WP45 planner)
    const end = Math.min(durationSec, start + (lenSec ?? Math.max(spec.durationSec, Math.min(5, sentenceEnd - start + 0.4))));
    if (end - start < (lenSec ? lenSec * 0.9 : Math.max(1.4, spec.durationSec * 0.7))) return false;
    if (blocked.some(r => r.start < end && r.end > start)) return false;
    if (beats.some(b => b.start - gapSec < end && b.end + gapSec > start)) return false;
    beats.push({id: `ct_${beats.length + 1}_${templateId}`, start, end, templateId, compositionId: spec.compositionId, intent, muteCaptions: spec.ownsFrame, ...(hint ? {hint} : {})});
    if (opaque) fullscreen += 1;
    return true;
  };

  // --- gated product / ecommerce (planned first: concrete assets / prices beat generic type)
  const pricePairs = sentences.map(s => ({s, pair: spokenPricePair(s.text)})).filter((row): row is {s: (typeof sentences)[number]; pair: {was: number; now: number; prefix: string}} => row.pair !== null);
  const briefPair = input.assetBriefPrices && input.assetBriefPrices.length >= 2 && input.assetBriefPrices[1]! < input.assetBriefPrices[0]! ? ([input.assetBriefPrices[0]!, input.assetBriefPrices[1]!] as const) : null;
  const gate = productGate({contentType: input.contentType, screenshotUrls: input.screenshotUrls, hasGroundedPrice: pricePairs.length > 0 || briefPair !== null});
  const facelessStill = input.skill === 'faceless' && (input.imageUrls ?? []).some(url => /^https:\/\//i.test(url));
  const productCap = CRAFT_AMBIENT_CAPS.productTemplates;
  if (!gate.pass && !facelessStill) {
    if (wp54Allowed.some(id => (PRODUCT_IDS as readonly string[]).includes(id))) warnings.push(`craft_templates:product:gated:${gate.reason}`);
  }
  if (gate.pass) {
    const shots = (input.screenshotUrls ?? []).filter(url => /^https:\/\//i.test(url));
    for (const row of pricePairs) {
      if (counts.product >= productCap) break;
      if (place('clip_43_promo_price_drop', 'promo_price', row.s.words[0]!.start, row.s.end, {was: row.pair.was, now: row.pair.now, prefix: row.pair.prefix})) counts.product += 1;
    }
    if (counts.product === 0 && briefPair) {
      const row = sentences.find(s => SALE_CUE.test(s.text) && !/\d/.test(s.text));
      if (row && place('clip_43_promo_price_drop', 'promo_price', row.words[0]!.start, row.end, {was: briefPair[0], now: briefPair[1], prefix: ''})) counts.product += 1;
    }
    if (shots.length > 0) {
      for (const s of sentences) {
        if (counts.product >= productCap) break;
        const click = CLICK_CUE.exec(s.text);
        if (click && place('clip_42_product_cursor_click', 'product_click', s.words[0]!.start, s.end)) {
          counts.product += 1;
          continue;
        }
        if (!click && APP_CUE.test(s.text) && place('clip_41_product_device_frame', 'product_device', s.words[0]!.start, s.end, {device: /\b(phone|mobile|iphone|android)\b/i.test(s.text) ? 'phone' : 'browser'})) counts.product += 1;
      }
    }
  }
  if (counts.product < productCap && (gate.pass || facelessStill) && allowed.has('clip_44_photo_ken_burns')) {
    const stills = [...(input.screenshotUrls ?? []), ...(input.imageUrls ?? [])].filter(url => /^https:\/\//i.test(url));
    if (stills.length > 0) {
      const row = sentences.find(s => PHOTO_CUE.test(s.text));
      if (row && place('clip_44_photo_ken_burns', 'photo_motion', row.words[0]!.start, row.end)) counts.product += 1;
    }
  }

  // --- logo reveal (needs a logo asset; end-of-video CTA cue)
  if (allowed.has('clip_39_logo_reveal')) {
    const cue = [...sentences].reverse().find(s => s.start >= durationSec * 0.6 && LOGO_CUE.test(s.text));
    if (cue) {
      if (!input.logoSrc || !/^https:\/\//i.test(input.logoSrc)) warnings.push('craft_templates:logo:skipped:no_logo_src');
      else if (counts.logo < CRAFT_AMBIENT_CAPS.logoReveal && place('clip_39_logo_reveal', 'logo_reveal', cue.words[0]!.start, cue.end)) counts.logo += 1;
    }
  }

  // --- WP55 KINETIC_TYPE_STORYTELLING (overlays; toolkit kinetic_text). Meaning decides the template; sparse budget + gaps + blocked ranges decide how many. Planned BEFORE the opaque WP54 type so a talking head keeps its
  // footage and its captions; the WP54 opaque type then only fills what is left.
  const storyAllowed = new Set<string>(input.kineticStory === false ? [] : KINETIC_STORY_IDS.filter(id => allowed.has(id) && (!input.kineticOnly || input.kineticOnly.includes(id))));
  if (storyAllowed.size > 0) {
    const ctx = {durationSec, logoSrc: input.logoSrc, brandName: input.brandName, socialImageUrls: input.socialImageUrls, subjectBox: input.subjectMatte?.box ?? input.subjectBox, hasMatte: Boolean(input.subjectMatte?.src || input.subjectMatte?.hostComposited), preferMatte: Boolean(input.kineticLed && (input.subjectMatte?.src || input.subjectMatte?.hostComposited))};
    const pool: Array<{c: KineticCandidate; sentence: (typeof sentences)[number]}> = [];
    let directedAccepted = 0;
    for (const d of input.directed?.candidates ?? []) {
      const r = kineticCandidateFromDirector(d, input.words, ctx, storyAllowed);
      if (!r.candidate || !r.sentence) {
        warnings.push(`kinetic_type:director_rejected:${d.template}:${r.rejected ?? 'unknown'}`);
        continue;
      }
      const containing = sentences.find(s => s.start <= r.sentence!.start + 0.01 && s.end >= r.sentence!.end - 0.01) ?? {...r.sentence, words: [...r.sentence.words]};
      if (duplicatesCaption(r.candidate.shown, containing.text)) {
        warnings.push(`kinetic_type:director_rejected:${d.template}:duplicates_caption`);
        continue;
      }
      pool.push({c: r.candidate, sentence: containing});
      directedAccepted += 1;
    }
    if (input.directed) warnings.push(`kinetic_type:director:${directedAccepted}_of_${input.directed.candidates.length}${input.directed.owned ? ':owned' : ''}`);
    // WP56: owned empty / all-rejected → deterministic fallback so every polish edit can still get kinetic type.
    const directorOwns = Boolean(input.directed?.owned && directedAccepted > 0);
    if (!directorOwns) {
      if (input.directed?.owned && directedAccepted === 0) warnings.push('kinetic_type:director_empty_fallback');
      for (const s of sentences) {
        const {candidates, warnings: w} = kineticCandidatesOf(s, ctx, storyAllowed);
        for (const warning of w) if (!warnings.includes(warning)) warnings.push(warning);
        for (const c of candidates) if (!duplicatesCaption(c.shown, s.text)) pool.push({c, sentence: s});
      }
    }
    pool.sort((a, b) => b.c.score - a.c.score || a.c.at - b.c.at);
    const budget = input.kineticLed ? kineticLedBeatBudget(durationSec) : kineticBeatBudget(durationSec);
    if (input.kineticLed) {
      gapSec = KINETIC_LED_CONFIG.density.minimumSecondsPerBeat;
      allowRepeat = true;
      warnings.push(`kinetic_led:budget:${budget}`);
      const face = input.subjectMatte?.box ?? input.subjectBox;
      if (!face) warnings.push('kinetic_led:face:unmeasured');
    }
    const faceBox = input.subjectMatte?.box ?? input.subjectBox;
    const styleHint = input.kineticLed
      ? {
          ground: KINETIC_LED_CONFIG.style.background,
          ink: KINETIC_LED_CONFIG.style.primaryText,
          secondary: KINETIC_LED_CONFIG.style.secondaryText,
          accent: KINETIC_LED_CONFIG.style.accent,
          ...(faceBox ? {anchor: kineticAnchorForSubject(faceBox)} : {}),
        }
      : {};
    const usedSentences = new Set<(typeof sentences)[number]>();
    const recentFamilies: string[] = [];
    let placed = 0;
    let matchCuts = 0;
    /** Text match cut is a full-frame hard-cut montage: ~1 per 20 s so it stays an event, not a tic. */
    const matchCutCap = Math.max(1, Math.floor(durationSec / 20));

    // Phase D: kinetic-led WITH a usable person matte = depth first. `matteMode` is false in every other case, and then none of the matte logic below runs (the plan is identical to before).
    // Text-behind is ONLY for oversized environmental heroes that stay readable (sweep reveal). Small word-pop type never goes behind the person.
    const matteMode = Boolean(input.kineticLed && (input.subjectMatte?.src || input.subjectMatte?.hostComposited));
    const matteQuota = matteMode ? kineticMatteQuota(budget) : 0;
    const matteCapSec = matteMode ? Math.max(0, input.matteBudgetSec ?? KINETIC_MATTE_BUDGET_CPU_SEC) : 0;
    let matteBeats = 0;
    let matteSec = 0;
    const matteStarts: number[] = [];
    const matteCostById = new Map<string, number>();
    // Pass 1 never takes the place of a beat the planner already values for its CONTENT: a stated number, the closing CTA, a brand reveal, social proof. A matte beat that would sit within one beat length + gap of one of those is skipped.
    const PROTECTED_IDS = new Set<string>(['clip_46_type_impact_number', 'clip_53_type_kinetic_cta', 'clip_52_type_logo_reveal', 'clip_51_type_floating_social_proof']);
    const protectedClearance = 2.4 + KINETIC_LED_CONFIG.density.minimumSecondsPerBeat + 0.3;
    const protectedAts = matteMode ? pool.filter(item => PROTECTED_IDS.has(item.c.templateId)).map(item => item.c.at) : [];
    const heroHeadroomOk = Boolean(faceBox && faceBox.y - 0.08 >= 0.12); // the no-matte / demoted hero layout needs measured room above the subject
    const isHero = (id: string) => id === 'clip_45_type_environmental_hero';
    const hasPersonMatte = Boolean(input.subjectMatte?.src || input.subjectMatte?.hostComposited);
    /** Text-behind is allowed for THIS hero when the marquee can make every glyph clear of the head for a stretch (a usable side gutter exists; a long word is fine). Otherwise refuse occlusion (headroom). */
    // kinetic-led (matte mode) refuses occlusion for an unmeasured subject; the sparse planner (and the binder) judge an unmeasured subject against the comp's default box, so the plan and the bound props agree
    const gateBox = faceBox ?? (matteMode ? undefined : HERO_DEFAULT_SUBJECT_BOX);
    const heroOcclusionOkFor = (c: KineticCandidate) => matteHeroRevealMode(gateBox, {text: String(c.hint?.text ?? ''), ...(typeof c.hint?.lead === 'string' ? {lead: c.hint.lead} : {})}) === 'sweep';
    /** Matted footage a beat costs: its own span plus the pad the matte ranges add on each side. */
    const matteCost = (len: number) => len + 2 * MATTE_RANGE_PAD_SEC;
    /** Temporal variety (matte mode): would this beat make a 4th consecutive same-family story beat IN TIME ORDER? The matte pass places out of time order, so placement order cannot be used. */
    const makesRunOfFour = (family: string, at: number) => {
      const start = Math.max(0, at - MOTION_TEMPLATE_SYNC_LEAD_SEC);
      const seq: Array<{start: number; family: string}> = beats.filter(b => (KINETIC_STORY_IDS as readonly string[]).includes(b.templateId)).map(b => ({start: b.start, family: kineticMotionFamily(b.templateId)}));
      seq.push({start, family});
      seq.sort((x, y) => x.start - y.start);
      const i = seq.findIndex(x => x.start === start && x.family === family);
      let run = 1;
      for (let j = i - 1; j >= 0 && seq[j]!.family === family; j -= 1) run += 1;
      for (let j = i + 1; j < seq.length && seq[j]!.family === family; j += 1) run += 1;
      return run >= 4;
    };
    /** How long the kinetic-led / sparse planner would run this candidate. */
    const lenOf = (c: KineticCandidate, specDuration: number) =>
      c.templateId === 'clip_55_type_text_match_cut'
        ? Math.min(2, Math.max(1.4, c.spokenEnd - c.at + 0.9))
        : input.kineticLed
        ? Math.min(2.4, Math.max(1.6, c.spokenEnd - c.at + 0.8))
        : Math.min(4.6, Math.max(specDuration, c.spokenEnd - c.at + (c.templateId === 'clip_49_type_kinetic_word_pop' ? 0.55 : 1.0)));

    /** Try to place one candidate. `mode`: normal = pre-Phase-D; matte = environmental hero BEHIND the presenter with a sweep reveal; demote = headroom (budget or unreadable occlusion). */
    const attempt = (c: KineticCandidate, sentence: (typeof sentences)[number], mode: 'normal' | 'matte' | 'demote', demoteReason?: 'budget' | 'unreadable'): boolean => {
      // a hero with no usable gutter around the subject is never put behind them: headroom where there is room, else not planned (also outside matte mode)
      if (mode !== 'demote' && isHero(c.templateId) && hasPersonMatte && !heroOcclusionOkFor(c)) return heroHeadroomOk ? attempt(c, sentence, 'demote', 'unreadable') : false;
      if (c.templateId === 'clip_55_type_text_match_cut' && matchCuts >= matchCutCap) return false;
      if (usedSentences.has(sentence)) return false; // one idea per sentence: a sentence gets ONE kinetic treatment
      const family = kineticMotionFamily(c.templateId);
      // matte mode: pass 1 skips the family check (the beats between the spread-out matte beats are not placed yet; the final guard below enforces "no 4 in a row" on the whole plan), pass 2 checks it in TIME order
      if (input.kineticLed && mode !== 'matte' && (matteMode ? makesRunOfFour(family, c.at) : familyRepeatsTooOften(recentFamilies, family))) {
        warnings.push('kinetic_led:variety:skipped');
        return false;
      }
      const spec = motionTemplate(c.templateId);
      if (!spec) return false;
      // the beat runs a little past the spoken words, never shorter than the template's natural length (word pop stays short)
      const len = lenOf(c, spec.durationSec);
      const heroMatteHint = isHero(c.templateId) && !(input.subjectMatte?.src || input.subjectMatte?.hostComposited);
      const modeHint =
        mode === 'demote'
          ? {occlusion: 'none', occlusionFallback: 'headroom'}
          : mode === 'matte' && isHero(c.templateId)
            ? {reveal: 'sweep'}
            : mode === 'normal' && isHero(c.templateId) && hasPersonMatte
              ? {reveal: 'sweep'}
              : {};
      const hint = {
        ...(heroMatteHint ? {...c.hint, occlusionFallback: 'headroom'} : c.hint),
        ...modeHint,
        ...styleHint,
      };
      if (!place(c.templateId, c.intent, c.at, c.spokenEnd, hint, len)) return false;
      placed += 1;
      if (c.templateId === 'clip_55_type_text_match_cut') matchCuts += 1;
      usedSentences.add(sentence);
      recentFamilies.push(family);
      warnings.push(`kinetic_type:${c.templateId}:${c.reason}`);
      const usesMatte = (mode === 'matte' || mode === 'normal') && isHero(c.templateId) && hasPersonMatte;
      if (isHero(c.templateId)) warnings.push(usesMatte ? 'kinetic_type:environmental:matte' : 'kinetic_type:environmental:no_matte_fallback');
      if (mode === 'demote') warnings.push(`kinetic_led:matte:demoted:${demoteReason ?? 'budget'}`);
      if (matteMode && usesMatte) {
        const placedBeat = beats[beats.length - 1]!;
        matteBeats += 1;
        matteCostById.set(placedBeat.id, matteCost(placedBeat.end - placedBeat.start));
        matteSec += matteCostById.get(placedBeat.id)!;
        matteStarts.push(placedBeat.start);
      }
      return true;
    };

    if (matteMode) {
      // PASS 1 (matte first): readable environmental heroes only, up to the quota, never past the matted-footage cap. Word pop is excluded (small type behind the body is unreadable).
      for (const {c, sentence} of pool) {
        if (placed >= budget || matteBeats >= matteQuota) break;
        if (!isHero(c.templateId)) continue;
        if (!heroOcclusionOkFor(c)) continue; // unreadable occlusion → pass 2 may demote to headroom
        if (matteStarts.some(t => Math.abs(t - c.at) < KINETIC_MATTE_MIN_SPACING_SEC)) continue; // spread the depth moments through the edit
        if (protectedAts.some(t => Math.abs(t - c.at) < protectedClearance)) continue; // keep the number / CTA / brand beats
        const spec = motionTemplate(c.templateId);
        if (!spec || matteSec + matteCost(lenOf(c, spec.durationSec)) > matteCapSec) continue;
        attempt(c, sentence, 'matte');
      }
    }
    for (const {c, sentence} of pool) {
      if (placed >= budget) break;
      if (matteMode && isHero(c.templateId)) {
        // PASS 2: readable heroes still under the matted-footage cap go behind with a sweep; otherwise headroom (only where there is room) or nothing
        const spec = motionTemplate(c.templateId);
        if (!spec) continue;
        if (protectedAts.some(t => Math.abs(t - c.at) < protectedClearance)) continue; // the matte boost must not outrank a number / CTA / brand beat next to it
        if (!heroOcclusionOkFor(c)) {
          if (heroHeadroomOk) attempt(c, sentence, 'demote', 'unreadable');
          continue;
        }
        if (matteSec + matteCost(lenOf(c, spec.durationSec)) <= matteCapSec) attempt(c, sentence, 'normal');
        else if (heroHeadroomOk) attempt(c, sentence, 'demote', 'budget');
        continue;
      }
      attempt(c, sentence, 'normal');
    }
    if (matteMode) {
      // Final guard: never four same-family story beats in a row (time order). A pass-1 matte beat is the one given up, and the matte accounting follows.
      for (;;) {
        const seq = beats.filter(b => (KINETIC_STORY_IDS as readonly string[]).includes(b.templateId)).sort((x, y) => x.start - y.start);
        let victim: (typeof seq)[number] | undefined;
        for (let i = 0; i + 3 < seq.length && !victim; i += 1) {
          const f = kineticMotionFamily(seq[i]!.templateId);
          if ([1, 2, 3].every(d => kineticMotionFamily(seq[i + d]!.templateId) === f)) victim = [...seq.slice(i, i + 4)].reverse().find(b => matteCostById.has(b.id)) ?? seq[i + 3]!;
        }
        if (!victim) break;
        beats.splice(beats.indexOf(victim), 1);
        placed -= 1;
        if (matteCostById.has(victim.id)) {
          matteBeats -= 1;
          matteSec -= matteCostById.get(victim.id)!;
          matteCostById.delete(victim.id);
        }
        warnings.push('kinetic_led:variety:dropped');
      }
      warnings.push(`kinetic_led:matte:beats:${matteBeats}_of_${budget}`);
      warnings.push(`kinetic_led:matte:quota:${matteQuota}`);
      warnings.push(`kinetic_led:matte:seconds:${Math.round(matteSec * 10) / 10}_of_${matteCapSec}`);
    }
    gapSec = MIN_GAP_S;
    allowRepeat = false;
  }

  // --- kinetic type (<= 2, one emphatic phrase each, never over a number)
  if (KINETIC_TYPE_IDS.some(id => allowed.has(id))) {
    const picks: Array<{s: (typeof sentences)[number]; phrase: EmphaticPhrase}> = [];
    for (const s of sentences) {
      const phrase = emphaticPhraseOf(s);
      if (phrase && allowed.has(phrase.templateId)) picks.push({s, phrase});
    }
    // prefer cue-bearing punchlines, then earliest
    picks.sort((a, b) => Number(IMPACT.test(b.phrase.text)) - Number(IMPACT.test(a.phrase.text)) || a.s.start - b.s.start);
    for (const {s, phrase} of picks) {
      if (counts.type >= (input.kineticLed ? 1 : CRAFT_AMBIENT_CAPS.kineticType)) break;
      const first = s.words[phrase.startIdx]!;
      const last = s.words[phrase.endIdx]!;
      const hint = phrase.templateId === 'clip_36_type_line_mask' ? {lines: phrase.lines} : {text: phrase.text};
      if (place(phrase.templateId, phrase.intent, first.start, last.end, hint)) counts.type += 1;
    }
  }

  // --- mesh ground (ambient, <= 1, only on a reflective cue; overlay, never mutes captions)
  if (allowed.has('clip_40_mesh_gradient_ground')) {
    const cue = sentences.find(s => AMBIENT_CUE.test(s.text) && !/\d/.test(s.text));
    if (cue && counts.mesh < CRAFT_AMBIENT_CAPS.meshGround) {
      // ambient is not a full-screen graphic: it never spends the restraint budget
      if (place('clip_40_mesh_gradient_ground', 'ambient_ground', cue.words[0]!.start, cue.end)) counts.mesh += 1;
    }
  }

  beats.sort((a, b) => a.start - b.start);
  const captionMuteRanges = beats.filter(b => b.muteCaptions).map(b => ({start: b.start, end: b.end}));
  warnings.push(`craft_templates:beats:${beats.length}`);
  for (const b of beats) warnings.push(`craft_templates:${b.templateId}`);
  return {beats, captionMuteRanges, warnings};
}
