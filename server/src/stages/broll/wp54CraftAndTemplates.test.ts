/**
 * WP54: craft standards + kinetic type / brand / ambient / gated ecommerce L2 + finished WP53 mounts. Offline only: no Chrome, no Gemini, no R2, no live render.
 */
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {env} from '../../config/env.ts';
import {EDIT_TOOLKITS} from '../../lib/editToolkits.ts';
import {backendVideoUrlOf} from '../render/prefetchAssets.ts';
import {libraryGraphicSource, resolveLibraryGraphic, WP54_TEMPLATE_REGISTRY_IDS} from '../motionDirector/libraryRegistry.ts';
import {resolvePolishSkill} from './explainerPacing.ts';
import * as craft from './motionCraftStandards.ts';
import {formatCraftStandardsForDirector} from './motionCraftStandards.ts';
import {bindMotionTemplateContent} from './motionTemplateBind.ts';
import {MOTION_TEMPLATE_CATALOG, MOTION_TEMPLATE_IDS, SKILL_MOTION_TEMPLATE_ALLOWLIST, motionTemplate, planMotionTemplateBeats, type MotionTemplateWord} from './motionTemplateCatalog.ts';
import {emphaticPhraseOf, planCraftTemplateBeats, productGate, spokenPricePair} from './planCraftTemplateBeats.ts';
import {sentencesOfWords} from './visualBackend/planVisualBackendBeats.ts';
import {nativeFallbackFor} from './visualBackend/visualBackendStage.ts';
import {planVisualBackendBeats} from './visualBackend/planVisualBackendBeats.ts';
import {
  CHAR_STAGGER_MAX_CHARS,
  ENTER_EASE_OUT,
  EXIT_EASE_IN,
  MOVE_IN_OUT,
  PLAYFUL_OVERSHOOT,
  bezierAt,
  morphWeight,
  priceCount,
  staggerStep,
} from '../../../../remotion/src/lib/craftTiming.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../../..');
const read = (...parts: string[]) => readFileSync(join(repo, ...parts), 'utf8');

/** Words for several sentences, each starting at a given second (0.3 s per word). */
function speech(parts: Array<[string, number]>): MotionTemplateWord[] {
  return parts.flatMap(([text, at]) => text.split(/\s+/).map((word, i) => ({text: word, start: at + i * 0.3, end: at + i * 0.3 + 0.25})));
}
const SHOT = 'https://cdn.example.com/dashboard.png';
const plan = (words: MotionTemplateWord[], extra: Partial<Parameters<typeof planCraftTemplateBeats>[0]> = {}) =>
  planCraftTemplateBeats({skill: 'explainer', durationSec: 40, words, kineticStory: false, ...extra});

describe('WP54 Phase A: craft standards', () => {
  it('exports the easing tokens, duration bands, stagger + restraint helpers', () => {
    expect(Object.keys(craft.CRAFT_EASING)).toEqual(['enterEaseOut', 'exitEaseIn', 'moveInOut', 'playfulOvershoot']);
    for (const token of Object.values(craft.CRAFT_EASING)) expect(token.css).toMatch(/^cubic-bezier\(/);
    expect(Object.keys(craft.CRAFT_DURATION_BANDS)).toEqual(['micro', 'ui', 'hero', 'cinematic']);
    expect(craft.CRAFT_DURATION_BANDS.micro).toMatchObject({minSec: 0.1, maxSec: 0.2});
    expect(craft.CRAFT_DURATION_BANDS.hero).toMatchObject({minSec: 0.4, maxSec: 0.8});
    expect(craft.clampToBand('ui', 5)).toBe(0.4);
    expect(craft.staggerStepSec(2)).toBeLessThanOrEqual(0.08);
    expect(craft.staggerStepSec(40)).toBeGreaterThanOrEqual(0.02);
    expect(craft.staggerDelaySec(9, 10)).toBeLessThanOrEqual(0.8 + 1e-9);
    expect(craft.maxSimultaneous(9)).toBe(3);
    expect(craft.obeysSimultaneity(9, 3)).toBe(true);
    expect(craft.obeysSimultaneity(9, 4)).toBe(false);
    expect(craft.maxFullscreenGfx(60)).toBe(craft.CRAFT_MAX_FULLSCREEN_GFX_PER_MINUTE);
    expect(craft.maxFullscreenGfx(4)).toBe(0);
    expect(craft.fullscreenBudgetAllows(30, craft.maxFullscreenGfx(30))).toBe(false);
    expect(craft.CRAFT_SAFE_AREA_NOTE).toMatch(/caption band/);
  });

  it('the Remotion timing tokens equal the server tokens (one set of curves)', () => {
    expect([...ENTER_EASE_OUT]).toEqual([...craft.CRAFT_EASING.enterEaseOut.bezier]);
    expect([...EXIT_EASE_IN]).toEqual([...craft.CRAFT_EASING.exitEaseIn.bezier]);
    expect([...MOVE_IN_OUT]).toEqual([...craft.CRAFT_EASING.moveInOut.bezier]);
    expect([...PLAYFUL_OVERSHOOT]).toEqual([...craft.CRAFT_EASING.playfulOvershoot.bezier]);
    expect(staggerStep(2)).toBe(craft.staggerStepSec(2));
    expect(staggerStep(40)).toBe(craft.staggerStepSec(40));
    expect(CHAR_STAGGER_MAX_CHARS).toBe(24);
    expect(bezierAt(ENTER_EASE_OUT, 0)).toBe(0);
    expect(bezierAt(ENTER_EASE_OUT, 1)).toBe(1);
    expect(bezierAt(ENTER_EASE_OUT, 0.2)).toBeGreaterThan(0.5); // ease-out is front-loaded
    expect(bezierAt(PLAYFUL_OVERSHOOT, 0.7)).toBeGreaterThan(1); // the one overshoot
    expect(morphWeight(0)).toBe(400);
    expect(morphWeight(1)).toBe(900);
    expect(priceCount(0, 79, 47)).toBe(79);
    expect(priceCount(1, 79, 47)).toBe(47);
  });

  it('the Director appendix is short, names the restraint and safe area, and is injected on the polish path only', () => {
    const text = formatCraftStandardsForDirector();
    expect(text).toMatch(/MOTION CRAFT STANDARDS/);
    expect(text).toMatch(/ease-out/);
    expect(text).toMatch(/1\/3/);
    expect(text).toMatch(/full-screen graphics per minute/);
    expect(text.split('\n').length).toBeLessThanOrEqual(8);
    const director = read('server/src/stages/directorV2/creativeDirector.ts');
    expect(director).toMatch(/\+ \(options\.editLooks \? `\\n\\n\$\{formatCraftStandardsForDirector\(\)\}` : ''\)/);
    const analyze = read('server/src/pipeline/analyzeVideo.ts');
    expect(analyze).toMatch(/if \(polishPath\) warnings\.push\('polish_craft:standards:on'\)/);
  });

  it('is not an L1 skill and not a toolkit: no Skill E, no new toolkit ids', () => {
    for (const id of ['riso', 'collage', 'doodle', 'product_demo', 'kinetic_typography', 'promo', 'anidoodle']) expect(EDIT_TOOLKITS.map(t => t.id as string)).not.toContain(id);
    expect(read('server/src/stages/broll/explainerPacing.ts')).not.toMatch(/skill_e|Skill E|craftStandards/);
  });
});

describe('WP54 catalog + allowlists + registry', () => {
  const NEW = ['clip_35_type_word_reveal', 'clip_36_type_line_mask', 'clip_37_type_char_stagger', 'clip_38_type_weight_morph', 'clip_39_logo_reveal', 'clip_40_mesh_gradient_ground', 'clip_41_product_device_frame', 'clip_42_product_cursor_click', 'clip_43_promo_price_drop', 'clip_44_photo_ken_burns'];

  it('catalog ids clip_35..44 exist with the audit toolkits, and WP53 rows are untouched', () => {
    expect(MOTION_TEMPLATE_IDS.slice(34, 44)).toEqual(NEW);
    expect(MOTION_TEMPLATE_IDS.slice(0, 44)).toHaveLength(44); // WP55 appends clip_45..54 (pinned in wp55KineticTypeStory.test.ts)
    const toolkits = Object.fromEntries(MOTION_TEMPLATE_CATALOG.slice(34, 44).map(row => [row.id, row.toolkit]));
    expect(toolkits).toEqual({
      clip_35_type_word_reveal: 'kinetic_text',
      clip_36_type_line_mask: 'kinetic_text',
      clip_37_type_char_stagger: 'kinetic_text',
      clip_38_type_weight_morph: 'kinetic_text',
      clip_39_logo_reveal: 'lockup',
      clip_40_mesh_gradient_ground: 'card',
      clip_41_product_device_frame: 'cutaway',
      clip_42_product_cursor_click: 'cutaway',
      clip_43_promo_price_drop: 'counter',
      clip_44_photo_ken_burns: 'zoom',
    });
    for (const row of MOTION_TEMPLATE_CATALOG.slice(34, 44)) {
      expect(row.lane).toBe('wp54');
      expect(row.backend).toBeUndefined();
      expect(WP54_TEMPLATE_REGISTRY_IDS[row.id]).toBe(row.compositionId);
    }
    expect(motionTemplate('clip_40_mesh_gradient_ground')).toMatchObject({ownsFrame: false, placement: 'overlay'});
    expect(MOTION_TEMPLATE_CATALOG.slice(34, 44).filter(row => row.gated === 'product').map(row => row.id)).toEqual(['clip_41_product_device_frame', 'clip_42_product_cursor_click', 'clip_43_promo_price_drop', 'clip_44_photo_ken_burns']);
  });

  it('allowlists: type on explainer / default / textual_mg / newsroom (as appropriate); product only default + explainer; faceless photo_ken_burns only', () => {
    const skillsOf = (id: string) => Object.entries(SKILL_MOTION_TEMPLATE_ALLOWLIST).filter(([, list]) => list.includes(id as never)).map(([skill]) => skill).sort();
    expect(skillsOf('clip_35_type_word_reveal')).toEqual(['default', 'explainer', 'newsroom_mg', 'textual_mg']);
    expect(skillsOf('clip_37_type_char_stagger')).toEqual(['default', 'explainer', 'textual_mg']);
    expect(skillsOf('clip_39_logo_reveal')).toEqual(['default', 'explainer']);
    for (const id of ['clip_41_product_device_frame', 'clip_42_product_cursor_click', 'clip_43_promo_price_drop']) expect(skillsOf(id)).toEqual(['default', 'explainer']);
    expect(skillsOf('clip_44_photo_ken_burns')).toEqual(['default', 'explainer', 'faceless']);
    expect(SKILL_MOTION_TEMPLATE_ALLOWLIST.faceless.filter(id => NEW.includes(id))).toEqual(['clip_44_photo_ken_burns']);
  });

  it('the WP45 native planner never picks a WP54 row', () => {
    const text = 'Never settle. Here is the product gallery with photos and the sale countdown and a notification message then proof';
    const result = planMotionTemplateBeats({skill: 'explainer', durationSec: 40, words: speech([[text, 1]])});
    for (const beat of result.beats) expect(NEW).not.toContain(beat.templateId);
  });

  it('every new row resolves through the library registry (opaque, silent; mesh = overlay only)', () => {
    const cases: Record<string, Record<string, unknown>> = {
      clip_35_type_word_reveal: {text: 'Nothing works like this'},
      clip_36_type_line_mask: {lines: ['The real secret,', 'stop guessing']},
      clip_37_type_char_stagger: {text: 'Never again'},
      clip_38_type_weight_morph: {text: 'Think bigger'},
      clip_39_logo_reveal: {logoSrc: 'https://cdn.example.com/logo.png'},
      clip_41_product_device_frame: {imageSrc: SHOT, device: 'phone'},
      clip_42_product_cursor_click: {imageSrc: SHOT, target: {x: 0.7, y: 0.3}},
      clip_43_promo_price_drop: {was: 79, now: 47, prefix: '$'},
      clip_44_photo_ken_burns: {imageSrc: SHOT, focus: {x: 0.4, y: 0.4}},
    };
    for (const [id, content] of Object.entries(cases)) {
      const hit = resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: id, ...content}})!;
      expect(hit.compositionId, id).toBe(WP54_TEMPLATE_REGISTRY_IDS[id]);
      expect(resolveLibraryGraphic({placement: 'overlay', content: {motionTemplateId: id, ...content}}), id).toBeNull();
      expect(libraryGraphicSource(hit)).toContain(`import {${hit.compositionId}`);
    }
    expect(resolveLibraryGraphic({placement: 'overlay', content: {motionTemplateId: 'clip_40_mesh_gradient_ground', accent: '#FD5D42'}})!.compositionId).toBe('MeshGradientGround');
    expect(resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_40_mesh_gradient_ground'}})).toBeNull();
    // assets travel as assets, not literals
    const shot = resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_41_product_device_frame', imageSrc: SHOT}})!;
    expect(shot.assets).toEqual({photo: {src: SHOT}});
    expect(JSON.stringify(shot.props)).not.toContain(SHOT);
    expect(libraryGraphicSource(shot)).toMatch(/imageSrc=\{imageSrc\}/);
    const logo = resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_39_logo_reveal', logoSrc: 'https://cdn.example.com/logo.png'}})!;
    expect(libraryGraphicSource(logo)).toMatch(/logoSrc=\{logoSrc\}/);
  });

  it('the registry itself refuses an over-long char-stagger, a non-drop price, a bad doodle style', () => {
    expect(resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_37_type_char_stagger', text: 'x'.repeat(25)}})!.props.text).toBeUndefined();
    expect(resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_43_promo_price_drop', was: 47, now: 79}})!.props.was).toBeUndefined();
    expect(resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_34_doodle_explain', style: 'ballpoint'}})!.props.style).toBeUndefined();
    expect(resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_34_doodle_explain', style: 'chalkboard'}})!.props.style).toBe('chalkboard');
  });
});

describe('WP54 kinetic type planner', () => {
  it('an emphatic short phrase picks word / line / char / weight templates', () => {
    const s = (text: string) => emphaticPhraseOf(sentencesOfWords(speech([[text, 1]]))[0]!);
    expect(s('Nothing works like this.')?.templateId).toBe('clip_35_type_word_reveal');
    expect(s('The real secret, stop guessing.')?.templateId).toBe('clip_36_type_line_mask');
    expect(s('Never again.')?.templateId).toBe('clip_37_type_char_stagger');
    expect(s('Think bigger.')?.templateId).toBe('clip_38_type_weight_morph');
  });

  it('a full caption-length sentence is refused (captions already carry it); digits belong to the number tools', () => {
    expect(emphaticPhraseOf(sentencesOfWords(speech([['So what I did was go through the whole process step by step with every single customer last week.', 1]]))[0]!)).toBeNull();
    expect(emphaticPhraseOf(sentencesOfWords(speech([['Never pay 200 dollars.', 1]]))[0]!)).toBeNull();
    // a long sentence yields only its short punchline clause
    expect(emphaticPhraseOf(sentencesOfWords(speech([['After years of trying everything out there, nothing works like this.', 1]]))[0]!)?.text).toBe('nothing works like this');
    const planned = plan(speech([['So what I did was go through the whole process step by step with every single customer last week.', 2]]));
    expect(planned.beats).toEqual([]);
  });

  it('plans <= 2 type beats per edit, spaced, silent, owning the frame (captions muted)', () => {
    const words = speech([['Nothing works like this.', 3], ['Never again.', 10], ['Think bigger.', 17], ['Stop guessing now.', 24]]);
    const result = plan(words);
    const type = result.beats.filter(b => motionTemplate(b.templateId)?.toolkit === 'kinetic_text');
    expect(type.length).toBeGreaterThan(0);
    expect(type.length).toBeLessThanOrEqual(2);
    for (const beat of type) expect(beat.muteCaptions).toBe(true);
    for (let i = 1; i < result.beats.length; i++) expect(result.beats[i]!.start - result.beats[i - 1]!.end).toBeGreaterThanOrEqual(4 - 1e-6);
    expect(result.captionMuteRanges).toHaveLength(result.beats.length);
  });

  it('never stacks with a blocked range (riso / StatHighlight on the same number / full-frame graphics)', () => {
    const words = speech([['Nothing works like this.', 3]]);
    const open = plan(words);
    expect(open.beats).toHaveLength(1);
    const blocked = plan(words, {blockedRanges: [{start: open.beats[0]!.start + 0.5, end: open.beats[0]!.end - 0.5}]});
    expect(blocked.beats).toEqual([]);
    // a number sentence is never a type beat, and the riso planner owns it
    const number = speech([['Over 200 people joined.', 3]]);
    expect(plan(number).beats).toEqual([]);
    const riso = planVisualBackendBeats({skill: 'explainer', durationSec: 40, words: number, flags: {riso: true, collage: false, anidoodle: false}});
    expect(riso.beats.map(b => b.templateId)).toEqual(['clip_27_riso_number']);
  });

  it('the shared full-screen budget stops the planner (restraint)', () => {
    const words = speech([['Nothing works like this.', 3]]);
    const spent = plan(words, {existingFullscreenCount: craft.maxFullscreenGfx(40)});
    expect(spent.beats).toEqual([]);
    expect(spent.warnings).toContain('craft_templates:budget_exhausted');
  });

  it('char stagger is refused above 24 characters (binder) and a phrase must be spoken verbatim', () => {
    const words = speech([['Absolutely nothing works like this at all.', 3]]);
    const base = {templateId: 'clip_37_type_char_stagger' as const, words, beatStart: 3, beatEnd: 6};
    expect(bindMotionTemplateContent({...base, hint: {text: 'Absolutely nothing works like this at all'}})).toBeNull();
    const ok = bindMotionTemplateContent({...base, hint: {text: 'Absolutely nothing'}, accent: '#FD5D42'});
    expect(ok).toMatchObject({text: 'Absolutely nothing', accent: '#FD5D42'});
    expect(bindMotionTemplateContent({...base, hint: {text: 'Totally invented'}})).toBeNull();
    expect(bindMotionTemplateContent({...base, templateId: 'clip_35_type_word_reveal', hint: {text: 'Totally invented words here'}})).toBeNull();
    const word = bindMotionTemplateContent({...base, templateId: 'clip_35_type_word_reveal', hint: {text: 'nothing works like this'}, accent: '#FD5D42', ground: '#0A0A20', ink: '#F5F5F5'});
    expect(word).toMatchObject({text: 'nothing works like this', ground: '#0A0A20', ink: '#F5F5F5'});
  });
});

describe('WP54 gated ecommerce', () => {
  const clickSpeech = speech([['Just click export and your report is ready.', 4]]);
  const appSpeech = speech([['Here is the dashboard inside the app.', 4]]);

  it('no screenshots + no prices -> ZERO product beats, even on a sales pitch', () => {
    const talking = speech([['Our offer is incredible and everyone loves it.', 3], ['Click the link below to get started.', 12]]);
    const result = plan(talking, {contentType: 'sales_pitch'});
    expect(result.beats.filter(b => /product|promo|photo/.test(b.templateId))).toEqual([]);
    expect(result.warnings).toContain('craft_templates:product:gated:no_screenshots_or_price');
    expect(productGate({contentType: 'sales_pitch'})).toEqual({pass: false, reason: 'no_screenshots_or_price'});
  });

  it('screenshots without a product / sales profile -> still zero (not a ordinary talking-head spam path)', () => {
    expect(plan(clickSpeech, {contentType: 'story', screenshotUrls: [SHOT]}).beats).toEqual([]);
    expect(plan(clickSpeech, {screenshotUrls: [SHOT]}).beats).toEqual([]);
  });

  it('a provided screenshot + "click export" -> cursor click; "here is the dashboard" -> device frame', () => {
    const click = plan(clickSpeech, {contentType: 'tutorial', screenshotUrls: [SHOT]});
    expect(click.beats.map(b => b.templateId)).toEqual(['clip_42_product_cursor_click']);
    const device = plan(appSpeech, {contentType: 'sales_pitch', screenshotUrls: [SHOT]});
    expect(device.beats.map(b => b.templateId)).toEqual(['clip_41_product_device_frame']);
    expect(device.beats[0]!.hint).toEqual({device: 'browser'});
    // the binder needs the screenshot too
    const base = {words: clickSpeech, beatStart: 4, beatEnd: 8};
    expect(bindMotionTemplateContent({...base, templateId: 'clip_42_product_cursor_click'})).toBeNull();
    expect(bindMotionTemplateContent({...base, templateId: 'clip_42_product_cursor_click', screenshotUrls: [SHOT]})).toMatchObject({imageSrc: SHOT});
    expect(bindMotionTemplateContent({...base, templateId: 'clip_41_product_device_frame', imageUrls: [SHOT]})).toBeNull(); // stock stills are not screenshots
  });

  it('promo: "was 79 now 47" is grounded -> price drop; an invented $999 is refused', () => {
    const words = speech([['Normally the course was 79 but now only 47 today.', 4]]);
    expect(spokenPricePair('Normally the course was 79 but now only 47 today.')).toEqual({was: 79, now: 47, prefix: ''});
    const result = plan(words, {contentType: 'sales_pitch'});
    expect(result.beats.map(b => b.templateId)).toEqual(['clip_43_promo_price_drop']);
    expect(result.beats[0]!.hint).toMatchObject({was: 79, now: 47});
    const base = {templateId: 'clip_43_promo_price_drop' as const, words, beatStart: 4, beatEnd: 8};
    expect(bindMotionTemplateContent({...base, hint: {was: 79, now: 47}})).toMatchObject({was: 79, now: 47});
    expect(bindMotionTemplateContent({...base, hint: {was: 999, now: 47}})).toBeNull();
    expect(bindMotionTemplateContent({...base, hint: {was: 79, now: 12}})).toBeNull();
    expect(bindMotionTemplateContent({...base, hint: {was: 47, now: 79}})).toBeNull();
    // the labeled asset brief may ground a price the transcript does not state
    expect(bindMotionTemplateContent({...base, hint: {was: 999, now: 47}, assetBriefPrices: [999, 47]})).toMatchObject({was: 999, now: 47});
    // no price pair anywhere -> no price beat at all
    expect(plan(speech([['Our deal is amazing and you should grab it.', 4]]), {contentType: 'sales_pitch'}).beats).toEqual([]);
    expect(planCraftTemplateBeats({skill: 'explainer', durationSec: 40, words: speech([['Grab this deal and save big.', 4]]), contentType: 'sales_pitch', assetBriefPrices: [99, 49]}).beats.map(b => b.templateId)).toEqual(['clip_43_promo_price_drop']);
  });

  it('promo and clip_23 never fire on the same window (craft spans block the WP45 planner)', () => {
    const words = speech([['Normally the course was 79 but now only 47 sale today.', 4]]);
    const craftPlan = plan(words, {contentType: 'sales_pitch'});
    expect(craftPlan.beats[0]!.templateId).toBe('clip_43_promo_price_drop');
    const blocked = craftPlan.beats.map(b => ({start: b.start, end: b.end}));
    const native = planMotionTemplateBeats({skill: 'explainer', durationSec: 40, words, blockedRanges: blocked});
    expect(native.beats.filter(b => b.templateId === 'clip_23_sale_promo')).toEqual([]);
  });

  it('photo ken burns: faceless may take it on an existing still; other lanes only through the product gate', () => {
    const words = speech([['Look at this photo of the first prototype.', 4]]);
    const faceless = planCraftTemplateBeats({skill: 'faceless', durationSec: 40, words, imageUrls: [SHOT], kineticStory: false});
    expect(faceless.beats.map(b => b.templateId)).toEqual(['clip_44_photo_ken_burns']);
    expect(planCraftTemplateBeats({skill: 'faceless', durationSec: 40, words, kineticStory: false}).beats).toEqual([]);
    expect(planCraftTemplateBeats({skill: 'explainer', durationSec: 40, words, imageUrls: [SHOT], kineticStory: false}).beats).toEqual([]);
    expect(bindMotionTemplateContent({templateId: 'clip_44_photo_ken_burns', words, beatStart: 4, beatEnd: 8, imageUrls: [SHOT]})).toMatchObject({imageSrc: SHOT});
  });
});

describe('WP54 logo + mesh ground (sparse)', () => {
  const cta = speech([['Follow for more and visit the site.', 33]]);

  it('logo reveal needs logoSrc: otherwise skipped with a warning', () => {
    const none = plan(cta);
    expect(none.beats).toEqual([]);
    expect(none.warnings).toContain('craft_templates:logo:skipped:no_logo_src');
    const withLogo = plan(cta, {logoSrc: 'https://cdn.example.com/logo.png'});
    expect(withLogo.beats.map(b => b.templateId)).toEqual(['clip_39_logo_reveal']);
    expect(bindMotionTemplateContent({templateId: 'clip_39_logo_reveal', words: cta, beatStart: 33, beatEnd: 36})).toBeNull();
    expect(bindMotionTemplateContent({templateId: 'clip_39_logo_reveal', words: cta, beatStart: 33, beatEnd: 36, logoSrc: 'https://cdn.example.com/logo.png'})).toMatchObject({logoSrc: 'https://cdn.example.com/logo.png'});
  });

  it('mesh ground: at most one, ambient only, overlay that does not mute captions', () => {
    const words = speech([['Imagine the future of this idea.', 4], ['Picture a calm morning.', 20]]);
    const result = plan(words);
    const mesh = result.beats.filter(b => b.templateId === 'clip_40_mesh_gradient_ground');
    expect(mesh).toHaveLength(1);
    expect(mesh[0]!.muteCaptions).toBe(false);
    expect(result.captionMuteRanges.some(r => r.start === mesh[0]!.start)).toBe(false);
    const content = bindMotionTemplateContent({templateId: 'clip_40_mesh_gradient_ground', words, beatStart: 4, beatEnd: 8, accent: '#FD5D42'});
    expect(content).toMatchObject({accent: '#FD5D42'});
    // it is the budget-free layer: spending the whole full-screen budget does not remove it
    expect(plan(words, {existingFullscreenCount: 99}).beats.map(b => b.templateId)).toContain('clip_40_mesh_gradient_ground');
  });
});

describe('WP54 finished WP53 backends', () => {
  it('riso video: GeneratedGraphicTrack plays a backend mp4; prefetch collects + rewrites it', () => {
    const track = read('remotion/src/generated/GeneratedGraphicTrack.tsx');
    expect(track).toMatch(/OffthreadVideo/);
    expect(track).toMatch(/export function backendVideoSrc/);
    expect(track).toMatch(/props\.backend !== 'riso'/);
    expect(track).toMatch(/muted/);
    expect(backendVideoUrlOf({props: {backend: 'riso', assetUrl: '/abs/cache/abc.mp4'}})).toBe('/abs/cache/abc.mp4');
    expect(backendVideoUrlOf({props: {backend: 'riso', assetUrl: ''}})).toBe('');
    expect(backendVideoUrlOf({props: {backend: 'native', assetUrl: '/abs/cache/abc.mp4'}})).toBe('');
    expect(backendVideoUrlOf({props: {backend: 'riso', assetUrl: 'https://x/y.png'}})).toBe('');
    const prefetch = read('server/src/stages/render/prefetchAssets.ts');
    expect(prefetch).toMatch(/add\(backendVideoUrlOf\(graphic\)\)/);
    expect(prefetch).toMatch(/assetUrl: swap\(video\)/);
  });

  it('clip_30 converge now has a native StackedCardDeck fallback (many -> few)', () => {
    const beat = planVisualBackendBeats({skill: 'explainer', durationSec: 30, words: speech([['We cut it from 30 tools to 4 categories', 1]]), flags: {riso: true, collage: false, anidoodle: false}}).beats[0]!;
    const fallback = nativeFallbackFor(beat)!;
    expect(fallback.composition).toBe('StackedCardDeck');
    expect(fallback.content).toMatchObject({cards: [{label: '30 tools'}, {label: '4 categories'}]});
    expect(resolveLibraryGraphic({placement: 'full_screen', content: fallback.content})!.compositionId).toBe('StackedCardDeck');
  });

  it('doodle: clip_34 has a native DoodleDrawOn path (no engine root needed); style from the eight', () => {
    const beat = planVisualBackendBeats({skill: 'explainer', durationSec: 30, words: speech([['Here is how it works inside the engine', 1]]), flags: {riso: false, collage: false, anidoodle: true}, anidoodleConfigured: false}).beats[0]!;
    const fallback = nativeFallbackFor(beat)!;
    expect(fallback.composition).toBe('DoodleDrawOn');
    expect(fallback.content.style).toBe('cut-paper');
    expect(resolveLibraryGraphic({placement: 'full_screen', content: fallback.content})!.compositionId).toBe('DoodleDrawOn');
    const comp = read('remotion/src/motion/compositions/templates/DoodleDrawOn.tsx');
    expect(comp).toMatch(/strokeDashoffset/);
    for (const style of ['cut-paper', 'pencil-watercolor', 'isometric', 'risograph', 'marker-comic', 'pixel', 'chalkboard', 'cyanotype']) expect(comp).toContain(`'${style}'`);
  });

  it('collage stays fail-closed without COLLAGE_RENDER=1 (no Gemini in tests)', () => {
    expect(env.COLLAGE_RENDER ?? false).toBeFalsy();
    const stage = read('server/src/stages/broll/visualBackend/visualBackendStage.ts');
    expect(stage).toMatch(/fail closed/);
    expect(read('server/src/stages/broll/visualBackend/collageAdapter.ts')).not.toMatch(/fetch\(|generativelanguage/);
  });
});

describe('WP54 flags + wiring', () => {
  it('riso / collage / anidoodle stay default OFF; the native craft rows ride the existing POLISH_MOTION_TEMPLATES flag (no new flag)', () => {
    expect(env.POLISH_RISO_TEMPLATES).toBe(false);
    expect(env.POLISH_COLLAGE_BROLL).toBe(false);
    expect(env.POLISH_ANIDOODLE).toBe(false);
    expect(env.POLISH_MOTION_TEMPLATES).toBe(false);
    expect(read('server/src/config/env.ts')).not.toMatch(/POLISH_KINETIC_TYPE/);
    const analyze = read('server/src/pipeline/analyzeVideo.ts');
    expect(analyze).toMatch(/if \(polishPath && flags\.motionTemplates && motion\) \{\s*try \{\s*const slotUrls/);
    expect(analyze.indexOf('runVisualBackendStage(')).toBeLessThan(analyze.indexOf('runCraftTemplateStage('));
    expect(analyze.indexOf('runCraftTemplateStage(')).toBeLessThan(analyze.indexOf('runMotionTemplateStage('));
    expect(analyze).toMatch(/motionTemplateMute = \[\.\.\.motionTemplateMute, \.\.\.craftTemplateMute\]/);
    const stage = read('server/src/stages/broll/craftTemplateStage.ts');
    expect(stage).not.toMatch(/sfxHit|playSfx|audio:|process\.env|config\/env/i);
  });

  it('resolvePolishSkill priority is unchanged', () => {
    expect(resolvePolishSkill({faceless: true, explainer: true, newsroom: true}).skill).toBe('faceless');
    expect(resolvePolishSkill({faceless: false, explainer: true, newsroom: true}).skill).toBe('newsroom_mg');
    expect(resolvePolishSkill({faceless: false, explainer: true}).skill).toBe('explainer');
    expect(resolvePolishSkill({faceless: false, explainer: false}).skill).toBe('default');
  });

  it('the new Remotion comps are silent, palette-driven and registered in the barrel', () => {
    const barrel = read('remotion/src/motion/index.ts');
    for (const name of ['WordRevealType', 'LineMaskReveal', 'CharStaggerType', 'WeightMorphType', 'DoodleDrawOn', 'LogoReveal', 'MeshGradientGround', 'ProductDeviceFrame', 'ProductCursorClick', 'PromoPriceDrop', 'PhotoKenBurns']) {
      expect(barrel, name).toContain(name);
      const source = read('remotion/src/motion/compositions/templates', `${name}.tsx`);
      expect(source, name).not.toMatch(/<Audio|playSfx|Math\.random|filter:\s*`?blur/);
    }
    for (const name of ['WordRevealType', 'LineMaskReveal', 'CharStaggerType', 'WeightMorphType']) expect(read('remotion/src/motion/compositions/templates', `${name}.tsx`)).toMatch(/typePalette/);
    expect(read('remotion/src/motion/compositions/templates/typeShared.tsx')).toMatch(/hexOr\(props\.accent\)/);
  });
});
