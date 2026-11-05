export type LiveStepStatus = "pending" | "running" | "succeeded" | "failed";
export type LiveStep = { status: LiveStepStatus; text: string | null; imageUrl: string | null; error: string | null; latencyMs: number | null };
export type LiveInput = { text: string | null; previewUrl: string | null; width: number | null; height: number | null };
export type LiveRun = {
  runId: string | null;
  state: "starting" | "running" | "succeeded" | "failed" | "incomplete";
  message: string | null;
  input: LiveInput;
  steps: LiveStep[]; // index = step position (stepOrder - 1)
};
export type StepUpdate = {
  stepOrder: number; status: "succeeded" | "failed"; text: string | null; imageUrl: string | null; error: string | null; latencyMs: number | null;
};
export type AdvanceResult = { state: "running" | "succeeded" | "failed" | "busy"; step: StepUpdate | null };

const PENDING: LiveStep = { status: "pending", text: null, imageUrl: null, error: null, latencyMs: null };

export const startLiveRun = (stepCount: number, input: LiveInput): LiveRun => ({
  runId: null, state: "starting", message: null, input, steps: Array.from({ length: stepCount }, () => PENDING),
});

export const markStarted = (live: LiveRun, runId: string): LiveRun => ({
  ...live, runId, state: "running", steps: live.steps.map((s, i) => (i === 0 ? { ...s, status: "running" } : s)),
});

export function applyAdvance(live: LiveRun, result: AdvanceResult): LiveRun {
  if (result.state === "busy") return live;
  const update = result.step;
  const steps = live.steps.map((s, i): LiveStep => {
    if (!update) return s;
    if (i + 1 === update.stepOrder) {
      return { status: update.status, text: update.text, imageUrl: update.imageUrl, error: update.error, latencyMs: update.latencyMs };
    }
    return i + 1 === update.stepOrder + 1 && result.state === "running" ? { ...s, status: "running" } : s;
  });
  const message = update?.error ?? (result.state === "failed" ? "The run failed." : null);
  return { ...live, steps, state: result.state, message };
}

export const failLiveRun = (live: LiveRun, message: string): LiveRun => ({ ...live, state: "failed", message });
export const markIncomplete = (live: LiveRun): LiveRun => ({
  ...live, state: "incomplete", message: "This run stopped responding. Start a new run.",
});

/** 1-based number of the running step, or 0 when none is running. */
export const runningStepNumber = (live: LiveRun) => live.steps.findIndex((s) => s.status === "running") + 1;
