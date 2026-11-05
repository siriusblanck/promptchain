import "server-only";

import { z } from "zod";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import { signRunImages } from "@/lib/runs/storage";
import { chainRowSchema, modelRowSchema, stepRowSchema } from "./schemas";
import type { ChainDetail, ChainStep, ChainSummary, LlmModel, SignedImage, StepOutput } from "./types";

const outputRow = z.object({ output_text: z.string().nullable(), output_image_path: z.string().nullable() });
const inputRow = z.object({
  input_text: z.string().nullable(),
  input_image_path: z.string().nullable(),
  input_image_width: z.number().nullable(),
  input_image_height: z.number().nullable(),
});
const summaryRow = z.object({
  id: z.guid(),
  name: z.string(),
  is_active: z.boolean(),
  prompt_chain_steps: z.array(z.object({
    step_order: z.number(),
    llm_models: z.object({ modality: z.enum(["text", "image"]) }).nullable(),
  })),
});
const coverOutputRow = z.object({ output_image_path: z.string(), prompt_chain_runs: z.object({ prompt_chain_id: z.guid() }) });
const coverInputRow = inputRow.extend({ prompt_chain_id: z.guid(), input_image_path: z.string() });

type Output = z.infer<typeof outputRow>;
type Cover = { path: string; width: number | null; height: number | null };

function check(label: string, error: { message: string } | null) {
  if (error) throw new Error(`[queries] ${label}: ${error.message}`);
}

const toModel = (row: z.infer<typeof modelRowSchema>): LlmModel => ({
  id: row.id, name: row.name, identifier: row.model_identifier, modality: row.modality,
});

export async function listActiveModels(): Promise<LlmModel[]> {
  const { data, error } = await createAdminClient()
    .from("llm_models").select("id, name, model_identifier, modality, is_active").eq("is_active", true).order("name");
  check("models", error);
  return z.array(modelRowSchema).parse(data).map(toModel);
}

export async function getChainName(chainId: string): Promise<string | null> {
  const { data, error } = await createAdminClient().from("prompt_chains").select("name").eq("id", chainId).maybeSingle();
  check("chain name", error);
  return data ? z.object({ name: z.string() }).parse(data).name : null;
}

const latestRow = outputRow.extend({ prompt_chain_step_id: z.guid() });

/** One batched query, newest first; the first row seen per step is that step's latest output. */
async function latestOutputs(admin: AdminClient, stepIds: readonly string[]): Promise<Map<string, Output>> {
  if (stepIds.length === 0) return new Map();
  const { data, error } = await admin.from("prompt_chain_run_steps")
    .select("prompt_chain_step_id, output_text, output_image_path").in("prompt_chain_step_id", [...stepIds])
    .eq("status", "succeeded").order("completed_at", { ascending: false }).limit(500);
  check("latest outputs", error);
  const latest = new Map<string, Output>();
  for (const row of z.array(latestRow).parse(data)) {
    if (!latest.has(row.prompt_chain_step_id)) {
      latest.set(row.prompt_chain_step_id, { output_text: row.output_text, output_image_path: row.output_image_path });
    }
  }
  return latest;
}

const signed = (urls: Map<string, string>, path: string | null, width: number | null = null, height: number | null = null): SignedImage | null => {
  const url = path ? urls.get(path) : undefined;
  return url ? { url, width, height } : null;
};

export async function getChainDetail(chainId: string): Promise<ChainDetail | null> {
  const admin = createAdminClient();
  const [chainRes, stepsRes, inputRes, countRes] = await Promise.all([
    admin.from("prompt_chains").select("id, name, description, is_active").eq("id", chainId).maybeSingle(),
    admin.from("prompt_chain_steps")
      .select("id, step_order, title, instructions, llm_models(id, name, model_identifier, modality, is_active)")
      .eq("prompt_chain_id", chainId).order("step_order"),
    admin.from("prompt_chain_runs").select("input_text, input_image_path, input_image_width, input_image_height")
      .eq("prompt_chain_id", chainId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("prompt_chain_runs").select("id", { count: "exact", head: true }).eq("prompt_chain_id", chainId),
  ]);
  [chainRes, stepsRes, inputRes, countRes].forEach((res) => check(`chain ${chainId}`, res.error));
  if (!chainRes.data) return null;

  const chain = chainRowSchema.parse(chainRes.data);
  const steps = z.array(stepRowSchema).parse(stepsRes.data);
  const latest = await latestOutputs(admin, steps.map((s) => s.id));
  const input = inputRes.data ? inputRow.parse(inputRes.data) : null;
  const paths = [...[...latest.values()].map((o) => o.output_image_path), input?.input_image_path ?? null];
  const urls = await signRunImages(admin, paths.filter((p): p is string => Boolean(p)));

  const toStep = (row: z.infer<typeof stepRowSchema>): ChainStep => {
    const out = latest.get(row.id);
    const output: StepOutput | null = out ? { text: out.output_text, image: signed(urls, out.output_image_path) } : null;
    return {
      id: row.id, order: row.step_order, title: row.title, instructions: row.instructions,
      model: row.llm_models ? { ...toModel(row.llm_models), isActive: row.llm_models.is_active } : null,
      latest: output,
    };
  };
  return {
    id: chain.id, name: chain.name, description: chain.description, isActive: chain.is_active,
    steps: steps.map(toStep),
    latestInput: input
      ? { text: input.input_text, image: signed(urls, input.input_image_path, input.input_image_width, input.input_image_height) }
      : null,
    runCount: countRes.count ?? 0,
  };
}

/** Newest image output per chain wins; otherwise the newest input photo. */
function pickCovers(outputs: z.infer<typeof coverOutputRow>[], inputs: z.infer<typeof coverInputRow>[]): Map<string, Cover> {
  const covers = new Map<string, Cover>();
  for (const o of outputs) {
    const id = o.prompt_chain_runs.prompt_chain_id;
    if (!covers.has(id)) covers.set(id, { path: o.output_image_path, width: null, height: null });
  }
  for (const i of inputs) {
    if (!covers.has(i.prompt_chain_id)) {
      covers.set(i.prompt_chain_id, { path: i.input_image_path, width: i.input_image_width, height: i.input_image_height });
    }
  }
  return covers;
}

export async function listChainSummaries(): Promise<ChainSummary[]> {
  const admin = createAdminClient();
  const [chainsRes, outputsRes, inputsRes] = await Promise.all([
    admin.from("prompt_chains").select("id, name, is_active, prompt_chain_steps(step_order, llm_models(modality))").order("name"),
    admin.from("prompt_chain_run_steps").select("output_image_path, prompt_chain_runs!inner(prompt_chain_id)")
      .eq("status", "succeeded").not("output_image_path", "is", null).order("completed_at", { ascending: false }).limit(300),
    admin.from("prompt_chain_runs").select("prompt_chain_id, input_text, input_image_path, input_image_width, input_image_height")
      .not("input_image_path", "is", null).order("created_at", { ascending: false }).limit(300),
  ]);
  [chainsRes, outputsRes, inputsRes].forEach((res) => check("collection", res.error));
  const covers = pickCovers(z.array(coverOutputRow).parse(outputsRes.data), z.array(coverInputRow).parse(inputsRes.data));
  const urls = await signRunImages(admin, [...covers.values()].map((c) => c.path));
  return z.array(summaryRow).parse(chainsRes.data).map((row) => {
    const cover = covers.get(row.id);
    return {
      id: row.id, name: row.name, isActive: row.is_active,
      trail: [...row.prompt_chain_steps].sort((a, b) => a.step_order - b.step_order).map((s) => s.llm_models?.modality ?? "text"),
      cover: cover ? signed(urls, cover.path, cover.width, cover.height) : null,
    };
  });
}
