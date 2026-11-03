/**
 * Kinetic typography contracts (version "1"). DUPLICATED on the Remotion side (remotion/src/kinetic/spec.ts) for Lambda, like the blueprint zod.
 *
 *  KineticPlan  = what the AI (or the deterministic fallback) may say: words, roles, preset NAMES, layering / anchor / region INTENT. Strict: pixels, frame numbers, font sizes, unknown keys and unknown presets are rejected.
 *  RenderSpec   = what the deterministic solver emits: frame-exact keyframes the compositor only interpolates.
 *
 * NOTE: this is NOT the old `TextTreatment` of stages/textTreatment (curved / clip / mask / layered); that module is untouched.
 */
import {z} from 'zod';

export const PRESET_NAMES = [
  'stack.serifHero.behind',
  'stack.mixed.between',
  'plane3d.receding.swap',
  'hero.thinSerif.front',
  'fallback.boldCenter.front',
  'hero.gradientWord.behind',
  'stack.twoCluster.behind',
  'hero.perLetter.behind',
  'hero.goldGlow.behind',
  'hero.swapStreak',
  'caption.serif.lower',
  'hero.extruded3d.rise',
  'hero.extruded3d.worldAnchored',
  'hero.gradientWord.sequence',
  'hero.extrudedStack.front',
  'stack.condensedHero.behind',
  'hero.chromatic.mid',
  'stack.twoHero.depth',
  /** MOTION-PLAYBOOK: word-by-word type (style + roles + zones + E1..E6 / X1..X6). The default for new plans. */
  'type.words',
  /** MATCH CUT as a kinetic treatment: full-frame TypeTextMatchCut (remotion/src/motion/compositions/templates/TextMatchCut.tsx) mounted by the kinetic compositor. One keyword inside >= 5 spoken words; the solver derives phrase / before / after. */
  'type.matchCut',
] as const;
export const presetNameSchema = z.enum(PRESET_NAMES);
export type PresetName = z.infer<typeof presetNameSchema>;

export const FONT_KEYS = ['bebas', 'inter', 'spaceGrotesk', 'playfair', 'playfairItalic', 'poppins', 'shrikhand', 'anton', 'archivoBlack', 'pacifico'] as const;
export const fontKeySchema = z.enum(FONT_KEYS);
export type FontKey = z.infer<typeof fontKeySchema>;

/** `caption` is the legacy name of `running`; it is still accepted (the playbook solver treats it as running). */
export const LINE_ROLES = ['hero', 'support', 'connector', 'running', 'punch', 'caption'] as const;
export const lineRoleSchema = z.enum(LINE_ROLES);
export type LineRole = z.infer<typeof lineRoleSchema>;

export const layeringSchema = z.enum(['behind', 'front', 'auto']);
export const anchorSchema = z.enum(['screen', 'background', 'plane:floor', 'plane:wall', 'auto']);
export const regionHintSchema = z.enum(['upperLeft', 'upperRight', 'upperCenter', 'betweenSubjects', 'lowerCenter', 'besideLeft', 'besideRight', 'flank', 'running', 'upper', 'behindSignature', 'stackOverCutout', 'auto']);
export const STYLE_NAMES = ['cinematicClean', 'editorialLuxury', 'retroNeon'] as const;
export const styleSchema = z.enum(STYLE_NAMES);
export type StyleName = z.infer<typeof styleSchema>;
/** Exit library. OUT-* are what live plans emit; X1..X6 stay as aliases (old plans / fixtures). */
export const OUT_NAMES = ['OUT-1', 'OUT-2', 'OUT-3', 'OUT-4', 'OUT-5', 'OUT-6', 'OUT-7'] as const;
export const EXIT_NAMES = ['X1', 'X2', 'X3', 'X4', 'X5', 'X6', ...OUT_NAMES] as const;
export const exitSchema = z.enum(EXIT_NAMES);
export type ExitName = z.infer<typeof exitSchema>;
/** Entry library. IN-* are what live plans emit; E1..E6 stay as aliases. IN-11 (caption tick) is solver-only, used by the gap captions. */
export const IN_NAMES = ['IN-1', 'IN-2', 'IN-3', 'IN-4', 'IN-5', 'IN-6', 'IN-7', 'IN-8', 'IN-9', 'IN-10', 'IN-11'] as const;
export const ANIM_NAMES = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', ...IN_NAMES] as const;
export const animSchema = z.enum(ANIM_NAMES);
export type AnimName = z.infer<typeof animSchema>;
/** What the director may tag (IN-11 is reserved for the gap captions). */
export const enterSchema = z.enum(['IN-1', 'IN-2', 'IN-3', 'IN-4', 'IN-5', 'IN-6', 'IN-7', 'IN-8', 'IN-9', 'IN-10']);
export type EnterName = z.infer<typeof enterSchema>;

/** One font pairing per video, chosen by the director for THIS plate. street = heavy grotesk + condensed display caps; editorial = sans lead-in + serif-italic hero; neon = sans + one script hero. */
export const FONT_PAIRS = ['street', 'editorial', 'neon'] as const;
export const fontPairSchema = z.enum(FONT_PAIRS);
export type FontPair = z.infer<typeof fontPairSchema>;
/** Accent: a #rrggbb hex or a name from a small named set (NOT the storyboard sheet cycle). The solver may nudge brightness for contrast, never the hue. */
export const ACCENT_NAMES = ['gold', 'magenta', 'cyan', 'crimson', 'white', 'lime', 'orange', 'violet', 'ice'] as const;
export const accentSchema = z.union([z.enum(ACCENT_NAMES), z.string().regex(/^#[0-9a-fA-F]{6}$/)]);
export type Accent = z.infer<typeof accentSchema>;
/** How a lockup sits in space. flat = square to camera; recede = one-point wall; isometric = tilted block letters; trapezoid = baseline wider than the cap; slant = a slight skew. */
export const POSE_NAMES = ['flat', 'recede', 'isometric', 'trapezoid', 'slant'] as const;
export const poseSchema = z.enum(POSE_NAMES);
export type PoseName = z.infer<typeof poseSchema>;
/** stackOverCutout: ONE stack centred on the subject; line 1 sits in the open area just above the cutout (front), the rest step down over head / shoulders (behind the matte). */
export const zoneSchema = z.enum(['besideLeft', 'besideRight', 'flank', 'running', 'upper', 'behindSignature', 'stackOverCutout']);
export type ZoneName = z.infer<typeof zoneSchema>;
export type Layering = z.infer<typeof layeringSchema>;
export type AnchorKind = z.infer<typeof anchorSchema>;
export type RegionHint = z.infer<typeof regionHintSchema>;

const nonNegInt = z.number().int().nonnegative();

export const MATCH_CUT_VARIANT_NAMES = ['memo', 'editorial', 'newsprint'] as const;
export const matchCutVariantSchema = z.enum(MATCH_CUT_VARIANT_NAMES);
/** Plan side of a match cut (type.matchCut): the keyword (+ optional second spoken word) only. phrase / before / after are derived from the transcript words of wordRange by the solver, so nothing can be invented. */
export const matchCutIntentSchema = z.strictObject({
  keyword: z.string().min(1).max(14),
  swapKeyword: z.string().min(1).max(14).optional(),
  variant: matchCutVariantSchema.optional(),
});
export type MatchCutIntent = z.infer<typeof matchCutIntentSchema>;
/** Render side: exactly the props TypeTextMatchCut takes. */
export const matchCutPropsSchema = z.strictObject({
  keyword: z.string().min(1).max(14),
  swapKeyword: z.string().min(1).max(14).optional(),
  phrase: z.string().min(1),
  before: z.string().optional(),
  after: z.string().optional(),
  variant: matchCutVariantSchema,
});
export type MatchCutProps = z.infer<typeof matchCutPropsSchema>;

export const kineticLineSchema = z.strictObject({
  text: z.string().min(1).max(80),
  role: lineRoleSchema,
  swapSlot: z.strictObject({wordIdxSequence: z.array(nonNegInt).min(2).max(8)}).optional(),
  /** entry INTENT for this line (a lead-in may use IN-1 / IN-3 while the hero uses another) */
  enter: enterSchema.optional(),
});

export const textEventSchema = z.strictObject({
  id: z.string().min(1).max(64),
  shotId: z.string().min(1).max(64),
  wordRange: z.tuple([nonNegInt, nonNegInt]),
  lines: z.array(kineticLineSchema).min(1).max(8),
  preset: presetNameSchema,
  layering: layeringSchema,
  anchor: anchorSchema,
  regionHint: regionHintSchema,
  styleOverrides: z
    .strictObject({
      gradient: z.string().max(40).optional(),
      material: z.enum(['flat', 'glossy3d', 'glow']).optional(),
      font: fontKeySchema.optional(),
    })
    .optional(),
  persistAcrossCut: z.boolean().optional(),
  /** exit INTENT (the solver picks the frames); omitted = the solver decides from cuts / position in the plan */
  exit: exitSchema.optional(),
  /** entry INTENT of the hero / punch line (the solver picks the frames and refuses the same entry+exit pair twice in a row) */
  enter: enterSchema.optional(),
  /** accent of THIS lockup's hero, chosen for this plate (hex or a named colour); the solver only nudges brightness for contrast */
  accent: accentSchema.optional(),
  /** resting pose of the lockup (omit = the solver cycles these on front heroes in a production plan) */
  pose: poseSchema.optional(),
  /** title-moment INTENT: the rare full-width hero (cinematicClean only, at most one per 15 s; the solver may refuse) */
  title: z.boolean().optional(),
  needsCustomTreatment: z.strictObject({description: z.string().min(1).max(400)}).optional(),
  /** only with preset type.matchCut */
  matchCut: matchCutIntentSchema.optional(),
});
export type TextEvent = z.infer<typeof textEventSchema>;

export const kineticPlanSchema = z.strictObject({
  version: z.literal('1'),
  /** one typographic style per plan; a missing field parses as cinematicClean so old plans / fixtures stay valid */
  style: styleSchema.default('cinematicClean'),
  /** one font pairing for the whole video (absent = the style's default pairing) */
  fontPair: fontPairSchema.optional(),
  events: z.array(textEventSchema).max(64),
});
/** INPUT type: `style` is optional for callers (the parser defaults it). */
export type KineticPlan = z.input<typeof kineticPlanSchema>;
export const planStyle = (plan: KineticPlan): StyleName => plan.style ?? 'cinematicClean';

/** Plan parsing that never throws: either a valid plan or the reason (for the report). */
export function parseKineticPlan(raw: unknown): {ok: true; plan: KineticPlan} | {ok: false; reason: string} {
  const r = kineticPlanSchema.safeParse(raw);
  if (r.success) return {ok: true, plan: r.data};
  return {ok: false, reason: r.error.issues.slice(0, 3).map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')};
}

// ---------------------------------------------------------------------------------------------------------------- transcript / shots

export type KineticWord = {idx: number; text: string; startFrame: number; endFrame: number; emphasisScore: number};
export type KineticShot = {id: string; startFrame: number; endFrame: number; noMatte?: boolean};

// ---------------------------------------------------------------------------------------------------------------- brand

export const brandConfigSchema = z.strictObject({
  fonts: z
    .strictObject({hero: fontKeySchema, support: fontKeySchema, caption: fontKeySchema, serifItalic: fontKeySchema.optional()})
    .default({hero: 'bebas', support: 'inter', caption: 'playfair'}),
  palette: z
    .strictObject({
      ink: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      paper: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      accent2: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      gradients: z.record(z.string(), z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).min(2).max(4)).default({}),
    })
    .default({ink: '#111111', paper: '#FFFFFF', accent: '#FFD400', accent2: '#FF5A36', gradients: {}}),
});
export type BrandConfig = z.infer<typeof brandConfigSchema>;

// ---------------------------------------------------------------------------------------------------------------- RenderSpec

const num = z.number().finite();
export const keyframeSchema = z.strictObject({frame: nonNegInt, x: num, y: num, scale: num, opacity: num, rotateX: num, rotateY: num, blurPx: num, z: num});
export type Keyframe = z.infer<typeof keyframeSchema>;

/** Per-word motion sample: offsets relative to the rest pose (x,y px; scale multiplier; rotations deg; z px). Linear interpolation only; the solver samples the easing densely. */
export const wordKeyframeSchema = z.strictObject({
  frame: nonNegInt, x: num, y: num, scale: num, opacity: num, rotateX: num, rotateY: num, blurPx: num, z: num,
  trackingEm: num.default(0),
  /** 0..1 left-to-right mask wipe (E5); 1 = fully revealed */
  mask: num.default(1),
  /** glow bloom multiplier (E5: 2 -> 1) */
  glowK: num.default(1),
  /** opacity of the 2-frame ghost trail duplicate (E2) */
  ghost: num.default(0),
  /** horizontal stretch multiplier (IN-3 whip 1.6 -> 1, OUT-2 smear 1 -> 3) */
  scaleX: num.default(1),
  /** RGB-split offset in px (IN-9 glitch pop): two tinted ghost copies at +-split */
  split: num.default(0),
});
export type WordKeyframe = z.infer<typeof wordKeyframeSchema>;

export const fillSchema = z.strictObject({kind: z.enum(['solid', 'gradient', 'gold', 'chrome']), colors: z.array(z.string()).min(1).max(4), angleDeg: num.default(90)});
export const shadowSchema = z.strictObject({color: z.string(), blurPx: num, offsetY: num, strokeColor: z.string().optional(), strokePx: num.default(0), glowColor: z.string().optional(), glowPx: num.default(0)});

export const renderLineSchema = z.strictObject({
  text: z.string(),
  role: lineRoleSchema,
  font: fontKeySchema,
  fontPx: num,
  italic: z.boolean().default(false),
  weight: z.number().int().default(700),
  letterSpacingEm: num.default(0),
  uppercase: z.boolean().default(false),
  /** offset of the line box inside the block (px, block coordinates, origin = block top-left at scale 1) */
  dx: num,
  dy: num,
  w: num,
  h: num,
  fill: fillSchema,
  /** per-line frames (relative to the event inFrame) the word becomes visible; used by perLetter / sequence / swap */
  revealFrames: z.array(nonNegInt).default([]),
  swapWords: z.array(z.string()).default([]),
  swapFrames: z.array(nonNegInt).default([]),
  /** one fill per revealed word (hero.gradientWord.sequence: a unique gradient each) */
  wordFills: z.array(fillSchema).default([]),
  /** --- MOTION-PLAYBOOK (type.words): one RenderLine = one word ---------------------------------------------- */
  anim: animSchema.default('E1'),
  /** speech start of the word, frames relative to the event inFrame */
  startFrame: nonNegInt.default(0),
  /** first visible frame of the word, relative to inFrame; always 1..2 frames before startFrame */
  enterFrame: nonNegInt.default(0),
  color: z.string().default('#FFFFFF'),
  /** null = no glow */
  glow: z.strictObject({color: z.string(), radiusPx: num, opacity: num}).nullable().default(null),
  /** text opacity at rest (connectors 0.9) */
  textOpacity: num.default(1),
  /** parallax depth at rest (hero / punch +40, support 0, connector -20) */
  zPx: num.default(0),
  /** relative frame at which an early exit (X2 word swap) starts; null = the word lives until the block exit */
  exitFrame: nonNegInt.nullable().default(null),
  /** the word's own frame keyframes (ABSOLUTE composition frames, offsets relative to its rest pose) */
  wordKeyframes: z.array(wordKeyframeSchema).default([]),
  /** stackOverCutout: which side of the subject foreground THIS line draws on. Absent = the event layering. The compositor honors it per line. */
  layer: z.enum(['front', 'behind']).optional(),
});
export type RenderLine = z.infer<typeof renderLineSchema>;

export const safeProofSchema = z.strictObject({
  ok: z.boolean(),
  sampledKeyframes: nonNegInt,
  /** smallest distance (px) from any projected keyframe AABB edge to the safe rect edge; >= 0 means inside */
  minMarginPx: num,
});

export const renderEventSchema = z.strictObject({
  id: z.string(),
  shotId: z.string(),
  preset: presetNameSchema,
  /** preset actually rendered (differs from `preset` when a custom treatment fell back) */
  presetResolved: presetNameSchema,
  inFrame: nonNegInt,
  outFrame: nonNegInt,
  fps: num,
  layering: z.enum(['behind', 'front']),
  anchor: z.enum(['screen', 'background', 'plane:floor', 'plane:wall']),
  material: z.enum(['flat', 'glossy3d', 'glow']),
  perspectivePx: num,
  block: z.strictObject({w: num, h: num}),
  lines: z.array(renderLineSchema).min(1),
  keyframes: z.array(keyframeSchema).min(2),
  shadow: shadowSchema,
  depthBlurPx: num,
  tint: z.string().nullable(),
  occlusionFraction: z.strictObject({mean: num, max: num}),
  safeProof: safeProofSchema,
  /** resting spatial pose; absent = flat. The compositor skews `slant` and extrudes `isometric`; rotateX / rotateY carry the others. */
  pose: poseSchema.optional(),
  /** MOTION-PLAYBOOK fields (type.words); absent = legacy event */
  style: styleSchema.default('cinematicClean'),
  zone: zoneSchema.nullable().default(null),
  exit: exitSchema.default('X1'),
  hold: z.strictObject({push: z.tuple([num, num]), rotY: num, rotX: num, periodSec: num}).default({push: [1, 1.04], rotY: 3, rotX: 1.5, periodSec: 5}),
  /** compositor-primitive light leak (screen blend, full frame): opacity per frame starting at startFrame (absolute) */
  flash: z.strictObject({startFrame: nonNegInt, color: z.string(), opacities: z.array(num)}).nullable().default(null),
  wordRange: z.tuple([nonNegInt, nonNegInt]),
  persistAcrossCut: z.boolean().default(false),
  notes: z.array(z.string()).default([]),
  /** type.matchCut only: the props the compositor passes to TypeTextMatchCut */
  matchCut: matchCutPropsSchema.optional(),
});
export type RenderEvent = z.infer<typeof renderEventSchema>;

/** The normal single-word caption shown ONLY on frames where no kinetic lockup is active (IN-11 tick in, OUT-6 cut out). Words that belong to a kinetic event never appear here. */
export const gapCaptionSchema = z.strictObject({
  wordIdx: nonNegInt,
  text: z.string().min(1),
  inFrame: nonNegInt,
  outFrame: nonNegInt,
  /** centre of the text box (px) */
  cx: num,
  cy: num,
  w: num,
  h: num,
  fontPx: num,
  font: fontKeySchema,
  weight: z.number().int(),
  color: z.string(),
  strokeColor: z.string().nullable().default(null),
  anim: z.literal('IN-11').default('IN-11'),
  exit: z.literal('OUT-6').default('OUT-6'),
  /** scale / opacity samples (absolute frames), linear */
  keyframes: z.array(z.strictObject({frame: nonNegInt, scale: num, opacity: num})).min(1),
});
export type GapCaption = z.infer<typeof gapCaptionSchema>;

export const renderSpecSchema = z.strictObject({
  version: z.literal('1'),
  seed: z.number().int(),
  fps: num,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  durationInFrames: nonNegInt,
  safeRect: z.strictObject({left: num, right: num, top: num, bottom: num}),
  noMatte: z.boolean(),
  shots: z.array(z.strictObject({id: z.string(), startFrame: nonNegInt, endFrame: nonNegInt, noMatte: z.boolean()})),
  events: z.array(renderEventSchema),
  /** gap captions: single spoken words on the frames where no kinetic event is active */
  captions: z.array(gapCaptionSchema).default([]),
  /** the font pairing the plan chose (absent = style default) */
  fontPair: fontPairSchema.optional(),
  planSource: z.string(),
});
export type RenderSpec = z.infer<typeof renderSpecSchema>;
