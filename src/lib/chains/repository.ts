import "server-only";

import { z } from "zod";
import type { AdminClient } from "@/lib/supabase/admin";
import { removeRunFolders } from "@/lib/runs/storage";
import type { ChainFormInput, StepFormInput } from "./schemas";

export class RepositoryError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

const raise = (error: { message: string; code?: string } | null) => {
  if (error) throw new RepositoryError(error.message, error.code);
};
const chainColumns = (input: ChainFormInput) => ({ name: input.name, description: input.description, is_active: input.isActive });

export async function insertChain(admin: AdminClient, input: ChainFormInput): Promise<string> {
  const { data, error } = await admin.from("prompt_chains").insert(chainColumns(input)).select("id").single();
  raise(error);
  return z.object({ id: z.guid() }).parse(data).id;
}

export async function updateChainRow(admin: AdminClient, chainId: string, input: ChainFormInput) {
  const { error } = await admin.from("prompt_chains").update(chainColumns(input)).eq("id", chainId);
  raise(error);
}

export async function deleteChainRow(admin: AdminClient, chainId: string) {
  const { data: runs, error: runsError } = await admin.from("prompt_chain_runs").select("id").eq("prompt_chain_id", chainId);
  raise(runsError);
  const { error } = await admin.from("prompt_chains").delete().eq("id", chainId);
  raise(error);
  await removeRunFolders(admin, z.array(z.object({ id: z.guid() })).parse(runs ?? []).map((r) => r.id));
}

export async function appendStep(admin: AdminClient, chainId: string, input: StepFormInput): Promise<string> {
  const { data, error } = await admin.rpc("append_prompt_chain_step", {
    p_chain_id: chainId, p_title: input.title, p_instructions: input.instructions, p_model_id: input.modelId,
  });
  raise(error);
  return z.guid().parse(data);
}

export async function updateStepRow(admin: AdminClient, stepId: string, input: StepFormInput) {
  const { error } = await admin.from("prompt_chain_steps")
    .update({ title: input.title, instructions: input.instructions, llm_model_id: input.modelId }).eq("id", stepId);
  raise(error);
}

export async function deleteStepRow(admin: AdminClient, stepId: string) {
  const { error } = await admin.rpc("delete_prompt_chain_step", { p_step_id: stepId });
  raise(error);
}

export async function reorderStepRows(admin: AdminClient, chainId: string, stepIds: readonly string[]) {
  const { error } = await admin.rpc("reorder_prompt_chain_steps", { p_chain_id: chainId, p_step_ids: stepIds });
  raise(error);
}
