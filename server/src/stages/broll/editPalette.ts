/** Server copy — mirror remotion/src/lib/editPalette.ts (parity pinned). */
/**
 * Shared EDIT PALETTE picker — content-aware accents/grounds for polish skills.
 * Reference skill colours stay PREFERRED defaults; they are not locks.
 *
 * Research notes (short-form / social video editing, 9:16):
 * Preferred accents (high phone contrast, one-signal discipline):
 *   lime/chartreuse — SaaS, product, edu explainers (Skill B reference)
 *   signal red — newsroom, finance, policy, serious docs (Skill D reference)
 *   amber/gold — warm night / lifestyle
 *   hot orange — urgency / energy
 *   white — mono emphasis on black (clean_mono)
 * Less preferred / avoid as default accents:
 *   muddy browns, low-sat pastels on busy footage, purple/magenta neon (AI cliché),
 *   multi-accent rainbow, karaoke neon cyan as the only highlighter
 * Grounds:
 *   paper white + soft gray dots — diagram/edu boards (Skill B C)
 *   near-black (#0A0A0A) — newsroom GFX (Skill D)
 *   soft gray card ground — photo cards
 */

export type EditPaletteId =
  | 'editorial_paper' // WP56 Color Director default for talking-head polish
  | 'edu_lime_paper' // Skill B preferred (proofs / forcePreferred); demoted as live default
  | 'newsroom_red_ink' // Skill D preferred
  | 'night_amber'
  | 'energy_orange'
  | 'clean_mono'
  | 'tech_cyan'; // rare; only when content is clearly tech/data and not neon-karaoke

export type EditGroundId = 'paper_dot' | 'ink_black' | 'soft_gray' | 'none';

export type EditPalette = {
  id: EditPaletteId;
  /** Highlighter / emphasis / pill / yuan-bar / ellipse. */
  accent: string;
  /** Full-bleed GFX / diagram ground. */
  ground: string;
  /** Dot colour when groundStyle is paper_dot. */
  groundDot: string;
  groundStyle: EditGroundId;
  text: string;
  /** Ink drawn on top of the accent bar (lime→near-black, red→white). */
  inkOnAccent: string;
  /** Why this palette won (warning / provenance). */
  reason: string;
  preferredFor: 'explainer' | 'newsroom_mg' | 'textual_mg' | 'faceless' | 'any';
};

export const EDIT_PALETTES: readonly EditPalette[] = [
  {
    id: 'editorial_paper',
    accent: '#3D4A5C',
    ground: '#FAFAF7',
    groundDot: '#D8D6CF',
    groundStyle: 'paper_dot',
    text: '#111111',
    inkOnAccent: '#FAFAF7',
    reason: 'WP56 Color Director: editorial paper + muted slate (video editing, not web neon)',
    preferredFor: 'any',
  },
  {
    id: 'edu_lime_paper',
    accent: '#BFFF00',
    ground: '#FFFFFF',
    groundDot: '#AEB4BD',
    groundStyle: 'paper_dot',
    text: '#FFFFFF',
    inkOnAccent: '#111111',
    reason: 'Skill B preferred: edu/SaaS explainer lime on paper board',
    preferredFor: 'explainer',
  },
  {
    id: 'newsroom_red_ink',
    accent: '#E00000',
    ground: '#0A0A0A',
    groundDot: '#2A2A2A',
    groundStyle: 'ink_black',
    text: '#FFFFFF',
    inkOnAccent: '#FFFFFF',
    reason: 'Skill D preferred: newsroom signal red on near-black',
    preferredFor: 'newsroom_mg',
  },
  {
    id: 'night_amber',
    accent: '#FFB020',
    ground: '#0B0A08',
    groundDot: '#3A3428',
    groundStyle: 'ink_black',
    text: '#FFF8EC',
    inkOnAccent: '#0A0805',
    reason: 'Warm night / lifestyle accent',
    preferredFor: 'any',
  },
  {
    id: 'energy_orange',
    accent: '#FF5A1F',
    ground: '#0A0A0A',
    groundDot: '#333',
    groundStyle: 'ink_black',
    text: '#FFFFFF',
    inkOnAccent: '#FFFFFF',
    reason: 'Urgency / energy accent',
    preferredFor: 'any',
  },
  {
    id: 'clean_mono',
    accent: '#FFFFFF',
    ground: '#000000',
    groundDot: '#333333',
    groundStyle: 'ink_black',
    text: '#FFFFFF',
    inkOnAccent: '#000000',
    reason: 'Mono emphasis; no chroma accent',
    preferredFor: 'any',
  },
  {
    id: 'tech_cyan',
    accent: '#00C2FF',
    ground: '#070B10',
    groundDot: '#1A2838',
    groundStyle: 'ink_black',
    text: '#FFFFFF',
    inkOnAccent: '#041018',
    reason: 'Tech/data when content clearly asks; not karaoke cyan',
    preferredFor: 'any',
  },
];

const byId = (id: EditPaletteId): EditPalette => EDIT_PALETTES.find(p => p.id === id)!;

const NEWS =
  /\b(bank|banks|yuan|dollar|reserve|imf|policy|controls|sanction|treasury|ministry|war|election|president|congress|regulation|capital|currency|geopolitics|newsroom|report)\b/i;
const TECH =
  /\b(ai|api|saas|startup|software|code|app|product|feature|stripe|plugin|developer|launch)\b/i;
const ENERGY = /\b(urgent|breaking|crisis|crash|collapse|now|warning|alert)\b/i;
const WARM = /\b(life|love|home|food|travel|story|night|warm|community)\b/i;
const MONEY = /\b(\$|percent|%|trillion|billion|million|revenue|gdp|market)\b/i;

export type EditPaletteSkill = 'explainer' | 'newsroom_mg' | 'textual_mg' | 'faceless' | 'default';

export type PickEditPaletteInput = {
  skill: EditPaletteSkill;
  /** Caption / VO words (text only is enough). */
  words?: ReadonlyArray<{text: string} | string>;
  /** Optional theme accent from brand / north-star (may reinforce, never force neon cyan alone). */
  themeAccent?: string | null;
  /** Force the skill's preferred palette (tests / proofs). */
  forcePreferred?: boolean;
};

function joinText(words: PickEditPaletteInput['words']): string {
  if (!words?.length) return '';
  return words.map(w => (typeof w === 'string' ? w : w.text)).join(' ');
}

function preferredId(skill: EditPaletteSkill): EditPaletteId {
  if (skill === 'newsroom_mg') return 'newsroom_red_ink';
  if (skill === 'explainer') return 'editorial_paper';
  if (skill === 'faceless') return 'clean_mono';
  return 'editorial_paper';
}

/**
 * Pick a palette. Skill preferred colour wins unless content clearly points elsewhere.
 * Never invents a new hex — always one of EDIT_PALETTES.
 */
export function pickEditPalette(input: PickEditPaletteInput): EditPalette {
  const preferred = byId(preferredId(input.skill));
  if (input.forcePreferred) return {...preferred, reason: `${preferred.reason} (forced preferred)`};

  const text = joinText(input.words);
  const theme = (input.themeAccent || '').toLowerCase();

  // Content overrides (strong signals only)
  if (input.skill === 'explainer' || input.skill === 'default' || input.skill === 'textual_mg') {
    if (NEWS.test(text) && MONEY.test(text)) {
      return {...byId('newsroom_red_ink'), reason: 'content: finance/policy/news cues overrode edu lime'};
    }
    if (NEWS.test(text) && !TECH.test(text)) {
      return {...byId('newsroom_red_ink'), reason: 'content: newsroom/policy cues overrode preferred'};
    }
    if (ENERGY.test(text) && !TECH.test(text)) {
      return {...byId('energy_orange'), reason: 'content: urgency cues'};
    }
    if (WARM.test(text) && !TECH.test(text) && !NEWS.test(text)) {
      return {...byId('night_amber'), reason: 'content: warm/lifestyle cues'};
    }
    if (TECH.test(text) && /data|chart|metric|dashboard/i.test(text) && !NEWS.test(text)) {
      // keep lime for SaaS explainers; cyan only if theme already leans cool blue
      if (theme.includes('00') && (theme.includes('c2') || theme.includes('d4') || theme.includes('blue'))) {
        return {...byId('tech_cyan'), reason: 'content: tech/data + cool theme accent'};
      }
    }
  }

  if (input.skill === 'newsroom_mg') {
    // Newsroom stays red unless the VO is clearly a product/SaaS pitch with no policy cues
    if (TECH.test(text) && !NEWS.test(text) && !MONEY.test(text)) {
      return {...byId('edu_lime_paper'), reason: 'content: product/SaaS cues overrode newsroom red'};
    }
    return preferred;
  }

  if (input.skill === 'faceless') {
    if (NEWS.test(text) || MONEY.test(text)) return {...byId('newsroom_red_ink'), reason: 'faceless + news/money → signal red'};
    if (TECH.test(text)) return {...byId('edu_lime_paper'), reason: 'faceless + tech → edu lime'};
    return preferred;
  }

  return preferred;
}

/** CSS for a paper/ink ground (Skill B layout C uses paper_dot; Skill D GFX uses ink_black). */
export function editGroundCss(
  width: number,
  palette: Pick<EditPalette, 'ground' | 'groundDot' | 'groundStyle'>,
  pitchFrac = 0.042,
  radiusFrac = 0.004,
): {backgroundColor: string; backgroundImage?: string; backgroundSize?: string} {
  if (palette.groundStyle !== 'paper_dot') {
    return {backgroundColor: palette.ground};
  }
  const pitch = Math.round(width * pitchFrac * 100) / 100;
  const radius = Math.round(width * radiusFrac * 100) / 100;
  return {
    backgroundColor: palette.ground,
    backgroundImage: `radial-gradient(circle at center, ${palette.groundDot} 0px, ${palette.groundDot} ${radius}px, rgba(0,0,0,0) ${radius + 0.9}px)`,
    backgroundSize: `${pitch}px ${pitch}px`,
  };
}
