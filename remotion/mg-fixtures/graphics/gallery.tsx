// Renders one reference composition by name with content from props (test fixture).
import type {FC} from 'react';
import {compositions, type GraphicProps} from '@finalpost/motion';

type Content = {composition: keyof typeof compositions; props: Record<string, unknown>};

export default function Gallery({width, height, safeArea, content}: GraphicProps<Content>) {
  const Composition = compositions[content!.composition] as unknown as FC<Record<string, unknown>>;
  return <Composition {...content!.props} width={width} height={height} safeArea={safeArea} />;
}
