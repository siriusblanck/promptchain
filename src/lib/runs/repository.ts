import "server-only";

import { z } from "zod";
import type { AdminClient } from "@/lib/supabase/admin";
import type { MediaRunRow } from "./media";
import { signRunImages } from "./storage";

const payload = z.object({ text: z.string().nullable(), imagePath: z.string().nullable() });
const claimSchema = z.union([
  z.object({
    state: z.literal("claimed"),
    step: z.object({
      id: z.guid(), stepOrder: z.number().int(), title: z.string(), instructions: z.string(),
      modelIdentifier: z.string(), modality: z.enum(["text", "image"]),
    }),
    runInput: payload,
    previous: payload.nullable(),
    isLast: z.boolean(),
  }),
  z.object({ state: z.enum(["succeeded", "failed", "busy"]) }),
]);
export type Claim = z.infer<typeof claimSchema>;
export type ClaimedRun = Extract<Claim, { state: "claimed" }>;

const mediaRowSchema = z.object({
  id: z.guid(), created_at: z.string(), status: z.enum(["running", "succeeded", "failed"]), error_message: z.string().nullable(),
  input_text: z.string().nullable(), input_image_path: z.string().nullable(),
  input_image_width: z.number().nullable(), input_image_height: z.number().nullable(),
  prompt_chain_run_steps: z.array(z.object({
    step_order: z.number(), title: z.string(), modality: z.enum(["text", "image"]), status: z.string(),
    output_text: z.string().nullable(), output_image_path: z.string().nullable(), latency_ms: z.number().nullable(),
    started_at: z.string().nullable(), completed_at: z.string().nullable(),
  })),
});

const raise = (label: string, error: { message: string } | null) => {
  if (error) throw new Error(`${label}: ${error.message}`);
};

export async function createRun(admin: AdminClient, run: {
  runId: string; chainId: string; userId: string; text: string | null; imagePath: string | null; width: number | null; height: number | null;
}) {
  const { error } = await admin.rpc("create_prompt_chain_run", {
    p_run_id: run.runId, p_chain_id: run.chainId, p_requested_by: run.userId, p_input_text: run.text,
    p_input_image_path: run.imagePath, p_input_image_width: run.width, p_input_image_height: run.height,
  });
  if (error) throw new Error(error.message); // message carries rate_limited / step_N_has_no_active_model
}

export async function claimNextStep(admin: AdminClient, runId: string): Promise<Claim> {
  const { data, error } = await admin.rpc("claim_next_run_step", { p_run_id: runId });
  raise("claim", error);
  return claimSchema.parse(data);
}

export async function completeStep(admin: AdminClient, stepId: string, out: { text: string | null; imagePath: string | null; latencyMs: number }) {
  const { data, error } = await admin.from("prompt_chain_run_steps").update({
    status: "succeeded", output_text: out.text, output_image_path: out.imagePath, latency_ms: out.latencyMs,
    completed_at: new Date().toISOString(),
  }).eq("id", stepId).eq("status", "running").select("id");
  raise("complete step", error);
  // A zero-row update means the guard missed (the step is no longer running): never report success then.
  if (!data || data.length !== 1) throw new Error("complete step: the step was no longer running");
}

/** Zero rows is fine here: claim_next_run_step may already have closed the run. */
export async function completeRun(admin: AdminClient, runId: string) {
  const { error } = await admin.from("prompt_chain_runs")
    .update({ status: "succeeded", completed_at: new Date().toISOString() }).eq("id", runId).eq("status", "running");
  raise("complete run", error);
}

/** Guarded like completeStep so a failure can never overwrite an output that already succeeded. */
export async function failStep(admin: AdminClient, runId: string, stepId: string, message: string, latencyMs: number) {
  const now = new Date().toISOString();
  const short = message.slice(0, 600);
  const { error: stepError } = await admin.from("prompt_chain_run_steps")
    .update({ status: "failed", error_message: short, latency_ms: latencyMs, completed_at: now }).eq("id", stepId).eq("status", "running");
  raise("fail step", stepError);
  const { error: runError } = await admin.from("prompt_chain_runs")
    .update({ status: "failed", error_message: short, completed_at: now }).eq("id", runId).eq("status", "running");
  raise("fail run", runError);
}

export async function listMediaRuns(admin: AdminClient, chainId: string): Promise<{ runs: MediaRunRow[]; urls: Map<string, string> }> {
  const { data, error } = await admin.from("prompt_chain_runs")
    .select("id, created_at, status, error_message, input_text, input_image_path, input_image_width, input_image_height, prompt_chain_run_steps(step_order, title, modality, status, output_text, output_image_path, latency_ms, started_at, completed_at)")
    .eq("prompt_chain_id", chainId).order("created_at", { ascending: false }).limit(30);
  raise("media runs", error);
  const runs = z.array(mediaRowSchema).parse(data);
  const paths = runs.flatMap((r) => [r.input_image_path, ...r.prompt_chain_run_steps.map((s) => s.output_image_path)]);
  return { runs, urls: await signRunImages(admin, paths.filter((p): p is string => Boolean(p))) };
}
