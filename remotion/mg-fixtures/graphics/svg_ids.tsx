// SVG id collision test: every instance defines a gradient named "fill". If ids
// collided, all simultaneous instances would show the same colours.
import {FitText, useSvgId, type GraphicProps} from '@finalpost/motion';

type Content = {from: string; to: string; label: string};

export default function SvgIds({width, height, content}: GraphicProps<Content>) {
  const fill = useSvgId('fill');
  const {from, to, label} = content!;
  return (
    <>
      <svg width={width} height={height} style={{position: 'absolute', inset: 0}}>
        <defs>
          <linearGradient id={fill} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
        </defs>
        <rect x={0} y={0} width={width} height={height} rx={32} fill={`url(#${fill})`} />
      </svg>
      <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <FitText text={label} width={width * 0.8} height={height * 0.4} maxLines={1} weight={900} color="#FFFFFF" />
      </div>
    </>
  );
}
