import {describe, expect, it} from 'vitest';

import {validateEditSpec} from './validate.ts';
import {editSpecToCaptionStyleGuide} from './applyEditSpec.ts';

describe('EditSpec validator', () => {
  it('fills defaults for empty JSON', () => {
    const {spec} = validateEditSpec({});
    expect(spec.version).toBe('1.0');
    expect(spec.canvas.aspectRatio).toBe('9:16');
    expect(spec.caption.template).toBe('karaoke');
  });

  it('clamps illegal numbers and drops unknown templates', () => {
    const {spec, warnings} = validateEditSpec({
      caption: {
        template: 'made-up-jsx',
        position: {x: 4, y: -1},
        size: 9,
      },
      emphasis: {action: {textScale: 99, cameraZoom: 0.1}},
      camera: {emphasisZoom: {scale: 12, durationMs: -4}},
    });
    expect(spec.caption.template).toBe('karaoke');
    expect(spec.caption.position.x).toBe(1);
    expect(spec.caption.position.y).toBe(0);
    expect(spec.caption.size).toBe(0.16);
    expect(spec.emphasis.action.textScale).toBe(3);
    expect(spec.camera.emphasisZoom.scale).toBe(3);
    expect(spec.camera.emphasisZoom.durationMs).toBe(80);
    expect(warnings.some(w => w.includes('caption.template'))).toBe(true);
  });

  it('keeps semantic emphasis triggers instead of literal words', () => {
    const {spec} = validateEditSpec({
      emphasis: {
        trigger: {type: 'emphasis_word', importance: 'high'},
        action: {textScale: 1.15, colorChange: true, cameraZoom: 1.08},
      },
    });
    expect(spec.emphasis.trigger.type).toBe('emphasis_word');
    expect(spec.emphasis.action.textScale).toBeCloseTo(1.15);
  });

  it('keeps a Designer catalog name and falls back when missing', () => {
    const named = validateEditSpec({name: '  Gold Karaoke  '});
    expect(named.spec.name).toBe('Gold Karaoke');
    const fallback = validateEditSpec({overallStyle: 'Punchy yellow slap captions'});
    expect(fallback.spec.name).toBe('Punchy yellow slap captions');
  });

  it('maps EditSpec onto a caption style the renderer already understands', () => {
    const {spec} = validateEditSpec({
      caption: {
        template: 'beast',
        grouping: 'word',
        position: {x: 0.5, y: 0.84},
        size: 0.1,
        textColor: '#FFFF00',
        highlightColor: '#FF6600',
        animation: 'scale',
        case: 'uppercase',
      },
    });
    const guide = editSpecToCaptionStyleGuide(spec);
    expect(guide.template).toBe('beast');
    expect(guide.bottomFrac).toBeCloseTo(0.16, 1);
    expect(guide.textColor).toBe('#FFFF00');
  });
});
