import { pad2 } from "@/lib/chains/presentation";

export type RunErrorCode = "timeout" | "rate_limited" | "model_unavailable" | "rejected" | "auth" | "empty" | "unknown";
export type RunError = { code: RunErrorCode; message: string };

export class EmptyResponseError extends Error {
  constructor(readonly finishReason: string | undefined) {
    super(`empty response (${finishReason ?? "unknown"})`);
    this.name = "EmptyResponseError";
  }
}

const shorten = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const statusOf = (e: unknown) =>
  typeof e === "object" && e !== null && typeof (e as { status?: unknown }).status === "number"
    ? (e as { status: number }).status
    : undefined;
const isTimeout = (e: unknown, status: number | undefined, message: string) =>
  status === 504 || (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")) ||
  /timed? ?out|deadline/i.test(message);

export function mapGeminiError(error: unknown, stepOrder: number, timeoutMs: number): RunError {
  const label = `Step ${pad2(stepOrder)}`;
  if (error instanceof EmptyResponseError) {
    return { code: "empty", message: `${label}: Gemini returned nothing (blocked: ${error.finishReason ?? "unknown"}). Try different input or instructions.` };
  }
  const status = statusOf(error);
  const message = error instanceof Error ? error.message : String(error);
  if (isTimeout(error, status, message)) return { code: "timeout", message: `${label} timed out after ${Math.round(timeoutMs / 1000)} s.` };
  if (status === 429) return { code: "rate_limited", message: `${label}: Gemini is rate-limiting; try again in a minute.` };
  if (status === 404) return { code: "model_unavailable", message: `${label}: that model isn't available. Pick another model for the step.` };
  if (status === 401 || status === 403) return { code: "auth", message: `${label}: Gemini rejected the API key.` };
  if (status === 400) return { code: "rejected", message: `${label}: Gemini rejected the request (${shorten(message, 160)}).` };
  return { code: "unknown", message: `${label} failed: ${shorten(message, 200)}` };
}

/** Turns create_prompt_chain_run exceptions into sentences. */
export function mapRunStartError(message: string): string {
  if (message.includes("rate_limited")) return "You've started 20 runs in 10 minutes. Wait a few minutes and try again.";
  if (message.includes("chain_has_no_steps")) return "Add a step before running this chain.";
  const missing = /step_(\d+)_has_no_active_model/.exec(message);
  if (missing) return `Step ${pad2(Number(missing[1]))} has no active model. Choose one in the step editor.`;
  if (message.includes("prompt_chain_runs_has_input")) return "Add an image or some text.";
  return "Couldn't start the run. Try again.";
}
