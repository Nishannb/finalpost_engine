// Phase 0 probe: transparent overlay (outline shape + draw-on arrow + label)
// composited directly over the talking-head footage. Paints no background.
import {interpolate, spring, useCurrentFrame} from 'remotion';
import {useSvgId} from '@finalpost/motion';

export type OverlayProps = {
  width: number;
  height: number;
  durationInFrames: number;
  fps: number;
  content: {label: string};
  focusBox: {x: number; y: number; w: number; h: number};
};

export default function Overlay({width, height, durationInFrames, fps, content, focusBox}: OverlayProps) {
  const frame = useCurrentFrame();
  const glow = useSvgId('glow');
  const outline = spring({frame, fps, config: {damping: 16, stiffness: 140}});
  const draw = interpolate(frame, [6, 22], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const label = spring({frame: frame - 18, fps, config: {damping: 12, stiffness: 160}});
  const exit = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const tipX = focusBox.x + focusBox.w / 2;
  const tipY = focusBox.y - 24;
  const startX = width * 0.2;
  const startY = focusBox.y - 360;
  const path = `M ${startX} ${startY} Q ${startX + 40} ${tipY - 40} ${tipX} ${tipY}`;
  const pathLength = 900;

  return (
    <svg width={width} height={height} style={{position: 'absolute', inset: 0, opacity: exit}}>
      <defs>
        <filter id={glow} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="10" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect
        x={focusBox.x}
        y={focusBox.y}
        width={focusBox.w}
        height={focusBox.h}
        rx={36}
        fill="none"
        stroke="#38BDF8"
        strokeWidth={10}
        filter={`url(#${glow})`}
        opacity={outline}
        transform={`translate(${tipX} ${focusBox.y + focusBox.h / 2}) scale(${0.85 + 0.15 * outline}) translate(${-tipX} ${-(focusBox.y + focusBox.h / 2)})`}
      />
      <path
        d={path}
        fill="none"
        stroke="#FACC15"
        strokeWidth={12}
        strokeLinecap="round"
        strokeDasharray={pathLength}
        strokeDashoffset={pathLength * (1 - draw)}
      />
      <circle cx={tipX} cy={tipY} r={18 * draw} fill="#FACC15" />
      <g transform={`translate(${startX} ${startY - 70}) scale(${Math.max(0, label)})`}>
        <rect x={-30} y={-58} width={520} height={96} rx={48} fill="#0F172A" opacity={0.85} />
        <text
          x={230}
          y={6}
          fill="#FFFFFF"
          fontSize={44}
          fontWeight={800}
          textAnchor="middle"
          fontFamily="Inter, Helvetica, Arial, sans-serif">
          {content.label}
        </text>
      </g>
    </svg>
  );
}
