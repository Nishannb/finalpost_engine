/**
 * SUBJECT STAGE: draws one stage asset (an uploaded image / video, or a native placeholder) into a box of `width` x `height` px. Shared by the behind-layer Track and the S5 Front layer.
 */
import React from 'react';
import {Img, OffthreadVideo} from 'remotion';

import type {SubjectStageAsset} from '../../blueprintSchema';
import {isStillMediaSrc, resolveMediaSrc} from '../../lib/mediaSrc';
import {PlateGround, QuoteCard, ResultPage, resultPageHeightPx} from './NativePlates';

/** Natural content height (px) of an asset drawn at `width`, when it is known (a native result page); undefined for media of unknown aspect. */
export function stageAssetContentHeightPx(asset: SubjectStageAsset | undefined, width: number): number | undefined {
  return asset?.kind === 'native' && asset.nativeKind === 'result_page' ? resultPageHeightPx(asset.lines?.length ?? 4, width) : undefined;
}

export const StageAsset: React.FC<{asset?: SubjectStageAsset; width: number; height: number; /** 'cover' fills the box; 'width' draws the media at the box width and its natural height (a tall page that scrolls) */ fit?: 'cover' | 'width'}> = ({asset, width, height, fit = 'cover'}) => {
  if (!asset || asset.kind === 'native') {
    if (asset?.nativeKind === 'quote_card') return <QuoteCard width={width} height={height} text={asset.text} />;
    if (asset?.nativeKind === 'result_page') return <ResultPage width={width} lines={asset.lines} />;
    return <PlateGround width={width} height={height} text={asset?.text} lines={asset?.lines} />;
  }
  const src = asset.url ? resolveMediaSrc(asset.url) : '';
  if (!src) return <PlateGround width={width} height={height} text={asset.text} lines={asset.lines} />;
  const style: React.CSSProperties = fit === 'width' ? {position: 'absolute', left: 0, top: 0, width, height: 'auto'} : {position: 'absolute', left: 0, top: 0, width, height, objectFit: 'cover'};
  return asset.kind === 'video' && !isStillMediaSrc(src) ? <OffthreadVideo src={src} muted style={style} /> : <Img src={src} style={style} />;
};
