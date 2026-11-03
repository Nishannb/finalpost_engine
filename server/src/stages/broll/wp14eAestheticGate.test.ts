/**
 * WP14E: the aesthetic gate (video motion vs web UI) on generated graphics, the tightened Claude prompt, and the internal recipe catalog. Offline: no render, no network.
 */
import {readFileSync, readdirSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {MOTION_RECIPES} from '../../../../remotion/src/motion/recipes/motionRecipes.ts';
import {checkMotionAesthetic} from '../../lib/motionAestheticGate.ts';
import {MOTION_RECIPE_IDS} from '../../lib/motionRecipes.ts';
import {buildSystemPrompt, motionRecipeRules} from '../../motionWorker/prompt.ts';
import {validateGraphicSource} from '../../motionWorker/worker.ts';
import {libraryGraphicSource, resolveLibraryGraphic} from '../motionDirector/libraryRegistry.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const motionDir = new URL('../../../../remotion/src/motion/', import.meta.url);

const WEB_UI_FADE_ONLY = `import {Background, Box, FitText, Reveal, contentBox, type GraphicProps} from '@finalpost/motion';

type Content = {headline: string};

export default function Graphic({width, height, safeArea, content}: GraphicProps<Content>) {
  const box = contentBox(width, height, safeArea, 24);
  return (
    <>
      <Background />
      <Box {...box}>
        <Reveal>
          <div className="browserWindow">
            <div className="addressBar">
              <span style={{background: '#FF5F57'}} />
              <span style={{background: '#FEBC2E'}} />
              <span style={{background: '#28C840'}} />
            </div>
            <FitText text={content!.headline} width={box.width} height={box.height} maxLines={3} />
          </div>
        </Reveal>
      </Box>
    </>
  );
}
`;
const VIDEO_MOTION = `import {Background, Box, FitText, MotionRecipe, contentBox, type GraphicProps} from '@finalpost/motion';

type Content = {openTitle: string; kicker: string};

export default function Graphic({width, height, safeArea, content}: GraphicProps<Content>) {
  const box = contentBox(width, height, safeArea, 24);
  return (
    <>
      <Background />
      <Box {...box}>
        <MotionRecipe recipeId="elastic_type_snap">
          <FitText text={content!.openTitle} width={box.width} height={box.height / 2} maxLines={2} weight={900} uppercase />
        </MotionRecipe>
        <MotionRecipe recipeId="smear_blur_in" delay={6}>
          <FitText text={content!.kicker} width={box.width} height={box.height / 4} maxLines={1} />
        </MotionRecipe>
      </Box>
    </>
  );
}
`;
const FADE_ONLY_NO_CHROME = VIDEO_MOTION.replace(/MotionRecipe recipeId="[a-z_]+"( delay=\{6\})?/g, 'Reveal').replace(/<\/MotionRecipe>/g, '</Reveal>').replace('MotionRecipe, ', 'Reveal, ');

describe('WP14E 1) aesthetic gate (pure)', () => {
  it('fails a graphic with authored fake browser chrome and a fade-only entrance, with both reasons given', () => {
    const verdict = checkMotionAesthetic(WEB_UI_FADE_ONLY);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.some(reason => /authored web \/ OS chrome \("browser window"\)/.test(reason))).toBe(true);
    expect(checkMotionAesthetic(WEB_UI_FADE_ONLY.replace('browserWindow', 'frame')).reasons.some(reason => /\("address bar"\)/.test(reason))).toBe(true);
    expect(verdict.reasons.some(reason => /traffic-light/.test(reason))).toBe(true);
    expect(verdict.reasons.some(reason => /soft fade \/ slide-up Reveal/.test(reason))).toBe(true);
    expect(verdict.reasons.every(reason => reason.startsWith('aesthetic: '))).toBe(true);
  });
  it('fails a Reveal-only (default fade + slide-up) graphic even with no chrome, and says how to fix it', () => {
    const verdict = checkMotionAesthetic(FADE_ONLY_NO_CHROME);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons).toHaveLength(1);
    expect(verdict.reasons[0]).toContain('<MotionRecipe recipeId="..."');
    expect(checkMotionAesthetic(FADE_ONLY_NO_CHROME.replace('<Reveal>', "<Reveal effect={['fade', 'slide-left']}>")).ok).toBe(false);
  });
  it('passes a graphic that uses MotionRecipe (OpenPlate-like content)', () => {
    expect(checkMotionAesthetic(VIDEO_MOTION)).toEqual({ok: true, reasons: []});
  });
  it('a Reveal that pops or wipes, or a graphic with any other motion (hand-written spring / interpolate, KineticText, charts ...), is not "fade-only"', () => {
    expect(checkMotionAesthetic(FADE_ONLY_NO_CHROME.replace('<Reveal>', '<Reveal effect="pop" spring="bouncy">')).ok).toBe(true);
    expect(checkMotionAesthetic(FADE_ONLY_NO_CHROME.replace('<Reveal>', '<Reveal effect="wipe-right">')).ok).toBe(true);
    expect(checkMotionAesthetic(FADE_ONLY_NO_CHROME.replace('<Reveal>', '<Reveal progress={0.5}>')).ok).toBe(true);
    expect(checkMotionAesthetic(FADE_ONLY_NO_CHROME.replace("import {", "import {useCurrentFrame} from 'remotion';\nimport {").replace('<Reveal>', '<Reveal>').replace('  const box', '  const frame = useCurrentFrame();\n  const x = interpolate(frame, [0, 10], [0, 1]);\n  const box')).ok).toBe(true);
    expect(checkMotionAesthetic(FADE_ONLY_NO_CHROME.replace('<FitText', '<KineticText')).ok).toBe(true);
  });
  it('does not fail for importing or naming the approved hosts (WikiCallout, TweetCard, NewspaperCallout) or for the word "tabs" in a comment', () => {
    const source = `// the Wiki sheet has a slim tab strip, drawn by the host
import {WikiCallout, TweetCard, NewspaperCallout, MotionRecipe, type GraphicProps} from '@finalpost/motion';

export default function Graphic({width, height, safeArea}: GraphicProps<unknown>) {
  return <MotionRecipe recipeId="split_mask_reveal"><WikiCallout width={width} height={height} safeArea={safeArea} passage="The standard is reviewed" /></MotionRecipe>;
}
`;
    expect(checkMotionAesthetic(source)).toEqual({ok: true, reasons: []});
    expect(checkMotionAesthetic(source.replace('MotionRecipe', 'MotionRecipe')).ok).toBe(true);
    expect(checkMotionAesthetic('import {TweetCard, NewspaperCallout} from "@finalpost/motion";\nexport default function G() { return <TweetCard width={1} height={1} body="x" />; }').ok).toBe(true);
  });
  it('catches authored chrome by identifier or string in any casing, but not by an unrelated word', () => {
    for (const snippet of ['const urlBar = 1;', 'const OMNIBOX = 1;', "const label = 'tab strip';", 'const trafficLights = [];', 'const windowControls = 1;', 'function IosNotification() {}', 'const statusBar = 1;', "const x = 'notification banner';"]) {
      expect(checkMotionAesthetic(`import {MotionRecipe} from '@finalpost/motion';\n${snippet}\n`).ok, snippet).toBe(false);
    }
    for (const snippet of ['const tabs = 3;', 'const bar = 1;', 'const url = 1;', 'const notificationCount = 1;', 'const statusText = 1;']) {
      expect(checkMotionAesthetic(`import {MotionRecipe} from '@finalpost/motion';\n${snippet}\n`).ok, snippet).toBe(true);
    }
  });
  it('pure: no env, logger, network or file access', () => {
    expect(read('../../lib/motionAestheticGate.ts')).not.toMatch(/process\.env|fetch\(|readFileSync|logger|anthropic/i);
  });
});

describe('WP14E 2) wired into the worker validation', () => {
  it('validateGraphicSource reports the gate reasons under `safety` and stops before compile (so the repair loop gets them)', async () => {
    const { report, compiled } = await validateGraphicSource(WEB_UI_FADE_ONLY);
    expect(compiled).toBeNull();
    expect(report.safety.some(reason => reason.startsWith('aesthetic: '))).toBe(true);
    expect(report.compile).toEqual([]);
  }, 60_000);
  it('a MotionRecipe graphic still passes the full validation', async () => {
    const { report, compiled } = await validateGraphicSource(VIDEO_MOTION);
    expect(report).toEqual({safety: [], typecheck: [], compile: [], runtime: []});
    expect(compiled?.bytes).toBeGreaterThan(0);
  }, 60_000);
  it('library host modules (generated from the registry) pass the gate: it targets generated graphics, not the toolkit compositions', async () => {
    for (const [content, id] of [
      [{passage: 'The standard is reviewed every single quarter', highlight: ['standard']}, 'WikiCallout'],
      [{body: 'Nobody reads the documentation anymore', highlight: ['documentation']}, 'TweetCard'],
      [{passage: 'The startup raised a huge round', newspaper: true}, 'NewspaperCallout'],
      [{openTitle: 'Market size matters', accent: 'matters'}, 'OpenPlate'],
    ] as const) {
      const hit = resolveLibraryGraphic({goal: 'g', visualDescription: 'v', placement: 'full_screen', content})!;
      expect(hit.compositionId).toBe(id);
      const source = libraryGraphicSource(hit);
      expect(checkMotionAesthetic(source), id).toEqual({ok: true, reasons: []});
      const { report } = await validateGraphicSource(source);
      expect(report, id).toEqual({safety: [], typecheck: [], compile: [], runtime: []});
    }
  }, 120_000);
  it('the toolkit README worked example and every shipped example graphic pass the gate (the prompt shows only compliant examples)', () => {
    const readme = read('../../../../remotion/src/motion/README.md');
    const example = /```tsx\n([\s\S]*?)```/.exec(readme)![1]!;
    expect(example).toContain('MotionRecipe');
    expect(checkMotionAesthetic(example)).toEqual({ok: true, reasons: []});
    const fixtures = new URL('../../../../remotion/mg-fixtures/graphics/', import.meta.url);
    for (const file of readdirSync(fixtures).filter(name => name.endsWith('.tsx'))) expect(checkMotionAesthetic(readFileSync(new URL(file, fixtures), 'utf8')), file).toEqual({ok: true, reasons: []});
  });
});

describe('WP14E 3) Claude prompt', () => {
  const system = buildSystemPrompt();
  it('has the PREFER and DEPRIORITIZE lines, keeps every recipe id, and does not ban the approved hosts', () => {
    const rules = motionRecipeRules().join('\n');
    expect(rules).toMatch(/^PREFER: full-bleed type, mask reveals, overshoot and squash, blur settle, hard contrast, and a named recipeId/m);
    expect(rules).toMatch(/^DEPRIORITIZE: multi-shadow soft cards as the hero, clusters of pills as the only motion, dashboard widgets/m);
    expect(rules).toMatch(/invented browser or OS chrome/);
    expect(rules).toContain('The approved hosts (WikiCallout, TweetCard, NewspaperCallout)');
    expect(rules).toMatch(/checked by the validator/);
    for (const id of MOTION_RECIPE_IDS) expect(system, id).toContain(id);
    expect(system).toContain(rules);
  });
});

describe('WP14E 4) recipe catalog', () => {
  const markdown = read('../../../../remotion/src/motion/recipes/CATALOG.md');
  const json = JSON.parse(read('../../../../remotion/src/motion/recipes/catalog.json')) as {note: string; recipes: Array<{id: string; family: string; intents: string[]; driver: string; feel: string; defaultHosts: string}>};
  it('CATALOG.md and catalog.json list every recipe id of the server list and the registry', () => {
    expect(MOTION_RECIPE_IDS.length).toBeGreaterThanOrEqual(12);
    for (const id of MOTION_RECIPE_IDS) {
      expect(markdown, id).toContain(`\`${id}\``);
      expect(json.recipes.some(entry => entry.id === id), id).toBe(true);
    }
    expect(json.recipes.length).toBe(MOTION_RECIPES.length);
  });
  it('catalog.json mirrors the registry (id, family, intents, driver, feel), so it cannot drift; every entry names a default host binding', () => {
    for (const recipe of MOTION_RECIPES) {
      const entry = json.recipes.find(item => item.id === recipe.id)!;
      expect(entry, recipe.id).toMatchObject({family: recipe.family, intents: [...recipe.intents], driver: recipe.driver, feel: recipe.feel});
      expect(entry.defaultHosts.length, recipe.id).toBeGreaterThan(10);
    }
  });
  it('says it is internal vernacular and not Jitter assets, and is linked from the README', () => {
    expect(markdown).toMatch(/Internal vernacular, not Jitter assets/);
    expect(json.note).toMatch(/Not Jitter assets/);
    const readme = read('../../../../remotion/src/motion/README.md');
    expect(readme).toContain('recipes/CATALOG.md');
    expect(readme).toContain('recipes/catalog.json');
    expect(readme).toContain('motionAestheticGate');
  });
  it('the catalog files sit with the recipes and are not code (the recipe modules stay free of chrome)', () => {
    expect(readdirSync(new URL('recipes/', motionDir)).sort()).toEqual(['CATALOG.md', 'MotionRecipe.tsx', 'catalog.json', 'motionRecipes.ts']);
  });
});
