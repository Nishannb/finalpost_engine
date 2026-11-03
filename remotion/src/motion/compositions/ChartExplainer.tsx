import React from 'react';

import {BarChart, Counter, LineChart, type NumberFormat} from '../components/Data';
import {Badge} from '../components/Indicators';
import {Box, Reveal} from '../components/Reveal';
import {PlateGround, usePlatePalette} from '../components/Plate';
import {FitText} from '../components/Text';
import {contentBox, sliceTop, type SafeArea} from '../layout';

export type ChartExplainerProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  title?: string;
  kind: 'line' | 'bar';
  data: Array<{label: string; value: number}>;
  /** Animated headline number above the chart (e.g. the latest value). */
  headline?: NumberFormat & {from?: number; to: number};
  /** Short annotation badge shown after the chart lands, e.g. "+400% in a year". */
  annotation?: string;
  valueFormat?: NumberFormat;
  background?: boolean;
};

/** Title → animated headline number → chart → annotation. */
export const ChartExplainer: React.FC<ChartExplainerProps> = ({width, height, safeArea, title, kind, data, headline, annotation, valueFormat, background = true}) => {
  const palette = usePlatePalette();
  const box = contentBox(width, height, safeArea, Math.min(width, height) * 0.06);
  let rest = box;
  let titleBox = null as null | typeof box;
  let headBox = null as null | typeof box;
  if (title) [titleBox, rest] = sliceTop(rest, Math.min(0.14, 120 / box.height), box.height * 0.02);
  if (headline) [headBox, rest] = sliceTop(rest, 0.22, box.height * 0.02);
  const [chartBox, noteBox] = annotation ? sliceTop(rest, 0.82, box.height * 0.02) : [rest, null];
  const chartDelay = headline ? 14 : 6;
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
      {headBox && headline ? (
        <Box {...headBox}>
          <Counter {...headline} width={headBox.width} height={headBox.height} color={palette.markerText} duration={44} delay={chartDelay} />
        </Box>
      ) : null}
      <Box {...chartBox}>
        {kind === 'line' ? (
          <LineChart data={data} width={chartBox.width} height={chartBox.height} delay={chartDelay} duration={44} showPoints />
        ) : (
          <BarChart data={data} width={chartBox.width} height={chartBox.height} delay={chartDelay} highlight={data.length - 1} valueFormat={valueFormat} />
        )}
      </Box>
      {noteBox && annotation ? (
        <Box {...noteBox} style={{display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
          <Badge text={annotation} icon="trending-up" height={Math.min(noteBox.height, 96)} maxWidth={noteBox.width} delay={chartDelay + 40} color={palette.paper} bordered />
        </Box>
      ) : null}
    </>
  );
};
