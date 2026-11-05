import type { Modality } from "@/lib/chains/types";

export type Payload = { text: string | null; imagePath: string | null };
export type ClaimedStep = {
  id: string; stepOrder: number; title: string; instructions: string; modelIdentifier: string; modality: Modality;
};
export type InlineImage = { mimeType: string; base64: string };
export type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

export const TEXT_TIMEOUT_MS = 30_000;
export const IMAGE_TIMEOUT_MS = 55_000;

export type GeminiCall =
  | { kind: "text"; model: string; parts: Part[]; systemInstruction: string; maxOutputTokens: number; timeoutMs: number }
  | { kind: "image"; model: string; parts: Part[]; aspectRatio: "3:4"; imageSize: "1K"; timeoutMs: number };

/** Step 1 receives the run's input; every later step receives the previous step's output. */
export function stepInput(runInput: Payload, previous: Payload | null): Payload {
  return previous ?? runInput;
}

export const hasInput = (payload: Payload) => Boolean(payload.text?.trim()) || Boolean(payload.imagePath);

export function buildGeminiCall(step: ClaimedStep, input: { text: string | null; image: InlineImage | null }): GeminiCall {
  const imageParts: Part[] = input.image ? [{ inlineData: { mimeType: input.image.mimeType, data: input.image.base64 } }] : [];
  const text = input.text?.trim() || null;
  if (step.modality === "text") {
    return {
      kind: "text", model: step.modelIdentifier, systemInstruction: step.instructions, maxOutputTokens: 2048,
      timeoutMs: TEXT_TIMEOUT_MS, parts: [...imageParts, ...(text ? [{ text }] : [])],
    };
  }
  return {
    kind: "image", model: step.modelIdentifier, aspectRatio: "3:4", imageSize: "1K", timeoutMs: IMAGE_TIMEOUT_MS,
    parts: [{ text: text ? `${step.instructions}\n\n${text}` : step.instructions }, ...imageParts],
  };
}
