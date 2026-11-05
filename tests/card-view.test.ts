import { expect, it } from "vitest";
import { describeFlow, inputCardView, stepCardView } from "@/lib/chains/card-view";
import type { ChainStep } from "@/lib/chains/types";
import { markStarted, startLiveRun } from "@/lib/runs/live-run";

const model = (modality: "text" | "image") => ({ id: "m", name: "M", identifier: "m", modality, isActive: true });
const step = (id: string, modality: "text" | "image", latest: ChainStep["latest"] = null): ChainStep => ({
  id, order: 1, title: id, instructions: "x", model: model(modality), latest,
});

it("shows the latest image output as a 3:4 photo", () => {
  const view = stepCardView(step("a", "image", { text: null, image: { url: "u", width: null, height: null } }), 0, null);
  expect(view).toEqual({ kind: "photo", url: "u", ratio: "3 / 4", stat: null });
});

it("shows live progress over saved outputs", () => {
  const live = markStarted(startLiveRun(2, { text: "t", previewUrl: null, width: null, height: null }), "r");
  expect(stepCardView(step("a", "text"), 0, live)).toMatchObject({ kind: "tile", tone: "running" });
  expect(stepCardView(step("b", "text"), 1, live)).toMatchObject({ kind: "tile", tone: "waiting" });
});

it("uses an empty placeholder before any run", () => {
  expect(inputCardView(null, null)).toEqual({ kind: "tile", tone: "empty", text: "Your image or text", stat: null });
});

it("describes what a step receives and sends", () => {
  const steps = [step("a", "text"), step("b", "image")];
  expect(describeFlow(steps, 0)).toEqual({ receives: "Receives your image and/or text.", sends: "Sends text to step 02." });
  expect(describeFlow(steps, 1)).toEqual({ receives: "Receives text from step 01.", sends: "Its output is the chain's final result." });
});
