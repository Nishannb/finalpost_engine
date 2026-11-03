/**
 * Runtime check for the motion-graphics worker: ONE generated graphic in a full
 * frame, loaded and drawn by the production path (useGeneratedGraphicComponents,
 * GeneratedGraphicTrack / GeneratedSplitStage, the same safe-area and caption
 * docking rules), over a neutral stand-in for the speaker. The worker renders a
 * single still of this composition before it publishes a module, so a graphic
 * that throws at render time is caught and repaired instead of failing a burn.
 */

import React, {useMemo} from 'react';
import {AbsoluteFill, useVideoConfig} from 'remotion';
import {z} from 'zod';

import {generatedGraphicSchema} from '../blueprintSchema';
import {GeneratedGraphicTrack, GeneratedSplitStage} from './GeneratedGraphicTrack';
import {useGeneratedGraphicComponents} from './loader';
import {captionsForGeneratedSplit} from './placement';

export const generatedGraphicPreviewSchema = z.object({
  graphic: generatedGraphicSchema,
  /** Where the video's captions sit (blueprint captionDirection.bottomFrac). */
  captionBottomFrac: z.number().default(0.16),
});

export type GeneratedGraphicPreviewProps = z.infer<typeof generatedGraphicPreviewSchema>;

export const GeneratedGraphicPreview: React.FC<GeneratedGraphicPreviewProps> = ({graphic, captionBottomFrac}) => {
  const {height} = useVideoConfig();
  const graphics = useMemo(() => [{...graphic, start: 0}], [graphic]);
  const components = useGeneratedGraphicComponents(graphics);
  const split = graphics[0]!.placement.mode === 'split_screen' ? graphics[0] : undefined;
  const {layout, band} = captionsForGeneratedSplit(
    {position: 'bottom', bottomFrac: captionBottomFrac, frameTopFrac: 0, frameHeightFrac: 1},
    split,
    height,
  );
  const speaker = <AbsoluteFill style={{background: 'linear-gradient(180deg, #59626e 0%, #2a2f37 100%)'}} />;
  const captionBottom = height * (layout.frameTopFrac + layout.frameHeightFrac) - height * layout.bottomFrac;

  return (
    <AbsoluteFill style={{background: '#000'}}>
      {split ? (
        <GeneratedSplitStage graphic={split} Component={components?.[split.module.sha256]} captionBand={band}>
          {speaker}
        </GeneratedSplitStage>
      ) : (
        speaker
      )}
      {!split && components ? <GeneratedGraphicTrack graphics={graphics} components={components} captionBand={band} /> : null}
      {/* Stand-in caption line where the real captions would sit. */}
      <div
        style={{
          position: 'absolute',
          left: '18%',
          width: '64%',
          top: captionBottom - height * 0.045,
          height: height * 0.045,
          borderRadius: height * 0.01,
          background: 'rgba(255,255,255,0.85)',
        }}
      />
    </AbsoluteFill>
  );
};
