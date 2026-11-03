/**
 * WP12A: the short-form look system: curated palettes (one marker, strong contrast, never karaoke cyan), video faces (display for titles, body for passages), the caption highlight contract, and the
 * Wiki / Tweet article look. Offline: no model, no render, no network.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {plateContrast, isKaraokeCyan, platePalette} from '../../../../remotion/src/motion/palette.ts';
import {pickShortFormLookId as rendererPick, resolveShortFormLook, SHORT_FORM_LOOK_IDS, SHORT_FORM_LOOKS} from '../../../../remotion/src/motion/looks.ts';
import {resolveTheme} from '../../../../remotion/src/motion/theme.ts';
import {LOOK_CAPTION_HIGHLIGHT, pickShortFormLookId, withShortFormLook} from '../../lib/shortFormLook.ts';
import {validateGraphicSource} from '../../motionWorker/worker.ts';
import {libraryGraphicSource, resolveLibraryGraphic} from '../motionDirector/libraryRegistry.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const comp = (name: string) => read(`../../../../remotion/src/motion/compositions/${name}.tsx`);
const navyCyan = {primary: '#2DD4BF', secondary: '#38BDF8', background: '#0B1B2B', surface: '#12283D', text: '#EAF2F8', mutedText: '#8FA6BA', accent: '#00E5FF'};
const warmDark = {primary: '#FF3D2E', secondary: '#FF9F1C', background: '#101010', surface: '#1E1E1E', text: '#FFFFFF', mutedText: '#B0B0B0', accent: '#FFE600'};
const lightTheme = {primary: '#2F5BEA', secondary: '#12A594', background: '#F6F3EE', surface: '#FFFFFF', text: '#1B1B1F', mutedText: '#6B6B76', accent: '#E4572E'};
const violetDark = {primary: '#6366F1', secondary: '#A78BFA', background: '#0B1020', surface: '#161D33', text: '#F8FAFC', mutedText: '#94A3B8', accent: '#C084FC'};
const greyDark = {primary: '#888888', secondary: '#777777', background: '#101010', surface: '#1E1E1E', text: '#FFFFFF', mutedText: '#B0B0B0', accent: '#999999'};
const brief = (content: Record<string, unknown>) => ({goal: 'g', visualDescription: 'v', placement: 'full_screen', content});

describe('WP12A 1) curated palettes', () => {
  it('the pick is pure and stable from the theme: light -> paper_lime, warm dark -> night_amber, other saturated dark -> ink_white, no usable accent -> clean_mono', () => {
    expect(rendererPick(lightTheme)).toBe('paper_lime');
    expect(rendererPick(warmDark)).toBe('night_amber');
    expect(rendererPick(violetDark)).toBe('ink_white');
    expect(rendererPick(greyDark)).toBe('clean_mono');
    for (const theme of [lightTheme, warmDark, violetDark, greyDark]) expect(rendererPick(theme)).toBe(rendererPick({...theme}));
  });
  it('a cyan-accent theme: the cyan is skipped in the pick, the plate marker is not karaoke cyan and the id is stable', () => {
    expect(navyCyan.accent).toBe('#00E5FF');
    const first = platePalette({...navyCyan, look: 'auto'});
    const second = platePalette({...navyCyan, look: 'auto'});
    expect(first.look).toBe(second.look);
    expect(first.look).toBe('clean_mono'); // every colour of this theme is blue-green: no usable accent
    expect(isKaraokeCyan(first.marker)).toBe(false);
    expect(isKaraokeCyan(first.markerText)).toBe(false);
  });
  it.each(SHORT_FORM_LOOK_IDS.map(id => [id] as const))('%s: ink on ground, marker ink on marker and paper ink on paper are strong; the marker is neither karaoke cyan nor a neon green', id => {
    const look = SHORT_FORM_LOOKS[id];
    expect(plateContrast(look.ink, look.ground)).toBeGreaterThanOrEqual(7);
    expect(plateContrast(look.markerInk, look.marker)).toBeGreaterThanOrEqual(7);
    expect(plateContrast(look.paperInk, look.paper)).toBeGreaterThanOrEqual(7);
    expect(plateContrast(look.mutedInk, look.ground)).toBeGreaterThanOrEqual(4.5);
    expect(plateContrast(look.paperMuted, look.paper)).toBeGreaterThanOrEqual(4.5);
    expect(isKaraokeCyan(look.marker)).toBe(false);
    expect(isKaraokeCyan(look.caption)).toBe(false);
    expect(look.marker.toLowerCase()).not.toBe('#00e5ff');
    expect(look.caption).toBe(look.marker);
  });
  it('platePalette with a look returns the curated colours, with markerText readable on the ground (lime bar yes, lime type on off-white no)', () => {
    const paper = platePalette({...lightTheme, look: 'auto'});
    expect(paper.look).toBe('paper_lime');
    expect(paper.marker).toBe('#C8F31D');
    expect(plateContrast(paper.markerText, paper.ground)).toBeGreaterThanOrEqual(3);
    expect(paper.markerText).toBe(paper.ink);
    const dark = platePalette({...warmDark, look: 'auto'});
    expect(dark.markerText).toBe(dark.marker);
    expect(plateContrast(dark.markerText, dark.ground)).toBeGreaterThanOrEqual(3);
  });
  it('without `look` the generic theme-derived palette is unchanged (no look id)', () => {
    expect(platePalette(warmDark).look).toBeUndefined();
    expect(platePalette(warmDark).marker).toBe('#FFE600');
  });
  it('no niche / content-type / mood branching in the look system', () => {
    for (const file of ['looks.ts', 'colorMath.ts', 'palette.ts']) expect(read(`../../../../remotion/src/motion/${file}`), file).not.toMatch(/contentType|content_type|niche|\bmood\b/i);
    expect(read('../../lib/shortFormLook.ts')).not.toMatch(/contentType|content_type|niche|\bmood\b/i);
  });
  it('the polish explain path flags the plate theme (look: auto); other paths are untouched (source pin)', () => {
    expect(withShortFormLook({primary: '#fff'})).toEqual({primary: '#fff', look: 'auto'});
    expect(withShortFormLook(undefined)).toEqual({look: 'auto'});
    expect(read('../motionDirector/index.ts')).toContain('input.explainPlates ? withShortFormLook(');
  });
});

describe('WP12A 2) video typography', () => {
  it('a look fixes the faces: heavy display for hero titles, body for passages', () => {
    const themed = resolveTheme({...warmDark, look: 'auto'} as never);
    expect(themed.fontDisplay).toBe('space_grotesk');
    expect(themed.fontBody).toBe('inter');
    expect(resolveTheme({...lightTheme, look: 'auto'} as never).fontDisplay).toBe('bebas');
    expect(resolveShortFormLook(violetDark).fontDisplay).toBe('bebas');
    expect(resolveTheme({fontDisplay: 'inter'} as never).fontDisplay).toBe('inter'); // no look: the theme's own faces
  });
  it('hero titles are drawn in the DISPLAY face and article / post passages in the BODY face; no plate hard-codes Inter', () => {
    const wiki = comp('WikiCallout');
    expect(wiki).toMatch(/<FitText text=\{title\}[^>]*weight=\{900\}/);
    expect(wiki.match(/<FitText text=\{title\}[^>]*/)![0]).not.toContain('font=');
    expect(wiki.match(/<KineticText text=\{text\}[^>]*/)![0]).toContain('font="body"');
    const open = comp('OpenPlate');
    expect(open.match(/<KineticText text=\{title\}[^>]*/)![0]).not.toContain('font="body"');
    expect(comp('TweetCard').match(/<KineticText text=\{body\}[^>]*/)![0]).toContain('font="body"');
    expect(comp('StampTitle').match(/<KineticText text=\{title\}[^>]*/)![0]).not.toContain('font="body"');
    expect(comp('FullscreenStatement').match(/<KineticText text=\{statement\}[^>]*/)![0]).not.toContain('font="body"');
    expect(comp('VsClaim').match(/<FitText text=\{side\.text\}[^>]*/)![0]).not.toContain('font="body"');
    for (const name of ['OpenPlate', 'StampTitle', 'WikiCallout', 'TweetCard', 'FullscreenStatement', 'VsClaim']) expect(comp(name), name).not.toMatch(/'inter'|"inter"|Inter/);
  });
  it('the README documents which faces the look system uses', () => {
    const readme = read('../../../../remotion/src/motion/README.md');
    expect(readme).toContain('Short-form looks');
    for (const id of SHORT_FORM_LOOK_IDS) expect(readme).toContain(`\`${id}\``);
    expect(readme).toMatch(/Bebas Neue/);
    expect(readme).toMatch(/Space Grotesk/);
  });
});

describe('WP12A 3) article / post look', () => {
  it('WikiCallout: paper + ink + one highlighter; slim tab chrome, no sidebar; the passage and highlight are the hero', () => {
    const wiki = comp('WikiCallout');
    expect(wiki).toContain('palette.paper');
    expect(wiki).toContain('palette.paperInk');
    expect(wiki).toContain('highlightOpacity={1}');
    expect(wiki).not.toContain('bars.map');
    expect(wiki).toContain('sliceTop(inner, 0.025');
    expect(wiki).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });
  it('TweetCard: no address-bar chrome; dots only; paper card with the single highlighter', () => {
    const tweet = comp('TweetCard');
    expect(tweet).not.toContain('flex: 1, height: dot');
    expect(tweet).toContain('highlightOpacity={1}');
    expect(tweet).toContain('palette.paper');
  });
  it('plates draw accent TEXT with markerText (so a lime bar never becomes unreadable lime type)', () => {
    for (const name of ['OpenPlate', 'StampTitle', 'StatHighlight', 'QuoteCallout', 'ChartExplainer']) expect(comp(name), name).toContain('palette.markerText');
  });
  it.each([
    ['WikiCallout', {passage: 'The standard is reviewed every single quarter', title: 'Standards', highlight: ['standard']}],
    ['TweetCard', {body: 'Nobody reads the documentation anymore', highlight: ['documentation']}],
    ['OpenPlate', {openTitle: 'Market size matters', kicker: 'Number two', accent: 'matters'}],
    ['StatHighlight', {value: {to: 85, suffix: '%'}, label: 'of projects slip'}],
  ])('%s still passes worker validation with the look system in place', async (id, content) => {
    const hit = resolveLibraryGraphic(brief(content))!;
    expect(hit.compositionId).toBe(id);
    const {report} = await validateGraphicSource(libraryGraphicSource(hit));
    expect(report).toEqual({safety: [], typecheck: [], compile: [], runtime: []});
  }, 60_000);
});

describe('WP12A 4) caption highlight contract', () => {
  it('the server pick mirrors the renderer pick for every sample theme (parity)', () => {
    for (const theme of [lightTheme, warmDark, violetDark, greyDark, navyCyan]) expect(pickShortFormLookId(theme), JSON.stringify(theme.background)).toBe(rendererPick(theme));
  });
  it('each look\'s caption highlight equals the renderer look\'s accent and is never karaoke cyan', () => {
    for (const id of SHORT_FORM_LOOK_IDS) {
      expect(LOOK_CAPTION_HIGHLIGHT[id]).toBe(SHORT_FORM_LOOKS[id].caption);
      expect(isKaraokeCyan(LOOK_CAPTION_HIGHLIGHT[id])).toBe(false);
    }
  });
  it('a missing or malformed theme still picks a look (dark default) without throwing', () => {
    expect(pickShortFormLookId({})).toBe('clean_mono');
    expect(pickShortFormLookId({background: 'nope', accent: 12})).toBe('clean_mono');
  });
  it('wiring pin: on a polish explain edit with no caller template the caption highlight is the look accent, with look:palette:<id>', () => {
    const analyze = read('../../pipeline/analyzeVideo.ts');
    expect(analyze).toContain('highlightColor: type.highlightColor'); // WP13C: the look's caption TYPE contract (stroke / fill / marker) supersedes the bare highlight colour
    expect(analyze).toContain('`look:palette:${lookId}`');
    expect(analyze).toMatch(/polishPath && motion && !input\.captionTemplate/);
  });
});
