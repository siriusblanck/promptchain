import type { LiveRun } from "@/lib/runs/live-run";
import { pad2, ratioOf, snippet, tileColor } from "./presentation";
import type { ChainStep, StepOutput } from "./types";

export type CardView =
  | { kind: "photo"; url: string; ratio: string; stat: string | null }
  | { kind: "tile"; tone: string; text: string | null; stat: string | null };

const done = (ms: number | null) => (ms === null ? "Done" : `Done · ${(ms / 1000).toFixed(1)} s`);

function fromOutput(output: StepOutput | null, tone: string): CardView {
  if (output?.image) return { kind: "photo", url: output.image.url, ratio: ratioOf(output.image), stat: null };
  return { kind: "tile", tone, text: output?.text ? snippet(output.text) : null, stat: null };
}

export function stepCardView(step: ChainStep, index: number, live: LiveRun | null): CardView {
  const color = tileColor(index);
  const state = live?.steps[index];
  if (!state) return fromOutput(step.latest, color);
  if (state.status === "pending") return { kind: "tile", tone: "waiting", text: "Waiting", stat: "Waiting" };
  if (state.status === "running") return { kind: "tile", tone: "running", text: "Running…", stat: "Running" };
  if (state.status === "failed") return { kind: "tile", tone: "failed", text: state.error, stat: "Failed" };
  return state.imageUrl
    ? { kind: "photo", url: state.imageUrl, ratio: "3 / 4", stat: done(state.latencyMs) }
    : { kind: "tile", tone: color, text: state.text ? snippet(state.text) : null, stat: done(state.latencyMs) };
}

export function inputCardView(latestInput: StepOutput | null, live: LiveRun | null): CardView {
  if (live) {
    const { previewUrl, width, height, text } = live.input;
    if (previewUrl) return { kind: "photo", url: previewUrl, ratio: width && height ? `${width} / ${height}` : "3 / 4", stat: "This run" };
    return { kind: "tile", tone: "mint", text: text ? snippet(text) : null, stat: "This run" };
  }
  if (latestInput?.image) return { kind: "photo", url: latestInput.image.url, ratio: ratioOf(latestInput.image), stat: null };
  if (latestInput?.text) return { kind: "tile", tone: "mint", text: snippet(latestInput.text), stat: null };
  return { kind: "tile", tone: "empty", text: "Your image or text", stat: null };
}

export function describeFlow(steps: readonly ChainStep[], index: number): { receives: string; sends: string } {
  const receives = index === 0
    ? "Receives your image and/or text."
    : `Receives ${steps[index - 1]?.model?.modality ?? "text"} from step ${pad2(index)}.`;
  const sends = index < steps.length - 1
    ? `Sends ${steps[index]?.model?.modality ?? "its output"} to step ${pad2(index + 2)}.`
    : "Its output is the chain's final result.";
  return { receives, sends };
}
