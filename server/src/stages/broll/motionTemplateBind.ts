/**
 * WP48 / WP50 / WP51: ground a Layer-2 motion-template beat in THIS video's spoken words (and optional still URLs).
 * Proof comps keep ACME / Bacon Club / MORPH defaults for offline demos; live publish MUST call this and skip the beat when binding fails — never ship reference brand copy into an edit.
 */
import {HERO_DEFAULT_SUBJECT_BOX, heroSweepFeasible} from './heroSweep.ts';
import type {MotionTemplateId} from './motionTemplateCatalog.ts';
import {isGroundedNumber, isGroundedText} from './visualBackend/sceneSpec.ts';

export type MotionTemplateBindWord = {text: string; start: number; end: number};

export type MotionTemplateBindInput = {
  templateId: MotionTemplateId;
  words: readonly MotionTemplateBindWord[];
  beatStart: number;
  beatEnd: number;
  /** https stills already fetched for this edit (editorial / faceless / stock). First few are used. */
  imageUrls?: readonly string[];
  /** WP49: edit-palette colours (never toolkit demo hex). */
  accent?: string;
  ground?: string;
  ink?: string;
  /** WP54: the creator's logo (https). clip_39 is refused without it. */
  logoSrc?: string;
  /** WP54: https screenshots the creator PROVIDED (asset brief / uploads). Gate for clip_41 / clip_42; stock stills are not screenshots. */
  screenshotUrls?: readonly string[];
  /** WP54: prices the labeled asset brief supplies (grounds clip_43 when the transcript is silent on a figure). */
  assetBriefPrices?: readonly number[];
  /** WP54: planner-chosen payload (phrase / lines / prices / target) — re-verified here against the spoken words, never trusted. */
  hint?: Record<string, unknown>;
  /** WP55: person-only alpha video for this source (one segmentation pass per video, cached). Absent = clip_45 binds the no-occlusion fallback layout. */
  subjectMatte?: SubjectMatteInput;
  /** WP55: the creator's brand name (user-provided brand info; the only non-transcript text clip_52 may show). */
  brandName?: string;
  /** WP55: https stills the creator PROVIDED of their own posts / profile (gate for clip_51 cards). Never stock, never generated. */
  socialImageUrls?: readonly string[];
};

export type SubjectMatteInput = {
  /** https URL of the person-only alpha video: the template then draws its own foreground (standalone / proof mode). */
  src?: string;
  /** Production mode: the host composition draws the person foreground (cut-aware keyed video + the same keep segments as the footage), so no URL travels with the template. */
  hostComposited?: boolean;
  /** Subject bounding box (fractions of the frame) used for placement. */
  box?: {x: number; y: number; w: number; h: number};
};

/** Content fields merged into the library brief (beyond motionTemplateId / intent). */
export type MotionTemplateBoundContent = Record<string, unknown>;

const STOP = new Set(
  (
    'a an the and or but if then so to of in on at for from with without by as is are was were be been being it its this that these those i you he she we they me him her us them my your his her our their what which who whom how when where why not no yes just really very into over under again about also than too can could would should will shall may might must do does did done have has had having get got getting go going went come came coming make made making see saw seen say said saying know knew known think thought thinking'
  ).split(/\s+/),
);

/** Refuse copy that is clearly the offline proof shell (not everyday speech). */
const DEMO_FORBIDDEN = /\b(acme|bacon\s*club|ship\s*it|fw25|paris\s*[|/]\s*milan|buildmago|spatial\s+audio|hello\s+monday|hey,?\s+what'?s\s+up|30%\s+off)\b/i;

function cleanToken(raw: string): string {
  return raw.replace(/[^\p{L}\p{N}'’-]+/gu, '').trim();
}

function contentTokens(words: readonly MotionTemplateBindWord[]): string[] {
  const out: string[] = [];
  for (const word of words) {
    const token = cleanToken(word.text);
    if (!token || token.length < 2) continue;
    if (STOP.has(token.toLowerCase())) continue;
    if (/^\d+$/.test(token) && token.length > 4) continue;
    out.push(token);
  }
  return out;
}

function windowWords(words: readonly MotionTemplateBindWord[], start: number, end: number): MotionTemplateBindWord[] {
  const padStart = Math.max(0, start - 1.5);
  const padEnd = end + 3;
  const hit = words.filter(w => w.end > padStart && w.start < padEnd);
  return hit.length >= 2 ? hit : words.slice(0, Math.min(words.length, 24));
}

function uniqPreserve(items: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

function titleCase(token: string): string {
  if (token.length <= 3 && token === token.toUpperCase()) return token;
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

function brandWord(tokens: string[]): string | null {
  const preferred = tokens.find(t => t.length >= 3 && t.length <= 8 && /^[A-Za-z]/.test(t));
  if (!preferred) return null;
  const upper = preferred.toUpperCase();
  if (DEMO_FORBIDDEN.test(upper)) return null;
  return upper.slice(0, 8);
}

function phrase(tokens: string[], maxWords: number, maxChars: number): string | null {
  if (tokens.length === 0) return null;
  const parts: string[] = [];
  let chars = 0;
  for (const token of tokens) {
    if (parts.length >= maxWords) break;
    const next = titleCase(token);
    if (chars + next.length + (parts.length ? 1 : 0) > maxChars) break;
    parts.push(next);
    chars += next.length + (parts.length > 1 ? 1 : 0);
  }
  const out = parts.join(' ').trim();
  if (!out || DEMO_FORBIDDEN.test(out)) return null;
  return out;
}

function twoLines(tokens: string[], maxEach: number): [string, string] | null {
  if (tokens.length < 2) return null;
  const mid = Math.max(1, Math.ceil(tokens.length / 2));
  const a = phrase(tokens.slice(0, mid), 3, maxEach);
  const b = phrase(tokens.slice(mid), 3, maxEach);
  if (!a || !b) return null;
  return [a, b];
}

/** WP51: spoken phrases for the chat: split the window's words on pauses (> 0.35 s) or after 8 words; each phrase is the words AS SAID (never rewritten), 2+ words, <= 90 chars. */
function spokenPhrases(words: readonly MotionTemplateBindWord[], max: number): string[] {
  const phrases: string[] = [];
  let current: string[] = [];
  let last: MotionTemplateBindWord | null = null;
  const flush = () => {
    const joined = current.join(' ').trim();
    if (current.length >= 2 && joined.length <= 90 && !DEMO_FORBIDDEN.test(joined)) phrases.push(joined);
    current = [];
  };
  for (const word of words) {
    const clean = word.text.trim();
    if (!clean) continue;
    if (last && (word.start - last.end > 0.35 || current.length >= 8)) flush();
    current.push(clean);
    last = word;
  }
  flush();
  return phrases.slice(0, max);
}

/** WP51: a colour ramp of `count` hexes through the edit palette stops (accent -> ground -> ink); null when the palette has fewer than two distinct colours. */
function paletteRamp(stops: Array<string | undefined>, count: number): string[] | null {
  const unique = [...new Set(stops.filter((c): c is string => c !== undefined).map(c => c.toUpperCase()))];
  if (unique.length < 2) return null;
  const channel = (hex: string, k: number) => parseInt(hex.slice(1 + k * 2, 3 + k * 2), 16);
  return Array.from({length: count}, (_, i) => {
    const at = (i / Math.max(1, count - 1)) * (unique.length - 1);
    const lo = Math.min(unique.length - 2, Math.floor(at));
    const f = at - lo;
    const a = unique[lo]!;
    const b = unique[lo + 1]!;
    return `#${[0, 1, 2].map(k => Math.round(channel(a, k) + (channel(b, k) - channel(a, k)) * f).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  });
}

type SubjectBoxLike = {x: number; y: number; w: number; h: number};
function isUnitBox(value: unknown): value is SubjectBoxLike {
  if (typeof value !== 'object' || value === null) return false;
  const b = value as Record<string, unknown>;
  const unit = (n: unknown): n is number => typeof n === 'number' && n >= 0 && n <= 1;
  return unit(b.x) && unit(b.y) && unit(b.w) && unit(b.h) && (b.w as number) > 0.05 && (b.h as number) > 0.1;
}

/** Seconds (relative to the beat start) at which each phrase word is spoken, aligned in order against the spoken words; null when any word cannot be aligned (the comp then staggers evenly). */
export function alignWordStarts(phraseText: string, spoken: readonly MotionTemplateBindWord[], beatStart: number): number[] | null {
  const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, '');
  const want = phraseText.split(/\s+/).map(norm).filter(Boolean);
  const out: number[] = [];
  let at = 0;
  for (const w of want) {
    let found = -1;
    for (let i = at; i < spoken.length; i++) {
      if (norm(spoken[i]!.text) === w) {
        found = i;
        break;
      }
    }
    if (found < 0) return null;
    out.push(Math.max(0, Math.round((spoken[found]!.start - beatStart) * 1000) / 1000));
    at = found + 1;
  }
  return out;
}

function httpsOnly(urls: readonly string[] | undefined): string[] {
  return (urls ?? []).filter(url => /^https:\/\/\S+$/i.test(url.trim())).map(url => url.trim());
}

/**
 * Bind spoken copy (+ optional stills) for one template beat. Returns null when the video cannot ground the shell —
 * the publisher then skips the beat instead of drawing ACME / Bacon Club / placeholder demos.
 */
export function bindMotionTemplateContent(input: MotionTemplateBindInput): MotionTemplateBoundContent | null {
  const local = windowWords(input.words, input.beatStart, input.beatEnd);
  const tokens = contentTokens(local);
  const allTokens = contentTokens(input.words);
  const pool = tokens.length >= 2 ? tokens : allTokens;
  const noSpeechOk = input.templateId === 'clip_39_logo_reveal' || input.templateId === 'clip_52_type_logo_reveal' || input.templateId === 'clip_40_mesh_gradient_ground' || input.templateId === 'clip_41_product_device_frame' || input.templateId === 'clip_42_product_cursor_click' || input.templateId === 'clip_44_photo_ken_burns';
  if (pool.length === 0 && !noSpeechOk) return null;
  const images = httpsOnly(input.imageUrls);
  const hex = (value?: string) => (value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : undefined);
  const accent = hex(input.accent);
  const ground = hex(input.ground);
  const ink = hex(input.ink);
  /** WP49: every grounded beat carries the edit palette — toolkit shells must not keep demo colours. */
  const withPalette = (content: MotionTemplateBoundContent): MotionTemplateBoundContent => ({
    ...content,
    ...(accent ? {accent} : {}),
    ...(ground ? {ground} : {}),
    ...(ink ? {ink} : {}),
  });
  const withAccent = withPalette;

  switch (input.templateId) {
    case 'clip_01_grid_morph': {
      // Grammar-only silhouette is fine without a still; a real still is preferred when the edit already has one.
      return withAccent(images[0] ? {imageSrc: images[0], personalized: true} : {personalized: true});
    }
    case 'clip_02_slit_carousel': {
      return withAccent(images.length >= 2 ? {imageUrls: images.slice(0, 6), personalized: true} : {personalized: true});
    }
    case 'clip_03_bento_camera': {
      const labels = uniqPreserve(pool.map(titleCase), 6);
      if (labels.length < 3) return null;
      const cards = labels.slice(0, 6).map((label, index) => ({
        kind: index % 2 === 0 ? 'ui' : 'photo',
        label,
        ...(images[index] ? {src: images[index]} : {}),
      }));
      return withAccent({cards});
    }
    case 'clip_04_stacked_cards': {
      const labels = uniqPreserve(pool.map(titleCase), 4);
      if (labels.length < 2) return null;
      return withPalette({
        cards: labels.slice(0, 4).map((label, index) => ({
          label,
          ...(images[index] ? {src: images[index]} : {}),
        })),
      });
    }
    case 'clip_05_config_brand_loop': {
      const wordmark = brandWord(pool) ?? phrase(pool, 1, 14)?.toUpperCase().replace(/\s+/g, '').slice(0, 14);
      if (!wordmark || wordmark.length < 2) return null;
      return withAccent({
        wordmark,
        personalized: true,
        ...(images.length > 0 ? {imageUrls: images.slice(0, 5)} : {}),
      });
    }
    case 'clip_06_blur_word_carousel': {
      const words = uniqPreserve(pool.map(titleCase), 9);
      if (words.length < 3) return null;
      return withAccent({words});
    }
    case 'clip_07_ios_notification': {
      const title = brandWord(pool) ? titleCase(brandWord(pool)!) : phrase(pool.slice(0, 3), 3, 40);
      const body = phrase(pool.slice(1), 8, 100);
      if (!title || !body) return null;
      return withPalette({title, time: 'now', body, personalized: true});
    }
    case 'clip_08_nested_rect_title': {
      const lines = twoLines(pool.slice(0, 8), 40);
      if (!lines) return null;
      return withAccent({
        lines,
        personalized: true,
        ...(images[0] ? {imageSrc: images[0]} : {}),
      });
    }
    case 'clip_09_acme_fruit_swap': {
      const word = brandWord(pool);
      if (!word || word.length < 3) return null;
      return withPalette({word, personalized: true});
    }
    case 'clip_10_morph_stretch': {
      const text = brandWord(pool) ?? phrase(pool, 1, 12)?.toUpperCase().replace(/\s+/g, '').slice(0, 12);
      if (!text || text.length < 3) return null;
      return withAccent({text, personalized: true});
    }
    case 'clip_11_menu_slide': {
      const labels = uniqPreserve(pool.map(t => t.toUpperCase()), 8);
      if (labels.length < 4) return null;
      const slides: Array<{headline: [string, string]; photoSrc?: string}> = [];
      for (let i = 0; i + 1 < labels.length && slides.length < 4; i += 2) {
        const a = labels[i]!.slice(0, 14);
        const b = labels[i + 1]!.slice(0, 14);
        slides.push({headline: [a, b], ...(images[slides.length] ? {photoSrc: images[slides.length]} : {})});
      }
      if (slides.length < 2) return null;
      return withPalette({slides, personalized: true, hideFooter: true});
    }
    case 'clip_12_editorial_inset': {
      const brand = brandWord(pool);
      const lines = uniqPreserve(pool.map(titleCase), 4);
      if (!brand || lines.length < 2) return null;
      return withPalette({
        brand,
        lines: lines.slice(0, 4),
        personalized: true,
        hideMicro: true,
        ...(images[0] ? {imageSrc: images[0]} : {}),
      });
    }
    case 'clip_13_heritage_poster': {
      // C1: up to six short upper-case headline lines from the spoken words; the demo PARIS / ACME / PR23 micro never ships.
      const lines = uniqPreserve(pool.filter(token => token.length <= 14).map(token => token.toUpperCase()), 6);
      if (lines.length < 3) return null;
      const seed = brandWord(pool) ?? lines[0]!;
      return withPalette({
        lines,
        brandMark: `${seed.charAt(0).toUpperCase()}°`,
        personalized: true,
        hideMicro: true,
        ...(images[0] ? {imageSrc: images[0]} : {}),
      });
    }
    case 'clip_14_silk_legacy': {
      // C2: three upper-case lines (1-2 spoken words each); the in-image wordmark is a spoken brand word or absent (never ACME).
      const tokens = pool.filter(token => token.length <= 14);
      if (tokens.length < 3) return null;
      const per = Math.min(2, Math.ceil(tokens.length / 3));
      const lines = [0, 1, 2].map(i => phrase(tokens.slice(i * per, i * per + per), per, 20)?.toUpperCase() ?? null);
      if (!lines.every((line): line is string => line !== null)) return null;
      const wordmark = brandWord(pool);
      return withPalette({
        lines,
        personalized: true,
        hideMicro: true,
        ...(wordmark ? {wordmark} : {}),
        ...(images[0] ? {imageSrc: images[0]} : {}),
      });
    }
    case 'clip_15_glass_testimonial': {
      // C3: the spoken sentence is the quote (as said, never rewritten); a proper noun that is not the first word is the author; a brand word (if any) is the wordmark. Mango / Mara Ellis never ship.
      const spoken = local.map(word => word.text.trim()).filter(Boolean);
      const picked: string[] = [];
      let chars = 0;
      for (const word of spoken) {
        if (picked.length >= 16 || chars + word.length + 1 > 120) break;
        picked.push(word);
        chars += word.length + 1;
      }
      const quote = picked.join(' ').trim();
      if (picked.length < 4 || DEMO_FORBIDDEN.test(quote) || /mango/i.test(quote)) return null;
      const author = spoken.slice(1).map(cleanToken).find(token => token.length >= 3 && token.length <= 14 && /^\p{Lu}/u.test(token) && !STOP.has(token.toLowerCase()));
      const wordmark = brandWord(pool);
      return withPalette({
        quote,
        ...(author ? {author} : {}),
        ...(wordmark && wordmark.toLowerCase() !== author?.toLowerCase() ? {wordmark: titleCase(wordmark)} : {}),
        personalized: true,
        ...(images[0] ? {imageSrc: images[0]} : {}),
      });
    }
    case 'clip_16_portrait_push': {
      // C4 is photo-forward with no text: without two real stills there is nothing honest to show, so the beat is skipped.
      if (images.length < 2) return null;
      return withPalette({imageUrls: images.slice(0, 3), personalized: true});
    }
    case 'clip_17_photo_stack_collapse':
    case 'clip_19_two_up_stack': {
      // Part 4 stacks are photo-forward with no text: without two real stills there is nothing honest to show, so the beat is skipped.
      if (images.length < 2) return null;
      return withPalette({imageUrls: images.slice(0, 2), personalized: true});
    }
    case 'clip_18_photo_stack_reveal': {
      if (images.length < 2) return null;
      return withPalette({imageUrls: images.slice(0, 3), personalized: true});
    }
    case 'clip_20_never_done_slit': {
      // Four short spoken lines (one word each, two when the window is wordy); the demo "We are never done." / acme wordmark / mono caption never ship.
      const tokens = uniqPreserve(pool.filter(token => token.length <= 12), 8);
      if (tokens.length < 4) return null;
      const per = tokens.length >= 8 ? 2 : 1;
      const lines = [0, 1, 2, 3].map(i => phrase(tokens.slice(i * per, i * per + per), per, 14));
      if (!lines.every((line): line is string => line !== null)) return null;
      return withPalette({
        lines,
        personalized: true,
        hideMicro: true,
        ...(images[0] ? {imageSrc: images[0]} : {}),
      });
    }
    case 'clip_21_typewriter': {
      // Two or three spoken lines: a one-word title, then short phrases. Demo title/date/footer never ships; optional mark still is replaceable.
      const tokens = pool.filter(token => token.length <= 14);
      if (tokens.length < 2) return null;
      const title = phrase(tokens.slice(0, 1), 1, 14);
      const second = phrase(tokens.slice(1, 4), 3, 24);
      const third = tokens.length >= 5 ? phrase(tokens.slice(4, 6), 2, 24) : null;
      if (!title || !second) return null;
      const lines = third ? [title, second, third] : [title, second];
      if (/mango/i.test(lines.join(' ')) || /livestream\s+july\s+15/i.test(lines.join(' '))) return null;
      return withPalette({
        lines,
        personalized: true,
        hideFooter: true,
        ...(images[0] ? {markSrc: images[0]} : {}),
      });
    }
    case 'clip_22_chat_conversation': {
      // B1: >= 2 spoken phrases alternate left / right (the first is preexisting); a trailing indicator-only left bubble is the loop tail. The demo "Hey, what's up?" lines never ship.
      const phrases = spokenPhrases(local, 4);
      if (phrases.length < 2) return null;
      const messages: Array<{side: 'left' | 'right'; text: string; indicatorOnly?: boolean}> = phrases.map((text, i) => ({side: i % 2 === 0 ? 'left' : 'right', text}));
      if (messages[messages.length - 1]!.side === 'right') messages.push({side: 'left', text: '', indicatorOnly: true});
      return withPalette({messages, personalized: true});
    }
    case 'clip_23_sale_promo': {
      // B2: a short title card + two slide-up lines (+ CTA when a 3rd phrase exists) from the speech. The demo "Sale: 30% Off" / buildmago footer never ship; without a still the comp draws its flat stand-in plate.
      const tokens = pool.filter(token => token.length <= 14);
      if (tokens.length < 4) return null;
      const title = phrase(tokens.slice(0, 2), 2, 24);
      const line1 = phrase(tokens.slice(2, 4), 2, 24);
      const line2 = phrase(tokens.slice(4, 6).length ? tokens.slice(4, 6) : tokens.slice(1, 2), 2, 24);
      if (!title || !line1 || !line2) return null;
      const cta = tokens.length >= 8 ? phrase(tokens.slice(6, 8), 2, 24) : null;
      return withPalette({
        titleCardText: title,
        lines: [line1, line2],
        ...(cta ? {cta} : {}),
        personalized: true,
        hideFooter: true,
        ...(images[0] ? {imageSrc: images[0]} : {}),
      });
    }
    case 'clip_24_color_word_wheel': {
      // B3: >= 3 short spoken tokens are the wheel rows; background colours ramp through the edit palette (omitted => the comp's demo colours, a default only).
      const words = uniqPreserve(pool.filter(token => token.length <= 14).map(titleCase), 7);
      if (words.length < 3) return null;
      const colors = paletteRamp([accent, ground, ink], Math.min(4, words.length));
      return withPalette({words, ...(colors ? {colors} : {}), personalized: true});
    }
    case 'clip_25_tracking_collapse': {
      // B4: 2-4 short ALL-CAPS lines, one spoken word each. The demo HELLO / MONDAY copy never ships.
      const lines = uniqPreserve(pool.filter(token => token.length <= 12).map(token => token.toUpperCase()), 4);
      if (lines.length < 2 || DEMO_FORBIDDEN.test(lines.join(' '))) return null;
      return withPalette({lines, personalized: true});
    }
    case 'clip_26_spatial_blur_tilt': {
      // B5: two short lines from the speech. "Available in / Spatial Audio" never ships.
      const tokens = pool.filter(token => token.length <= 14);
      const small = phrase(tokens.slice(0, 2), 2, 24);
      const big = phrase(tokens.slice(2, 4).length ? tokens.slice(2, 4) : tokens.slice(1, 2), 2, 24);
      if (!small || !big) return null;
      return withPalette({lines: [small, big], personalized: true});
    }
    case 'clip_35_type_word_reveal':
    case 'clip_38_type_weight_morph': {
      const phraseText = typeof input.hint?.text === 'string' ? input.hint.text.trim() : '';
      const count = phraseText.split(/\s+/).filter(Boolean).length;
      const max = input.templateId === 'clip_35_type_word_reveal' ? 8 : 5;
      if (!phraseText || count < (input.templateId === 'clip_35_type_word_reveal' ? 2 : 1) || count > max || phraseText.length > 64) return null;
      if (!isGroundedText(phraseText, local.map(w => w.text).join(' ')) || DEMO_FORBIDDEN.test(phraseText)) return null;
      return withPalette({text: phraseText, personalized: true});
    }
    case 'clip_36_type_line_mask': {
      const lines = Array.isArray(input.hint?.lines) ? (input.hint!.lines as unknown[]).filter((line): line is string => typeof line === 'string' && line.trim().length > 0).map(line => line.trim()) : [];
      if (lines.length < 1 || lines.length > 3 || lines.some(line => line.length > 32)) return null;
      const spoken = local.map(w => w.text).join(' ');
      if (!isGroundedText(lines.join(' '), spoken) || DEMO_FORBIDDEN.test(lines.join(' '))) return null;
      return withPalette({lines, personalized: true});
    }
    case 'clip_37_type_char_stagger': {
      const phraseText = typeof input.hint?.text === 'string' ? input.hint.text.trim() : '';
      // WP54: char stagger is a very short-phrase move only (> 24 chars is refused, never clipped)
      if (!phraseText || Array.from(phraseText).length > 24) return null;
      if (!isGroundedText(phraseText, local.map(w => w.text).join(' ')) || DEMO_FORBIDDEN.test(phraseText)) return null;
      return withPalette({text: phraseText, personalized: true});
    }
    case 'clip_39_logo_reveal': {
      const [logo] = httpsOnly(input.logoSrc ? [input.logoSrc] : []);
      return logo ? withPalette({logoSrc: logo}) : null;
    }
    case 'clip_40_mesh_gradient_ground':
      return withPalette({strength: 0.45});
    case 'clip_41_product_device_frame': {
      const [shot] = httpsOnly(input.screenshotUrls);
      if (!shot) return null;
      return withPalette({imageSrc: shot, device: input.hint?.device === 'phone' ? 'phone' : 'browser'});
    }
    case 'clip_42_product_cursor_click': {
      const [shot] = httpsOnly(input.screenshotUrls);
      if (!shot) return null;
      const t = input.hint?.target as {x?: unknown; y?: unknown} | undefined;
      const unit = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v <= 1;
      return withPalette({imageSrc: shot, ...(t && unit(t.x) && unit(t.y) ? {target: {x: t.x, y: t.y}} : {})});
    }
    case 'clip_43_promo_price_drop': {
      // WP54: ONLY grounded prices. Both figures must be spoken in the transcript (or supplied by the labeled asset brief); an invented price refuses the beat.
      const was = Number(input.hint?.was);
      const now = Number(input.hint?.now);
      if (!Number.isFinite(was) || !Number.isFinite(now) || !(now > 0) || !(now < was)) return null;
      const spokenAll = input.words.map(w => w.text).join(' ');
      const brief = input.assetBriefPrices ?? [];
      const grounded = (n: number) => isGroundedNumber(n, spokenAll) || brief.includes(n);
      if (!grounded(was) || !grounded(now)) return null;
      const prefix = typeof input.hint?.prefix === 'string' && input.hint.prefix.length <= 3 ? input.hint.prefix : '';
      const label = typeof input.hint?.label === 'string' && input.hint.label.trim() && isGroundedText(input.hint.label, spokenAll) ? input.hint.label.trim() : '';
      return withPalette({was, now, ...(prefix ? {prefix} : {}), ...(label ? {label} : {}), personalized: true});
    }
    // ---- WP55 KINETIC_TYPE_STORYTELLING: every displayed string must be spoken in the beat window (or be creator-provided brand data). Anything else refuses the beat.
    case 'clip_45_type_environmental_hero':
    case 'clip_49_type_kinetic_word_pop':
    case 'clip_54_type_illustrated_emphasis': {
      const spoken = local.map(w => w.text).join(' ');
      const key = typeof input.hint?.text === 'string' ? input.hint.text.trim() : typeof input.hint?.word === 'string' ? input.hint.word.trim() : '';
      const keyWords = key.split(/\s+/).filter(Boolean);
      const lead = typeof input.hint?.lead === 'string' ? input.hint.lead.trim() : '';
      // WP56: hero / emphasis may use 1–5 spoken words by meaning; word-pop stays 1.
      const maxWords = input.templateId === 'clip_49_type_kinetic_word_pop' ? 1 : 5;
      if (keyWords.length < 1 || keyWords.length > maxWords || Array.from(key).length > 24 || !isGroundedText(key, spoken) || DEMO_FORBIDDEN.test(key)) return null;
      if (lead && (Array.from(lead).length > 24 || !isGroundedText(lead, spoken))) return null;
      const box = input.subjectMatte?.box ?? (isUnitBox(input.hint?.subjectBox) ? (input.hint!.subjectBox as SubjectBoxLike) : undefined);
      if (input.templateId === 'clip_45_type_environmental_hero') {
        const matte = input.subjectMatte?.src && /^https:\/\/\S+$/i.test(input.subjectMatte.src.trim()) ? input.subjectMatte.src.trim() : undefined;
        // Phase D: the kinetic-led planner demotes a hero beyond the matted-footage budget to the headroom layout (`hint.occlusion === 'none'`)
        const demoted = input.hint?.occlusion === 'none';
        const host = input.subjectMatte?.hostComposited === true && !demoted;
        // real occlusion only with a real matte (own https alpha video, or the host's keyed cutout); otherwise the comp keeps the type in the headroom above the subject (no pretend occlusion)
        const wantsMatte = (matte && !demoted) || host;
        // READABILITY GATE: text-behind is a big word that SCROLLS behind the person so every glyph is clear of the head for a stretch (heroSweep.ts); it is refused only when there is no usable gutter at all
        // (subject fills the frame / both gutters tiny). A long word is not a reason to demote. Whatever a stale hint says, an unusable subject gets the headroom layout here.
        const sweepOk = heroSweepFeasible(box ?? HERO_DEFAULT_SUBJECT_BOX, key);
        const behind = wantsMatte && sweepOk;
        return withPalette({text: key, ...(lead ? {lead} : {}), occlusion: behind ? 'matte' : 'none', ...(behind ? {reveal: 'sweep'} : {}), ...(behind && matte ? {subjectSrc: matte, subjectStartSec: input.beatStart} : {}), ...(behind && !matte && host ? {hostComposited: true} : {}), ...(box ? {subjectBox: box} : {}), ...(typeof input.hint?.tone === 'string' ? {tone: input.hint.tone} : {}), personalized: true});
      }
      if (input.templateId === 'clip_49_type_kinetic_word_pop') {
        // Small type is NEVER behind the presenter (a word tucked under a shoulder is unreadable): no occlusion / hostComposited, whatever a stale hint or matte says. It pops beside the presenter or in the headroom.
        return withPalette({word: key, anchor: input.hint?.anchor === 'right' ? 'right' : input.hint?.anchor === 'top' ? 'top' : 'left', ...(box ? {subjectBox: box} : {}), personalized: true});
      }
      const marks = ['underline', 'circle', 'arrow', 'burst', 'bracket'];
      return withPalette({word: key, ...(lead ? {lead} : {}), mark: marks.includes(String(input.hint?.mark)) ? String(input.hint?.mark) : 'underline', ...(box ? {subjectBox: box} : {}), personalized: true});
    }
    case 'clip_55_type_text_match_cut': {
      // Text match cut: the keyword + every context word must be a contiguous slice of what the speaker said around the beat. Its palette is its own style bible (highlight colour per grammar), so the edit palette is NOT merged.
      const spoken = local.map(w => w.text).join(' ');
      const kwOf = (raw: unknown) => (typeof raw === 'string' ? raw.trim() : '');
      const keyword = kwOf(input.hint?.keyword);
      const swapKeyword = kwOf(input.hint?.swapKeyword);
      const phrase = kwOf(input.hint?.phrase);
      const oneToTwo = (v: string) => v.split(/\s+/).filter(Boolean).length <= 2 && Array.from(v).length <= 12;
      if (!keyword || !oneToTwo(keyword) || !isGroundedText(keyword, spoken) || DEMO_FORBIDDEN.test(keyword)) return null;
      if (swapKeyword && (!oneToTwo(swapKeyword) || !isGroundedText(swapKeyword, spoken))) return null;
      if (!phrase || phrase.split(/\s+/).filter(Boolean).length < 5 || Array.from(phrase).length > 160 || !isGroundedText(phrase, spoken) || DEMO_FORBIDDEN.test(phrase)) return null;
      const sliceOk = (v: string) => !v || (Array.from(v).length <= 80 && isGroundedText(v, spoken));
      const before = kwOf(input.hint?.before);
      const after = kwOf(input.hint?.after);
      if (!sliceOk(before) || !sliceOk(after)) return null;
      const variant = ['memo', 'editorial', 'newsprint'].includes(String(input.hint?.variant)) ? String(input.hint?.variant) : 'memo';
      return {keyword, ...(swapKeyword ? {swapKeyword} : {}), phrase, ...(before ? {before} : {}), ...(after ? {after} : {}), variant, personalized: true};
    }
    case 'clip_46_type_impact_number': {
      const spoken = local.map(w => w.text).join(' ');
      const raw = Array.isArray(input.hint?.values) ? (input.hint!.values as unknown[]) : [];
      const values = raw.filter((v): v is number | string => typeof v === 'number' || typeof v === 'string').map(v => String(v));
      if (values.length < 1 || values.length > 3) return null;
      // every figure shown must be a number the speaker actually said
      if (!values.every(v => /^\d[\d,]*(?:\.\d+)?$/.test(v) && isGroundedNumber(Number(v.replace(/,/g, '')), spoken))) return null;
      const prefix = typeof input.hint?.prefix === 'string' && input.hint.prefix.length <= 2 ? input.hint.prefix : '';
      const suffix = typeof input.hint?.suffix === 'string' && input.hint.suffix.length <= 3 ? input.hint.suffix : '';
      const label = typeof input.hint?.label === 'string' ? input.hint.label.trim() : '';
      if (label && (Array.from(label).length > 24 || !isGroundedText(label, spoken))) return null;
      const countTo = values.length === 1 && input.hint?.countUp === true ? Number(values[0]!.replace(/,/g, '')) : undefined;
      return withPalette({values, ...(prefix ? {prefix} : {}), ...(suffix ? {suffix} : {}), ...(label ? {label} : {}), labelPosition: input.hint?.labelPosition === 'side' ? 'side' : 'below', ...(countTo !== undefined && Number.isFinite(countTo) ? {countTo} : {}), personalized: true});
    }
    case 'clip_47_type_staggered_phrase': {
      const spoken = local.map(w => w.text).join(' ');
      const phraseText = typeof input.hint?.text === 'string' ? input.hint.text.trim() : '';
      const count = phraseText.split(/\s+/).filter(Boolean).length;
      if (count < 2 || count > 8 || phraseText.length > 64 || !isGroundedText(phraseText, spoken) || DEMO_FORBIDDEN.test(phraseText)) return null;
      const wordStarts = alignWordStarts(phraseText, local, input.beatStart);
      const emph = typeof input.hint?.emphasisIndex === 'number' && input.hint.emphasisIndex >= 0 && input.hint.emphasisIndex < count ? input.hint.emphasisIndex : undefined;
      return withPalette({text: phraseText, ...(wordStarts ? {wordStarts} : {}), ...(emph !== undefined ? {emphasisIndex: emph} : {}), personalized: true});
    }
    case 'clip_48_type_split_color_headline':
    case 'clip_50_type_stacked_statement':
    case 'clip_53_type_kinetic_cta': {
      const spoken = local.map(w => w.text).join(' ');
      const key = input.templateId === 'clip_50_type_stacked_statement' ? 'lines' : input.templateId === 'clip_53_type_kinetic_cta' ? 'parts' : 'groups';
      const rows = Array.isArray(input.hint?.[key]) ? (input.hint![key] as unknown[]) : [];
      const clean: Array<Record<string, unknown>> = rows
        .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null && typeof (row as Record<string, unknown>).text === 'string')
        .map(row => ({...row, text: String(row.text).trim()}))
        .filter(row => row.text.length > 0);
      const max = input.templateId === 'clip_50_type_stacked_statement' ? 4 : 3;
      if (clean.length < 2 || clean.length > max || clean.some(row => Array.from(row.text as string).length > 24)) return null;
      const joined = clean.map(row => row.text).join(' ');
      if (!isGroundedText(joined, spoken) || DEMO_FORBIDDEN.test(joined)) return null;
      const tones = ['accent', 'accent2', 'ink'];
      const sizes = ['sm', 'md', 'lg'];
      const roles = ['lead', 'key', 'support'];
      const shaped: Array<Record<string, unknown>> = clean.map(row => ({
        text: row.text as string,
        ...(key === 'lines' ? (roles.includes(String(row.role)) ? {role: String(row.role)} : {role: 'support'}) : {...(sizes.includes(String(row.size)) ? {size: String(row.size)} : {}), ...(tones.includes(String(row.tone)) ? {tone: String(row.tone)} : {})}),
      }));
      // a stack / headline needs exactly one dominant line, otherwise there is no hierarchy to speak of
      if (key === 'lines' && shaped.filter(row => (row as Record<string, unknown>).role === 'key').length !== 1) return null;
      if (key !== 'lines' && shaped.filter(row => (row as Record<string, unknown>).size === 'lg').length !== 1) return null;
      return withPalette({[key]: shaped, personalized: true});
    }
    case 'clip_51_type_floating_social_proof': {
      const spoken = local.map(w => w.text).join(' ');
      // Social proof is shown only from assets the creator provided. No stills and no spoken figure = no beat: engagement is never invented.
      const stills = httpsOnly(input.socialImageUrls).slice(0, 2);
      const figure = typeof input.hint?.figure === 'string' ? input.hint.figure.trim() : '';
      const figNum = Number(figure.replace(/[^\d.]/g, ''));
      const figureOk = figure.length > 0 && figure.length <= 10 && Number.isFinite(figNum) && figNum > 0 && isGroundedNumber(figNum, spoken);
      if (stills.length === 0 && !figureOk) return null;
      const iconNames = ['heart', 'comment', 'share', 'bookmark'];
      const icons = (Array.isArray(input.hint?.icons) ? (input.hint!.icons as unknown[]) : []).filter((i): i is string => typeof i === 'string' && iconNames.includes(i)).slice(0, 3);
      const label = typeof input.hint?.figureLabel === 'string' ? input.hint.figureLabel.trim() : '';
      return withPalette({icons: icons.length > 0 ? icons : ['heart'], ...(stills.length > 0 ? {imageSrcs: stills} : {}), ...(figureOk ? {figure} : {}), ...(figureOk && label && isGroundedText(label, spoken) ? {figureLabel: label} : {})});
    }
    case 'clip_52_type_logo_reveal': {
      const [logo] = httpsOnly(input.logoSrc ? [input.logoSrc] : []);
      const brand = (input.brandName ?? '').trim();
      if (!logo && !brand) return null;
      const spoken = local.map(w => w.text).join(' ');
      const subtitle = typeof input.hint?.subtitle === 'string' ? input.hint.subtitle.trim() : '';
      return withPalette({...(logo ? {logoSrc: logo} : {}), ...(brand ? {title: brand.slice(0, 28)} : {}), ...(subtitle && Array.from(subtitle).length <= 28 && isGroundedText(subtitle, spoken) ? {subtitle} : {})});
    }
    case 'clip_44_photo_ken_burns': {
      const [still] = httpsOnly(input.screenshotUrls && input.screenshotUrls.length > 0 ? input.screenshotUrls : input.imageUrls);
      return still ? withPalette({imageSrc: still}) : null;
    }
    default:
      return null;
  }
}
