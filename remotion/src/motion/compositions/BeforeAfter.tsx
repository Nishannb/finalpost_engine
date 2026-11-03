import React from 'react';

import {Arrow} from '../components/Indicators';
import {Box, Reveal} from '../components/Reveal';
import {PlateGround, usePlatePalette} from '../components/Plate';
import {Card} from '../components/Shapes';
import {FitText} from '../components/Text';
import {contentBox, isWide, sliceTop, type SafeArea} from '../layout';

type Side = {label: string; value?: string; detail?: string};

export type BeforeAfterProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  title?: string;
  before: Side;
  after: Side;
  background?: boolean;
};

/** Two cards with an arrow between: muted "before", highlighted "after". Row when wide, column when tall. */
export const BeforeAfter: React.FC<BeforeAfterProps> = ({width, height, safeArea, title, before, after, background = true}) => {
  const palette = usePlatePalette();
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.06);
  const [titleBox, body] = title ? sliceTop(box, Math.min(0.18, 130 / box.height), box.height * 0.04) : [null, box];
  const wide = isWide(body.width, body.height);
  const gap = (wide ? body.width : body.height) * 0.16;
  const cardW = wide ? (body.width - gap) / 2 : body.width;
  const cardH = wide ? Math.min(body.height, cardW * 1.1) : (body.height - gap) / 2;
  const first = {x: body.x, y: body.y + (wide ? (body.height - cardH) / 2 : 0), width: cardW, height: cardH};
  const second = wide ? {...first, x: body.x + cardW + gap} : {...first, y: body.y + cardH + gap};
  const arrowFrom = wide ? {x: first.x + cardW + gap * 0.15, y: first.y + cardH / 2} : {x: first.x + cardW / 2, y: first.y + cardH + gap * 0.15};
  const arrowTo = wide ? {x: second.x - gap * 0.15, y: arrowFrom.y} : {x: arrowFrom.x, y: second.y - gap * 0.15};

  const card = (side: Side, rect: typeof first, highlight: boolean, delay: number) => {
    const pad = Math.min(rect.width, rect.height) * 0.08;
    const inner = {width: rect.width - pad * 2, height: rect.height - pad * 2};
    const rows = [side.label, side.value, side.detail].filter(Boolean).length;
    const unit = inner.height / (rows === 1 ? 1 : rows === 2 ? 2.4 : 3.4);
    return (
      <Box {...rect}>
        <Reveal delay={delay} effect={['fade', 'scale']} spring="snappy">
          <Card width={rect.width} height={rect.height} variant={highlight ? 'soft' : 'solid'} color={highlight ? undefined : palette.paper} borderColor={highlight ? palette.marker : undefined} padding={pad}>
            <FitText text={side.label.toUpperCase()} width={inner.width} height={unit * 0.7} maxLines={1} font="body" weight={700} letterSpacing={0.08} color={highlight ? palette.mutedInk : palette.paperMuted} />
            {side.value ? <FitText text={side.value} width={inner.width} height={unit * 1.4} maxLines={1} weight={900} color={highlight ? palette.markerText : palette.paperInk} /> : null}
            {side.detail ? <FitText text={side.detail} width={inner.width} height={unit} maxLines={2} font="body" weight={500} color={highlight ? palette.ink : palette.paperInk} /> : null}
          </Card>
        </Reveal>
      </Box>
    );
  };

  return (
    <>
      {background ? <PlateGround /> : null}
      {titleBox ? (
        <Box {...titleBox}>
          <Reveal>
            <FitText text={title!} width={titleBox.width} height={titleBox.height} maxLines={2} weight={800} />
          </Reveal>
        </Box>
      ) : null}
      {card(before, first, false, 4)}
      <Arrow from={arrowFrom} to={arrowTo} delay={20} duration={12} strokeWidth={Math.max(6, gap * 0.08)} color={palette.marker} pulse />
      {card(after, second, true, 30)}
    </>
  );
};
