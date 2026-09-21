import {describe, expect, it} from 'vitest';

import {
  allowedEditsPromptBlock,
  defaultRequestedEdits,
  filterVisualDirection,
  isKindAllowed,
  lockCaptionTemplate,
  mergeDeliveryShapingAllowlist,
  normalizeToolkitId,
  parseCaptionTemplateFlag,
  parseEditAllowlist,
  resolvePipelineEdits,
  visualToolkitsRequested,
} from './editToolkits.ts';

describe('edit toolkits', () => {
  it('resolves aliases for visual tools and delivery shaping', () => {
    expect(normalizeToolkitId('b-roll')).toBe('cutaway');
    expect(normalizeToolkitId('behind-subject')).toBe('depth_overlay');
    expect(normalizeToolkitId('inset-scale-reveal')).toBe('inset_reveal');
    expect(normalizeToolkitId('delivery-shaping')).toBe('delivery_shaping');
    expect(normalizeToolkitId('pacing')).toBe('delivery_shaping');
    expect(normalizeToolkitId('karaoke')).toBeNull();
  });

  it('treats omit as lean later and all as an open allowlist', () => {
    expect(parseEditAllowlist([]).omitted).toBe(true);
    expect(parseEditAllowlist([]).allowed).toBeNull();
    expect(parseEditAllowlist(['all']).explicitAll).toBe(true);
    expect(parseEditAllowlist(['all']).allowed).toBeNull();
    expect(resolvePipelineEdits(parseEditAllowlist([]))).toEqual(['captions']);
    expect(resolvePipelineEdits(parseEditAllowlist(['all']))).toBeNull();
    expect(defaultRequestedEdits(undefined)).toEqual(['captions']);
    expect(defaultRequestedEdits(null)).toBeNull();
    expect(visualToolkitsRequested(['captions'])).toBe(false);
    expect(visualToolkitsRequested(null)).toBe(true);
    expect(visualToolkitsRequested(['cutaway'])).toBe(true);
  });

  it('builds an allowlist from mixed aliases', () => {
    const parsed = parseEditAllowlist([
      'broll',
      'inset_reveal',
      'depth-overlay',
      'delivery',
    ]);
    expect(parsed.unknown).toEqual([]);
    expect(parsed.allowed).toEqual(
      new Set([
        'cutaway',
        'inset_reveal',
        'depth_overlay',
        'delivery_shaping',
      ]),
    );
  });

  it('does not keep hook_title and zoom when the allowlist is narrow', () => {
    const allowed = new Set(['inset_reveal']);
    expect(isKindAllowed('hook_title', allowed)).toBe(false);
    expect(isKindAllowed('zoom', allowed)).toBe(false);
    expect(isKindAllowed('counter', allowed)).toBe(false);
    expect(isKindAllowed('inset_reveal', allowed)).toBe(true);
    expect(isKindAllowed('cutaway', allowed)).toBe(false);
    expect(isKindAllowed('depth_overlay', allowed)).toBe(false);
  });

  it('filters a visual direction down to requested toolkits', () => {
    const filtered = filterVisualDirection(
      {
        moments: [
          {layout: 'cutaway'},
          {layout: 'lockup'},
        ],
        depthOverlays: [{start: 1}],
        insetReveals: [{start: 4}],
        zooms: [{timestamp: 2}],
        semanticEmphasis: [{treatment: 'count'}],
      },
      new Set(['inset_reveal']),
    );
    expect(filtered.moments).toEqual([]);
    expect(filtered.depthOverlays).toEqual([]);
    expect(filtered.insetReveals).toEqual([{start: 4}]);
    expect(filtered.zooms).toEqual([]);
    expect(filtered.semanticEmphasis).toEqual([]);
  });

  it('parses caption template flags', () => {
    expect(parseCaptionTemplateFlag('karaoke')).toBe('karaoke');
    expect(parseCaptionTemplateFlag('nope')).toBeNull();
  });

  it('adds delivery_shaping onto an existing visual allowlist', () => {
    expect(
      mergeDeliveryShapingAllowlist(['inset_reveal', 'cutaway'], true)?.sort(),
    ).toEqual(['cutaway', 'delivery_shaping', 'inset_reveal']);
    expect(mergeDeliveryShapingAllowlist(null, true)).toBeNull();
    expect(
      mergeDeliveryShapingAllowlist(['delivery_shaping', 'cutaway'], false),
    ).toEqual(['cutaway']);
  });

  it('tells the Director requested --edits may be declined', () => {
    const block = allowedEditsPromptBlock(
      new Set(['inset_reveal', 'depth_overlay', 'cutaway']),
    );
    expect(block).toContain('REQUESTED_EDIT_STYLES');
    expect(block).not.toContain('REQUIRED_EDIT_STYLES');
    expect(block).toContain('inset_reveal');
    expect(block).toContain('may decline');
  });

  it('tells the Director lean mode is captions, hook, and zoom only', () => {
    const block = allowedEditsPromptBlock(new Set(['captions']));
    expect(block).toContain('PIPELINE_MODE: lean');
    expect(block).toContain('Do not emit cutaway');
    expect(block).not.toContain('counter are always on');
  });

  it('locks a caption template', () => {
    expect(lockCaptionTemplate({template: 'clean'}, 'karaoke').template).toBe(
      'karaoke',
    );
  });
});
