import { expect, it } from "vitest";
import { buildGeminiCall, hasInput, stepInput, type ClaimedStep } from "@/lib/runs/plan";

const step = (modality: "text" | "image"): ClaimedStep => ({
  id: "s", stepOrder: 2, title: "T", instructions: "Do the thing.", modelIdentifier: "m-1", modality,
});
const image = { mimeType: "image/jpeg", base64: "QUJD" };

it("feeds step 1 the run input and later steps the previous output", () => {
  const run = { text: "seed", imagePath: "r/input.jpg" };
  expect(stepInput(run, null)).toEqual(run);
  expect(stepInput(run, { text: "prev", imagePath: null })).toEqual({ text: "prev", imagePath: null });
});

it("detects empty input", () => {
  expect(hasInput({ text: "  ", imagePath: null })).toBe(false);
  expect(hasInput({ text: null, imagePath: "x.png" })).toBe(true);
});

it("builds a text call with instructions as system instruction and image before text", () => {
  const call = buildGeminiCall(step("text"), { text: "hello", image });
  expect(call).toEqual({
    kind: "text", model: "m-1", systemInstruction: "Do the thing.", maxOutputTokens: 2048, timeoutMs: 30_000,
    parts: [{ inlineData: { mimeType: "image/jpeg", data: "QUJD" } }, { text: "hello" }],
  });
});

it("builds an image call with instructions and input text in one prompt", () => {
  const call = buildGeminiCall(step("image"), { text: "a cat", image: null });
  expect(call).toEqual({
    kind: "image", model: "m-1", aspectRatio: "3:4", imageSize: "1K", timeoutMs: 55_000,
    parts: [{ text: "Do the thing.\n\na cat" }],
  });
});

it("passes an input image to an image step after the prompt", () => {
  const call = buildGeminiCall(step("image"), { text: null, image });
  expect(call.parts).toEqual([{ text: "Do the thing." }, { inlineData: { mimeType: "image/jpeg", data: "QUJD" } }]);
});
