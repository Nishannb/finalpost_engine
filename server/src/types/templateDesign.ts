import type {CaptionStyleGuide} from './captionStyleGuide.ts';
import type {EditSpec} from './editSpec.ts';

export type TemplateDesignStatus =
  | 'awaiting_upload'
  | 'preprocessing'
  | 'designing'
  | 'rendering_preview'
  | 'done'
  | 'failed';

export type TemplateDesignJob = {
  designJobId: string;
  userId: string;
  status: TemplateDesignStatus;
  progress: number;
  name: string;
  description: string;
  sourceKey: string;
  sourcePublicUrl: string;
  editSpec?: EditSpec;
  captionStyleGuide?: CaptionStyleGuide;
  warnings?: string[];
  modelUsed?: string;
  estimatedCostUsd?: number;
  previewUrl?: string;
  previewRenderJobId?: string;
  confidence?: number;
  createdAt: string;
  updatedAt: string;
  errorCode?: string;
  errorMessage?: string;
};
