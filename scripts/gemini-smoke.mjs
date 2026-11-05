// Verifies the DB's model ids work with this key before the UI depends on them.
import { GoogleGenAI, Modality } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const text = await ai.models.generateContent({ model: "gemini-3.5-flash-lite", contents: "Reply with exactly: ready" });
console.log("text:", text.text?.trim());
const image = await ai.models.generateContent({
  model: "gemini-3.1-flash-lite-image",
  contents: "A small red square centered on a white background",
  config: { responseModalities: [Modality.IMAGE], imageConfig: { aspectRatio: "3:4", imageSize: "1K" } },
});
const part = image.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
console.log("image:", part?.inlineData?.mimeType, part?.inlineData?.data?.length ?? 0, "base64 chars");
