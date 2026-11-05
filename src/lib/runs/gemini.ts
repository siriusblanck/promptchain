import "server-only";

import { GoogleGenAI, Modality, type GenerateContentResponse } from "@google/genai";
import { EmptyResponseError } from "./errors";
import type { GeminiCall } from "./plan";

export type GeminiOutput = { text: string } | { image: { mimeType: string; bytes: Buffer } };
export type GeminiClient = { generate(call: GeminiCall): Promise<GeminiOutput> };

function toRequest(call: GeminiCall) {
  const contents = [{ role: "user", parts: call.parts }];
  if (call.kind === "text") {
    return {
      model: call.model, contents,
      config: { systemInstruction: call.systemInstruction, maxOutputTokens: call.maxOutputTokens, httpOptions: { timeout: call.timeoutMs } },
    };
  }
  return {
    model: call.model, contents,
    config: {
      responseModalities: [Modality.IMAGE],
      imageConfig: { aspectRatio: call.aspectRatio, imageSize: call.imageSize },
      httpOptions: { timeout: call.timeoutMs },
    },
  };
}

function readText(response: GenerateContentResponse): GeminiOutput {
  const text = response.text?.trim();
  if (!text) throw new EmptyResponseError(response.candidates?.[0]?.finishReason);
  return { text };
}

function readImage(response: GenerateContentResponse): GeminiOutput {
  const part = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  const data = part?.inlineData?.data;
  if (!data) throw new EmptyResponseError(response.candidates?.[0]?.finishReason);
  return { image: { mimeType: part?.inlineData?.mimeType ?? "image/png", bytes: Buffer.from(data, "base64") } };
}

export function createGeminiClient(apiKey = process.env.GEMINI_API_KEY): GeminiClient {
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing.");
  const ai = new GoogleGenAI({ apiKey });
  return {
    async generate(call) {
      const response = await ai.models.generateContent(toRequest(call));
      return call.kind === "text" ? readText(response) : readImage(response);
    },
  };
}
