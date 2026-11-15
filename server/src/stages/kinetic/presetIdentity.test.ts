import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {deriveKineticIdentity, FONT_MAP, identityToBrand, type PresetLike} from './presetIdentity.ts';
import {brandConfigSchema, FONT_KEYS} from './schema.ts';
import {wordStyle} from './playbook.ts';

const presets = (JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../captionkit_tmp/presets.json'), 'utf8')) as {presets: PresetLike[]}).presets;
const byId = (id: string) => presets.find(p => p.id === id)!;

describe('preset -> Kinetic identity', () => {
  it('maps every one of the 74 presets deterministically to a valid BrandConfig', () => {
    expect(presets).toHaveLength(74);
    for (const p of presets) {
      const a = deriveKineticIdentity(p), b = deriveKineticIdentity(p);
      expect(a).toEqual(b);
      expect(FONT_KEYS).toContain(a.font);
      expect(a.text).toMatch(/^#[0-9A-F]{6}$/); expect(a.accent).toMatch(/^#[0-9A-F]{6}$/);
      expect(() => brandConfigSchema.parse(identityToBrand(a))).not.toThrow();
      expect(a.limitations.length).toBeGreaterThan(0); // the Kinetic-owned list is always stated
    }
  });
  it('every CaptionKit family in presets.json has a documented mapping (no silent fallback)', () => {
    const missing = [...new Set(presets.map(p => p.font.family))].filter(f => !FONT_MAP[f]);
    expect(missing).toEqual([]);
  });
  it('punchline: Anton, white text, yellow highlight, upper case, black outline', () => {
    const i = deriveKineticIdentity(byId('punchline'));
    expect([i.font, i.text, i.accent, i.upper]).toEqual(['anton', '#FFFFFF', '#FFE14D', true]);
    expect(i.outline?.color).toBe('#000000');
    expect(i.mapping.exact).toBe(true);
  });
  it('spotlight: active colour sits on a word box (near black): the highlight uses the box colour and says so', () => {
    const i = deriveKineticIdentity(byId('spotlight'));
    expect(i.accent).toBe('#3DDC84');
    expect(i.limitations.some(l => l.includes('not readable on video'))).toBe(true);
  });
  it('a non-exact family is reported as nearest, not silently substituted', () => {
    const p = presets.find(x => FONT_MAP[x.font.family] && !FONT_MAP[x.font.family]!.exact)!;
    expect(deriveKineticIdentity(p).limitations.some(l => l.includes('nearest shipped face'))).toBe(true);
  });
  it('corrected fallbacks: a fat display face never becomes an italic serif or light Poppins; typewriter keeps a technical feel', () => {
    const by = (family: string) => presets.find(p => p.font.family === family)!;
    expect(deriveKineticIdentity(by('Luckiest Guy'))).toMatchObject({font: 'archivoBlack'});
    expect(deriveKineticIdentity(by('Monoton'))).toMatchObject({font: 'archivoBlack'});
    expect(deriveKineticIdentity(by('Special Elite'))).toMatchObject({font: 'spaceGrotesk'});
    expect(deriveKineticIdentity(by('Lilita One'))).toMatchObject({font: 'poppins', weight: 900});
    expect(deriveKineticIdentity(by('Titan One'))).toMatchObject({font: 'poppins', weight: 900});
    expect(deriveKineticIdentity(by('Sniglet'))).toMatchObject({font: 'poppins', weight: 800});
    expect(Object.values(FONT_MAP).filter(f => f.exact)).toHaveLength(6);
    expect(Object.values(FONT_MAP).filter(f => !f.exact)).toHaveLength(26);
  });
  it('Kinetic keeps size / tracking / opacity; identity owns face and case only', () => {
    const id = deriveKineticIdentity(byId('punchline'));
    const own = wordStyle('retroNeon', 'hero', 'street', 'word');
    const mine = wordStyle('retroNeon', 'hero', 'street', 'word', id);
    expect(mine.font).toBe('anton');
    expect([mine.px1080, mine.ls, mine.opacity]).toEqual([own.px1080, own.ls, own.opacity]);
    const other = wordStyle('retroNeon', 'hero', 'neon', 'hi', deriveKineticIdentity(byId('typewriter')));
    expect(other.font).not.toBe('pacifico'); // the pairing's hero face no longer wins
  });
  it('no identity = byte-identical to the previous style table', () => {
    expect(wordStyle('retroNeon', 'support', 'street', 'x', undefined)).toEqual(wordStyle('retroNeon', 'support', 'street', 'x'));
  });
});
