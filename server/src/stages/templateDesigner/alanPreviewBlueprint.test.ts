import {describe, expect, it} from 'vitest';

import {
  ALAN_BLACK_VIDEO_SRC,
  ALAN_CAPTION_SCRIPT,
  buildAlanPreviewBlueprint,
} from './alanPreviewBlueprint.ts';
import {validateEditSpec} from './validate.ts';

describe('Alan caption preview blueprint', () => {
  it('burns captions onto the bundled black plate, not the reference', () => {
    const {spec} = validateEditSpec({
      name: 'Gold Karaoke',
      caption: {template: 'karaoke', animation: 'karaoke'},
    });
    const blueprint = buildAlanPreviewBlueprint({
      spec,
      designJobId: 'td_test',
    });
    expect(blueprint.videoUrl).toBe(ALAN_BLACK_VIDEO_SRC);
    expect(blueprint.transcript).toBe(ALAN_CAPTION_SCRIPT);
    expect(blueprint.captionWords.map(word => word.text).join(' ')).toContain(
      'Alan the Designer',
    );
    expect(blueprint.captionDirection.template).toBe('karaoke');
    expect(blueprint.brollClips).toHaveLength(0);
  });
});
