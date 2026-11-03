/**
 * @finalpost/motion — the procedural motion toolkit generated graphics import.
 * Only what is exported here is public. Docs for graphic authors: ./README.md
 */

export const MOTION_LIB_VERSION = '0.1.0';

// Runtime context, theme, layout
export {useMotionTheme, useSvgId} from './context';
export {defaultTheme, resolveTheme, withAlpha, type MotionTheme} from './theme';
export {contentBox, splitRow, splitColumn, sliceTop, center, isWide, type SafeArea, type Rect} from './layout';
export {fontFamily, type FontId} from './fonts';
export {fitTextBlock, fitTextGroup, measureLine, type FitTextOptions, type FittedText} from './text';

// Animation
export {
  ease,
  progress,
  springIn,
  exitProgress,
  stagger,
  lerp,
  lerpPoint,
  pointAlong,
  drawStroke,
  pulse,
  keyframes,
  type EaseName,
  type SpringPreset,
} from './animation';
export {Reveal, Stagger, Box, type RevealEffect, type RevealProps} from './components/Reveal';

// Primitives
export {FitText, KineticText, type FitTextProps, type KineticTextProps} from './components/Text';
export {CurvedText, type CurvedTextProps, type CurvedTextReveal} from './components/CurvedText';
export {layoutCurvedText, type CurvedTextOptions, type CurvedTextLayout, type CurveShape, type CurveAlign} from './curvedText';
export {ClipWindow, MaskReveal, LayeredText, type ClipWindowProps, type MaskRevealProps, type LayeredTextProps} from './components/MaskedText';
export {regionClipPath, revealClipPath, MASK_REVEAL_KINDS, type ClipRegion, type ClipShape, type MaskRevealKind} from './masks';
export {Card, Shape, Line, Background, type CardProps, type ShapeProps, type LineProps} from './components/Shapes';
export {Arrow, FocusRing, Badge, Progress, type ArrowProps, type FocusRingProps, type BadgeProps, type ProgressProps} from './components/Indicators';
export {Counter, BarChart, LineChart, formatNumber, type CounterProps, type BarChartProps, type LineChartProps, type NumberFormat} from './components/Data';
export {Icon, AssetImage, DeviceFrame, ICON_NAMES, type IconName} from './components/Media';

// Reference compositions
export {StatHighlight} from './compositions/StatHighlight';
export {ProcessSteps} from './compositions/ProcessSteps';
export {BeforeAfter} from './compositions/BeforeAfter';
export {ChartExplainer} from './compositions/ChartExplainer';
export {QuoteCallout} from './compositions/QuoteCallout';
export {PointerCallout} from './compositions/PointerCallout';
// WP8D: social-short compositions (library-first motion; the server prefers these over Claude-written TSX when a brief fits)
export {BigKineticHeadline, type BigKineticHeadlineProps, type HeadlineLine} from './compositions/BigKineticHeadline';
export {TopicPills, type TopicPillsProps, type TopicPill} from './compositions/TopicPills';
export {VsClaim, type VsClaimProps} from './compositions/VsClaim';
export {FullscreenStatement, type FullscreenStatementProps} from './compositions/FullscreenStatement';
export {BrandLockupBar, type BrandLockupBarProps} from './compositions/BrandLockupBar';
// WP9G: section stamp and social-post card plates
export {StampTitle, type StampTitleProps} from './compositions/StampTitle';
export {TweetCard, type TweetCardProps} from './compositions/TweetCard';
// WP10A: designed open / thumbnail plate (arc headline + masked title) and the theme-derived plate palette
export {OpenPlate, type OpenPlateProps} from './compositions/OpenPlate';
export {WikiCallout, type WikiCalloutProps} from './compositions/WikiCallout';
export {FlashCard, FLASH_CARD_MAX_WORDS, type FlashCardProps} from './compositions/FlashCard';
export {ImageRun, IMAGE_RUN_MAX_ITEMS, type ImageRunProps, type ImageRunItem, type ImageRunBackdrop} from './compositions/ImageRun';
export {NewspaperCallout, newspaperColumns, NEWSPAPER_TWO_COLUMN_WORDS, type NewspaperCalloutProps} from './compositions/NewspaperCallout';
// Skill C: Jitter-class textual MG plate (over media; see textualMgCatalog / textual-mg-grammar.yaml)
export {TextualMgPlate, TEXTUAL_MG_MAX_WORDS, type TextualMgPlateProps} from './compositions/TextualMgPlate';
export {
  TEXTUAL_MG_CATALOG,
  TEXTUAL_MG_FAMILIES,
  TEXTUAL_MG_DEFERRED,
  defaultRecipeFor,
  familyForTrigger,
  textualMgFamily,
  type TextualMgFamily,
  type TextualMgFamilySpec,
  type TextualMgTrigger,
} from '../lib/textualMgCatalog';
// WP45: Layer-2 motion-template toolkit moves (CLIP_01..04). Opaque full-bleed; used inside the existing skills via the allowlist, NOT a new skill lane.
export {GridMosaicMorph, type GridMosaicMorphProps} from './compositions/templates/GridMosaicMorph';
export {SlitPanelCarousel, type SlitPanelCarouselProps, type SlitPanel} from './compositions/templates/SlitPanelCarousel';
export {BentoCardWall, type BentoCardWallProps, type BentoCard} from './compositions/templates/BentoCardWall';
export {StackedCardDeck, type StackedCardDeckProps, type StackCard} from './compositions/templates/StackedCardDeck';
// WP46: Layer-2 toolkit moves CLIP_05..08 (brand loop, blur word carousel, iOS notification overlay, nested-rect title). Still inside the existing skills; ConfigBrandLoop / BlurWordCarousel / NestedRectTitleWipe are opaque, IosNotificationMock is an overlay.
export {ConfigBrandLoop, type ConfigBrandLoopProps, type ConfigScene} from './compositions/templates/ConfigBrandLoop';
export {BlurWordCarousel, type BlurWordCarouselProps} from './compositions/templates/BlurWordCarousel';
export {IosNotificationMock, type IosNotificationMockProps} from './compositions/templates/IosNotificationMock';
export {NestedRectTitleWipe, type NestedRectTitleWipeProps} from './compositions/templates/NestedRectTitleWipe';
// WP47: Layer-2 toolkit moves CLIP_09..12 (analysis Part 2 ACME set: fruit letter swap, morph font stretch, menu slide poster, editorial inset poster). Still inside the existing skills; all four are opaque full-bleed.
export {AcmeFruitLetterSwap, type AcmeFruitLetterSwapProps} from './compositions/templates/AcmeFruitLetterSwap';
export {MorphFontStretch, type MorphFontStretchProps} from './compositions/templates/MorphFontStretch';
export {MenuSlidePoster, type MenuSlidePosterProps, type MenuSlide} from './compositions/templates/MenuSlidePoster';
export {EditorialInsetPoster, type EditorialInsetPosterProps} from './compositions/templates/EditorialInsetPoster';
// WP48: Layer-2 toolkit moves CLIP_13..16 (layout analysis C1-C4: heritage devotion poster, silk legacy cover, glass testimonial morph, portrait push carousel). Still inside the existing skills; all four are opaque full-bleed.
export {HeritageDevotionPoster, type HeritageDevotionPosterProps} from './compositions/templates/HeritageDevotionPoster';
export {SilkLegacyCover, type SilkLegacyCoverProps} from './compositions/templates/SilkLegacyCover';
export {GlassTestimonialMorph, type GlassTestimonialMorphProps} from './compositions/templates/GlassTestimonialMorph';
export {PortraitPushCarousel, type PortraitPushCarouselProps} from './compositions/templates/PortraitPushCarousel';
export {PhotoStackCollapse, type PhotoStackCollapseProps} from './compositions/templates/PhotoStackCollapse';
export {PhotoStackReveal, type PhotoStackRevealProps} from './compositions/templates/PhotoStackReveal';
export {TwoUpStackHold, type TwoUpStackHoldProps} from './compositions/templates/TwoUpStackHold';
export {NeverDoneSlitPoster, type NeverDoneSlitPosterProps} from './compositions/templates/NeverDoneSlitPoster';
export {TypewriterPoster, type TypewriterPosterProps} from './compositions/templates/TypewriterPoster';
export {ChatConversationBubbles, type ChatConversationBubblesProps} from './compositions/templates/ChatConversationBubbles';
export {SalePromoCountdown, type SalePromoCountdownProps} from './compositions/templates/SalePromoCountdown';
export {ColorWordWheel, type ColorWordWheelProps} from './compositions/templates/ColorWordWheel';
export {TrackingCollapseHeadline, type TrackingCollapseHeadlineProps} from './compositions/templates/TrackingCollapseHeadline';
export {WordRevealType, type WordRevealTypeProps} from './compositions/templates/WordRevealType';
export {LineMaskReveal, type LineMaskRevealProps} from './compositions/templates/LineMaskReveal';
export {CharStaggerType, type CharStaggerTypeProps} from './compositions/templates/CharStaggerType';
export {WeightMorphType, type WeightMorphTypeProps} from './compositions/templates/WeightMorphType';
export {DoodleDrawOn, type DoodleDrawOnProps} from './compositions/templates/DoodleDrawOn';
export {ProductDeviceFrame, type ProductDeviceFrameProps} from './compositions/templates/ProductDeviceFrame';
export {ProductCursorClick, type ProductCursorClickProps} from './compositions/templates/ProductCursorClick';
export {PromoPriceDrop, type PromoPriceDropProps} from './compositions/templates/PromoPriceDrop';
export {PhotoKenBurns, type PhotoKenBurnsProps} from './compositions/templates/PhotoKenBurns';
export {LogoReveal, type LogoRevealProps} from './compositions/templates/LogoReveal';
export {MeshGradientGround, type MeshGradientGroundProps} from './compositions/templates/MeshGradientGround';
export {TypeEnvironmentalHero, type TypeEnvironmentalHeroProps} from './compositions/templates/KineticTypeStory';
export {TypeImpactNumber, type TypeImpactNumberProps} from './compositions/templates/KineticTypeStory';
export {TypeStaggeredPhrase, type TypeStaggeredPhraseProps} from './compositions/templates/KineticTypeStory';
export {TypeSplitColorHeadline, type TypeSplitColorHeadlineProps} from './compositions/templates/KineticTypeStory';
export {TypeKineticWordPop, type TypeKineticWordPopProps} from './compositions/templates/KineticTypeStory';
export {TypeStackedStatement, type TypeStackedStatementProps} from './compositions/templates/KineticTypeStory';
export {TypeFloatingSocialProof, type TypeFloatingSocialProofProps} from './compositions/templates/KineticTypeStory';
export {TypeLogoReveal, type TypeLogoRevealProps} from './compositions/templates/KineticTypeStory';
export {TypeKineticCta, type TypeKineticCtaProps} from './compositions/templates/KineticTypeStory';
export {TypeIllustratedEmphasis, type TypeIllustratedEmphasisProps} from './compositions/templates/KineticTypeStory';
export {TypeTextMatchCut, type TypeTextMatchCutProps} from './compositions/templates/TextMatchCut';
export {SpatialBlurTiltReveal, type SpatialBlurTiltRevealProps} from './compositions/templates/SpatialBlurTiltReveal';
export {pickShortFormLookId, resolveShortFormLook, SHORT_FORM_LOOKS, SHORT_FORM_LOOK_IDS, type ShortFormLook, type ShortFormLookId} from './looks';
// WP14A: motion recipes (video vernacular: elastic snap, smear, type trail, scramble, split reveal, squash and stretch, counter snap, nested scale)
export {MotionRecipe, type MotionRecipeProps} from './recipes/MotionRecipe';
export {
  MOTION_INTENTS,
  MOTION_RECIPES,
  MOTION_RECIPE_IDS,
  counterSnapValue,
  entranceFrames,
  getRecipe,
  recipeForIntent,
  recipeForIntentVaried,
  captionRecipeIdFor,
  captionWordRecipeState,
  exitFrames,
  exitModeForRecipe,
  isUnitRecipe,
  recipeExitState,
  recipeSfxPeaks,
  recipeStateCss,
  unitRecipeState,
  CAPTION_WORD_SETTLE_FRAMES,
  UNIT_RECIPE_DURATION_FRAMES,
  recipesForIntent,
  recipeState,
  scrambleText,
  typeTrailGlyphs,
  type MotionIntent,
  type MotionRecipe as MotionRecipeSpec,
  type MotionRecipeFamily,
  type MotionRecipeId,
  type RecipeExitMode,
  type RecipeSfxKind,
  type RecipeSfxPeak,
  type RecipeState,
} from './recipes/motionRecipes';
export {activeSpanAt, cleanSchedule, scheduleFrames, visitedWordsAt, type HighlightSpan} from './highlightSchedule';
export {platePalette, plateContrast, mixColors, type PlatePalette} from './palette';
export {PlateGround, usePlatePalette} from './components/Plate';

import {BeforeAfter} from './compositions/BeforeAfter';
import {BigKineticHeadline} from './compositions/BigKineticHeadline';
import {BrandLockupBar} from './compositions/BrandLockupBar';
import {ChartExplainer} from './compositions/ChartExplainer';
import {FullscreenStatement} from './compositions/FullscreenStatement';
import {OpenPlate} from './compositions/OpenPlate';
import {PointerCallout} from './compositions/PointerCallout';
import {ProcessSteps} from './compositions/ProcessSteps';
import {QuoteCallout} from './compositions/QuoteCallout';
import {StampTitle} from './compositions/StampTitle';
import {StatHighlight} from './compositions/StatHighlight';
import {TopicPills} from './compositions/TopicPills';
import {TweetCard} from './compositions/TweetCard';
import {WikiCallout} from './compositions/WikiCallout';
import {NewspaperCallout} from './compositions/NewspaperCallout';
import {FlashCard} from './compositions/FlashCard';
import {ImageRun} from './compositions/ImageRun';
import {TextualMgPlate} from './compositions/TextualMgPlate';
import {VsClaim} from './compositions/VsClaim';
import {GridMosaicMorph} from './compositions/templates/GridMosaicMorph';
import {SlitPanelCarousel} from './compositions/templates/SlitPanelCarousel';
import {BentoCardWall} from './compositions/templates/BentoCardWall';
import {StackedCardDeck} from './compositions/templates/StackedCardDeck';
import {ConfigBrandLoop} from './compositions/templates/ConfigBrandLoop';
import {BlurWordCarousel} from './compositions/templates/BlurWordCarousel';
import {IosNotificationMock} from './compositions/templates/IosNotificationMock';
import {NestedRectTitleWipe} from './compositions/templates/NestedRectTitleWipe';
import {AcmeFruitLetterSwap} from './compositions/templates/AcmeFruitLetterSwap';
import {MorphFontStretch} from './compositions/templates/MorphFontStretch';
import {MenuSlidePoster} from './compositions/templates/MenuSlidePoster';
import {EditorialInsetPoster} from './compositions/templates/EditorialInsetPoster';
import {HeritageDevotionPoster} from './compositions/templates/HeritageDevotionPoster';
import {SilkLegacyCover} from './compositions/templates/SilkLegacyCover';
import {GlassTestimonialMorph} from './compositions/templates/GlassTestimonialMorph';
import {PortraitPushCarousel} from './compositions/templates/PortraitPushCarousel';
import {PhotoStackCollapse} from './compositions/templates/PhotoStackCollapse';
import {PhotoStackReveal} from './compositions/templates/PhotoStackReveal';
import {TwoUpStackHold} from './compositions/templates/TwoUpStackHold';
import {NeverDoneSlitPoster} from './compositions/templates/NeverDoneSlitPoster';
import {TypewriterPoster} from './compositions/templates/TypewriterPoster';
import {ChatConversationBubbles} from './compositions/templates/ChatConversationBubbles';
import {SalePromoCountdown} from './compositions/templates/SalePromoCountdown';
import {ColorWordWheel} from './compositions/templates/ColorWordWheel';
import {TrackingCollapseHeadline} from './compositions/templates/TrackingCollapseHeadline';
import {SpatialBlurTiltReveal} from './compositions/templates/SpatialBlurTiltReveal';
import {WordRevealType} from './compositions/templates/WordRevealType';
import {LineMaskReveal} from './compositions/templates/LineMaskReveal';
import {CharStaggerType} from './compositions/templates/CharStaggerType';
import {WeightMorphType} from './compositions/templates/WeightMorphType';
import {DoodleDrawOn} from './compositions/templates/DoodleDrawOn';
import {ProductDeviceFrame} from './compositions/templates/ProductDeviceFrame';
import {ProductCursorClick} from './compositions/templates/ProductCursorClick';
import {PromoPriceDrop} from './compositions/templates/PromoPriceDrop';
import {PhotoKenBurns} from './compositions/templates/PhotoKenBurns';
import {LogoReveal} from './compositions/templates/LogoReveal';
import {MeshGradientGround} from './compositions/templates/MeshGradientGround';
import {TypeEnvironmentalHero, TypeImpactNumber, TypeStaggeredPhrase, TypeSplitColorHeadline, TypeKineticWordPop, TypeStackedStatement, TypeFloatingSocialProof, TypeLogoReveal, TypeKineticCta, TypeIllustratedEmphasis} from './compositions/templates/KineticTypeStory';
import {TypeTextMatchCut} from './compositions/templates/TextMatchCut';

/** Compositions by name (for graphics that pick one dynamically). */
export const compositions = {StatHighlight, ProcessSteps, BeforeAfter, ChartExplainer, QuoteCallout, PointerCallout, BigKineticHeadline, TopicPills, VsClaim, FullscreenStatement, BrandLockupBar, StampTitle, TweetCard, OpenPlate, WikiCallout, NewspaperCallout, FlashCard, ImageRun, TextualMgPlate, GridMosaicMorph, SlitPanelCarousel, BentoCardWall, StackedCardDeck, ConfigBrandLoop, BlurWordCarousel, IosNotificationMock, NestedRectTitleWipe, AcmeFruitLetterSwap, MorphFontStretch, MenuSlidePoster, EditorialInsetPoster, HeritageDevotionPoster, SilkLegacyCover, GlassTestimonialMorph, PortraitPushCarousel, PhotoStackCollapse, PhotoStackReveal, TwoUpStackHold, NeverDoneSlitPoster, TypewriterPoster, ChatConversationBubbles, SalePromoCountdown, ColorWordWheel, TrackingCollapseHeadline, SpatialBlurTiltReveal, WordRevealType, LineMaskReveal, CharStaggerType, WeightMorphType, DoodleDrawOn, ProductDeviceFrame, ProductCursorClick, PromoPriceDrop, PhotoKenBurns, LogoReveal, MeshGradientGround, TypeEnvironmentalHero, TypeImpactNumber, TypeStaggeredPhrase, TypeSplitColorHeadline, TypeKineticWordPop, TypeStackedStatement, TypeFloatingSocialProof, TypeLogoReveal, TypeKineticCta, TypeIllustratedEmphasis, TypeTextMatchCut};

/** Standard props every generated graphic receives from the editor. */
export type GraphicProps<Content = unknown> = {
  width: number;
  height: number;
  durationInFrames: number;
  fps: number;
  theme: import('./theme').MotionTheme;
  safeArea: import('./layout').SafeArea;
  content?: Content;
  assets?: Record<string, {src: string; width?: number; height?: number}>;
};
