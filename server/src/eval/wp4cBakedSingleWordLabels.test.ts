/**
 * WP4C pure tests: a single word held in a variable or a const array of strings is collected only when the component actually shows it (a JSX child, a text-like attribute, mapped or indexed
 * into one). Small TSX strings; the shared matcher; no model call. bakedGraphicText.ts imports only `typescript` and groundedText.ts; analyzeVideo.ts (logger) is read as text.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {bakedWordsNotAllowed, dropGraphicsWithBakedText, visibleStringsInSource} from '../stages/broll/bakedGraphicText.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

const TRANSCRIPT = 'Today I use After Effects and Premiere Pro to cut my videos. The hook is key, so save time.';
const component = (body: string) => `import {Text, Stack} from '@finalpost/motion';\nexport default function G({content}: {content: {title: string}}) {\n  ${body}\n}\n`;
const baked = (source: string, content: unknown = {title: 'Save time'}) => bakedWordsNotAllowed({source, content, transcript: TRANSCRIPT});

describe('a const array of single words that is shown', () => {
  it("['Plan', 'Shoot'] mapped into labels is collected, and its words are reported", () => {
    const src = component(`const steps = ['Plan', 'Shoot']; return <Stack>{steps.map(step => <Text key={step}>{step}</Text>)}</Stack>;`);
    expect(visibleStringsInSource(src)).toEqual(expect.arrayContaining(['Plan', 'Shoot']));
    expect(baked(src)).toEqual(['plan', 'shoot']);
  });
  it('the graphic is dropped by the existing drop function, with the words', () => {
    const src = component(`const steps = ['Plan', 'Shoot']; return <Stack>{steps.map(step => <Text>{step}</Text>)}</Stack>;`);
    const graphic = {id: 'g1', props: {content: {title: 'Save time'}}};
    const result = dropGraphicsWithBakedText([graphic], new Map([['g1', src]]), new Map(), TRANSCRIPT);
    expect(result.kept).toEqual([]);
    expect(result.dropped).toEqual([{graphic, words: ['plan', 'shoot']}]);
  });
  it('the same array, never used, is not collected', () => {
    const src = component(`const steps = ['Plan', 'Shoot']; return <Stack><Text>Save time</Text></Stack>;`);
    expect(visibleStringsInSource(src).join('|')).not.toMatch(/Plan|Shoot/);
    expect(baked(src)).toEqual([]);
  });
  it('mapped into a text-like attribute, indexed into text, indexed into an attribute, and through slice/filter', () => {
    expect(baked(component(`const steps = ['Plan', 'Shoot']; return <Stack>{steps.map(s => <Text label={s} />)}</Stack>;`))).toEqual(['plan', 'shoot']);
    expect(baked(component(`const steps = ['Plan', 'Shoot']; return <Text>{steps[0]}</Text>;`))).toEqual(['plan', 'shoot']);
    expect(baked(component(`const steps = ['Plan', 'Shoot']; const i = 1; return <Text title={steps[i % steps.length]} />;`))).toEqual(['plan', 'shoot']);
    expect(baked(component(`const steps = ['Plan', 'Shoot']; return <Stack>{steps.slice(0, 1).map(s => <Text>{s}</Text>)}</Stack>;`))).toEqual(['plan', 'shoot']);
    expect(baked(component(`const steps = ['Plan', 'Shoot']; return <Stack>{steps.map(s => <Text>{s ? s : 'x'}</Text>)}</Stack>;`))).toEqual(['plan', 'shoot']);
  });
  it('mapped, but the item only reaches a key, a class name or a style, is not collected', () => {
    expect(baked(component(`const steps = ['Plan', 'Shoot']; return <Stack>{steps.map(s => <Text key={s} className={s}>Save time</Text>)}</Stack>;`))).toEqual([]);
    expect(baked(component(`const steps = ['Plan', 'Shoot']; return <Stack>{steps.map((s, i) => <Text style={{color: s}}>{i}</Text>)}</Stack>;`))).toEqual([]);
  });
  it('words that were spoken or are in props.content stay', () => {
    expect(baked(component(`const tools = ['Premiere', 'Effects']; return <Stack>{tools.map(t => <Text>{t}</Text>)}</Stack>;`))).toEqual([]);
    expect(baked(component(`const steps = ['Plan', 'Shoot']; return <Stack>{steps.map(t => <Text>{t}</Text>)}</Stack>;`), {title: 'Plan then shoot'})).toEqual([]);
  });
  it('only const arrays whose elements are ALL strings count; a let array or a mixed array does not', () => {
    expect(baked(component(`let steps = ['Plan', 'Shoot']; return <Stack>{steps.map(s => <Text>{s}</Text>)}</Stack>;`))).toEqual([]);
    expect(baked(component(`const steps = ['Plan', 3]; return <Stack>{steps.map(s => <Text>{s}</Text>)}</Stack>;`))).toEqual([]);
  });
});

describe('a const or let string that is shown', () => {
  it('a JSX child or a text-like attribute is collected', () => {
    expect(baked(component(`const heading = 'Recommended'; return <Text>{heading}</Text>;`))).toEqual(['recommended']);
    expect(baked(component(`let word = 'Recommended'; return <Text label={word} />;`))).toEqual(['recommended']);
    expect(baked(component(`const word = 'Recommended'; return <Text>{cond ? word : null}</Text>;`))).toEqual(['recommended']);
    expect(baked(component(`const word = 'Recommended'; return <Text>{(word)}</Text>;`))).toEqual(['recommended']);
  });
  it('a spoken word in a const stays', () => {
    expect(baked(component(`const tool = 'Premiere'; return <Text>{tool}</Text>;`))).toEqual([]);
  });
  it('a word in props.content stays', () => {
    expect(baked(component(`const tool = 'Zebra'; return <Text>{tool}</Text>;`), {title: 'Zebra'})).toEqual([]);
  });
  it('a const that is never shown is not collected', () => {
    expect(baked(component(`const heading = 'Recommended'; return <Text>Save time</Text>;`))).toEqual([]);
  });
});

describe('configuration stays ignored', () => {
  it('a class name, colour, font name, easing, URL or SVG path in a variable stays out, even when the variable is used', () => {
    const src = component(`
      const cls = 'highlight'; const color = 'crimson'; const font = 'Garamond'; const ease = 'inOut'; const url = 'https://cdn.example/a.png'; const d = 'M0 0 L10 10';
      return <Stack className={cls} style={{color, fontFamily: font}} easing={ease} src={url}><path d={d} fill={color} /></Stack>;`);
    expect(baked(src)).toEqual([]);
    expect(visibleStringsInSource(src)).toEqual([]);
  });
  it('a const used only through a non-text attribute (key, id, variant, size) stays out', () => {
    expect(baked(component(`const variant = 'bold'; const id = 'chart'; return <Text variant={variant} id={id}>Save time</Text>;`))).toEqual([]);
  });
  it('a URL or colour held in a variable that IS shown is still ignored', () => {
    expect(baked(component(`const hex = '#ff0000'; const link = 'https://cdn.example/a'; return <Text>{hex}{link}</Text>;`))).toEqual([]);
  });
});

describe('scope', () => {
  it('imports are not followed: words from another file are out of scope', () => {
    expect(baked(component(`import {words} from './words'; return <Stack>{words.map(w => <Text>{w}</Text>)}</Stack>;`))).toEqual([]);
    expect(baked(`import {steps} from './steps';\nexport default function G() { return <Stack>{steps.map(s => <Text>{s}</Text>)}</Stack>; }`)).toEqual([]);
  });
  it('earlier behaviour is unchanged: JSX text, text-like attributes, phrase arrays', () => {
    expect(baked(component('return <Text>Recommended Software</Text>;'))).toEqual(['recommended', 'software']);
    expect(baked(component(`const lines = ['Open the app', 'Pick a color']; return <Text>x</Text>;`))).toEqual(expect.arrayContaining(['open', 'pick', 'color']));
  });
  it('invalid TSX does not throw', () => {
    expect(() => visibleStringsInSource('const steps = [\'Plan\'; steps.map(')).not.toThrow();
  });
  it('no source: nothing is claimed; a graphic with no source stays', () => {
    expect(bakedWordsNotAllowed({content: {}, transcript: TRANSCRIPT})).toEqual([]);
    const graphic = {id: 'g2', props: {content: {}}};
    expect(dropGraphicsWithBakedText([graphic], new Map(), new Map(), TRANSCRIPT).kept).toEqual([graphic]);
  });
  it('a graphic with spoken words only stays, as the same object', () => {
    const src = component(`const tools = ['Premiere', 'Effects']; return <Stack>{tools.map(t => <Text>{t}</Text>)}</Stack>;`);
    const graphic = {id: 'g3', props: {content: {title: 'x'}}};
    const result = dropGraphicsWithBakedText([graphic], new Map([['g3', src]]), new Map(), TRANSCRIPT);
    expect(result.kept[0]).toBe(graphic);
    expect(result.dropped).toEqual([]);
  });
});

describe('wiring (source text)', () => {
  const analyze = stripComments(read('pipeline', 'analyzeVideo.ts'));
  const module = stripComments(read('stages', 'broll', 'bakedGraphicText.ts'));
  it('the collector is still only called through dropGraphicsWithBakedText, once, inside the mvp block, and the ledger reason is ungrounded_text', () => {
    expect(analyze.match(/dropGraphicsWithBakedText\(/g)).toHaveLength(1);
    const mvp = analyze.indexOf("input.editProfile === 'mvp' && !captionsOnly");
    expect(analyze.indexOf('dropGraphicsWithBakedText(')).toBeGreaterThan(mvp);
    const block = analyze.slice(analyze.indexOf('const baked = dropGraphicsWithBakedText('), analyze.indexOf('grounded.kept = baked.kept;'));
    expect(block).toContain("ledger.drop(entry.id, 'plan_assembly', 'ungrounded_text')");
  });
  it('the module still imports only typescript and the shared matcher, and has no model call or logger', () => {
    expect([...module.matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1]).sort()).toEqual(['./groundedText.ts', 'typescript']);
    expect(module).not.toMatch(/logger|anthropic|claude\(|fetch\(|generator/i);
  });
  it('no new matcher: the tokenising regex is still only in groundedText.ts', () => {
    expect(module).not.toMatch(/\\p\{L\}\\p\{N\}|toLowerCase\(\)\.split|normalize\('NFD'\)/);
  });
  it('the defaults are untouched', () => {
    const env = stripComments(read('config', 'env.ts'));
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE:[^\n]*cuts/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED:\s*bool\(false\)/);
  });
});
