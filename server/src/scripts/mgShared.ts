/**
 * Shared by the mg:fixture and mg:worker dev scripts: ShortVideo props for a
 * test timeline, and a render through the real local pipeline.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {renderLocally} from '../stages/render/localRender.ts';
import type {GeneratedGraphic, RenderStyle, TimelineBlueprint} from '../types/blueprint.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
export const remotionRoot = path.resolve(here, '../../../remotion');
export const fixtureOutDir = path.join(remotionRoot, 'out/mg-fixtures');

export type FixtureTimeline = {
  name: string;
  durationSec: number;
  videoUrl: string;
  /** Extra blueprint fields (existing edit features) merged into the fixture. */
  blueprint?: Record<string, unknown>;
  style?: Record<string, unknown>;
};

export function fixtureProps(timeline: FixtureTimeline, generatedGraphics: GeneratedGraphic[]) {
  return {
    blueprint: {
      blueprintId: `bp_mgfix_${timeline.name}`,
      videoUrl: timeline.videoUrl,
      languageCode: 'en',
      fps: 30,
      width: 1080,
      height: 1920,
      sourceDurationSec: timeline.durationSec,
      outputDurationSec: timeline.durationSec,
      captionWords: [],
      keepSegments: [],
      zoomTriggers: [],
      brollClips: [],
      ...timeline.blueprint,
      generatedGraphics,
    },
    style: {
      captionTemplate: 'clean',
      layoutStyle: 'fullscreen',
      captionBottomFrac: 0.16,
      captionCenterXFrac: 0.5,
      brollEnabled: false,
      zoomEnabled: false,
      trimEnabled: false,
      ...timeline.style,
    },
  };
}

export async function writeFixtureProps(fileName: string, props: ReturnType<typeof fixtureProps>): Promise<string> {
  await fs.mkdir(fixtureOutDir, {recursive: true});
  const propsPath = path.join(fixtureOutDir, fileName);
  await fs.writeFile(propsPath, JSON.stringify(props, null, 2));
  return propsPath;
}

/** Burns through prefetch → Remotion → R2, the same path the API uses. */
export async function renderFixtureLocally(name: string, props: ReturnType<typeof fixtureProps>) {
  const started = Date.now();
  // Fixture props carry only what ShortVideo reads; the render path ignores the rest.
  const result = await renderLocally({
    blueprint: props.blueprint as unknown as TimelineBlueprint,
    style: props.style as unknown as RenderStyle,
    renderJobId: `mgfix_${name}_${Date.now()}`,
  });
  return {...result, ms: Date.now() - started};
}
