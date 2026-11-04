/**
 * The composition every burn goes through.
 *
 * Layer order: composite/split plate → talking-head (optional media container,
 * behind-subject overlay, or inset scale reveal) → video B-roll → designed
 * overlays → motion graphics → semantic emphasis → transition wipes → hook →
 * captions (not scaled by inset_reveal).
 */

import React from 'react';
import {AbsoluteFill, Img, OffthreadVideo, Sequence, interpolate, spring, Easing, useCurrentFrame, useVideoConfig} from 'remotion';

import type {ExplainerClaimBeat, ExplainerLayoutSpan, GeneratedGraphic, ShortVideoProps, TimelineBlueprint, VisualOverlay} from './blueprintSchema';
import {BRollTrack} from './components/BRollTrack';
import {ExplainerLayoutFrame} from './components/ExplainerLayouts';
import {ExplainerArticleBody, ExplainerMedia, useArticlePhraseRects} from './components/ExplainerMount';
import {LimeHighlightWipe} from './components/LimeHighlightWipe';
import {EXPLAINER_PICTURE_OWNING_OVERLAYS, activeExplainerSpanAt, claimBeatForSpan, explainerMediaForSpan, isExplainerMedia} from './lib/explainerMount';
import {explainerRegions, explainerSplitExpandAt} from './lib/explainerLayouts';
import {DepthOverlayTrack} from './components/DepthOverlayTrack';
import {SubjectForegroundTrack} from './components/SubjectForegroundTrack';
import {KineticTrack} from './kinetic/KineticTrack';import {SubjectStageFront} from './components/SubjectStage/SubjectStageFront';
import {SubjectStageTrack} from './components/SubjectStage/SubjectStageTrack';
import {combineFilters, foregroundFromStage, stageBackdropFilterAt} from './components/SubjectStage/stageMotion';
import {TextBehindSubjectTrack} from './components/TextBehindSubjectTrack';
import {InsetRevealTrack} from './components/InsetRevealTrack';
import {HookTitle} from './components/HookTitle';
import {OpeningTreatment} from './components/OpeningTreatment';
import {DynamicCaptionRenderer} from './captions/DynamicCaptionRenderer';
import type {DynamicCaptionTemplateId} from './captions/types';
import {
  MediaContainerFrame,
  activeMediaContainerAt,
} from './components/MediaContainerTrack';
import {
  FrameInsetFrame,
  activeFrameInsetAt,
} from './components/FrameInsetTrack';
import {MotionGraphicTrack} from './components/MotionGraphicTrack';
import {GeneratedGraphicTrack, GeneratedSplitStage} from './generated/GeneratedGraphicTrack';
import {graphicsWithComponents} from './generated/loadFold';
import {useGeneratedGraphicComponents} from './generated/loader';
import {activeGeneratedSplitAt, captionsForGeneratedSplit} from './generated/placement';
import {PACKAGE_THEME_DEFAULT_FONT_SIZE, isPackageCaptionThemeId} from './captions/packageThemes';
import {captionBackingPlate, captionBackingPlateEnabled, captionPlateLineActive, captionPlateLines, captionSplitAt, captionsForBrollSplit, openingHidesCaptions, captionsMutedAt} from './lib/captionSplit';
import {SemanticEmphasisTrack} from './components/SemanticEmphasisTrack';
import {ImpactFxTrack, ImpactPunch} from './components/ImpactFxTrack';
import {SmashPunch} from './components/SmashPunch';
import {TransitionTrack} from './components/TransitionTrack';
import {VideoTrack} from './components/VideoTrack';
import {gradeFilterAt} from './lib/gradeBeat';
import {
  CompositePlate,
  VisualOverlayTrack,
  activeCompositeAt,
  activeCutoutAt,
  activeOverlayLayoutAt,
} from './components/VisualOverlayTrack';
import {ZoomFrame} from './components/ZoomFrame';
import {MusicBedTrack} from './components/MusicBedTrack';
import {SfxTrack} from './components/SfxTrack';
import {SlideshowPlate, overlayHasSlideshow} from './components/SlideshowPlate';
import {reportDesignDiagnostics, resolveDesignTokens} from './lib/designTokens';
import {resolveMediaSrc} from './lib/mediaSrc';
import {
  captionLayoutForInset,
  getInsetState,
} from './lib/insetRevealMotion';
import {activeInsetRevealAt} from './components/InsetRevealTrack';
import {SPLIT_ENTER_SEC, SPLIT_EXIT_SEC, splitExitStartsAt, splitPlaySec} from './lib/splitMotion';
import {compositionFrames, framesBetween, resolveSegments, secToFrame} from './lib/timeline';

const NO_GRAPHICS: GeneratedGraphic[] = [];
const NO_EXPLAINER_SPANS: ExplainerLayoutSpan[] = [];

export const ShortVideo: React.FC<ShortVideoProps> = ({blueprint, style}) => {
  const frame = useCurrentFrame();
  const {fps, width, height, durationInFrames} = useVideoConfig();
  const timeSec = frame / fps;
  // Preferred key `designTokens`, legacy key `northStarDesign` (dual-read). Diagnostics (a conflict, an ignored invalid design) are logged once.
  const design = React.useMemo(() => {
    const resolution = resolveDesignTokens(blueprint);
    reportDesignDiagnostics(resolution.diagnostics);
    return resolution.tokens;
  }, [blueprint]);
  // WP4F: the caption lines the backing plate follows (only for blueprints with `legibility.captions`).
  const plateLines = React.useMemo(
    () => (blueprint.legibility?.captions ? captionPlateLines(blueprint.captionWords) : []),
    [blueprint.legibility?.captions, blueprint.captionWords],
  );
  // WP42: Skill B (Explainer). A blueprint that carries `explainerLayoutTrack` has its picture composed by the layout frames (A / B / C / D, hard cuts); the free picture-owning overlays (split / composite /
  // cutout / cutaway) and the planned layout media are then drawn only inside the layouts. No track = every line below behaves exactly as before.
  const explainerTrack = style.brollEnabled ? blueprint.explainerLayoutTrack ?? NO_EXPLAINER_SPANS : NO_EXPLAINER_SPANS;
  const explainerOn = explainerTrack.length > 0;
  const allOverlays = style.brollEnabled ? blueprint.visualOverlays ?? [] : [];
  const overlays = explainerOn
    ? allOverlays.filter(overlay => !isExplainerMedia(overlay) && !(EXPLAINER_PICTURE_OWNING_OVERLAYS as readonly string[]).includes(overlay.layout))
    : allOverlays;
  const split = style.brollEnabled
    ? activeOverlayLayoutAt(overlays, 'split', timeSec)
    : undefined;
  const generatedGraphics = style.generatedGraphicsEnabled === false ? NO_GRAPHICS : blueprint.generatedGraphics ?? NO_GRAPHICS;
  const graphicComponents = useGeneratedGraphicComponents(generatedGraphics);
  // A B-roll split keeps priority; a generated split replaces the other base layouts.
  const generatedSplit = split || explainerOn ? undefined : activeGeneratedSplitAt(graphicsWithComponents(generatedGraphics, graphicComponents), timeSec);
  const composite = split || generatedSplit ? undefined : activeCompositeAt(overlays, timeSec);
  const cutout =
    !split && !generatedSplit && !composite && style.brollEnabled
      ? activeCutoutAt(overlays, timeSec)
      : undefined;
  const mediaContainer =
    !split && !generatedSplit && !composite && !cutout
      ? activeMediaContainerAt(blueprint.mediaContainers, timeSec)
      : undefined;
  const hookDurationSec = Math.max(1.2, blueprint.hookDurationSec || 3);
  const hookStartSec = Math.max(0, blueprint.hookStartSec || 0);
  const speakerSide = split
    ? split.speakerSide === 'top' ? 'top' : 'bottom'
    : generatedSplit?.placement.mode === 'split_screen' &&
        generatedSplit.placement.graphicSide === 'bottom'
      ? 'top'
      : 'bottom';
  const motionGraphics = blueprint.motionGraphics ?? [];
  const semanticEmphasis = blueprint.semanticEmphasis ?? [];
  const frameInset = activeFrameInsetAt(blueprint.frameInsets, timeSec);
  const insetClip =
    !split && !generatedSplit && !composite && !cutout
      ? activeInsetRevealAt(blueprint.insetReveals, timeSec)
      : undefined;
  const insetState = insetClip
    ? getInsetState(
        timeSec - insetClip.start,
        insetClip.end - insetClip.start,
        insetClip.params,
      )
    : undefined;
  const baseCaptionLayout = captionLayoutForInset(
    insetClip && insetClip.params.captions.enabled ? insetState?.progress ?? 0 : 0,
    {
      position: blueprint.captionDirection?.position,
      bottomFrac:
        blueprint.captionDirection?.bottomFrac ?? style.captionBottomFrac,
    },
    insetClip?.params,
  );

  // A bottom-half generated split docks captions above the seam; the band tells
  // generated graphics where captions sit so they keep content out of it.
  const generatedCaptions = captionsForGeneratedSplit(baseCaptionLayout, generatedSplit, height);
  // WP2B (blueprints with `legibility` only): during a B-roll split the captions leave the creator's half (chin/neck) for the related-media half, on a dark box.
  const legibleCaptions = blueprint.legibility?.captions;
  // WP3U: the split caption placement (plate + position) is held `splitHoldFrames` before a B-roll split starts and after it ends (never moves the split itself). Frames at the
  // BLUEPRINT fps; without a usable blueprint fps or hold the switch stays instant. Never during a generated split, which docks captions its own way.
  const holdSplit =
    legibleCaptions && !split && !generatedSplit && style.brollEnabled
      ? captionSplitAt(
          overlays.filter(overlay => overlay.layout === 'split' && Boolean(overlay.assetUrl)),
          frame,
          {holdFrames: legibleCaptions.splitHoldFrames, fps: blueprint.fps, durationFrames: durationInFrames},
        )
      : undefined;
  const captionSplit = split ?? holdSplit;
  const captionSpeakerSide = holdSplit ? (holdSplit.speakerSide === 'top' ? 'top' : 'bottom') : speakerSide;
  const splitCaptions = legibleCaptions && captionSplit ? captionsForBrollSplit(generatedCaptions.layout, captionSpeakerSide, height) : undefined;
  const captionLayout = splitCaptions?.layout ?? generatedCaptions.layout;
  const captionBand = blueprint.captionWords.length > 0 ? (splitCaptions?.band ?? generatedCaptions.band) : null;
  const captionTemplateId = style.captionTemplate || blueprint.captionDirection?.template;
  // WP4D (blueprints with `legibility.captions` only): outline-style captions off a split get the same dark band as a split, in the lower half at the caption's bottom edge.
  // WP4F: only while a caption line is on screen (the renderer's grouping and `activeLineAt`, hold included), so the band is not up through the long gaps and does not blink between words.
  // WP8G: OFF unless the blueprint explicitly opts in (`legibility.captions.backingPlate === true`); no product profile writes it, so no full-width band on talking-head footage. The split
  // layout's own plate (`splitCaptions.plate`) is unchanged.
  const backingPlate =
    legibleCaptions && captionBackingPlateEnabled(legibleCaptions) && blueprint.captionWords.length > 0 && captionPlateLineActive(plateLines, timeSec)
      ? captionBackingPlate({
          template: captionTemplateId,
          packageTheme: isPackageCaptionThemeId(captionTemplateId),
          boxColor: blueprint.captionDirection?.boxColor,
          splitPlateShowing: Boolean(splitCaptions),
          generatedSplitShowing: Boolean(generatedSplit),
          layout: captionLayout,
          canvasHeight: height,
        })
      : null;

  // WP4K: no caption layer and no plate over the art-directed opening while it is on screen.
  // WP11A: also muted while a graphic that owns the spoken words is on screen (one text job at a time).
  const openingShowing = openingHidesCaptions(blueprint.openingTreatment, timeSec) || captionsMutedAt(blueprint.captionMuteRanges, timeSec);

  const segments = resolveSegments(blueprint.keepSegments, {
    trimEnabled: style.trimEnabled,
    sourceDurationSec: blueprint.sourceDurationSec,
  });

  // SUBJECT STAGE: the person foreground the stage needs (undefined for a blueprint without `subjectStage`)
  const subjectStageForeground = foregroundFromStage(blueprint.subjectStage);
  const hideBaseUnderMatte = Boolean(blueprint.subjectStage && (blueprint.subjectForeground || subjectStageForeground));

  // Keep the creator's face in the half-panel: bias toward the upper face band.
  const speakerObjectPosition =
    speakerSide === 'top' ? '50% 28%' : '50% 18%';

  // WP26: a `smash zoom` transition punches the real footage (scale + a touch of blur) in sync with its edge blowout.
  const speakerAt = (objectPosition: string) => {
    const baseVideo = (
      <VideoTrack
        src={blueprint.videoUrl}
        segments={segments}
        layoutStyle={style.layoutStyle}
        objectPosition={objectPosition}
        // Dim-only stage treatment (never CSS blur).
        grade={combineFilters(gradeFilterAt(blueprint.gradeBeats, timeSec), stageBackdropFilterAt(blueprint.subjectStage, timeSec))}
      />
    );
    return (
    <SmashPunch clips={blueprint.transitions} enabled={style.brollEnabled}>
      <ImpactPunch fx={blueprint.impactFx} enabled={style.brollEnabled}>
      <ZoomFrame triggers={blueprint.zoomTriggers} enabled={style.zoomEnabled}>
        {/* SUBJECT STAGE: the behind-layer (SubjectStageTrack) is what sits behind the cutout; the base talking-head body is NOT shown under the matte. The speaker stays mounted at opacity 0 so its audio keeps playing (the cutout track is muted). Absent subjectStage = plain VideoTrack, unchanged. */}
        {hideBaseUnderMatte ? <AbsoluteFill style={{opacity: 0}}>{baseVideo}</AbsoluteFill> : baseVideo}
      </ZoomFrame>
      </ImpactPunch>
    </SmashPunch>
    );
  };
  const speaker = speakerAt(split || generatedSplit ? speakerObjectPosition : '50% 42%');

  const containedSpeaker = mediaContainer ? (
    <MediaContainerFrame
      container={mediaContainer}
      language={blueprint.languageCode}>
      {speaker}
    </MediaContainerFrame>
  ) : (
    speaker
  );

  // The classic full talking-head stack (inset reveal > text behind subject > depth overlay > media container > speaker). Layout A of an explainer edit draws exactly this.
  const classicStack = (
    <InsetRevealTrack
      clips={blueprint.insetReveals ?? []}
      legible={Boolean(blueprint.legibility)}
      talkingHead={
        <TextBehindSubjectTrack
          clips={blueprint.behindSubjectTexts ?? []}
          talkingHead={
            <DepthOverlayTrack
              clips={style.brollEnabled ? blueprint.depthOverlays ?? [] : []}
              talkingHead={containedSpeaker}
              speakerCutout={blueprint.speakerCutout}
              segments={segments}
              layoutStyle={style.layoutStyle}
              zoomTriggers={blueprint.zoomTriggers}
              zoomEnabled={style.zoomEnabled}
            />
          }
          speakerCutout={blueprint.speakerCutout}
          segments={segments}
          layoutStyle={style.layoutStyle}
          zoomTriggers={blueprint.zoomTriggers}
          zoomEnabled={style.zoomEnabled}
        />
      }
      design={design}
    />
  );

  // WP42: the layout on screen NOW (a hard cut: the span whose first frame has been reached, no blend). B = the planned media / claim plate on top + the speaker below the seam; C = white + dot grid, speaker
  // hidden; D = dark cutaway, speaker hidden; A = the classic full talking head. The speaker video is mounted exactly once in every layout (hidden in C / D) so the audio never drops.
  // WP44: accent/ground from blueprint.editPalette (content-aware; Skill B preferred lime/paper when unset).
  const editPalette = blueprint.editPalette;
  const explainerAccent = editPalette?.accent;
  const explainerInkOnAccent = editPalette?.inkOnAccent;
  const explainerSpan = explainerOn ? activeExplainerSpanAt(explainerTrack, frame, fps) : null;
  // WP49: animate the split seam when entering / leaving layout B (expand speaker up or b-roll down).
  const explainerExpand = explainerOn ? explainerSplitExpandAt(explainerTrack, frame, fps) : null;
  const explainerDrawSplit = Boolean(explainerExpand?.drawSplit);
  const explainerSeam = explainerExpand?.seam ?? 0.5;
  const explainerPicture = explainerSpan ? (
    <ExplainerLayoutFrame
      layout={explainerSpan.layout}
      width={width}
      height={height}
      groundColor={editPalette?.ground}
      groundDotColor={editPalette?.groundDot}
      groundDotted={!editPalette || editPalette.groundStyle === 'paper_dot'}
      forceSplit={explainerDrawSplit}
      seam={explainerSeam}
      broll={
        explainerDrawSplit || explainerSpan.layout === 'explainer_b' ? (
          (() => {
            const beat = claimBeatForSpan(blueprint.explainerClaimBeats, explainerSpan);
            const region = explainerRegions('explainer_b', width, height).top!;
            // Prefer media tagged for the active / target layout during expand into C/D
            const mediaLayout = explainerSpan.layout === 'explainer_b' ? 'explainer_b' : explainerSpan.layout === 'explainer_a' ? 'explainer_b' : explainerSpan.layout;
            return beat && explainerSpan.layout === 'explainer_b' ? (
              <ExplainerClaimPlate beat={beat} width={region.w} height={region.h} accentColor={explainerAccent} />
            ) : (
              <ExplainerMedia
                overlay={explainerMediaForSpan(allOverlays, {...explainerSpan, layout: mediaLayout === 'explainer_a' ? 'explainer_b' : mediaLayout})}
                layout={mediaLayout === 'explainer_a' ? 'explainer_b' : mediaLayout}
                width={region.w}
                height={region.h}
                accentColor={explainerAccent}
                inkOnAccent={explainerInkOnAccent}
              />
            );
          })()
        ) : undefined
      }
      speaker={explainerDrawSplit || explainerSpan.layout === 'explainer_b' ? speakerAt('50% 22%') : undefined}>
      {!explainerDrawSplit && explainerSpan.layout === 'explainer_a' ? (
        classicStack
      ) : !explainerDrawSplit && (explainerSpan.layout === 'explainer_c' || explainerSpan.layout === 'explainer_d') ? (
        <AbsoluteFill>
          <ExplainerMedia overlay={explainerMediaForSpan(allOverlays, explainerSpan)} layout={explainerSpan.layout} width={width} height={height} accentColor={explainerAccent} inkOnAccent={explainerInkOnAccent} />
          <AbsoluteFill style={{opacity: 0, pointerEvents: 'none'}}>{speakerAt('50% 42%')}</AbsoluteFill>
        </AbsoluteFill>
      ) : null}
    </ExplainerLayoutFrame>
  ) : null;

  const picture = (
    <AbsoluteFill style={{backgroundColor: '#000000'}}>
      {style.brollEnabled && !explainerOn ? <CompositeTrack overlays={overlays} /> : null}

      {explainerPicture ? (
        explainerPicture
      ) : split ? (
        <SplitStage overlay={split} height={height} speakerSide={speakerSide}>
          {speaker}
        </SplitStage>
      ) : generatedSplit ? (
        <GeneratedSplitStage
          graphic={generatedSplit}
          Component={graphicComponents?.[generatedSplit.module.sha256]}
          captionBand={captionBand}>
          {speaker}
        </GeneratedSplitStage>
      ) : composite ? (
        <div
          style={{
            position: 'absolute',
            left: width * 0.07,
            width: width * 0.86,
            bottom: height * 0.12,
            height: height * 0.4,
            borderRadius: 34,
            overflow: 'hidden',
            border: '3px solid rgba(255,255,255,0.38)',
            boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
          }}>
          {speaker}
        </div>
      ) : cutout ? (
        <CutoutStage
          overlay={cutout}
          speakerCutout={blueprint.speakerCutout}
          talkingHead={speaker}
          plateUrl={
            cutout.assetUrl ||
            (blueprint.brollClips ?? []).find(
              clip =>
                Boolean(clip.assetUrl) &&
                clip.start < cutout.end &&
                clip.end > cutout.start,
            )?.assetUrl
          }
          plateKind={
            cutout.assetUrl
              ? cutout.mediaKind
              : (blueprint.brollClips ?? []).some(
                    clip =>
                      Boolean(clip.assetUrl) &&
                      clip.start < cutout.end &&
                      clip.end > cutout.start,
                  )
                ? 'video'
                : cutout.mediaKind
          }
        />
      ) : (
        classicStack
      )}

      {style.brollEnabled && blueprint.brollClips.length > 0 && !split && !cutout && !explainerOn ? (
        <BRollTrack clips={blueprint.brollClips} />
      ) : null}

      {style.brollEnabled && overlays.length > 0 ? (
        <VisualOverlayTrack
          overlays={overlays}
          language={blueprint.languageCode}
          design={design}
        />
      ) : null}

      {motionGraphics.length > 0 ? (
        <MotionGraphicTrack
          graphics={motionGraphics}
          language={blueprint.languageCode}
          design={design}
        />
      ) : null}

      {generatedGraphics.length > 0 && graphicComponents ? (
        // WP36: the faceless lane's stills are the world, so the money punch-in (WP35) scales them too (it only fires inside a planned money window)
        <ImpactPunch fx={blueprint.impactFx} enabled={style.brollEnabled}>
          <GeneratedGraphicTrack graphics={generatedGraphics} components={graphicComponents} captionBand={captionBand} />
        </ImpactPunch>
      ) : null}

      {blueprint.kinetic ? (
        // KINETIC TYPE (absent = nothing mounted): text BEHIND the person (drawn before the RVM foreground below)
        <KineticTrack spec={blueprint.kinetic} layer="behind" foreground={Boolean(blueprint.subjectForeground || subjectStageForeground)} />
      ) : null}

      {blueprint.subjectStage ? (
        // SUBJECT STAGE (absent = nothing mounted): the layer BEHIND the person (S1 plate / S2 card / S3 ghost scroll / S4 accents). Above the speaker footage, below the person (SubjectForegroundTrack).
        <SubjectStageTrack stage={blueprint.subjectStage} zoomTriggers={blueprint.zoomTriggers} zoomEnabled={style.zoomEnabled} />
      ) : null}

      {blueprint.subjectForeground ? (
        // WP55 phase 2: the presenter in front of host-composited kinetic environmental type (same keep segments + zoom as the speaker, so cuts stay in sync)
        <SubjectForegroundTrack
          foreground={blueprint.subjectForeground}
          segments={segments}
          layoutStyle={style.layoutStyle}
          zoomTriggers={blueprint.zoomTriggers}
          zoomEnabled={style.zoomEnabled}
        />
      ) : null}

      {!blueprint.subjectForeground && subjectStageForeground ? (
        // SUBJECT STAGE: the person (RVM matte) over the stage spans, through the same keep segments + zoom as the speaker. Only when kinetic's own subjectForeground is not set.
        <SubjectForegroundTrack
          foreground={subjectStageForeground}
          segments={segments}
          layoutStyle={style.layoutStyle}
          zoomTriggers={blueprint.zoomTriggers}
          zoomEnabled={style.zoomEnabled}
        />
      ) : null}

      {blueprint.subjectStage ? (
        // SUBJECT STAGE: S5 foreground takeover + flash_cut, IN FRONT of the person
        <SubjectStageFront stage={blueprint.subjectStage} />
      ) : null}

      {blueprint.kinetic ? (
        // KINETIC TYPE: text IN FRONT of the person (after the foreground, before emphasis / transitions / captions)
        <KineticTrack spec={blueprint.kinetic} layer="front" foreground={Boolean(blueprint.subjectForeground || subjectStageForeground)} />
      ) : null}

      {semanticEmphasis.length > 0 ? (
        <SemanticEmphasisTrack
          emphasis={semanticEmphasis}
          language={blueprint.languageCode}
          design={design}
        />
      ) : null}

      {style.brollEnabled && (blueprint.transitions ?? []).length > 0 ? (
        <TransitionTrack clips={blueprint.transitions} />
      ) : null}

      {style.brollEnabled && blueprint.impactFx ? <ImpactFxTrack fx={blueprint.impactFx} /> : null}

      <MusicBedTrack
        bed={
          blueprint.audioDesign?.musicUrl
            ? {
                musicUrl: blueprint.audioDesign.musicUrl,
                musicGain: blueprint.audioDesign.musicGain,
                duckedGain: blueprint.audioDesign.duckedGain,
                ducking: blueprint.audioDesign.ducking,
                ...(blueprint.audioDesign.musicFullUrl ? {musicFullUrl: blueprint.audioDesign.musicFullUrl} : {}),
                ...(blueprint.audioDesign.musicLoopUrl ? {musicLoopUrl: blueprint.audioDesign.musicLoopUrl} : {}),
                ...(blueprint.audioDesign.musicCarvedUrl ? {musicCarvedUrl: blueprint.audioDesign.musicCarvedUrl} : {}),
                ...(blueprint.audioDesign.musicFullDurationSec ? {musicFullDurationSec: blueprint.audioDesign.musicFullDurationSec} : {}),
                ...(blueprint.audioDesign.musicSource ? {musicSource: blueprint.audioDesign.musicSource} : {}),
              }
            : null
        }
        duck={blueprint.audioDesign?.duck ?? null}
        speechWindows={(blueprint.captionWords ?? []).map(word => ({start: word.start, end: word.end}))}
      />
      <SfxTrack hits={blueprint.audioDesign?.hits} />

      {blueprint.openingTreatment ? (
        <Sequence
          from={secToFrame(blueprint.openingTreatment.startSec, fps)}
          durationInFrames={Math.max(1, Math.round(blueprint.openingTreatment.durationSec * fps))}>
          <OpeningTreatment spec={blueprint.openingTreatment} />
        </Sequence>
      ) : null}

      {blueprint.hookTitle ? (
        <Sequence
          from={secToFrame(hookStartSec, fps)}
          durationInFrames={Math.max(1, Math.round(hookDurationSec * fps))}>
          <HookTitle
            // An art-directed opening replaces the standard hook: HookTitle draws nothing for an empty title.
            title={blueprint.openingTreatment ? '' : blueprint.hookTitle}
            durationSec={hookDurationSec}
            language={blueprint.languageCode}
            styleId={blueprint.hookStyle}
            anchor={blueprint.hookAnchor}
            fit={blueprint.legibility?.hook}
            design={design}
          />
        </Sequence>
      ) : null}

      {!openingShowing && legibleCaptions && blueprint.captionWords.length > 0 && (splitCaptions?.plate ?? backingPlate) ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: (splitCaptions?.plate ?? backingPlate)!.top,
            height: (splitCaptions?.plate ?? backingPlate)!.height,
            backgroundColor: legibleCaptions.splitBoxColor,
            pointerEvents: 'none',
          }}
        />
      ) : null}

      {!openingShowing ? (
      <AbsoluteFill
        style={{
          bottom: 'auto',
          height: `${captionLayout.frameHeightFrac * 100}%`,
          overflow: 'hidden',
          pointerEvents: 'none',
          top: `${captionLayout.frameTopFrac * 100}%`,
        }}>
        <DynamicCaptionRenderer
          railClear={Boolean(legibleCaptions)}
          transcriptData={blueprint.captionWords}
          selectedTemplate={captionTemplateId as DynamicCaptionTemplateId}
          customizationOptions={{
            // WP2C: on a legible split every template reads against the dark band below. The grape package theme paints its own pill from the primary colour, so
            // it gets the plate colour (its text then turns white by its own rule); every other theme/template takes white text and the contrast-checked highlight.
            primaryColor:
              splitCaptions && legibleCaptions
                ? captionTemplateId === 'grape-theme'
                  ? legibleCaptions.splitPlateColor
                  : legibleCaptions.splitTextColor
                : backingPlate && legibleCaptions
                  ? legibleCaptions.splitTextColor
                  : blueprint.captionDirection?.textColor,
            secondaryColor: (splitCaptions || backingPlate) && legibleCaptions ? legibleCaptions.splitHighlightColor : blueprint.captionDirection?.highlightColor,
            // WP2B: a package theme sizes itself from PACKAGE_THEME_DEFAULT_FONT_SIZE; scaling the 34 px kinetic base instead made it less than half size.
            fontSize: blueprint.captionDirection?.fontScale
              ? (blueprint.legibility && isPackageCaptionThemeId(captionTemplateId) ? PACKAGE_THEME_DEFAULT_FONT_SIZE : 34) * blueprint.captionDirection.fontScale
              : undefined,
          }}
          language={blueprint.languageCode}
          style={{
            ...style,
            captionBottomFrac: captionLayout.bottomFrac,
          }}
          direction={{
            ...blueprint.captionDirection,
            position: captionLayout.position,
            bottomFrac: captionLayout.bottomFrac,
            ...(splitCaptions && legibleCaptions ? {boxColor: legibleCaptions.splitBoxColor, textColor: legibleCaptions.splitTextColor} : {}),
          }}
          design={design}
        />
      </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );

  return frameInset ? (
    <FrameInsetFrame inset={frameInset}>{picture}</FrameInsetFrame>
  ) : (
    picture
  );
};

/**
 * WP42: the claim beat's article plate (top half of layout B). The spoken line is the plate; when the key phrase is spoken the rest dims to 0.28 and a lime L -> R bar wipes behind the phrase
 * (`LimeHighlightWipe`, WP41). The phrase is measured from the DOM; an unmeasurable phrase still shows the plate + dim with a fallback band (never a crash, never a blank).
 */
const ExplainerClaimPlate: React.FC<{beat: ExplainerClaimBeat; width: number; height: number; accentColor?: string}> = ({beat, width, height, accentColor}) => {
  const {fps} = useVideoConfig();
  const {rects, measured, settled, probe} = useArticlePhraseRects({context: beat.context, phrase: beat.phrase, width, height});
  React.useEffect(() => {
    if (settled && !measured && typeof console !== 'undefined') console.warn(`[explainer] lime phrase "${beat.phrase}" was not measurable; using the fallback band`);
  }, [settled, measured, beat.phrase]);
  return (
    <AbsoluteFill data-explainer-claim-plate="true">
      {probe}
      <LimeHighlightWipe width={width} height={height} rects={rects} color={accentColor} startFrame={Math.max(secToFrame(beat.start, fps), secToFrame(beat.phraseStart, fps))}>
        <ExplainerArticleBody context={beat.context} phrase={beat.phrase} width={width} />
      </LimeHighlightWipe>
    </AbsoluteFill>
  );
};

/**
 * Split: creator on top OR bottom (director/planner picks). Soft feather seam.
 * Creator half always frames the face — never chops the head at the cut.
 */
const SplitStage: React.FC<{
  overlay: VisualOverlay;
  height: number;
  speakerSide: 'top' | 'bottom';
  children: React.ReactNode;
}> = ({overlay, height, speakerSide, children}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const timeSec = frame / fps;
  const local = Math.max(0, timeSec - overlay.start);
  const enter = spring({
    frame: Math.round(local * fps),
    fps,
    config: {damping: 22, stiffness: 58, mass: 1.15},
    durationInFrames: Math.round(SPLIT_ENTER_SEC * fps),
  });
  const exitAt = splitExitStartsAt(overlay);
  const exit =
    local < exitAt
      ? 1
      : interpolate(local, [exitAt, exitAt + SPLIT_EXIT_SEC], [1, 0], {
          easing: Easing.inOut(Easing.cubic),
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
  const progress = Math.min(1, enter) * Math.max(0, exit);

  const seam = interpolate(progress, [0, 1], [
    speakerSide === 'top' ? height : 0,
    height * 0.5,
  ]);
  const feather = Math.max(40, height * 0.075);
  const topH = seam + feather * 0.55;
  const bottomTop = seam - feather * 0.55;
  const bottomH = height - bottomTop;
  const relatedShift = (1 - progress) * (speakerSide === 'top' ? height * 0.35 : -height * 0.35);

  const hasMedia = Boolean(overlay.assetUrl) || overlayHasSlideshow(overlay);
  if (!hasMedia) {
    return <AbsoluteFill>{children}</AbsoluteFill>;
  }

  const related = (
    <div
      style={{
        width: '100%',
        height: '100%',
        transform: `translateY(${relatedShift}px)`,
        opacity: progress,
      }}>
      {overlay.mediaKind === 'video' && overlay.assetUrl && !overlayHasSlideshow(overlay) ? (
        <SplitVideoPlate overlay={overlay} />
      ) : (
        // SlideshowPlate times its slides from the frame it sees and splits the available duration between them, so it
        // must run inside the overlay's own Sequence; outside one it used the whole video's clock and could skip slides.
        <Sequence from={secToFrame(overlay.start, fps)} durationInFrames={framesBetween(overlay.start, overlay.end, fps)} layout="none">
          <SlideshowPlate overlay={overlay} />
        </Sequence>
      )}
    </div>
  );

  const topMask = {
    WebkitMaskImage: `linear-gradient(to bottom, #000 0%, #000 calc(100% - ${feather}px), transparent 100%)`,
    maskImage: `linear-gradient(to bottom, #000 0%, #000 calc(100% - ${feather}px), transparent 100%)`,
  } as const;
  const bottomMask = {
    WebkitMaskImage: `linear-gradient(to top, #000 0%, #000 calc(100% - ${feather}px), transparent 100%)`,
    maskImage: `linear-gradient(to top, #000 0%, #000 calc(100% - ${feather}px), transparent 100%)`,
  } as const;

  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: topH,
          overflow: 'hidden',
          backgroundColor: '#111',
          ...topMask,
        }}>
        {speakerSide === 'top' ? children : related}
      </div>
      <div
        style={{
          position: 'absolute',
          top: bottomTop,
          left: 0,
          right: 0,
          height: bottomH,
          overflow: 'hidden',
          ...bottomMask,
        }}>
        {speakerSide === 'bottom' ? children : related}
      </div>
      <div
        style={{
          position: 'absolute',
          top: seam - feather * 0.5,
          left: 0,
          right: 0,
          height: feather,
          pointerEvents: 'none',
          opacity: 0.85 * progress,
          background:
            'linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,0.14) 45%, rgba(0,0,0,0.12) 55%, rgba(0,0,0,0) 100%)',
          filter: 'blur(10px)',
        }}
      />
    </AbsoluteFill>
  );
};

const splitVideoStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  objectPosition: '50% 40%',
};

/** Slide in first; play the clip only after enter hits 100%; then slide off. */
const SplitVideoPlate: React.FC<{overlay: VisualOverlay}> = ({overlay}) => {
  const {fps} = useVideoConfig();
  const startFrame = secToFrame(overlay.start, fps);
  const enterFrames = Math.max(1, Math.round(SPLIT_ENTER_SEC * fps));
  const playFrames = Math.max(1, Math.round(splitPlaySec(overlay) * fps));
  const src = resolveMediaSrc(overlay.assetUrl);
  return (
    <AbsoluteFill>
      <Sequence from={startFrame} durationInFrames={enterFrames} layout="none">
        <OffthreadVideo src={src} startFrom={0} endAt={2} muted style={splitVideoStyle} />
      </Sequence>
      <Sequence from={startFrame + enterFrames} durationInFrames={playFrames} layout="none">
        <OffthreadVideo src={src} muted style={splitVideoStyle} />
      </Sequence>
    </AbsoluteFill>
  );
};

/**
 * Creator stands in front of B-roll / designed canvas. Keyed WebM when the
 * backdrop is plain; otherwise a soft occupancy crop of the talking-head.
 */
const CutoutStage: React.FC<{
  overlay: VisualOverlay;
  speakerCutout?: TimelineBlueprint['speakerCutout'];
  talkingHead: React.ReactNode;
  plateUrl?: string;
  plateKind?: VisualOverlay['mediaKind'];
}> = ({overlay, speakerCutout, talkingHead, plateUrl, plateKind}) => {
  const absoluteFrame = useCurrentFrame();
  const {fps, width, height, durationInFrames} = useVideoConfig();
  // This stage is not inside a <Sequence>, so the frame is absolute; time inside the cutout is measured from its start.
  // (Using the absolute time made every cutout that starts later than its own length fade to nothing.)
  const frame = Math.max(0, absoluteFrame - secToFrame(overlay.start, fps));
  const local = frame / fps;
  const hold = Math.max(0.8, overlay.end - overlay.start);
  const enter = spring({
    frame,
    fps,
    config: {damping: 18, stiffness: 90, mass: 0.95},
    durationInFrames: Math.round(0.7 * fps),
  });
  const remaining = hold - local;
  const exit =
    remaining < 0.7
      ? interpolate(remaining, [0, 0.7], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : 1;
  const progress = Math.min(1, enter) * Math.max(0, exit);
  const keyedSrc = speakerCutout?.videoUrl
    ? resolveMediaSrc(speakerCutout.videoUrl)
    : '';
  const box = speakerCutout?.speaker ?? {x: 0.12, y: 0.22, w: 0.76, h: 0.7};
  const speakerWidth = width * Math.min(0.92, Math.max(0.62, box.w * 1.15));
  const speakerHeight = height * Math.min(0.72, Math.max(0.42, box.h * 0.95));

  return (
    <AbsoluteFill>
      <AbsoluteFill style={{opacity: progress}}>
        {plateUrl ? (
          plateKind === 'video' ? (
            <OffthreadVideo
              src={resolveMediaSrc(plateUrl)}
              muted
              style={{width: '100%', height: '100%', objectFit: 'cover'}}
            />
          ) : (
            <Img
              src={resolveMediaSrc(plateUrl)}
              style={{width: '100%', height: '100%', objectFit: 'cover'}}
            />
          )
        ) : (
          <AbsoluteFill
            style={{
              background:
                overlay.accentColor ||
                'linear-gradient(180deg, #F8FAFC 0%, #E2E8F0 100%)',
            }}
          />
        )}
      </AbsoluteFill>
      {keyedSrc ? (
        <OffthreadVideo
          src={keyedSrc}
          muted
          transparent
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: progress,
          }}
        />
      ) : (
        <div
          style={{
            position: 'absolute',
            left: (width - speakerWidth) / 2,
            bottom: height * 0.02,
            width: speakerWidth,
            height: speakerHeight,
            overflow: 'hidden',
            opacity: progress,
            WebkitMaskImage:
              'radial-gradient(ellipse 72% 88% at 50% 62%, #000 46%, transparent 78%)',
            maskImage:
              'radial-gradient(ellipse 72% 88% at 50% 62%, #000 46%, transparent 78%)',
          }}>
          {talkingHead}
        </div>
      )}
    </AbsoluteFill>
  );
};

const CompositeTrack: React.FC<{overlays: VisualOverlay[]}> = ({overlays}) => {
  const {fps} = useVideoConfig();
  return (
    <AbsoluteFill>
      {overlays
        .filter(overlay => overlay.layout === 'composite' && overlay.assetUrl)
        .map((overlay, index) => (
          <Sequence
            key={`composite-${overlay.providerId}-${index}`}
            from={secToFrame(overlay.start, fps)}
            durationInFrames={framesBetween(overlay.start, overlay.end, fps)}>
            <CompositePlate overlay={overlay} />
          </Sequence>
        ))}
    </AbsoluteFill>
  );
};

export function durationInFramesFor(props: ShortVideoProps): number {
  const seconds = props.style.trimEnabled
    ? props.blueprint.outputDurationSec
    : props.blueprint.sourceDurationSec;
  const segments = resolveSegments(props.blueprint.keepSegments, {
    trimEnabled: props.style.trimEnabled,
    sourceDurationSec: props.blueprint.sourceDurationSec,
  });
  return compositionFrames(segments, seconds, props.blueprint.fps);
}
