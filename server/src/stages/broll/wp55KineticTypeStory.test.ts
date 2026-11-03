/**
 * WP55 KINETIC_TYPE_STORYTELLING: the ten overlay templates clip_45..54 registered under the existing kinetic_text toolkit. Offline only: no network, no model, no Chrome (rendered proofs live in
 * remotion/scripts/wp55-preview.mjs). Covers registration + allowlists, transcript-meaning selection, grounding, caption ownership, safe area, matte fallback, sparse placement and the Remotion source contracts.
 */
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

import {EDIT_TOOLKITS} from '../../lib/editToolkits.ts';
import {libraryGraphicSource, LIBRARY_COMPOSITION_IDS, LIBRARY_COMPOSITIONS, resolveLibraryGraphic, WP55_TEMPLATE_REGISTRY_IDS} from '../motionDirector/libraryRegistry.ts';
import {validateGraphicSource} from '../../motionWorker/worker.ts';
import {KINETIC_TYPE_FAMILY, formatKineticTypeForDirector, kineticTypeCapabilitiesFor} from './kineticTypeCapabilities.ts';
import {duplicatesCaption, kineticBeatBudget, kineticCandidatesOf, keyWordIndex, spokenQuantities, type KineticContext} from './kineticTypeStory.ts';
import {alignWordStarts, bindMotionTemplateContent} from './motionTemplateBind.ts';
import {MOTION_TEMPLATE_CATALOG, SKILL_MOTION_TEMPLATE_ALLOWLIST, motionTemplate, planMotionTemplateBeats, type MotionTemplateId, type MotionTemplateWord} from './motionTemplateCatalog.ts';
import {KINETIC_STORY_IDS, planCraftTemplateBeats} from './planCraftTemplateBeats.ts';
import {runCraftTemplateStage} from './craftTemplateStage.ts';
import {CRAFT_SAFE_AREA} from './motionCraftStandards.ts';
import {sentencesOfWords} from './visualBackend/planVisualBackendBeats.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../../..');
const read = (...parts: string[]) => readFileSync(join(repo, ...parts), 'utf8');

const speech = (parts: Array<[string, number]>): MotionTemplateWord[] =>
  parts.flatMap(([text, at]) => text.split(/\s+/).map((word, i) => ({text: word, start: at + i * 0.3, end: at + i * 0.3 + 0.25})));
const sentence = (text: string, at = 10) => sentencesOfWords(speech([[text, at]]))[0]!;
const ALL = new Set<string>(KINETIC_STORY_IDS);
const only = (id: string) => new Set<string>([id]);
const ctx = (extra: Partial<KineticContext> = {}): KineticContext => ({durationSec: 40, ...extra});
const pick = (text: string, id: string, extra: Partial<KineticContext> = {}, at = 10) => kineticCandidatesOf(sentence(text, at), ctx(extra), only(id)).candidates.find(c => c.templateId === id);
const SHOT = 'https://cdn.example.com/post.png';
const LOGO = 'https://cdn.example.com/logo.png';
const MATTE = 'https://cdn.example.com/subject-alpha.webm';

describe('WP55 registration (catalog, registry, library, Remotion, toolkit)', () => {
  const rows = MOTION_TEMPLATE_CATALOG.filter(row => row.lane === 'wp55');

  it('ten rows clip_45..54, all kinetic_text, overlay, owning no frame, in the existing catalog (no new registry / skill lane)', () => {
    // clip_55 (text match cut) shares the planner pass but is a full-frame row in its own lane (textMatchCut.test.ts)
    expect(rows.map(r => r.id)).toEqual(KINETIC_STORY_IDS.filter(id => id !== 'clip_55_type_text_match_cut'));
    for (const row of rows) {
      expect(row.toolkit, row.id).toBe('kinetic_text');
      expect(row.ownsFrame, row.id).toBe(false);
      expect(row.placement, row.id).toBe('overlay');
      expect(row.backend, row.id).toBeUndefined();
      expect(motionTemplate(row.id)).toBe(row);
      expect(WP55_TEMPLATE_REGISTRY_IDS[row.id], row.id).toBe(row.compositionId);
    }
  });

  it('each row has a library entry (overlay only), an exported Remotion comp and a capability row', () => {
    const index = read('remotion/src/motion/index.ts');
    const source = read('remotion/src/motion/compositions/templates/KineticTypeStory.tsx');
    for (const row of rows) {
      const entry = LIBRARY_COMPOSITIONS.find(c => c.id === row.compositionId)!;
      expect(entry, row.id).toBeDefined();
      expect(entry.overlayOnly, row.id).toBe(true);
      expect(entry.opaqueOnly, row.id).toBeUndefined();
      expect(LIBRARY_COMPOSITION_IDS).toContain(row.compositionId);
      expect(index, row.compositionId).toMatch(new RegExp(`export \\{${row.compositionId}\\b`));
      expect(index, row.compositionId).toMatch(new RegExp(`export const compositions = \\{[^}]*\\b${row.compositionId}\\b`));
      expect(source, row.compositionId).toMatch(new RegExp(`export const ${row.compositionId}\\b`));
      expect(KINETIC_TYPE_FAMILY.find(c => c.templateId === row.id), row.id).toBeDefined();
    }
  });

  it('the kinetic_text toolkit (what the Director reads) names every family template and keeps the grounding rule', () => {
    const toolkit = EDIT_TOOLKITS.find(t => t.id === 'kinetic_text')!;
    expect(toolkit.directorKinds).toEqual(['kinetic_text']);
    for (const cap of KINETIC_TYPE_FAMILY) expect(toolkit.description, cap.name).toContain(cap.name);
    expect(toolkit.description).toMatch(/spoken or brand data/);
    expect(toolkit.description).toMatch(/captions are never muted/);
    expect(EDIT_TOOLKITS.filter(t => /KINETIC_TYPE_STORYTELLING/.test(t.description)).map(t => t.id)).toEqual(['kinetic_text']);
  });

  it('allowlists: faceless gets no presenter-bound templates, newsroom no CTA, textual_mg none; explainer + default get all ten', () => {
    const has = (skill: keyof typeof SKILL_MOTION_TEMPLATE_ALLOWLIST) => KINETIC_STORY_IDS.filter(id => SKILL_MOTION_TEMPLATE_ALLOWLIST[skill].includes(id as MotionTemplateId));
    expect(has('explainer')).toEqual([...KINETIC_STORY_IDS]);
    expect(has('default')).toEqual([...KINETIC_STORY_IDS]);
    expect(has('textual_mg')).toEqual([]);
    expect(has('faceless')).not.toContain('clip_45_type_environmental_hero');
    expect(has('faceless')).not.toContain('clip_49_type_kinetic_word_pop');
    expect(has('faceless')).not.toContain('clip_51_type_floating_social_proof');
    expect(has('newsroom_mg')).not.toContain('clip_53_type_kinetic_cta');
    // WP55 rows are lane rows: the WP45 planner never picks them
    const words = speech([['Here is our brand story and the product feature.', 2]]);
    for (const skill of ['explainer', 'default', 'faceless', 'newsroom_mg'] as const) {
      expect(planMotionTemplateBeats({skill, durationSec: 40, words}).beats.some(b => b.templateId.startsWith('clip_5') || /^clip_4[5-9]/.test(b.templateId))).toBe(false);
    }
  });

  it('the Director only sees templates that are registered + implemented + allowed for the active skill', () => {
    const implemented = new Set<string>(LIBRARY_COMPOSITION_IDS);
    expect(kineticTypeCapabilitiesFor('explainer', implemented)).toHaveLength(11);
    expect(kineticTypeCapabilitiesFor('textual_mg', implemented)).toEqual([]);
    expect(formatKineticTypeForDirector('textual_mg', implemented)).toBe('');
    expect(kineticTypeCapabilitiesFor('faceless', implemented).map(r => r.templateId)).not.toContain('clip_45_type_environmental_hero');
    // not implemented -> not exposed
    expect(kineticTypeCapabilitiesFor('explainer', new Set(['TypeImpactNumber'])).map(r => r.name)).toEqual(['type_impact_number']);
    const text = formatKineticTypeForDirector('explainer', implemented);
    expect(text).toMatch(/Never invent statistics/);
    for (const cap of kineticTypeCapabilitiesFor('explainer', implemented)) {
      expect(cap.rendering).toContain(cap.compositionId);
      expect(cap.ownsFrame).toBe(cap.templateId === 'clip_55_type_text_match_cut');
      expect(cap.skills).toContain('explainer');
      expect(['none', 'optional', 'recommended']).toContain(cap.matte);
      expect(cap.fallback.length).toBeGreaterThan(10);
      expect(cap.cost.length).toBeGreaterThan(10);
    }
    expect(kineticTypeCapabilitiesFor('explainer', implemented).find(c => c.name === 'type_environmental_hero')!.matte).toBe('recommended');
  });

  it('every overlay template emits Tiny TSX that passes the worker typecheck + compile (with assets wired, never literals)', async () => {
    const contents: Record<string, Record<string, unknown>> = {
      clip_45_type_environmental_hero: {text: 'attention', occlusion: 'matte', subjectSrc: MATTE},
      clip_46_type_impact_number: {values: ['10'], label: 'seconds'},
      clip_47_type_staggered_phrase: {text: 'good editing feels invisible'},
      clip_48_type_split_color_headline: {groups: [{text: 'I can', size: 'sm'}, {text: 'show you', size: 'lg'}]},
      clip_49_type_kinetic_word_pop: {word: 'attention'},
      clip_50_type_stacked_statement: {lines: [{text: 'so the', role: 'lead'}, {text: 'attention', role: 'key'}]},
      clip_51_type_floating_social_proof: {icons: ['heart'], imageSrcs: [SHOT]},
      clip_52_type_logo_reveal: {logoSrc: LOGO, title: 'Northwind'},
      clip_53_type_kinetic_cta: {parts: [{text: 'Just', size: 'sm'}, {text: 'DM me', size: 'lg'}]},
      clip_54_type_illustrated_emphasis: {word: 'best', mark: 'circle'},
    };
    for (const row of rows) {
      const hit = resolveLibraryGraphic({placement: 'overlay', content: {motionTemplateId: row.id, accent: '#FD5D42', ...contents[row.id]}})!;
      expect(hit, row.id).not.toBeNull();
      const source = libraryGraphicSource(hit);
      expect(source).toContain(`import {${row.compositionId}, type GraphicProps} from '@finalpost/motion';`);
      expect(source).not.toContain('https://');
      const {report, compiled} = await validateGraphicSource(source);
      expect(report, row.id).toEqual({safety: [], typecheck: [], compile: [], runtime: []});
      expect(compiled?.bytes).toBeGreaterThan(0);
    }
  }, 120_000);

  it('overlay only: a full-screen / split brief misses (they own no frame)', () => {
    for (const mode of ['full_screen', 'split_screen'] as const) {
      expect(resolveLibraryGraphic({placement: mode, content: {motionTemplateId: 'clip_46_type_impact_number', values: ['10']}})).toBeNull();
    }
    expect(resolveLibraryGraphic({placement: 'overlay', content: {motionTemplateId: 'clip_46_type_impact_number', values: ['10']}})!.compositionId).toBe('TypeImpactNumber');
  });
});

describe('WP55 director selection from transcript meaning', () => {
  it('a spoken statistic -> impact number with the spoken label, never a price pair or a year', () => {
    const c = pick('I can show you the result in 10 seconds.', 'clip_46_type_impact_number')!;
    expect(c.hint).toMatchObject({values: ['10'], label: 'seconds'});
    expect(c.reason).toMatch(/statistic/);
    expect(pick('We hit 386 thousand views last month.', 'clip_46_type_impact_number')!.hint).toMatchObject({values: ['386'], suffix: 'K'});
    expect(pick('That is 50 percent faster than before.', 'clip_46_type_impact_number')!.hint).toMatchObject({values: ['50'], suffix: '%'});
    expect(pick('It was 79 dollars and now 47.', 'clip_46_type_impact_number')).toBeUndefined();
    expect(pick('We started back in 2019 with nothing.', 'clip_46_type_impact_number')).toBeUndefined();
    expect(pick('One of the best days of my life.', 'clip_46_type_impact_number')).toBeUndefined(); // number words need a unit
    expect(spokenQuantities(sentence('It takes ten seconds.')).map(q => q.value)).toEqual([10]);
  });

  it('a strong claim -> environmental hero on the key word (+ spoken lead-in); a short plain statement -> staggered phrase', () => {
    const hero = pick('What you really need is attention.', 'clip_45_type_environmental_hero', {hasMatte: true})!;
    expect(hero.hint).toMatchObject({text: 'attention'});
    expect(hero.score).toBeGreaterThan(0.9);
    const plain = pick('Good editing feels invisible.', 'clip_47_type_staggered_phrase')!;
    expect(plain.hint.text).toBe('Good editing feels invisible.'.replace(/\.$/, ''));
    expect(pick('Good editing feels invisible.', 'clip_45_type_environmental_hero')).toBeUndefined(); // no claim word
    // the lead-in is a run of function words only ("and that" / "is"), never content words
    expect(pick('And that is attention.', 'clip_45_type_environmental_hero', {hasMatte: true})!.hint).toMatchObject({text: 'attention', lead: 'that is'});
    expect(pick('Your story deserves attention.', 'clip_45_type_environmental_hero', {hasMatte: true})!.hint.lead).toBeUndefined();
  });

  it('a contrast / two-part message -> split colour headline (small lead-in, one large keyword)', () => {
    const c = pick('We sell homes, not houses.', 'clip_48_type_split_color_headline')!;
    const groups = c.hint.groups as Array<{text: string; size: string}>;
    expect(groups.map(g => g.size)).toEqual(['sm', 'lg']);
    expect(groups[1]!.text).toBe('houses');
    const reference = pick('I can show you.', 'clip_48_type_split_color_headline');
    expect(reference).toBeDefined();
  });

  it('a concluding argument -> stacked statement with exactly one key line; one word -> word pop; pointed word -> drawn accent', () => {
    const stacked = pick('So the secret is consistent attention every day.', 'clip_50_type_stacked_statement', {durationSec: 40})!;
    const lines = stacked.hint.lines as Array<{text: string; role: string}>;
    expect(lines.filter(l => l.role === 'key')).toHaveLength(1);
    expect(lines.find(l => l.role === 'key')!.text).toBe('attention');
    expect(pick('Honestly that changed everything.', 'clip_49_type_kinetic_word_pop')!.hint).toMatchObject({word: expect.any(String)});
    expect(pick('This is the best way to grow.', 'clip_54_type_illustrated_emphasis')!.hint).toMatchObject({word: 'best', mark: 'circle'});
    expect(pick('Click the link below.', 'clip_54_type_illustrated_emphasis')!.hint).toMatchObject({mark: 'arrow'});
    expect(pick('That will double your reach.', 'clip_54_type_illustrated_emphasis')!.hint).toMatchObject({word: 'double', mark: 'burst'});
  });

  it('a final invitation -> kinetic CTA, only in the closing stretch', () => {
    const c = pick('Just DM me for a free video.', 'clip_53_type_kinetic_cta', {}, 30)!;
    const parts = c.hint.parts as Array<{text: string; size: string}>;
    expect(parts.map(p => p.text)).toEqual(['Just', 'DM me']);
    expect(parts.filter(p => p.size === 'lg')).toHaveLength(1);
    expect(pick('Just DM me for a free video.', 'clip_53_type_kinetic_cta', {}, 4)).toBeUndefined(); // too early: not a closing invitation
  });

  it('social proof needs creator stills OR a spoken figure; a brand intro needs a logo / brand name', () => {
    const talk = 'My reels reached 386 thousand views and so many likes.';
    expect(pick(talk, 'clip_51_type_floating_social_proof')!.hint).toMatchObject({figure: '386K', icons: ['heart']});
    expect(pick('People leave likes and shares on my posts.', 'clip_51_type_floating_social_proof', {socialImageUrls: [SHOT]})).toBeDefined();
    const gated = kineticCandidatesOf(sentence('People leave likes and shares on my posts.'), ctx(), only('clip_51_type_floating_social_proof'));
    expect(gated.candidates).toEqual([]);
    expect(gated.warnings).toContain('kinetic_type:social_proof:gated:no_assets_or_figure');
    expect(pick('Welcome to Northwind Realty.', 'clip_52_type_logo_reveal', {brandName: 'Northwind Realty'}, 2)).toBeDefined();
    expect(pick('Welcome to Northwind Realty.', 'clip_52_type_logo_reveal', {}, 2)).toBeUndefined();
    expect(pick('Welcome to Northwind Realty.', 'clip_52_type_logo_reveal', {logoSrc: LOGO}, 2)).toBeDefined();
  });

  it('never repeats most of a long caption line, and sentence text with digits never becomes hero / phrase type', () => {
    expect(duplicatesCaption('so the secret is consistent attention', 'So the secret is consistent attention every day.')).toBe(true);
    expect(duplicatesCaption('attention', 'So the secret is consistent attention every day.')).toBe(false);
    expect(duplicatesCaption('Never again.', 'Never again.')).toBe(false); // a 2-word punchline IS the line
    expect(pick('In 10 seconds attention wins everything.', 'clip_45_type_environmental_hero', {hasMatte: true})).toBeUndefined();
    expect(keyWordIndex(speech([['and the of', 1]]))).toBe(-1);
  });

  it('the budget is sparse: none under 8 s, one per ~7 s after, never more than five', () => {
    expect([4, 7.9].map(kineticBeatBudget)).toEqual([0, 0]);
    expect([8, 14, 26.7, 60, 600].map(kineticBeatBudget)).toEqual([1, 2, 3, 5, 5]);
  });
});

describe('WP55 grounding (binder): displayed text is spoken or provided brand data, nothing else', () => {
  const words = speech([['Just DM me for a free video.', 30]]);
  const bind = (templateId: MotionTemplateId, hint: Record<string, unknown>, extra: Record<string, unknown> = {}, w = words, at = 30) =>
    bindMotionTemplateContent({templateId, words: w, beatStart: at - 0.35, beatEnd: at + 3, hint, accent: '#FF8A1F', ...extra});

  it('accepts spoken copy and carries the edit palette', () => {
    expect(bind('clip_53_type_kinetic_cta', {parts: [{text: 'Just', size: 'sm'}, {text: 'DM me', size: 'lg'}]})).toMatchObject({parts: [{text: 'Just', size: 'sm'}, {text: 'DM me', size: 'lg'}], accent: '#FF8A1F'});
    expect(bind('clip_49_type_kinetic_word_pop', {word: 'free'})).toMatchObject({word: 'free'});
  });

  it('refuses invented text, invented numbers, demo shells and malformed hierarchy', () => {
    expect(bind('clip_49_type_kinetic_word_pop', {word: 'guaranteed'})).toBeNull();
    expect(bind('clip_53_type_kinetic_cta', {parts: [{text: 'Just', size: 'sm'}, {text: 'Call now', size: 'lg'}]})).toBeNull();
    expect(bind('clip_53_type_kinetic_cta', {parts: [{text: 'Just', size: 'lg'}, {text: 'DM me', size: 'lg'}]})).toBeNull(); // two dominant parts = no hierarchy
    const n = speech([['I can show you the result in 10 seconds.', 3]]);
    expect(bind('clip_46_type_impact_number', {values: ['10'], label: 'seconds'}, {}, n, 3)).toMatchObject({values: ['10'], label: 'seconds'});
    expect(bind('clip_46_type_impact_number', {values: ['99']}, {}, n, 3)).toBeNull();
    expect(bind('clip_46_type_impact_number', {values: ['10'], label: 'customers'}, {}, n, 3)).toBeNull();
    expect(bind('clip_47_type_staggered_phrase', {text: 'ACME ship it'}, {}, speech([['ACME ship it now.', 3]]), 3)).toBeNull();
    expect(bind('clip_50_type_stacked_statement', {lines: [{text: 'a', role: 'lead'}, {text: 'b', role: 'support'}]})).toBeNull(); // no key line
  });

  it('social proof: never without creator stills or a spoken figure; stock / non-https stills never count', () => {
    const talk = speech([['My reels reached 386 thousand views.', 5]]);
    expect(bind('clip_51_type_floating_social_proof', {icons: ['heart']}, {}, talk, 5)).toBeNull();
    expect(bind('clip_51_type_floating_social_proof', {icons: ['heart']}, {socialImageUrls: ['http://insecure/x.png', 'file:///x.png']}, talk, 5)).toBeNull();
    expect(bind('clip_51_type_floating_social_proof', {icons: ['heart'], figure: '386K', figureLabel: 'views'}, {}, talk, 5)).toMatchObject({figure: '386K', figureLabel: 'views'});
    expect(bind('clip_51_type_floating_social_proof', {icons: ['heart'], figure: '900K'}, {}, talk, 5)).toBeNull(); // 900 was never said
    expect(bind('clip_51_type_floating_social_proof', {icons: ['heart']}, {socialImageUrls: [SHOT]}, talk, 5)).toMatchObject({imageSrcs: [SHOT]});
  });

  it('logo reveal: logo or brand name required; the title is brand data, never transcript guesswork', () => {
    expect(bind('clip_52_type_logo_reveal', {})).toBeNull();
    expect(bind('clip_52_type_logo_reveal', {}, {brandName: 'Northwind'})).toMatchObject({title: 'Northwind'});
    expect(bind('clip_52_type_logo_reveal', {}, {logoSrc: LOGO})).toMatchObject({logoSrc: LOGO});
  });

  it('transcript timing: word starts are aligned in order to the spoken words (relative to the beat), else null', () => {
    const w = speech([['good editing feels invisible', 12]]);
    expect(alignWordStarts('good editing feels invisible', w, 11.65)).toEqual([0.35, 0.65, 0.95, 1.25]);
    expect(alignWordStarts('good never feels invisible', w, 11.65)).toBeNull();
    const bound = bind('clip_47_type_staggered_phrase', {text: 'good editing feels invisible'}, {}, w, 12);
    expect((bound!.wordStarts as number[]).length).toBe(4);
    expect(bound!.wordStarts as number[]).toEqual([...(bound!.wordStarts as number[])].sort((a, b) => a - b));
  });
});

describe('WP55 environmental typography: matte vs graceful fallback', () => {
  // the big word that used to sit static and unreadable behind the presenter: it keeps its size and scrolls (marquee), so it is bound behind the presenter
  const w = speech([['What you really need is attention.', 6]]);
  const hint = {text: 'attention'};
  const bindHero = (extra: Record<string, unknown>) => bindMotionTemplateContent({templateId: 'clip_45_type_environmental_hero', words: w, beatStart: 5.65, beatEnd: 8.5, hint, ...extra});

  it('with a person matte the beat binds real occlusion (marquee reveal) and carries the matte as an asset, starting at the beat', () => {
    const c = bindHero({subjectMatte: {src: MATTE, box: {x: 0.3, y: 0.3, w: 0.4, h: 0.6}}})!;
    expect(c).toMatchObject({occlusion: 'matte', reveal: 'sweep', subjectSrc: MATTE, subjectStartSec: 5.65, subjectBox: {x: 0.3, y: 0.3, w: 0.4, h: 0.6}});
    const hit = resolveLibraryGraphic({placement: 'overlay', content: {motionTemplateId: 'clip_45_type_environmental_hero', ...c}})!;
    expect(hit.props).toMatchObject({occlusion: 'matte', reveal: 'sweep', subjectAsset: 'subject'});
    expect(hit.assets).toMatchObject({subject: {src: MATTE}});
    expect(JSON.stringify(hit.props)).not.toContain('https://');
  });

  it('a subject that fills the frame (no usable side gutter) is demoted to the headroom layout even with a real matte', () => {
    for (const extra of [{subjectMatte: {src: MATTE, box: {x: 0, y: 0.1, w: 1, h: 0.9}}}, {subjectMatte: {hostComposited: true, box: {x: 0, y: 0.1, w: 1, h: 0.9}}}]) {
      const c = bindHero(extra)!;
      expect(c.occlusion).toBe('none');
      expect(c.subjectSrc).toBeUndefined();
      expect(c.hostComposited).toBeUndefined();
      expect(c.reveal).toBeUndefined();
    }
  });

  it('production mode: hostComposited binds real occlusion with NO url (the host draws the cut-aware foreground)', () => {
    const c = bindHero({subjectMatte: {hostComposited: true, box: {x: 0.3, y: 0.3, w: 0.4, h: 0.6}}})!;
    expect(c).toMatchObject({occlusion: 'matte', reveal: 'sweep', hostComposited: true});
    expect(c.subjectSrc).toBeUndefined();
    const hit = resolveLibraryGraphic({placement: 'overlay', content: {motionTemplateId: 'clip_45_type_environmental_hero', ...c}})!;
    expect(hit.props).toMatchObject({occlusion: 'matte', hostComposited: true});
    expect(hit.assets).toBeUndefined();
    // a claim of host compositing is only honoured with occlusion 'matte' (no flag, no occlusion)
    expect(resolveLibraryGraphic({placement: 'overlay', content: {motionTemplateId: 'clip_45_type_environmental_hero', text: 'attention', hostComposited: true}})!.props.occlusion).toBe('none');
  });

  it('no matte, a non-https matte, or a matte hint without a source -> occlusion "none" (never fake occlusion)', () => {
    for (const extra of [{}, {subjectMatte: {src: 'http://insecure/x.webm'}}, {subjectMatte: {src: 'file:///x.webm'}}]) {
      const c = bindHero(extra)!;
      expect(c.occlusion).toBe('none');
      expect(c.subjectSrc).toBeUndefined();
    }
    // a hand-built brief that says matte without a source is downgraded by the registry too
    const hit = resolveLibraryGraphic({placement: 'overlay', content: {motionTemplateId: 'clip_45_type_environmental_hero', text: 'attention', occlusion: 'matte'}})!;
    expect(hit.props.occlusion).toBe('none');
    expect(hit.assets).toBeUndefined();
  });

  it('the planner warns which mode was chosen and skips the fallback when there is no headroom above the subject', () => {
    const talk = speech([['What you really need is attention.', 6], ['Something filler goes here to pad out the edit length.', 14], ['More filler words fill the remaining running time.', 24]]);
    const withMatte = planCraftTemplateBeats({skill: 'explainer', durationSec: 40, words: talk, subjectMatte: {src: MATTE}});
    expect(withMatte.beats.map(b => b.templateId)).toContain('clip_45_type_environmental_hero');
    expect(withMatte.warnings).toContain('kinetic_type:environmental:matte');
    // no matte AND an unmeasured subject: nowhere provably safe for the type, so no hero (no invented default box)
    const unmeasured = planCraftTemplateBeats({skill: 'explainer', durationSec: 40, words: talk});
    expect(unmeasured.beats.map(b => b.templateId)).not.toContain('clip_45_type_environmental_hero');
    expect(unmeasured.warnings).toContain('kinetic_type:environmental:skipped:subject_unmeasured');
    // a MEASURED subject box without a matte -> the headroom fallback
    const without = planCraftTemplateBeats({skill: 'explainer', durationSec: 40, words: talk, subjectBox: {x: 0.3, y: 0.4, w: 0.4, h: 0.55}});
    expect(without.warnings).toContain('kinetic_type:environmental:no_matte_fallback');
    expect(without.beats.find(b => b.templateId === 'clip_45_type_environmental_hero')!.hint).toMatchObject({occlusionFallback: 'headroom'});
    // production mode: the host composites the foreground (no URL travels), still real occlusion
    const host = planCraftTemplateBeats({skill: 'explainer', durationSec: 40, words: talk, subjectMatte: {hostComposited: true, box: {x: 0.3, y: 0.4, w: 0.4, h: 0.55}}});
    expect(host.warnings).toContain('kinetic_type:environmental:matte');
    // subject fills the top of the frame and there is no matte: nowhere safe for the type
    const noRoom = kineticCandidatesOf(sentence('What you really need is attention.', 6), ctx({subjectBox: {x: 0.2, y: 0.12, w: 0.6, h: 0.85}}), only('clip_45_type_environmental_hero'));
    expect(noRoom.candidates).toEqual([]);
    expect(noRoom.warnings).toContain('kinetic_type:environmental:skipped:no_matte_no_headroom');
    // ...but with a real matte the type can go behind him
    expect(kineticCandidatesOf(sentence('What you really need is attention.', 6), ctx({subjectBox: {x: 0.2, y: 0.12, w: 0.6, h: 0.85}, hasMatte: true}), only('clip_45_type_environmental_hero')).candidates).toHaveLength(1);
  });

  it('compositing contract: type is drawn BEFORE the person cutout, the cutout is a real alpha video layer, no Math.random / Date.now anywhere', () => {
    const story = read('remotion/src/motion/compositions/templates/KineticTypeStory.tsx');
    const shared = read('remotion/src/motion/compositions/templates/kineticType.tsx');
    const hero = story.slice(story.indexOf('export const TypeEnvironmentalHero'), story.indexOf('// ---', story.indexOf('export const TypeEnvironmentalHero')));
    expect(hero.indexOf('{words.map')).toBeGreaterThan(-1);
    expect(hero.indexOf('<SubjectForeground')).toBeGreaterThan(hero.indexOf('{words.map')); // text first, subject above it
    expect(hero).toMatch(/const wantsMatte = occlusion === 'matte'/);
    expect(hero).toMatch(/const occluded = wantsMatte &&/);
    expect(shared).toMatch(/<OffthreadVideo[\s\S]*transparent/);
    expect(shared).toMatch(/if \(!src\) return null/);
    for (const src of [story, shared]) expect(src).not.toMatch(/Math\.random|Date\.now|new Date/);
  });
});

describe('WP55 sparse placement, blocked ranges, caption ownership, safe area', () => {
  const talk = speech([
    ['Welcome to Northwind Realty.', 1],
    ['I can show you the result in 10 seconds.', 6],
    ['What you really need is attention.', 12],
    ['Good editing feels invisible.', 18],
    ['We sell homes, not houses.', 23],
    ['So the secret is consistent attention every day.', 29],
    ['Just DM me for a free video.', 36],
  ]);
  const plan = (extra: Partial<Parameters<typeof planCraftTemplateBeats>[0]> = {}) => planCraftTemplateBeats({skill: 'explainer', durationSec: 42, words: talk, brandName: 'Northwind Realty', ...extra});
  const story = (extra: Partial<Parameters<typeof planCraftTemplateBeats>[0]> = {}) => plan(extra).beats.filter(b => (KINETIC_STORY_IDS as readonly string[]).includes(b.templateId));

  it('is sparse: within the budget, >= 4 s apart, one treatment per sentence, never every sentence', () => {
    const beats = story();
    expect(beats.length).toBeGreaterThan(0);
    expect(beats.length).toBeLessThanOrEqual(kineticBeatBudget(42));
    expect(beats.length).toBeLessThan(sentencesOfWords(talk).length);
    for (let i = 1; i < beats.length; i++) expect(beats[i]!.start - beats[i - 1]!.end).toBeGreaterThanOrEqual(3.99);
    expect(new Set(beats.map(b => b.templateId)).size).toBe(beats.length); // variety: no template twice
    const sentences = sentencesOfWords(talk);
    const perSentence = beats.map(b => sentences.findIndex(s => b.start + 0.35 >= s.start - 0.5 && b.start + 0.35 <= s.end + 0.5));
    expect(new Set(perSentence).size).toBe(perSentence.length);
  });

  it('chooses by meaning: number sentence -> impact number, closing invite -> CTA, claim -> hero (highest-value picks win the budget)', () => {
    const ids = plan().beats.map(b => b.templateId);
    expect(ids).toContain('clip_46_type_impact_number');
    expect(ids).toContain('clip_53_type_kinetic_cta');
    const number = plan().beats.find(b => b.templateId === 'clip_46_type_impact_number')!;
    expect(number.start).toBeGreaterThan(5);
    expect(number.start).toBeLessThan(8);
    expect(number.hint).toMatchObject({values: ['10']});
  });

  it('timing follows the transcript: each beat starts a little BEFORE its first spoken word and covers the spoken span', () => {
    for (const b of story()) {
      const spokenWords = talk.filter(w => w.start >= b.start - 0.01 && w.start <= b.end);
      expect(spokenWords.length, b.templateId).toBeGreaterThan(0);
      expect(b.end - b.start, b.templateId).toBeGreaterThanOrEqual(1.1);
    }
  });

  it('captions stay: no WP55 beat mutes captions or appears in the mute ranges', () => {
    const p = plan();
    for (const b of story()) expect(b.muteCaptions, b.templateId).toBe(false);
    const storyRanges = story().map(b => `${b.start}-${b.end}`);
    expect(p.captionMuteRanges.map(r => `${r.start}-${r.end}`).filter(r => storyRanges.includes(r))).toEqual([]);
  });

  it('respects blocked ranges (full-frame graphics, clips ...)', () => {
    const blocked = [{start: 5, end: 11}, {start: 27, end: 33}];
    for (const b of story({blockedRanges: blocked})) expect(blocked.some(r => r.start < b.end && r.end > b.start), b.templateId).toBe(false);
    expect(story({blockedRanges: [{start: 0, end: 42}]})).toEqual([]);
  });

  it('respects the allowlist and the kill switch: textual_mg plans none, kineticStory:false plans none, faceless never plans presenter-bound ones', () => {
    expect(story({skill: 'textual_mg'})).toEqual([]);
    expect(story({kineticStory: false})).toEqual([]);
    const faceless = story({skill: 'faceless'}).map(b => b.templateId);
    for (const id of ['clip_45_type_environmental_hero', 'clip_49_type_kinetic_word_pop', 'clip_51_type_floating_social_proof']) expect(faceless).not.toContain(id);
  });

  it('kineticOnly narrows the family (still inside the skill allowlist)', () => {
    const only = story({kineticOnly: ['clip_53_type_kinetic_cta']}).map(b => b.templateId);
    expect(only).toEqual(['clip_53_type_kinetic_cta']);
    expect(story({kineticOnly: ['clip_45_type_environmental_hero'], skill: 'faceless'})).toEqual([]);
  });

  it('short clips plan nothing; the plan is deterministic', () => {
    expect(planCraftTemplateBeats({skill: 'explainer', durationSec: 6, words: talk}).beats).toEqual([]);
    expect(JSON.stringify(plan())).toBe(JSON.stringify(plan()));
  });

  it('the stage publishes through the existing path: only grounded beats publish, none mute captions, assets travel as assets', async () => {
    const seen: Array<{content: Record<string, unknown>; assets?: Array<{id: string; type: string}>}> = [];
    const publisher = (async (brief: {id: string; content: Record<string, unknown>; placement?: string; assets?: Array<{id: string; type: string}>}) => {
      seen.push({content: brief.content, assets: brief.assets});
      return {id: brief.id, module: {url: `https://cdn.invalid/${brief.id}.js`, sha256: 'a'.repeat(64)}, placement: {mode: brief.placement ?? 'overlay'}, props: {content: brief.content}, brief: {purpose: 'p', visualIntent: 'v'}};
    }) as never;
    const result = await runCraftTemplateStage({polishSkill: 'explainer', words: talk, durationSec: 42, brandName: 'Northwind Realty', subjectMatte: {src: MATTE}, publish: {publisher}});
    expect(result.published.length).toBeGreaterThan(0);
    expect(result.muteRanges.filter(r => result.published.some(p => (KINETIC_STORY_IDS as readonly string[]).includes(p.beat.templateId) && p.beat.start === r.startSec))).toEqual([]);
    const hero = seen.find(s => s.content.motionTemplateId === 'clip_45_type_environmental_hero');
    if (hero) expect(hero.assets).toEqual([{id: 'subject', type: 'video', url: MATTE}]);
  });

  it('safe area: the Remotion comps keep type above the caption band and inside the chrome (numbers mirror the server standard)', () => {
    const shared = read('remotion/src/motion/compositions/templates/kineticType.tsx');
    expect(shared).toContain(`topFrac: ${CRAFT_SAFE_AREA.topFrac}`);
    expect(shared).toContain(`captionBandFrac: ${CRAFT_SAFE_AREA.captionBandFrac}`);
    expect(shared).toContain(`sideFrac: ${CRAFT_SAFE_AREA.sideFrac}`);
    const story = read('remotion/src/motion/compositions/templates/KineticTypeStory.tsx');
    expect(story.match(/typeRegion\(width, height\)/g)!.length).toBeGreaterThanOrEqual(9);
  });

  it('aspect ratios and missing optional data: every comp lays out from width / height fractions (no fixed pixels) and every prop is optional', () => {
    const story = read('remotion/src/motion/compositions/templates/KineticTypeStory.tsx');
    expect(story).not.toMatch(/\b1080\b|\b1920\b/);
    for (const row of MOTION_TEMPLATE_CATALOG.filter(r => r.lane === 'wp55')) {
      const start = story.indexOf(`export type ${row.compositionId}Props`);
      expect(start, row.compositionId).toBeGreaterThan(-1);
    }
    // demo copy only renders when a prop is omitted; the binder never ships it (ACME & friends refused above)
    expect(existsSync(join(repo, 'remotion/scripts/wp55-preview.mjs'))).toBe(true);
  });
});
