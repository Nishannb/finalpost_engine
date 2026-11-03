/**
 * WP3T pure tests: words a generated graphic can show that are not in props.content (a headline baked into the component's TSX, a toolkit text treatment's words in the brief). Small TSX
 * strings and brief objects; no model call. stages/broll/bakedGraphicText.ts imports only `typescript` (the parser the worker's typecheck already uses) and the shared matcher. The worker,
 * the prompt, the contract and analyzeVideo (logger, SDK path) are read as text. No logger, `.env`, SDK, FFmpeg, Chromium or network.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {bakedWordsNotAllowed, dropGraphicsWithBakedText, visibleStringsInSource} from '../stages/broll/bakedGraphicText.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), 'utf8');

const TRANSCRIPT = 'Today I use After Effects and Premiere Pro to cut my videos. The hook is key, so save time.';
const component = (body: string) => `import {Text, Stack} from '@finalpost/motion';\nexport default function G({content}: {content: {title: string}}) {\n  ${body}\n}\n`;
const baked = (source: string, content: unknown = {title: 'Save time'}, brief?: unknown) => bakedWordsNotAllowed({source, content, brief: brief as never, transcript: TRANSCRIPT});

describe('what the worker validates, and what it does not (source text)', () => {
  const contract = read('motionWorker', 'contract.ts');
  const worker = read('motionWorker', 'worker.ts');
  it('the safety contract bans network, code evaluation, globals, raw media and similar; it has no rule about string literals or JSX text', () => {
    const banned = contract.slice(contract.indexOf('const BANNED'), contract.indexOf('export const MAX_SOURCE_BYTES'));
    for (const label of ['network: fetch', 'network: URL literal', 'code evaluation', 'global object access', 'raw media element']) expect(banned).toContain(label);
    expect(banned).not.toMatch(/string literal|JSX text|hard-coded (text|copy)|visible text|copy/i);
  });
  it('the worker adds only "must import from @finalpost/motion", then typecheck, compile and a one-frame render', () => {
    expect(worker).toContain("'must import from \"@finalpost/motion\" (build the graphic from the toolkit)'");
    const validate = worker.slice(worker.indexOf('export async function validateGraphicSource'), worker.indexOf('const isClean'));
    expect(validate).toContain('checkSource(source)');
    expect(validate).toContain('typecheckGraphic(source)');
    expect(validate).toContain('compileGraphicSource(source)');
    expect(validate).not.toMatch(/transcript|string literal|isGrounded/);
  });
  it('the only thing that tells the model to take its words from content is a sentence in the prompt (an instruction, not a check)', () => {
    expect(read('motionWorker', 'prompt.ts')).toContain('Read every visible text and number from it (type it as `GraphicProps<Content>`); do not invent facts or copy.');
  });
  it('the blueprint keeps neither the component source nor the text treatment (only kind, purpose and visual intent)', () => {
    const types = read('types', 'blueprint.ts');
    expect(types).toContain('brief?: {kind?: string; purpose?: string; visualIntent?: string};');
    const generated = types.slice(types.indexOf('export type GeneratedGraphic = {'), types.indexOf('};', types.indexOf('export type GeneratedGraphic = {')));
    expect(generated).not.toMatch(/source|textTreatment/);
  });
});

describe('visibleStringsInSource', () => {
  it('collects JSX text, JSX-child strings, text-like attributes, text-like object keys and phrase arrays', () => {
    const src = component(`const steps = [{label: 'Plan'}, {text: 'Shoot'}];
      const lines = ['Open the app', 'Pick a color'];
      return <Stack title="Big idea"><Text>Recommended Software</Text>{'Hello world'}{\`Static \${content.title}\`}</Stack>;`);
    const found = visibleStringsInSource(src);
    for (const expected of ['Plan', 'Shoot', 'Open the app', 'Pick a color', 'Big idea', 'Recommended Software', 'Hello world']) expect(found.join('|'), expected).toContain(expected);
  });
  it('does not collect configuration: class names, colours, font stacks, easing names, paths, URLs, single-word arrays, digits', () => {
    const src = component(`const palette = ['#00E5FF', '#ffffff'];
      const dirs = ['row', 'column'];
      const font = {fontFamily: 'Open Sans', fontWeight: 'bold', easing: 'inOut'};
      const d = 'M0 0 L10 10';
      return <Stack className="flex center" style={{color: '#fff', transform: 'translateX(10px)'}} src="https://cdn.example/a.png">{42}{'1'}</Stack>;`);
    const found = visibleStringsInSource(src);
    expect(found.filter(text => !/^\d+$/.test(text.trim()))).toEqual([]);
  });
  it('does not throw on source that is not valid TSX', () => {
    expect(() => visibleStringsInSource('export default function (')).not.toThrow();
    expect(() => visibleStringsInSource('')).not.toThrow();
  });
});

describe('bakedWordsNotAllowed', () => {
  it('a headline baked into the TSX that is neither spoken nor in content is reported, lower-cased, in order, without repeats', () => {
    const words = baked(component('return <Text>Recommended Software and more recommended software</Text>;'));
    expect(words).toEqual(['recommended', 'software', 'more']);
  });
  it('words that were spoken pass; words that are in props.content pass', () => {
    expect(baked(component('return <Text>Save time and Premiere Pro</Text>;'))).toEqual([]);
    expect(baked(component('return <Text>Zebra crossing</Text>;'), {title: 'Zebra crossing'})).toEqual([]);
  });
  it('only the offending words are reported when a string mixes spoken, content and invented words', () => {
    expect(baked(component('return <Text>Save the zebra crossing guarantee</Text>;'), {title: 'Zebra crossing'})).toEqual(['guarantee']);
  });
  it('text read from props is not baked: the expression `{content.title}` adds nothing', () => {
    expect(baked(component('return <Text>{content.title}</Text>;'), {title: 'Anything at all'})).toEqual([]);
  });
  it('a baked label in a data array or an attribute is found', () => {
    expect(baked(component(`const steps = [{label: 'Plan'}, {label: 'Shoot'}]; return <Stack>{steps.map(s => <Text>{s.label}</Text>)}</Stack>;`))).toEqual(['plan', 'shoot']);
    expect(baked(component('return <Stack title="Secret sauce" />;'))).toEqual(['secret', 'sauce']);
    expect(baked(component(`const lines = ['Open the app']; return <Stack />;`))).toEqual(['open', 'the', 'app'].filter(word => word !== 'the'));
  });
  it('digits and symbols are not words', () => {
    expect(baked(component(`return <Text>{'1'} 20 % — ·</Text>;`))).toEqual([]);
  });
  it('a graphic with no extra words stays: no source, no brief, or a source that shows only content and spoken words', () => {
    expect(bakedWordsNotAllowed({transcript: TRANSCRIPT})).toEqual([]);
    expect(bakedWordsNotAllowed({source: component('return <Stack><Text>{content.title}</Text></Stack>;'), content: {title: 'x'}, transcript: TRANSCRIPT})).toEqual([]);
  });
  it('the brief\'s text treatment words are checked: unspoken fails, spoken passes, content words pass, other brief fields are not text', () => {
    expect(baked(component('return <Stack />;'), {title: 'Save time'}, {textTreatment: {kind: 'curved', text: 'Totally invented'}})).toEqual(['totally', 'invented']);
    expect(baked(component('return <Stack />;'), {title: 'Save time'}, {textTreatment: {kind: 'curved', text: 'Save time'}})).toEqual([]);
    expect(baked(component('return <Stack />;'), {title: 'Totally invented'}, {textTreatment: {kind: 'curved', text: 'Totally invented'}})).toEqual([]);
    expect(baked(component('return <Stack />;'), {title: 'x'}, {goal: 'Totally invented', purpose: 'Unspoken'})).toEqual([]);
    expect(bakedWordsNotAllowed({brief: {textTreatment: {text: 42}}, transcript: TRANSCRIPT})).toEqual([]);
  });
});

describe('dropGraphicsWithBakedText', () => {
  const g = (id: string, start: number, content: unknown) => ({id, start, end: start + 3, props: {content}});
  it('drops only the graphic with baked words, keeps the others as the same objects in order with their times, and a graphic with no known source stays', () => {
    const a = g('a', 1, {title: 'Save time'});
    const b = g('b', 5, {title: 'Save time'});
    const c = g('c', 9, {title: 'Save time'});
    const sources = new Map([['a', component('return <Text>{content.title}</Text>;')], ['b', component('return <Text>Guaranteed results</Text>;')]]);
    const r = dropGraphicsWithBakedText([a, b, c], sources, new Map(), TRANSCRIPT);
    expect(r.kept).toEqual([a, c]);
    expect(r.kept[0]).toBe(a);
    expect(r.kept[1]!.start).toBe(9);
    expect(r.dropped).toEqual([{graphic: b, words: ['guaranteed', 'results']}]);
  });
  it('a toolkit text treatment is checked through the brief map', () => {
    const a = g('a', 1, {title: 'Save time'});
    const r = dropGraphicsWithBakedText([a], new Map(), new Map([['a', {textTreatment: {text: 'Invented claim'}}]]), TRANSCRIPT);
    expect(r.dropped).toHaveLength(1);
    expect(r.kept).toEqual([]);
  });
});

describe('wiring (source text; analyzeVideo imports the logger)', () => {
  const av = read('pipeline', 'analyzeVideo.ts');
  const block = av.slice(av.indexOf("if (mvpLike && !captionsOnly) {"), av.indexOf('const finalized = finalizeEdits({'));
  it('runs only in the mvp block outside caption-only mode, before the validator, after the content check, from the sources and briefs of this run', () => {
    expect(av.match(/dropGraphicsWithBakedText\(/g)).toHaveLength(1);
    expect(block).toContain('dropGraphicsWithBakedText(\n          grounded.kept,');
    expect(block).toContain('(motion.worker?.results ?? []).map(result => [result.id, result.source])');
    expect(block).toContain('(motion.director?.graphics ?? []).map(directed => [directed.brief.id, directed.brief])');
    expect(block.indexOf('dropUngroundedGeneratedGraphics(')).toBeLessThan(block.indexOf('dropGraphicsWithBakedText('));
  });
  it('records ungrounded_text in the ledger, warns, never rewrites a graphic or calls a model, and does not touch the hook', () => {
    const added = block.slice(block.indexOf('// WP3T'), block.indexOf('const behind = dropUngroundedBehindSubject'));
    expect(added).toContain("ledger.drop(entry.id, 'plan_assembly', 'ungrounded_text')");
    expect(block).toContain('legibility:baked_graphic_text_dropped:');
    expect(added).not.toMatch(/hookTitle|runMotionGraphicsStage|generateMotionGraphic|anthropic|callDirectorModel|\.start\s*=|\.end\s*=/);
  });
  it('the new module imports only the TypeScript parser and the shared matcher, and only analyzeVideo uses it', () => {
    const module = read('stages', 'broll', 'bakedGraphicText.ts');
    expect([...module.matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1]).sort()).toEqual(['./groundedText.ts', 'typescript']);
    const code = module.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/logger|process\.env|fetch\(/);
    expect(av.match(/bakedGraphicText\.ts'/g)).toHaveLength(1);
  });
  it('the scorer, the worker and the renderer are unchanged by this package, and the defaults are too', () => {
    expect(read('eval', 'rubricScorer.ts')).not.toMatch(/bakedGraphicText|dropGraphicsWithBakedText/);
    expect(read('motionWorker', 'worker.ts')).not.toMatch(/bakedGraphicText|dropGraphicsWithBakedText/);
    const env = read('config', 'env.ts');
    expect(env).toContain("PRODUCT_EDIT_PROFILE: str('cuts')");
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED: bool\(false\)/);
  });
});
