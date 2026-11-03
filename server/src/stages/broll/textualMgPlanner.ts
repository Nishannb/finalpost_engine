/**
 * Skill C — sparse textual MG plate planner (Jitter-class). PURE.
 * Grammar: remotion/out/phase36-readiness/textual-mg-grammar.yaml
 * Does not place graphics itself; analyze / motionDirector publish when POLISH_TEXTUAL_MG=1.
 */
import {
  TEXTUAL_MG_CATALOG,
  defaultRecipeFor,
  familyForTrigger,
  type TextualMgFamily,
  type TextualMgTrigger,
} from './textualMgCatalog.ts';

export type TextualMgWord = {text: string; start: number; end: number};

export type TextualMgPlatePlan = {
  id: string;
  start: number;
  end: number;
  family: TextualMgFamily;
  recipeId: string;
  text: string;
  trigger: TextualMgTrigger;
  /** Mute Skill A/B captions while this plate owns the words. */
  muteCaptions: boolean;
  counter?: {from?: number; to: number; prefix?: string; suffix?: string; decimals?: number};
};

export type TextualMgPlan = {
  plates: TextualMgPlatePlan[];
  captionMuteRanges: Array<{start: number; end: number}>;
  warnings: string[];
};

const CTA = /\b(follow|subscribe|link|comment|share|download|sign\s*up|join)\b/i;
const STAT =
  /(?:\$?\d[\d,]*(?:\.\d+)?\s*(?:%|k|m|b|million|billion|trillion)?|\d+\s*(?:percent|users|people|customers)|(?:\b(?:one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand)\b\s+)?\b(?:million|billion|trillion)\b)/i;
const PIVOT = /\b(but|however|then|suddenly|instead|the problem|here'?s why|the trick)\b/i;

const HOLD_SEC = {hook_title: 1.4, spoken_stat: 1.6, chapter_pivot: 1.2, cta_keyword: 1.5, product_lockup: 1.4} as const;

/** Max plates for a clip: ~1 per 8s, hard cap 5. */
export function maxPlatesForDuration(durationSec: number): number {
  return Math.max(1, Math.min(5, Math.floor(durationSec / 8) + 1));
}

function joinWindow(words: readonly TextualMgWord[], from: number, to: number, maxWords: number): string {
  return words
    .slice(from, to)
    .map(w => w.text)
    .join(' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join(' ');
}

const WORD_NUM: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function parseStat(raw: string): TextualMgPlatePlan['counter'] | undefined {
  const money = raw.match(/\$([\d,]+(?:\.\d+)?)\s*(k|m|b|million|billion|trillion)?/i);
  if (money) {
    let to = Number(money[1]!.replace(/,/g, ''));
    const unit = (money[2] || '').toLowerCase();
    if (unit === 'k') to *= 1e3;
    if (unit === 'm' || unit === 'million') to *= 1e6;
    if (unit === 'b' || unit === 'billion') to *= 1e9;
    if (unit === 'trillion') to *= 1e12;
    return {from: 0, to, prefix: '$', decimals: to % 1 === 0 ? 0 : 1};
  }
  const pct = raw.match(/([\d,]+(?:\.\d+)?)\s*(%|percent)/i);
  if (pct) return {from: 0, to: Number(pct[1]!.replace(/,/g, '')), suffix: '%', decimals: pct[1]!.includes('.') ? 1 : 0};
  const wordScale = raw.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b\s+(million|billion|trillion)\b/i);
  if (wordScale) {
    const n = WORD_NUM[wordScale[1]!.toLowerCase()] ?? 1;
    const scale = wordScale[2]!.toLowerCase() === 'trillion' ? 1e12 : wordScale[2]!.toLowerCase() === 'billion' ? 1e9 : 1e6;
    return {from: 0, to: n * scale, decimals: 0};
  }
  const num = raw.match(/([\d,]+(?:\.\d+)?)/);
  if (num) return {from: 0, to: Number(num[1]!.replace(/,/g, '')), decimals: 0};
  return undefined;
}

type Candidate = {trigger: TextualMgTrigger; at: number; from: number; to: number; text: string};

function candidates(words: readonly TextualMgWord[], durationSec: number): Candidate[] {
  const out: Candidate[] = [];
  if (words.length === 0) return out;
  // Hook: first 1–6 content words in the opening 3s
  const hookEnd = words.findIndex(w => w.start > 3);
  const hookTo = hookEnd === -1 ? Math.min(6, words.length) : Math.min(6, hookEnd);
  if (hookTo > 0) {
    out.push({
      trigger: 'hook_title',
      at: words[0]!.start,
      from: 0,
      to: hookTo,
      text: joinWindow(words, 0, hookTo, 6),
    });
  }
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const window = joinWindow(words, i, Math.min(words.length, i + 4), 4);
    if (STAT.test(window) || STAT.test(w.text)) {
      out.push({trigger: 'spoken_stat', at: w.start, from: i, to: Math.min(words.length, i + 4), text: window});
    }
    if (PIVOT.test(w.text) && i + 1 < words.length) {
      out.push({
        trigger: 'chapter_pivot',
        at: w.start,
        from: i,
        to: Math.min(words.length, i + 5),
        text: joinWindow(words, i, Math.min(words.length, i + 5), 6),
      });
    }
    if (CTA.test(w.text)) {
      out.push({
        trigger: 'cta_keyword',
        at: w.start,
        from: i,
        to: Math.min(words.length, i + 3),
        text: joinWindow(words, i, Math.min(words.length, i + 3), 4),
      });
    }
  }
  // Drop candidates that start after the clip
  return out.filter(c => c.at >= 0 && c.at < durationSec - 0.4 && c.text.length > 0);
}

/**
 * Plan sparse Skill C plates. Deterministic. Never wall-to-wall.
 */
export function planTextualMgPlates(input: {
  durationSec: number;
  words: readonly TextualMgWord[];
  /** Hard cap override (tests). */
  maxPlates?: number;
  /** Output-time spans a plate may not overlap (a hook title, a full-frame card, ...): a candidate that would overlap one is skipped, never shifted (its words were spoken at `at`). */
  blockedRanges?: ReadonlyArray<{start: number; end: number}>;
}): TextualMgPlan {
  const warnings: string[] = [];
  const durationSec = Math.max(0, input.durationSec);
  if (durationSec < 2 || input.words.length === 0) {
    warnings.push('polish_textual_mg:skipped:short_or_empty');
    return {plates: [], captionMuteRanges: [], warnings};
  }
  const cap = input.maxPlates ?? maxPlatesForDuration(durationSec);
  const ranked = candidates(input.words, durationSec);
  // Prefer hook, then stats, then pivots, then CTA; de-dupe by ~2s proximity
  const order: TextualMgTrigger[] = ['hook_title', 'spoken_stat', 'chapter_pivot', 'cta_keyword', 'product_lockup'];
  ranked.sort((a, b) => order.indexOf(a.trigger) - order.indexOf(b.trigger) || a.at - b.at);

  const plates: TextualMgPlatePlan[] = [];
  const blocked = input.blockedRanges ?? [];
  let skippedBlocked = 0;
  for (const c of ranked) {
    if (plates.length >= cap) break;
    const family = familyForTrigger(c.trigger);
    // Same family within 2.2s = skip; different family may stack after the prior hold (e.g. hook then counter).
    if (plates.some(p => p.family === family && Math.abs(p.start - c.at) < 2.2)) continue;
    const hold = HOLD_SEC[c.trigger];
    let start = Math.max(0, c.at);
    const prior = plates.filter(p => p.end > start - 0.05).sort((a, b) => b.end - a.end)[0];
    if (prior) start = Math.max(start, prior.end + 0.15);
    const end = Math.min(durationSec, start + hold);
    if (end - start < 0.7) continue;
    if (blocked.some(range => range.end > start + 0.05 && range.start < end - 0.05)) {
      skippedBlocked += 1;
      continue;
    }
    const counter = family === 'counter_metric' ? parseStat(c.text) : undefined;
    plates.push({
      id: `tm_${plates.length + 1}_${family}`,
      start,
      end,
      family,
      recipeId: defaultRecipeFor(family),
      text: c.text.slice(0, 80),
      trigger: c.trigger,
      muteCaptions: true,
      ...(counter ? {counter} : {}),
    });
  }

  plates.sort((a, b) => a.start - b.start);
  const captionMuteRanges = plates.filter(p => p.muteCaptions).map(p => ({start: p.start, end: p.end}));
  warnings.push(`polish_textual_mg:plates:${plates.length}`);
  if (skippedBlocked > 0) warnings.push(`polish_textual_mg:skipped_blocked:${skippedBlocked}`);
  if (plates.length === 0) warnings.push('polish_textual_mg:no_triggers');
  return {plates, captionMuteRanges, warnings};
}
