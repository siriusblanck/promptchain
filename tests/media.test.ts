import { expect, it } from "vitest";
import { splitNumbered, toMediaRun, type MediaRunRow } from "@/lib/runs/media";

const step = (order: number, text: string, ms: number) => ({
  step_order: order, title: `S${order}`, modality: "text" as const, status: "succeeded", output_text: text,
  output_image_path: null, latency_ms: ms, started_at: null, completed_at: null,
});
const row: MediaRunRow = {
  id: "r", created_at: "2026-11-05T19:00:00.000Z", status: "succeeded", error_message: null, input_text: "hi",
  input_image_path: "r/input.jpg", input_image_width: 1600, input_image_height: 900,
  prompt_chain_run_steps: [step(2, "1. a\n2. b", 1500), step(1, "desc", 500)],
};

it("splits numbered captions only when every line is numbered", () => {
  expect(splitNumbered("1. a\n2) b")).toEqual(["a", "b"]);
  expect(splitNumbered("intro\n1. a")).toBeNull();
});

it("shows the input photo and the final captions for a text chain", () => {
  const run = toMediaRun(row, new Map([["r/input.jpg", "signed"]]), Date.parse(row.created_at));
  expect(run.photo).toEqual({ url: "signed", width: 1600, height: 900 });
  expect(run.finalLines).toEqual(["a", "b"]);
  expect(run.statusLabel).toBe("Done in 2.0 s");
  expect(run.trail.map((s) => s.order)).toEqual([1, 2]);
});

it("labels a silent running run as incomplete", () => {
  const run = toMediaRun({ ...row, status: "running" }, new Map(), Date.parse(row.created_at) + 91_000);
  expect(run.statusLabel).toBe("Incomplete");
});
