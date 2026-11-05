export type Modality = "text" | "image";
export type LlmModel = { id: string; name: string; identifier: string; modality: Modality };
/** A signed (private bucket) image; null dimensions mean the 3:4 default used for generated images. */
export type SignedImage = { url: string; width: number | null; height: number | null };
export type StepOutput = { text: string | null; image: SignedImage | null };
export type ChainStep = {
  id: string;
  order: number;
  title: string;
  instructions: string;
  model: (LlmModel & { isActive: boolean }) | null;
  latest: StepOutput | null;
};
export type ChainDetail = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  steps: ChainStep[];
  latestInput: StepOutput | null;
  runCount: number;
};
export type ChainSummary = { id: string; name: string; isActive: boolean; trail: Modality[]; cover: SignedImage | null };
