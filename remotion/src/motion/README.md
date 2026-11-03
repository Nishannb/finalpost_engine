# @finalpost/motion — guide for graphic authors

You are implementing **one motion graphic** for a FinalPost short-form video. The
editor (Remotion) decides where and when it appears. You decide how it looks and
moves inside the region you are given. Write one `.tsx` file whose default
export is a React component. Build it from this toolkit wherever you can.

You do **not** choose B-roll, cuts, captions, timing in the video, or placement.
Never paint outside your region, and never assume it is 1080×1920.

---

## 1. File contract

```tsx
import {Background, Box, FitText, MotionRecipe, contentBox, type GraphicProps} from '@finalpost/motion';

type Content = {headline: string};

export default function Graphic({width, height, durationInFrames, fps, theme, safeArea, content}: GraphicProps<Content>) {
  const box = contentBox(width, height, safeArea, 24);
  return (
    <>
      <Background />
      <Box {...box}>
        <MotionRecipe recipeId="elastic_type_snap">
          <FitText text={content!.headline} width={box.width} height={box.height} maxLines={3} />
        </MotionRecipe>
      </Box>
    </>
  );
}
```

- **One file**, default export, ≤ 40 KB.
- **Imports allowed**: `react`, `@finalpost/motion` (everything it exports), and from `remotion` only:
  `useCurrentFrame, interpolate, spring, Easing, AbsoluteFill, Sequence, Series, random, interpolateColors`.
- **Frame 0** is the first frame of the graphic, and the graphic lasts `durationInFrames`.
  It must look right if the duration changes by ±40%, so time things as fractions of `durationInFrames` or with short fixed entrances.
- **Exits:** the editor may fade or slide the whole region in or out. You may add your own exit (`Reveal exit`). Do not rely on the last frame being visible for long.

## 2. Props you receive (`GraphicProps<Content>`)

| prop | meaning |
|---|---|
| `width`, `height` | Your region in px. Examples: 1080×1920 full screen, 1080×960 half of a top/bottom split, 454×461 PiP. **Lay everything out from these.** |
| `durationInFrames`, `fps` | Length of the graphic (30 fps). |
| `theme` | Resolved `MotionTheme` (see §4). Prefer it over invented colours. |
| `safeArea` | `{top,right,bottom,left}` px insets the editor reserves (captions, platform UI). Keep text and key content inside `contentBox(width, height, safeArea)`. Decorative backgrounds may extend under it. |
| `content` | Your task's data (text, numbers, items). **All visible copy must come from here**, never hard-coded. |
| `assets` | Optional user-provided images: `{[id]: {src, width, height}}`. Show them only with `<AssetImage src={assets.logo.src} …/>`. |

Do not call `useVideoConfig()`: inside the timeline it returns the whole video's size, not your region's.

## 3. Forbidden

These are rejected by the validator before anything renders:
- **Network:** `fetch`, `XMLHttpRequest`, `WebSocket`, any `http(s)://` string, CSS `url(...)` except `url(#id)`.
- **Code loading / reflection:** `import()`, `import.meta`, `require()`, `eval`, `Function(...)`, `constructor`, `prototype`, `__proto__`, `Reflect`, `Proxy`, `WebAssembly`.
- **Non-determinism:** `Math.random`, `Date`, `performance`, `setTimeout`, `setInterval`, `requestAnimationFrame`.
  Use `random('seed')` from remotion if you need noise.
- **Browser globals:** `window`, `document`, `globalThis`, `self`, `location`, `process`, `localStorage`, `navigator`, `new Image()`/`Audio`/`Worker`.
- **Hooks:** `useState`, `useEffect`, `useLayoutEffect`, `useRef`. `useMemo` is fine.
- **Other imports:** any package not listed in §1, and `Img`/`Video`/`Audio`/`staticFile` from remotion.
- **Hard-coded SVG ids** (`id="glow"`). Use `useSvgId('glow')`; see §7.
- **Unsafe markup:** `dangerouslySetInnerHTML`, `<script>`, `<iframe>`, `<foreignObject>`.
- **Raw media elements:** `<img>`, `<image>`, `<video>`, `<audio>`, `<source>`, `<link>`, `<object>`, `<embed>`. Show supplied images with `<AssetImage>`.
- **No toolkit import:** a graphic must import from `@finalpost/motion`.

## 4. Theme

`theme` (also available via `useMotionTheme()`):

| key | use |
|---|---|
| `primary`, `secondary` | brand colours, main shapes, chart fill |
| `background` | full-region background (opaque graphics) |
| `surface` | cards, chips, panels |
| `text`, `mutedText` | primary / secondary text |
| `accent` | emphasis: the one thing to look at |
| `success`, `warning`, `danger` | positive / caution / negative values |
| `fontDisplay`, `fontBody` | font ids (see §5) |
| `radius` | corner radius in px at 1080 width; scale it down for small regions |

All primitives default to theme colours. Override per element when the design calls for it. `withAlpha(color, 0.3)` makes a translucent variant of a hex colour.

## 5. Typography

Fonts are bundled locally (no network). Use them by id:
- `'inter'`: weights 400, 500, 600, 700, 800, 900. Default for display and body.
- `'space_grotesk'`: weights 500, 700. Geometric and techy.
- `'bebas'`: weight 400 only. All-caps condensed display.

Every family falls back per glyph to bundled **Noto Sans Devanagari** (Nepali, Hindi) and **Noto Sans JP** (Japanese), weights 400/700, loaded automatically for the characters in your `content`. Keep copy in its own script; never romanise or translate it. Japanese wraps between characters (with kinsoku rules), other scripts between words. Text props take `font: 'display' | 'body' | FontId`, where `'display'`/`'body'` follow the theme. A missing weight maps to the nearest available one.

**Never estimate text width from character counts.** Use the fitting tools:
- `<FitText text width height maxLines …/>`: largest size that fits the box, wrapped on word boundaries. It never cuts a word unless you pass `truncate`.
- `fitTextBlock({text, width, height, maxLines, …})` → `{fontSize, lines, width, height, overflow}`, for custom layouts.
- `fitTextGroup(texts, options)` → one font size that fits every text. Use it so sibling labels match.
- `measureLine(text, fontSize, font, weight)` → width in px, e.g. to size a pill.

Sizing guide: headline ≈ 7–10% of region height, body ≥ 3%. Never go below ~26 px on a 1080-wide region; captions compete with you.

## 6. Layout

All coordinates are px inside your region; (0,0) is its top-left corner.

- `contentBox(width, height, safeArea, padding)` → `Rect`: where important content goes.
- `sliceTop(rect, size, gap)` → `[top, rest]`. `size` ≤ 1 is a fraction of the height; larger values are px.
- `splitRow(rect, n, gap)` / `splitColumn(rect, n, gap)` → n equal rects.
- `isWide(width, height)` is true when the region is landscape-ish. Use a row layout when wide (split halves), a column when tall (full screen).
- `<Box x y width height>`: an absolutely positioned container. Most layouts are just Boxes.

Lines, arrows and focus rings draw in their **parent's coordinate space**, so give them region coordinates directly, not wrapped in a Box.

## 7. SVG ids

Any `<linearGradient>`, `<filter>`, `<clipPath>`, `<mask>` or `<pattern>` needs an id from:

```tsx
const fade = useSvgId('fade');   // unique per graphic instance, stable across frames
<linearGradient id={fade}>…</linearGradient>
<rect fill={`url(#${fade})`} />
```

## 8. Animation

Pure helpers. Feed them `useCurrentFrame()` and combine freely.

| helper | returns |
|---|---|
| `progress(frame, start, duration, easing?)` | 0→1, clamped. easing: `linear in out inOut outBack outExpo` (default `out`) |
| `springIn(frame, fps, delay?, preset?)` | spring 0→~1. presets: `smooth snappy bouncy gentle` (`bouncy` overshoots) |
| `exitProgress(frame, durationInFrames, duration?)` | 1→0 over the last frames |
| `stagger(i, each, start)` | start frame for item i |
| `lerp`, `lerpPoint`, `pointAlong(points, t)` | interpolation / position along a polyline |
| `drawStroke(length, t)` | `{strokeDasharray, strokeDashoffset}` to draw a stroke on |
| `pulse(frame, fps, period, min, max)` | smooth oscillation (attention loops) |
| `keyframes(frame, frames[], values[], easing?)` | multi-step value |

Wrappers:
- `<Reveal effect={['fade','slide-up']} delay duration spring exit distance>` animates its children in (and out with `exit`). It does not position anything.
  - effects: `fade slide-up slide-down slide-left slide-right scale pop wipe-right wipe-left wipe-up wipe-down grow-x grow-y`.
  - `progress={t}` drives it manually.
- `<Stagger each={5} effect=… delay=…>{items}</Stagger>` reveals children one after another. Each child is wrapped in a div.

Remotion's `interpolate`, `spring` and `<Sequence>` remain available for anything custom.

## 9. Primitives

Every visual primitive takes explicit `width`/`height` (px) or explicit coordinates. Timed primitives accept `delay`/`duration` (frames, relative to the current Sequence), or `progress` (0–1) to drive them yourself.

### Text
- **`FitText`**: `text, width, height?, maxLines=2, maxFontSize?, minFontSize=12, font='display', weight=700, color, align='center', verticalAlign='center', lineHeight=1.15, letterSpacing (em), uppercase, truncate=false, tabular`.
  Static, measured text.
- **`KineticText`**: FitText props plus:
  - `mode: 'words'|'chars'|'typewriter'|'lines'` (default `words`)
  - `effect: 'up'|'pop'|'fade'`, `delay`, `each` (frames between units), `spring`
  - `highlight: string[]` (phrases, case and punctuation insensitive), `highlightStyle: 'color'|'marker'|'underline'`, `highlightColor`, `emphasisScale` (e.g. 1.15)

  Layout is fixed up front and never reflows while animating.

- **`CurvedText`**: text along a curve. Props: `text, width, height` (the box; the text never leaves it), `shape: 'arc'|'circle'|'path'`, `curvature` (arc: -1..1, + arches up ∩, - bowls down ∪, 0 straight, 1 half circle), `radius` and `angleDeg` and `direction: 'clockwise'|'counterclockwise'` (circle: clockwise puts the glyphs outside the ring, counter-clockwise inside, reading along the bottom), `points: {x,y}[]` (path: 2-16 points, joined by a smooth curve; raw SVG path strings are not accepted), `align: 'start'|'center'|'end'`, `font, weight, fontSize` (largest size to try), `minFontSize=28`, `letterSpacing` (em), `uppercase`, `rotationDeg`, `margin=24`, `color`, `strokeColor`+`strokeWidth` (outline), `shadow`, and `reveal: 'none'|'fade'|'chars'|'sweep'` with `delay, duration, easing, progress`, and `fallback: 'straight'|'none'` (default `straight`: a curve that cannot hold the text legibly becomes a straight fitted line instead of tiny type).
  The text is measured against the real font and shrunk until it fits the curve and stays `margin` px inside the box. `onLayout(layout)` reports `{fontSize, bbox, shrunk, legible, clipped}`; if `legible` is false use a shorter text or a straighter curve rather than shipping tiny type. `layoutCurvedText(options)` returns the same layout without rendering.
- **`MaskReveal`**: reveals its children through an animated clip region. `kind: 'wipe-right'|'wipe-left'|'wipe-up'|'wipe-down'|'slit'|'iris'`, `width, height, delay, duration=18, easing, progress`. At the end nothing is clipped.
- **`ClipWindow`**: shows its children only inside a shape, so text can slide through a window. `region: {x,y,width,height,shape:'rect'|'rounded'|'capsule'|'circle'|'ellipse',radius}`, `width, height`, `fill` (a panel inside the window). Whatever leaves the shape is cut, so size the text to sit well inside it (a capsule's ends are round: keep text within about 80% of its width).
- **`LayeredText`**: `background`, `text`, `foreground` in one box; the foreground is clipped to `foregroundRegion` so a shape can overlap part of the text and read as depth. You position the foreground yourself (wrap it in `<Box>` at the place it should overlap); only the part inside `foregroundRegion` shows.

These masks are **shape clipping and layering only**. They do not know where the speaker is. You cannot put text "behind the speaker" from inside a graphic: that needs a real foreground matte and is done by the editor, never claimed here. Never describe a graphic as depth-aware or subject-aware.

### Shapes & surfaces
- **`Card`**: `width, height, variant: 'solid'|'soft'|'outline'|'glass', color, radius, borderColor, borderWidth, shadow, padding, children`. Children are centred in a flex column. `glass` is translucent with no blur.
- **`Shape`**: `kind: 'circle'|'rect'|'pill'|'ring', width, height, fill, stroke, strokeWidth, radius, draw` (strokes draw on).
- **`Line`**: `from, to, color, strokeWidth, dashed, draw=true`. Also works as a divider.
- **`Background`**: `variant: 'solid'|'gradient'|'spotlight'|'grid', color, accent`. Fills the region. **Opaque graphics only — never on overlays.**

### Indicators
- **`Arrow`**: `from, to, bend` (0 straight, ±0.3 curved), `color=accent, strokeWidth=8, head: 'triangle'|'open'|'none', headSize, outline` (dark halo for video), `pulse` (head nudges toward the target), `dashed`. Draws on, with the head riding the tip.
- **`FocusRing`**: `x, y, width, height` (the target box), `shape: 'rounded'|'ellipse', color=secondary, strokeWidth, padding, pulse=true, outline=true`. Draws around a target.
- **`Badge`**: `text, icon?, height=72, maxWidth, color, textColor, delay, animate=true, bordered, truncate=false`. A pill sized to its measured text. If it can't fit `maxWidth`, the whole badge shrinks; it does not cut the text.
- **`Progress`**: `variant: 'bar'|'ring', value` (0–1), `width, height, color, trackColor, thickness, showLabel`.

### Data
- **`Counter`**: `from=0, to, width, height, prefix, suffix, decimals, grouping=true, delay, duration, easing, font, weight=900, color, align`.
  The font size is fitted once to the widest value, so the number never jumps in size. Digits are tabular.
- **`BarChart`**: `data: {label,value,color?}[], width, height, orientation, highlight` (index gets accent, others muted), `delay, each, duration, showValues, valueFormat, maxValue, color`.
- **`LineChart`**: `data: number[] | {label,value}[], width, height, color=success, area=true, showPoints, endLabel, delay, duration, min, max, strokeWidth`. One continuous path that draws left→right, with a dot on the tip.
- `formatNumber(value, {prefix, suffix, decimals, grouping})` gives deterministic formatting.

### Media
- **`Icon`**: `name, size, color, strokeWidth`. The curated Lucide set is listed in `ICON_NAMES`:
  arrow-down/left-right/right/up/up-right, award, badge-check, bell, book, bot, brain, briefcase, building, calendar, camera, car, chart-bar/column/line/pie, check, circle-check, circle-x, clock, cloud, code, coffee, cpu, credit-card, crown, database, dollar, download, eye, file-text, film, flame, gauge, gift, globe, graduation-cap, handshake, hash, heart, home, image, info, laptop, layers, leaf, lightbulb, link, lock, mail, map-pin, megaphone, message, mic, minus, monitor, moon, music, package, pause, percent, plane, play, plus, refresh, repeat, rocket, scissors, search, server, settings, share, shield, shopping-cart, smartphone, sparkles, star, store, sun, target, thumbs-up, timer, trending-down, trending-up, trophy, truck, upload, user, users, video, wallet, wand, warning, x, zap.
  Unknown names render a neutral dot.
- **`AssetImage`**: `src` (from `props.assets` only), `width, height, fit, radius`.
- **`DeviceFrame`**: `kind: 'phone'|'browser', width, height, color, url, children`. Children fill the screen area.

## 10. Reference compositions

Complete, adaptive graphics built only from the primitives above. Use one directly when it fits the brief, or read its source (`compositions/*.tsx`) as a pattern for something new. You are never required to use them.

| name | content props |
|---|---|
| `StatHighlight` | `value: {from?, to, prefix?, suffix?, decimals?}, label, sublabel?, trend?: number[], icon?, background?` |
| `ProcessSteps` | `steps: {label, icon?}[], title?, cues?: number[]` (activation frames), `variant: 'steps'|'timeline', background?` |
| `BeforeAfter` | `before: {label, value?, detail?}, after: {…}, title?, background?` |
| `ChartExplainer` | `kind: 'line'|'bar', data: {label,value}[], title?, headline?: {from?, to, prefix?, suffix?}, annotation?, valueFormat?, background?` |
| `QuoteCallout` | `quote, author?, highlight?: string[], background?` |
| `PointerCallout` | `target: {x,y,width,height}` (px in region), `label, icon?`. Transparent overlay. |
| `BigKineticHeadline` | `lines: {text, weight?, color?}[]` (max 5, stacked), `accent?: string`, `background?` (default false: type over footage) |
| `TopicPills` | `items: {label, icon?}[]` (max 8, floating chips), `side?: 'left'|'right'`. Transparent overlay. |
| `VsClaim` | `left: string, right: string, center?: string` (default "VS"), `background?` |
| `FullscreenStatement` | `statement: string, sublabel?, highlight?: string[], background?` (default true: a cutaway beat without stock video) |
| `BrandLockupBar` | `name: string, tagline?`. Text-only wordmark bar at the bottom of the safe area. Transparent overlay. |
| `StampTitle` | `stamp?: string` (e.g. `02 —`), `title: string, subtitle?, background?` (default true). A big section stamp, a rule, then the title word by word. |
| `TweetCard` | `body: string, name?, handle?, highlight?: string[], background?` (default true). A captured post / article surface (paper card, capture chrome, letter-disc header) with a dominant highlighter bar on 1-3 words; no images. |
| `OpenPlate` | `title: string, kicker?, stamp?, accent?, background?` (default true). WP10A designed open / thumbnail plate: theme ground, arc headline (`CurvedText`) over a masked (`MaskReveal`) title with a highlighter on `accent`. |
| `WikiCallout` | `passage: string (alias body), title?, highlight?: string[], background?` (default true). WP10B captured encyclopedia / article page (slim tab strip, heading + rule, full-width passage) with a dominant highlighter on 1-3 words; visually distinct from `TweetCard`. |
| `NewspaperCallout` | `passage: string, title?, highlight?: string[], highlightSchedule?, background?` (default true). WP13D newspaper clipping: flat off-white sheet, thick-and-thin masthead rules, optional uppercase headline between rules, passage in one or two columns with a hairline column rule, solid highlighter on the marked words. No browser tabs (WikiCallout), no social chrome or tilt (TweetCard); the only text is spoken words. |
| `FlashCard` | `phrase: string (1-4 words), ground?: 'black' \| 'white', recipeId?`. WP17 flash / pivot card: a solid full-frame black or white ground (no gradient, no paper) with 1-4 words of heavy display type slammed in by a motion recipe (default `stretch_squash_pop`). A pattern interrupt on a connective beat ("Then everything broke"), kept to ~0.35-1.2 s by the seed; not a statement plate. |
| `ImageRun` | `items: {src, label?}[] (2-6), mode?: 'sequence' \| 'logo_cloud', holdFrames?, recipeId?, ground?: 'dim' \| 'solid', fit?: 'contain' \| 'cover'`. WP18 image run: the creator's own uploaded stills as a video collage on a dim / solid ground. Sequence = one still at a time, motion-recipe entrance, hard cut + scale pop between; logo_cloud = hero still with the other logos small and blurred behind. Draws no text. `fit: 'cover'` (WP30 editorial stock photos) fills the frame; the default `contain` keeps a logo / screenshot whole. |
| `TextualMgPlate` | `text: string (1-8 spoken words), family?: 'snap_elastic' \| 'trail_cascade' \| 'scramble_glitch' \| 'smear_blur' \| 'mask_reveal' \| 'counter_metric' \| 'tagline_plate', recipeId?, color?, stroke?, background?: 'none' \| 'soft_plate', yFrac?, counter?: {from?, to, prefix?, suffix?, decimals?}`. WP43 Skill C: Jitter-class designed type OVER the picture (transparent ground, soft shadow + stroke, mid-frame band, recipe entrance + vernacular exit). Not captions, not a full-bleed world. |
| `GridMosaicMorph` | `imageSrc?, accentFrom?, accentTo?, accent?, logoMark?, exitSlide?`. WP45 CLIP_01 (Layer-2 toolkit move, NOT a skill): 4x4 tile wipe-grow -> logo fill -> tile merge -> colour flood -> photo window reveal, 1.8 s payoff hold. Opaque full-bleed, silent, no fades / blur / glow. |
| `SlitPanelCarousel` | `panels?: {src?, tone?}[] (2-6), focusIndex?, accent?, parallax?`. WP45 CLIP_02: letterboxed slit strip on black, staggered slot advance, 3.25x accordion expand, advance back (loop friendly). Opaque, silent. |
| `BentoCardWall` | `cards?: {kind: 'ui' \| 'photo', src?, label?}[], focusIndex?, accent?`. WP45 CLIP_03: justified card wall, camera creep -> hard jump cut -> exp-decay ease zoom -> hold -> pull-back. No rotation / blur. Opaque, silent. |
| `StackedCardDeck` | `cards?: {src?, label?}[] (2-6)`. WP45 CLIP_04: 1:1 grayscale card stack on black; the top card exits up with a 3-5 degree tilt, the next scales 0.82 -> 1; 1.03 s cycle. Opaque, silent. |
| `ConfigBrandLoop` | `scenes?: {src?}[] (up to 5), wordmark?, accent?`. WP46 CLIP_05 (Layer-2 toolkit move, NOT a skill): 4:5 black loop, hard cut every 1.5 s on stills, mask outline morphs around each cut, three independent flat stickers (pop dot -> full 0.8 s, shrink 0.2 s), static CONFIG wordmark. 7.63 s seamless. Opaque, silent. |
| `BlurWordCarousel` | `words?: string[] (2-12), accent?`. WP46 CLIP_06: left-aligned word list on black scrolling one slot per 0.73 s (0.42 move + 0.31 hold); active white + arrow, neighbours grey with depth blur; stack tilts -8 / -1 deg. 3.67 s. Opaque, silent. |
| `IosNotificationMock` | `title?, time?, body?, canvas?`. WP46 CLIP_07: static iOS banner OVERLAY (does not own the frame, captions stay on) + cursor arrow -> open hand (0.83 s) -> hidden (1.67 s). 2.02 s. Overlay only, silent. |
| `NestedRectTitleWipe` | `imageSrc?, lines?: [string, string], accent?, leadHold?`. WP46 CLIP_08: hard cut to pale blue, six nested rects grow from the centre (ease-in cascade) to a photo, then two typewriter lines at 37 cps (no caret). 6.15 s. Opaque, silent. |
| `AcmeFruitLetterSwap` | `word?: string (default ACME)`. WP47 CLIP_09 (Layer-2 toolkit move, NOT a skill): 4:5 flared-serif wordmark on flat colour fields that HARD-cut through five scenes (0.43 / 0.57 / 1.50 / 0.90 / 0.43 s, word scale 0.58 / 0.58 / 0.22 / 1.20 / 0.58); in four scenes one glyph is replaced by a flat vector fruit that settles from 1.6x over 0.4 s with a ~15 degree turn. 3.83 s seamless loop. Opaque, silent. |
| `MorphFontStretch` | `text?: string (default MORPH), accent?`. WP47 CLIP_10: 16:10 cyan lettering on #11102A; bubbly word -> vertical stretch (1.8x / 3.8x, cropped) -> HARD cut to plain sans -> per-letter font morph plain -> bubbly, left to right (0.17 s stagger). 2.30 s seamless loop. Opaque, silent. |
| `MenuSlidePoster` | `slides?: {headline: [string, string], photoSrc?}[] (2-4)`. WP47 CLIP_11: 1:1 royal-blue poster, four slides on a 1.70 s beat (0.85 s ease-in-out slide with a slight settle + 0.85 s hold); photo cut-out leads the extended ALL-CAPS headline by 0.10 s, line 2 lags 0.08 s; static footer microtext. 6.80 s loop, opens mid-slide. Opaque, silent. |
| `EditorialInsetPoster` | `imageSrc?, lines?: string[] (2-6)`. WP47 CLIP_12: 4:5 white poster; the inset photo between AC and ME grows to full bleed under fixed text (text auto-contrasts by masking), HARD cut to white, hairline italic headline lines rise through a mask (0.10 s stagger), AC / ME split and the photo returns from a dot. 5.30 s seamless loop. Opaque, silent. |

Each composition also takes `width, height, safeArea`. Pass yours straight through:

```tsx
import {ProcessSteps, type GraphicProps} from '@finalpost/motion';
export default function Graphic({width, height, safeArea, content}: GraphicProps<{steps: {label: string}[]}>) {
  return <ProcessSteps width={width} height={height} safeArea={safeArea} steps={content!.steps} title="How it works" />;
}
```

## 11. Overlays and transparency

Overlay and PiP graphics are composited **directly over the video**: whatever you don't paint stays transparent.
- **Overlays:** no `Background`, no full-region fills. Use `outline` on `Arrow`/`FocusRing` so they read over busy footage.
- **Full-screen and split graphics:** start with `<Background/>` (or your own opaque fill). Otherwise the video shows through.

## 12. Performance (Lambda has no GPU)

- Avoid CSS `filter: blur()`, `backdrop-filter`, SVG `feGaussianBlur` and big `box-shadow`s. For glows, use a wider translucent stroke (as `FocusRing pulse` does).
- Keep it under ~150 animated elements and avoid particle swarms.
- Animate `opacity`/`transform` rather than layout properties.

## 13. Recipes

**Card + fade/slide + staggered rows**
```tsx
<Box {...box}>
  <Reveal effect={['fade','slide-up']}>
    <Card width={box.width} height={box.height} variant="glass" padding={32}>
      <Stagger each={6} delay={8} effect={['fade','slide-left']}>
        {content!.items.map(item => <FitText key={item} text={item} width={box.width - 64} height={90} maxLines={1} align="left" font="body" />)}
      </Stagger>
    </Card>
  </Reveal>
</Box>
```

**Chart + counter + arrow annotation**
```tsx
const [headBox, chartBox] = sliceTop(box, 0.25, 16);
<>
  <Background variant="grid" />
  <Box {...headBox}><Counter to={content!.total} prefix="$" width={headBox.width} height={headBox.height} color={theme.success} /></Box>
  <Box {...chartBox}><LineChart data={content!.series} width={chartBox.width} height={chartBox.height} delay={10} endLabel={content!.label} /></Box>
  <Arrow from={{x: box.x + 40, y: chartBox.y + 40}} to={{x: chartBox.x + chartBox.width - 60, y: chartBox.y + 60}} bend={-0.2} delay={50} />
</>
```

**Pointer overlay** (transparent):
```tsx
<FocusRing {...target} />
<Arrow from={labelAnchor} to={{x: target.x - 16, y: target.y + target.height / 2}} bend={0.25} delay={8} outline pulse />
<Box x={lx} y={ly} width={w} height={72}><Badge text={content!.label} icon="sparkles" delay={4} bordered /></Box>
```

Working full examples: `remotion/mg-fixtures/graphics/ex_process.tsx` (three-step process, 1080×960), `ex_pointer.tsx` (overlay), `ex_growth.tsx` ($2M → $10M), and the composed checklist in §15.

## 14. Checklist before you submit

- [ ] Layout derives from `width`/`height`; text sits inside `contentBox(…, safeArea)`.
- [ ] All copy comes from `content`; every text goes through FitText, KineticText, Badge or `fitTextBlock`.
- [ ] Colours come from `theme` unless deliberately different.
- [ ] SVG defs use `useSvgId`.
- [ ] Overlays paint no background; opaque graphics start with `<Background/>`.
- [ ] Timing scales with `durationInFrames`; something moves in the first ~10 frames.
- [ ] No forbidden APIs or imports (§3).

## 15. How Claude should build a graphic

You get a brief (goal, visual description, placement, duration, `content`, maybe assets and constraints) and the region size. Work in this order:

1. **Understand the brief.** What is the one thing the viewer must take away? That element gets the most size, contrast and motion. Everything else supports it. Don't add facts, copy or numbers the brief doesn't give you.
2. **Choose primitives.** Sketch the graphic as toolkit pieces (e.g. "KineticText title + checklist rows of Icon + FitText + a Progress ring"). Use a reference composition only when it genuinely is the brief. Otherwise compose: a funnel, a timeline or a comparison are all Boxes, Shapes, Counters and text.
3. **Establish layout** from `width`/`height` with `contentBox`, `sliceTop`, `splitRow`, `splitColumn`. Branch on `isWide()`. The same file must work at 1080×1920, a 1080×960 split half and a small PiP box.
4. **Use `safeArea`.** All text and key content goes inside `contentBox(width, height, safeArea, …)`. Only backgrounds may run under the insets. The editor already accounts for captions and platform UI; don't guess their positions.
5. **Use `theme`.** Colours and fonts come from `theme` (`accent` for the single focal point, `success`/`danger` for good/bad numbers). Overlays and PiPs paint no background.
6. **Animate with the helpers.** Use `Reveal`/`Stagger` for entrances and `progress`/`springIn`/`interpolate` with `useCurrentFrame()` for anything driven. Time events as fractions of `durationInFrames` (or from `content` timings) so a ±40% length change still works. Something should move within the first ~10 frames.
7. **Fit text by measurement.** Every string goes through `FitText`, `KineticText`, `Badge`, or `fitTextBlock` / `fitTextGroup`, never a guessed `fontSize`. Use `fitTextGroup` + `maxFontSize` so sibling labels match.
8. **Give SVG defs unique ids** with `useSvgId('name')`, never a literal `id="…"`.
9. **Avoid external resources.** No URLs, fetches, fonts or images other than `assets[id].src` through `<AssetImage>`. No randomness except `random('seed')`, no timers, no browser globals (§3).
10. **Validate before returning.** Re-read §14, then check: does it typecheck under `strict` + `noUncheckedIndexedAccess` (use `!` on indexed rects and `content!`)? Are only allowed imports used? Does every visible string come from `content`? Could any value be undefined at render time (missing optional fields, empty arrays)? The worker typechecks, compiles and renders one frame of your file in Remotion; on any failure it sends you the exact error to fix.

### Complete example

Brief: *"A checklist that ticks off three items while a ring fills; works full screen and in a split half."* `content`: `{title, highlight?, items[], doneLabel}`.

```tsx
import {interpolate, useCurrentFrame} from 'remotion';
import {
  Background,
  Box,
  FitText,
  Icon,
  KineticText,
  Progress,
  Reveal,
  contentBox,
  fitTextGroup,
  isWide,
  progress,
  sliceTop,
  splitColumn,
  splitRow,
  springIn,
  useSvgId,
  withAlpha,
  type GraphicProps,
} from '@finalpost/motion';

type Content = {title: string; highlight?: string; items: string[]; doneLabel: string};

export default function Graphic({width, height, durationInFrames, fps, theme, safeArea, content}: GraphicProps<Content>) {
  const frame = useCurrentFrame();
  const {title, highlight, items, doneLabel} = content!;
  const n = Math.max(1, items.length);

  // Layout: from the region and safe area only. Row when wide (split half), stacked when tall.
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.05);
  const wide = isWide(width, height);
  const [titleBox, body] = sliceTop(box, wide ? 0.24 : 0.16, box.height * 0.04);
  const [listBox, meterBox] = wide ? splitRow(body, 2, body.width * 0.06) : sliceTop(body, 0.6, body.height * 0.06);
  const rows = splitColumn(listBox!, n, listBox!.height * 0.05);
  const rowH = rows[0]!.height;
  const dot = Math.min(rowH * 0.7, listBox!.width * 0.14);

  // Timing: fractions of the duration, so a ±40% change still reads well.
  const firstCheck = Math.round(durationInFrames * 0.2);
  const lastCheck = Math.round(durationInFrames * 0.7);
  const checkAt = (i: number) => Math.round(firstCheck + ((lastCheck - firstCheck) * i) / Math.max(1, n - 1));
  const done = items.filter((_, i) => frame >= checkAt(i)).length;
  const meter = interpolate(frame, [firstCheck, lastCheck + 8], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  // Text: one measured size for every row so the list reads as a set.
  const labelW = rows[0]!.width - dot * 1.4;
  const labelSize = fitTextGroup(items, {width: labelW, height: rowH * 0.9, maxLines: 2, font: theme.fontBody, weight: 700});

  // SVG defs: unique, stable ids.
  const sweep = useSvgId('sweep');
  const ring = Math.min(meterBox!.width, meterBox!.height) * 0.86;
  const ringX = meterBox!.x + (meterBox!.width - ring) / 2;
  const ringY = meterBox!.y + (meterBox!.height - ring) / 2;

  return (
    <>
      <Background variant="gradient" />
      <Box {...titleBox}>
        <KineticText text={title} width={titleBox.width} height={titleBox.height * 0.9} maxLines={2} align="left" weight={800} highlight={highlight ? [highlight] : []} highlightStyle="marker" />
      </Box>
      <svg width={width} height={height} style={{position: 'absolute', left: 0, top: 0}}>
        <defs>
          <linearGradient id={sweep} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor={theme.primary} />
            <stop offset="1" stopColor={theme.accent} />
          </linearGradient>
        </defs>
        <rect x={titleBox.x} y={titleBox.y + titleBox.height} width={titleBox.width * progress(frame, 8, 20)} height={Math.max(4, height * 0.005)} rx={3} fill={`url(#${sweep})`} />
      </svg>
      {items.map((item, i) => {
        const row = rows[i]!;
        const isDone = frame >= checkAt(i);
        const tick = springIn(frame, fps, checkAt(i), 'bouncy');
        return (
          <Box key={item} {...row}>
            <Reveal delay={6 + i * 4} effect={['fade', 'slide-left']}>
              <div style={{display: 'flex', alignItems: 'center', gap: dot * 0.4, height: row.height}}>
                <div
                  style={{
                    width: dot,
                    height: dot,
                    flexShrink: 0,
                    borderRadius: dot / 2,
                    boxSizing: 'border-box',
                    border: `${Math.max(3, dot * 0.08)}px solid ${isDone ? theme.success : withAlpha(theme.text, 0.3)}`,
                    background: withAlpha(theme.success, 0.2 * Math.min(1, tick)),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <div style={{transform: `scale(${tick})`, display: 'flex'}}>
                    <Icon name="check" size={dot * 0.6} color={theme.success} strokeWidth={3} />
                  </div>
                </div>
                <FitText text={item} width={labelW} height={rowH * 0.9} maxLines={2} maxFontSize={labelSize} align="left" font="body" weight={700} color={isDone ? theme.text : theme.mutedText} />
              </div>
            </Reveal>
          </Box>
        );
      })}
      <Box x={ringX} y={ringY} width={ring} height={ring}>
        <Reveal delay={firstCheck - 8} effect={['fade', 'scale']}>
          <Progress variant="ring" value={meter} width={ring} height={ring} thickness={ring * 0.08} color={done === n ? theme.success : theme.primary} />
        </Reveal>
      </Box>
      <Box x={ringX + ring * 0.2} y={ringY + ring * 0.3} width={ring * 0.6} height={ring * 0.26}>
        <FitText text={`${done}/${n}`} width={ring * 0.6} height={ring * 0.26} maxLines={1} weight={900} tabular color={done === n ? theme.success : theme.text} />
      </Box>
      <Box x={ringX + ring * 0.18} y={ringY + ring * 0.58} width={ring * 0.64} height={ring * 0.14}>
        <Reveal delay={lastCheck + 6} effect={['fade', 'slide-up']}>
          <FitText text={doneLabel} width={ring * 0.64} height={ring * 0.14} maxLines={1} font="body" weight={700} color={theme.mutedText} uppercase letterSpacing={0.08} />
        </Reveal>
      </Box>
    </>
  );
}
```

Why it is built this way: the layout branches on `isWide` and derives every size from the region. Item timing is a fraction of `durationInFrames`. Labels share one measured size. The gradient id comes from `useSvgId`. The background is opaque because this is a full-screen/split graphic (an overlay would drop `<Background/>`). Every visible string comes from `content`.

## Short-form looks (WP12A)

On the polish explain path the plate theme carries `look: 'auto'`; `platePalette(theme)` then returns one of four curated video looks (`pickShortFormLookId`, pure, from the theme's background lightness and accent hue), and `resolveTheme` sets the faces. One ground, one ink, ONE highlighter marker, white / off-white paper for article and post cards; never the karaoke blue-green.

| Look | When | Ground / ink | Marker | Display / body face |
| --- | --- | --- | --- | --- |
| `paper_lime` | light theme background | off-white / black | lime `#C8F31D` | Bebas Neue / Inter |
| `ink_white` | dark, other saturated accent | near-black / white | lime `#C8F31D` | Bebas Neue / Inter |
| `night_amber` | dark, warm accent | near-black / warm white | amber `#FFB020` | Space Grotesk / Inter |
| `clean_mono` | dark, no usable accent | near-black / white | white bar, black ink | Space Grotesk / Inter |

Hero titles (OpenPlate, StampTitle, WikiCallout heading, TweetCard name, FullscreenStatement, VsClaim) use the **display** face (`font` unset); article and post passages use `font="body"`. Accent *text* uses `palette.markerText` (a lime bar is a highlighter, not type on off-white). The karaoke highlight on these edits is the look's marker (`LOOK_CAPTION_HIGHLIGHT` on the server).

## Motion recipes (video vernacular)

Plates should move like **video motion design**, not like website cards fading in. A *motion recipe* is a named entrance (WP14A) that a plate host runs through `<MotionRecipe recipeId="...">`; a seed or Director picks one by beat intent. They are built only from Remotion `spring` / `interpolate` / `Easing` and the toolkit helpers (no network, no state, no effects, no timers), so they pass the sandbox rules above.

| id | family | intents | feel |
| --- | --- | --- | --- |
| `elastic_type_snap` | type_physics | hook, punchline | scale 0.4 -> overshoot -> 1 with a blur that clears (Snappy / Elastic Text) |
| `smear_blur_in` | type_physics | pivot, hook | horizontal smear: stretched + blurred + sliding, then sharp (Stretch Blur) |
| `type_trail` | type_physics | list, hook | characters arrive one by one, each leaving a fading ghost (pass `text`) |
| `scramble_settle` | type_physics | pivot, stat | glyphs flicker through letters and lock onto the real ones (pass `text`) |
| `split_mask_reveal` | reveal_mask | evidence, payoff | a slit opens from the centre line and reveals the layer (Split Reveal) |
| `stretch_squash_pop` | type_physics | punchline, hook | stretch, squash, overshoot, settle (cartoon physics) |
| `counter_snap` | metric | stat | a number counts on a snappy spring and pops as it settles (pass `value`) |
| `nested_scale_in` | image_story | evidence, payoff, stat | the layer grows 0.6 -> 1 while its content counter-scales 1.25 -> 1 |
| `glitch_text_reveal` | type_physics | pivot, punchline | RGB split (red / blue drop-shadow pair, never blue-green) and hashed horizontal jitter settle into sharp type |
| `pixel_dissolve_in` | reveal_mask | evidence, payoff | a coarse checker mask refines (cells 96 -> 6 px) while opacity climbs in four steps |
| `gooey_accent_pop` | type_physics | punchline, stat | blobby pop: x / y overshoot out of phase with a slight tilt; motion only, no backing card |
| `blur_spin_settle` | type_physics | hook, pivot | 14 deg spin + 12 px blur resolve to sharp upright type |
| `logo_slam` | image_story | media, payoff, hook | scale 0.2 -> 1.18 -> 1 with a rocking settle (logo hit) |
| `sticker_pop` | image_story | media, punchline, hook | elastic scale + small rotate wiggle (stickers) |
| `still_push_in` | image_story | media, evidence, payoff | slow push 1.12 -> 1 over the hold, blur clears (Ken Burns) |
| `card_tilt_in` | image_story | media, evidence, payoff | perspective rotateY 16 / rotateX 10 deg -> 0 with a scale settle (card as an object) |
| `orbit_drift` | image_story | media, payoff | CONTINUOUS slow drift for logo-cloud background items |

Rules every recipe keeps:
- **Motion only.** A recipe never draws chrome (no browser bar, tab strip, notification, card). The host owns the paper; the recipe only moves, blurs, stretches, clips and re-times what it wraps.
- **Already moving on frame 0** (never starts on its end state; something changes within 10 frames) and **ends on the identity state** (opacity 1, scale 1, no blur, no offset, no clip).
- **Duration-adaptive:** the entrance is a short fixed span clamped to 8-24 frames and at most 40 % of the graphic, so +-40 % duration still lands well before the end.
- An unknown id falls back to `Reveal effect="pop" spring="snappy"`, never to a bare fade.

Catalog for QA and Director docs (ids, families, intents, feel, default host binding): [`recipes/CATALOG.md`](./recipes/CATALOG.md) and its machine-readable twin `recipes/catalog.json`. Internal vernacular, not Jitter assets. Generated graphics are checked by an aesthetic gate (`server/src/lib/motionAestheticGate.ts`): authored browser / OS chrome, or a soft fade / slide-up `Reveal` as the only entrance with no `<MotionRecipe>`, is rejected.

Hosts take `recipeId?: MotionRecipeId` with a default: `OpenPlate` -> `elastic_type_snap`, `StampTitle` -> `stretch_squash_pop`, `FullscreenStatement` -> `smear_blur_in`, `WikiCallout` -> `split_mask_reveal`, `NewspaperCallout` and `TweetCard` -> `nested_scale_in`. The server mirrors the ids and intents in `server/src/lib/motionRecipes.ts` (a test keeps them equal).

**Intent priority and variety (WP14C).** `recipesForIntent(intent)` lists every recipe for an intent: those whose *first* intent it is, in registry order, then the others. Its head is the stable default (`recipeForIntent`), the rest is the variety pool (`recipeForIntentVaried(intent, n)`): hook = elastic_type_snap, blur_spin_settle, ...; punchline = stretch_squash_pop, gooey_accent_pop, elastic_type_snap, glitch_text_reveal; pivot = smear_blur_in, scramble_settle, glitch_text_reveal, blur_spin_settle; evidence = split_mask_reveal, nested_scale_in, pixel_dissolve_in; stat = counter_snap, then the others that list it. Seeds keep the default; Claude plate briefs rotate through the pool.

**Kinetic type on recipes (WP14D).** `KineticText` takes `recipeId` (a transform-driven recipe): every word / char / line then enters with that recipe on its own clock (40 frames of local duration = a 16-frame entrance; hidden until its own start), so the stagger stays but the settle is video physics rather than the soft `effect`. Omit it for the old behaviour. `BigKineticHeadline` wraps each line in `<MotionRecipe>` (default `stretch_squash_pop`); `VsClaim` sides default to `smear_blur_in`; `QuoteCallout` enters with `split_mask_reveal` (quote mark `elastic_type_snap`). Product captions (`KineticCaptions`) never wrap the rail: only the ACTIVE word runs a recipe (`captionWordRecipeState`: bounce -> `stretch_squash_pop`; scale / pop / type -> `elastic_type_snap`; a short-form typed look -> `elastic_type_snap`), blended to identity within 10 frames.

