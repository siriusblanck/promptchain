import { expect, it } from "vitest";
import { EmptyResponseError, mapGeminiError, mapRunStartError } from "@/lib/runs/errors";

const withStatus = (status: number, message = "boom") => Object.assign(new Error(message), { status });

it.each([
  [Object.assign(new Error("aborted"), { name: "AbortError" }), "timeout", "Step 02 timed out after 30 s."],
  [withStatus(504), "timeout", "Step 02 timed out after 30 s."],
  [withStatus(429), "rate_limited", "Step 02: Gemini is rate-limiting; try again in a minute."],
  [withStatus(404), "model_unavailable", "Step 02: that model isn't available. Pick another model for the step."],
  [withStatus(403), "auth", "Step 02: Gemini rejected the API key."],
  [withStatus(400, "bad input"), "rejected", "Step 02: Gemini rejected the request (bad input)."],
  [new EmptyResponseError("SAFETY"), "empty", "Step 02: Gemini returned nothing (blocked: SAFETY). Try different input or instructions."],
  [new Error("weird"), "unknown", "Step 02 failed: weird"],
])("maps %s", (error, code, message) => {
  expect(mapGeminiError(error, 2, 30_000)).toEqual({ code, message });
});

it("maps run-start exceptions", () => {
  expect(mapRunStartError("rate_limited")).toMatch(/20 runs in 10 minutes/);
  expect(mapRunStartError("chain_has_no_steps")).toBe("Add a step before running this chain.");
  expect(mapRunStartError("step_3_has_no_active_model")).toBe("Step 03 has no active model. Choose one in the step editor.");
  expect(mapRunStartError("other")).toBe("Couldn't start the run. Try again.");
});
