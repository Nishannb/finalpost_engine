// Phase 0 probe: opaque graphic that sizes itself from props and prints the
// canvas size it was given, so a render proves the region contract.
import {AbsoluteFill, interpolate, spring, useCurrentFrame} from 'remotion';

export type HelloProps = {
  width: number;
  height: number;
  durationInFrames: number;
  fps: number;
  content: {headline: string; tag: string};
};

export default function Hello({width, height, durationInFrames, fps, content}: HelloProps) {
  const frame = useCurrentFrame();
  const enter = spring({frame, fps, config: {damping: 14, stiffness: 120}});
  const exit = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const unit = Math.min(width, height) / 10;

  return (
    <AbsoluteFill
      style={{
        background: 'linear-gradient(160deg, #1E1B4B 0%, #0F172A 60%, #022C22 100%)',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: exit,
        fontFamily: 'Inter, Helvetica, Arial, sans-serif',
      }}>
      <div
        style={{
          transform: `scale(${0.6 + 0.4 * enter}) translateY(${(1 - enter) * unit}px)`,
          opacity: enter,
          color: '#F8FAFC',
          fontSize: unit * 1.1,
          fontWeight: 900,
          lineHeight: 1.05,
          textAlign: 'center',
          padding: unit * 0.6,
        }}>
        {content.headline}
      </div>
      <div
        style={{
          marginTop: unit * 0.4,
          color: '#FACC15',
          fontSize: unit * 0.45,
          fontWeight: 700,
          opacity: interpolate(frame, [10, 20], [0, 1], {extrapolateRight: 'clamp'}),
        }}>
        {content.tag} · {width}×{height}
      </div>
    </AbsoluteFill>
  );
}
