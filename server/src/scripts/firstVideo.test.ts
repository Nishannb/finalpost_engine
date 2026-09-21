import {describe, expect, it} from 'vitest';

import {parseArgs} from './firstVideo.ts';

describe('first-video flags', () => {
  it('defaults to lean captions when --edits is omitted', () => {
    const parsed = parseArgs(['/tmp/clip.mp4', 'auto']);
    expect(parsed.requestedEdits).toEqual(['captions']);
    expect(parsed.northStar).toBe(false);
    expect(parsed.directorV2).toBe(false);
  });

  it('opts into every toolkit with --full-edits or --edits=all', () => {
    expect(parseArgs(['/tmp/clip.mp4', 'auto', '--full-edits']).requestedEdits).toBeNull();
    expect(parseArgs(['/tmp/clip.mp4', 'auto', '--edits=all']).requestedEdits).toBeNull();
  });

  it('enables north-star and implies director v2', () => {
    const parsed = parseArgs(['/tmp/clip.mp4', 'auto', '--north-star']);
    expect(parsed.northStar).toBe(true);
    expect(parsed.directorV2).toBe(true);
  });

  it('parses toolkit allowlist aliases and caption templates', () => {
    const parsed = parseArgs([
      '/tmp/clip.mp4',
      'auto',
      '--edits=broll,inset_reveal,delivery-shaping',
      '--edit=depth_overlay',
      '--captions=karaoke',
    ]);
    expect(parsed.requestedEdits?.sort()).toEqual(
      ['cutaway', 'delivery_shaping', 'depth_overlay', 'inset_reveal'].sort(),
    );
    expect(parsed.captionTemplate).toBe('karaoke');
    expect(parsed.listEdits).toBe(false);
  });

  it('lists edits without requiring a video path', () => {
    const parsed = parseArgs(['--list-edits']);
    expect(parsed.listEdits).toBe(true);
  });

  it('adds delivery_shaping when --delivery-shaping is passed with --edits', () => {
    const parsed = parseArgs([
      '/tmp/clip.mp4',
      'auto',
      '--edits=inset_reveal,depth_overlay,cutaway',
      '--delivery-shaping',
      '--captions=karaoke',
    ]);
    expect(parsed.forceDeliveryShaping).toBe(true);
    expect(parsed.requestedEdits?.sort()).toEqual(
      ['cutaway', 'delivery_shaping', 'depth_overlay', 'inset_reveal'].sort(),
    );
  });

  it('keeps lean captions plus delivery shaping when --delivery-shaping is used alone', () => {
    const parsed = parseArgs(['/tmp/clip.mp4', 'auto', '--delivery-shaping']);
    expect(parsed.requestedEdits?.sort()).toEqual(['captions', 'delivery_shaping']);
    expect(parsed.forceDeliveryShaping).toBe(true);
  });

  it('parses --no-repair for dump runs', () => {
    expect(parseArgs(['/tmp/clip.mp4', 'auto', '--no-repair']).noRepair).toBe(true);
    expect(parseArgs(['/tmp/clip.mp4', 'auto']).noRepair).toBe(false);
  });

  it('opts out of delivery shaping with --no-delivery-shaping', () => {
    const parsed = parseArgs([
      '/tmp/clip.mp4',
      'auto',
      '--edits=delivery_shaping,cutaway',
      '--no-delivery-shaping',
    ]);
    expect(parsed.forceDeliveryShaping).toBe(false);
    expect(parsed.requestedEdits).toEqual(['cutaway']);
  });
});
