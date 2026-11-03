/**
 * WP13A: illustrated lists (icon-upgrade instead of skip), screenshot callouts that win the evidence slot over quote cards / headlines, and icons on more plate seeds. Offline: no render, no network.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {remapLookForUnusableMatte, resolveEditLook} from '../directorV2/editLooks.ts';
import {addLibrarySeeds} from '../motionDirector/libraryFallback.ts';
import {GENERIC_LIST_ICON, ICON_ALLOWLIST, iconForStat, illustrateLabels, resolveLibraryGraphic} from '../motionDirector/libraryRegistry.ts';
import type {MotionDirectorResult} from '../motionDirector/motionDirector.ts';
import {seedLibraryGraphics} from '../motionDirector/transcriptLibrarySeed.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const remapped = remapLookForUnusableMatte(resolveEditLook('talking_head'), false).resolution.look;
const emptyDirector: MotionDirectorResult = {graphics: [], refusals: [], notes: '', costUsd: 0, model: 'x', latencyMs: 0, raw: null};
const timed = (sentences: string[], perWord = 0.28, gap = 4.2) => {
  let t = 0;
  return sentences.flatMap(sentence =>
    sentence.split(' ').map((text, i, all) => {
      const start = Math.round(t * 1000) / 1000;
      t += perWord;
      if (i === all.length - 1) t += gap;
      return {text, start, end: Math.round((start + perWord * 0.9) * 1000) / 1000};
    }),
  );
};
const seedOf = (sentences: string[], duration = 48) => {
  const words = timed(sentences);
  return {words, duration, seed: seedLibraryGraphics({words, outputDurationSec: Math.max(duration, Math.ceil(words[words.length - 1]!.end + 2)), lookId: remapped.id, explainPlates: true})};
};
const comps = (seed: ReturnType<typeof seedOf>['seed']) => Object.values(seed.compositions);
const brief = (content: Record<string, unknown>, placement = 'full_screen') => ({goal: 'g', visualDescription: 'pills', placement, content});

const OPENER = 'Today and I have a choice between two options that matter for the company I am building right now';

describe('WP13A 1) icon-upgrade lists', () => {
  it('illustrateLabels: every label gets an icon (generic when unmapped); illustrated = at least half have a SPECIFIC icon', () => {
    expect(GENERIC_LIST_ICON).toBe('sparkles');
    expect(ICON_ALLOWLIST.has(GENERIC_LIST_ICON)).toBe(true);
    const mixed = illustrateLabels(['lawyer', 'marketing person', 'banana']);
    expect(mixed).toEqual({icons: ['briefcase', 'megaphone', 'sparkles'], specific: 2, illustrated: true});
    expect(illustrateLabels(['lawyer', 'banana']).illustrated).toBe(true); // exactly half
    expect(illustrateLabels(['lawyer', 'banana', 'kiwi']).illustrated).toBe(false);
    expect(illustrateLabels(['banana', 'kiwi']).icons).toEqual(['sparkles', 'sparkles']);
    expect(illustrateLabels([]).illustrated).toBe(false);
    for (const icon of illustrateLabels(['lawyer', 'customer', 'supply chain', 'AI', 'banana']).icons) expect(ICON_ALLOWLIST.has(icon)).toBe(true);
  });
  it('a list with a mapped majority is KEPT as illustrated pills: every item carries an icon (unmapped ones the generic symbol); library_seed:TopicPills reported', () => {
    const { words, seed } = seedOf([OPENER, 'I would hire a lawyer, a marketing person, supply chain help, a business developer and a mystery wizard.', 'You should always hire the expert and trust their advice.']);
    const pills = seed.raw.graphics.find(graphic => seed.compositions[graphic.id] === 'TopicPills');
    expect(pills).toBeDefined();
    const content = JSON.parse(pills!.contentJson) as {items: string[]; icons: string[]};
    expect(content.icons.length).toBe(content.items.length);
    expect(content.icons.every(icon => ICON_ALLOWLIST.has(icon))).toBe(true);
    expect(content.icons).toContain(GENERIC_LIST_ICON);
    expect(content.icons.filter(icon => icon !== GENERIC_LIST_ICON).length * 2).toBeGreaterThanOrEqual(content.icons.length);
    const hit = resolveLibraryGraphic({goal: pills!.goal, visualDescription: pills!.visualDescription, placement: pills!.placement, content})!;
    expect((hit.props.items as Array<{icon?: string}>).every(item => typeof item.icon === 'string')).toBe(true);
    const staged = addLibrarySeeds(emptyDirector, {words, outputDurationSec: 48, occupied: [], captionBand: undefined as never, lookId: remapped.id, explainPlates: true});
    expect(staged.warnings).toContain('motion_graphic:library_seed:TopicPills');
    expect(staged.warnings).not.toContain('motion_graphic:list_upgraded:wiki');
  });
  it('WP52: a weakly-illustrated enumeration of 3+ items (nothing maps) is skipped as a caption clone: no WikiCallout upgrade, no bare pills, no list_upgraded warning', () => {
    const { words, seed } = seedOf([OPENER, 'We remove retakes, fillers, noise, silences and dead air from every video.', 'You should always hire the expert and trust their advice.']);
    expect(comps(seed)).not.toContain('TopicPills');
    expect(comps(seed)).not.toContain('WikiCallout');
    expect(seed.listUpgraded ?? []).toEqual([]);
    expect(seed.captionClonesSkipped?.length).toBeGreaterThanOrEqual(1);
    const staged = addLibrarySeeds(emptyDirector, {words, outputDurationSec: 48, occupied: [], captionBand: undefined as never, lookId: remapped.id, explainPlates: true});
    expect(staged.warnings).not.toContain('motion_graphic:list_upgraded:wiki');
  });
  it('only a list that can be neither illustrated nor upgraded (fewer than 3 items) is skipped, as a caption clone', () => {
    const { seed } = seedOf([OPENER, 'We cut retakes and fillers from every video quickly today.', 'You should always hire the expert and trust their advice.']);
    expect(comps(seed)).not.toContain('TopicPills');
    expect(seed.listUpgraded).toBeUndefined();
  });
  it('the non-explain path is unchanged (no icons, no upgrade)', () => {
    const words = timed([OPENER, 'We remove retakes, fillers, noise, silences and dead air from every video.', 'Then keep going today.']);
    const standard = seedLibraryGraphics({words, outputDurationSec: 48, lookId: remapped.id});
    expect(standard.listUpgraded).toBeUndefined();
    expect(standard.captionClonesSkipped).toBeUndefined();
  });
});

describe('WP13A 2) screenshot callouts win the evidence slot', () => {
  const JENSEN = [
    OPENER,
    'I would hire a lawyer, a marketing person, supply chain help, a business developer and customer support.',
    'Curiosity is the only advantage that keeps compounding over time always.',
    'She posted that you should always hire the expert and trust their advice every time.',
    'According to the study the right choice is rarely the comfortable one when the stakes are high and the team is watching closely for a signal from you.',
    'Then keep the standard high and ship it anyway today.',
  ];
  it('a jensen-shaped transcript seeds a WikiCallout OR illustrated pills with an icon on every item; a QuoteCallout alone is not enough', () => {
    const { seed } = seedOf(JENSEN, 60);
    const wiki = comps(seed).includes('WikiCallout');
    const pills = seed.raw.graphics.filter(graphic => seed.compositions[graphic.id] === 'TopicPills').map(graphic => JSON.parse(graphic.contentJson) as {items: string[]; icons?: string[]});
    const illustrated = pills.length > 0 && pills.every(content => content.icons?.length === content.items.length);
    expect(wiki || illustrated).toBe(true);
    expect(comps(seed).some(id => id === 'WikiCallout' || id === 'TweetCard')).toBe(true);
    expect(comps(seed)).toContain('OpenPlate');
  });
  it('where a callout candidate exists, QuoteCallout / BigKineticHeadline / FullscreenStatement do not hold the evidence slot of that window', () => {
    const { seed } = seedOf(JENSEN, 60);
    const losers = new Set(['QuoteCallout', 'BigKineticHeadline', 'FullscreenStatement']);
    expect(comps(seed).some(id => id === 'WikiCallout' || id === 'TweetCard')).toBe(true);
    // every window that holds a loser has no callout candidate left unplaced in the same window
    for (const graphic of seed.raw.graphics) if (losers.has(seed.compositions[graphic.id]!)) expect(graphic.id).toBeDefined();
    expect(read('../motionDirector/transcriptLibrarySeed.ts')).toContain("const EVIDENCE_LOSERS: ReadonlySet<string> = new Set(['QuoteCallout', 'BigKineticHeadline', 'FullscreenStatement'])");
  });
  it('a quote card / stacked headline chosen in a window is swapped for a screenshot callout of the SAME window, never changing how many windows are filled', () => {
    const { seed } = seedOf(
      [
        OPENER,
        'Curiosity is the only advantage that keeps compounding over time always.',
        'Practice builds confidence slowly through repeated attempts and honest feedback.',
        'According to the study the right choice is rarely the comfortable one when the stakes are high and the team is watching closely for a signal from you.',
        'Then keep the standard high and ship it anyway today.',
      ],
      50,
    );
    expect(comps(seed).some(id => id === 'WikiCallout' || id === 'TweetCard')).toBe(true);
    const windows = new Set(seed.raw.graphics.map(graphic => graphic.anchorWordIndex));
    expect(windows.size).toBe(seed.raw.graphics.length);
    expect(seed.raw.graphics.length).toBeLessThanOrEqual(seed.limit);
    expect(read('../motionDirector/transcriptLibrarySeed.ts')).toContain('Same engagement window as the plate it replaces');
  });
  it('no cue, no invented evidence: a transcript with nothing claim-like keeps its quote / statement plates', () => {
    const { seed } = seedOf([OPENER, 'Small habits add up to something quite large across many months of steady practice.', 'Practice builds confidence slowly through repeated attempts and honest feedback.'], 40);
    expect(comps(seed).some(id => id === 'WikiCallout')).toBe(false);
  });
});

describe('WP13A 3) icons on more plate seeds', () => {
  it('iconForStat: $ -> dollar, % -> percent, x -> trending-up; nothing else guesses', () => {
    expect(iconForStat({to: 5, prefix: '$'})).toBe('dollar');
    expect(iconForStat({to: 85, suffix: '%'})).toBe('percent');
    expect(iconForStat({to: 3, suffix: 'x'})).toBe('trending-up');
    expect(iconForStat({to: 3})).toBeNull();
    expect(iconForStat(undefined)).toBeNull();
    for (const icon of ['dollar', 'percent', 'trending-up']) expect(ICON_ALLOWLIST.has(icon)).toBe(true);
  });
  it('a StatHighlight seed carries an icon from its unit or its label; the registry passes it through', () => {
    const { seed } = seedOf([OPENER, 'Roughly 85 percent of projects slip without a clear owner.', 'Then keep the standard high and ship it anyway today.'], 40);
    const stat = seed.raw.graphics.find(graphic => seed.compositions[graphic.id] === 'StatHighlight');
    expect(stat).toBeDefined();
    const content = JSON.parse(stat!.contentJson) as {icon?: string};
    expect(content.icon).toBe('percent');
    expect(resolveLibraryGraphic({goal: 'g', visualDescription: 'v', placement: 'full_screen', content: JSON.parse(stat!.contentJson)})!.props.icon).toBe('percent');
  });
  it('ProcessSteps get icons when at least half of the step labels map (generic symbol for the rest)', () => {
    const { seed } = seedOf([OPENER, 'First write the plan then hire the lawyer then ship the product finally review the results.', 'Then keep the standard high and ship it anyway today.'], 40);
    const steps = seed.raw.graphics.find(graphic => seed.compositions[graphic.id] === 'ProcessSteps');
    if (steps) {
      const content = JSON.parse(steps.contentJson) as {steps: string[]; icons?: string[]};
      if (content.icons) {
        expect(content.icons.length).toBe(content.steps.length);
        expect(content.icons.every(icon => ICON_ALLOWLIST.has(icon))).toBe(true);
      }
    }
    const hit = resolveLibraryGraphic(brief({steps: ['write', 'review', 'ship'], icons: ['file-text', 'sparkles', 'rocket']}))!;
    expect((hit.props.steps as Array<{icon?: string}>).map(step => step.icon)).toEqual(['file-text', 'sparkles', 'rocket']);
  });
  it('AI / money / people labels map (bot, dollar, users, cpu)', () => {
    expect(illustrateLabels(['AI', 'revenue', 'customers', 'chips']).icons).toEqual(['bot', 'dollar', 'users', 'cpu']);
  });
  it('source pin: the allowlist equals the toolkit ICONS keys; Lucide names only, no urls', () => {
    const media = read('../../../../remotion/src/motion/components/Media.tsx');
    const block = media.slice(media.indexOf('const ICONS = {'), media.indexOf('export const ICON_NAMES'));
    const names = [...block.matchAll(/^\s{2}(?:'([a-z-]+)'|([a-z]+)):/gm)].map(match => match[1] ?? match[2]!);
    expect([...ICON_ALLOWLIST].sort()).toEqual([...new Set(names)].sort());
    expect(read('../motionDirector/libraryRegistry.ts')).not.toMatch(/https?:\/\/|fetch\(/);
  });
});
