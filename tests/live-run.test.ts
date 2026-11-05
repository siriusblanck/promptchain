import { expect, it } from "vitest";
import { applyAdvance, markStarted, runningStepNumber, startLiveRun } from "@/lib/runs/live-run";

const input = { text: "hi", previewUrl: null, width: null, height: null };

it("marks step 1 running once the run starts", () => {
  const live = markStarted(startLiveRun(3, input), "r1");
  expect(live.state).toBe("running");
  expect(runningStepNumber(live)).toBe(1);
});

it("fills a finished step and starts the next one", () => {
  const live = applyAdvance(markStarted(startLiveRun(3, input), "r1"), {
    state: "running",
    step: { stepOrder: 1, status: "succeeded", text: "out", imageUrl: null, error: null, latencyMs: 900 },
  });
  expect(live.steps[0]).toMatchObject({ status: "succeeded", text: "out" });
  expect(runningStepNumber(live)).toBe(2);
});

it("stops with the step's message on failure", () => {
  const live = applyAdvance(markStarted(startLiveRun(2, input), "r1"), {
    state: "failed",
    step: { stepOrder: 1, status: "failed", text: null, imageUrl: null, error: "Step 01 timed out after 30 s.", latencyMs: 30_000 },
  });
  expect(live.state).toBe("failed");
  expect(live.message).toBe("Step 01 timed out after 30 s.");
  expect(runningStepNumber(live)).toBe(0);
});

it("ignores busy results", () => {
  const live = markStarted(startLiveRun(2, input), "r1");
  expect(applyAdvance(live, { state: "busy", step: null })).toBe(live);
});
