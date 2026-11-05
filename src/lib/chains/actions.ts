"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, fieldErrorsOf, ok, type ActionResult, type FormState } from "@/lib/action-result";
import { idSchema, readChainForm, readStepForm, reorderSchema } from "./schemas";
import * as repo from "./repository";

function userMessage(error: unknown): string {
  if (error instanceof repo.RepositoryError) {
    if (error.code === "22023") return "This chain changed in another tab. Reload and try again.";
    if (error.message.includes("chain_step_limit")) return "A chain can have at most 20 steps.";
    if (error.code === "23505") return "Another change landed first. Reload and try again.";
  }
  return "Couldn't save. Try again.";
}

function logged(area: string, error: unknown, context: Record<string, unknown>): string {
  console.error(`[chains] ${area} failed`, { ...context, message: (error as Error).message });
  return userMessage(error);
}

const invalid = (error: Parameters<typeof fieldErrorsOf>[0]): FormState => ({
  ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrorsOf(error),
});

export async function createChain(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = readChainForm(formData);
  if (!parsed.success) return invalid(parsed.error);
  let chainId: string;
  try {
    chainId = await repo.insertChain(createAdminClient(), parsed.data);
  } catch (error) {
    return { ok: false, error: logged("create chain", error, {}) };
  }
  revalidatePath("/");
  redirect(`/chains/${chainId}`);
}

export async function updateChain(chainId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = readChainForm(formData);
  if (!idSchema.safeParse(chainId).success) return { ok: false, error: "Unknown chain." };
  if (!parsed.success) return invalid(parsed.error);
  try {
    await repo.updateChainRow(createAdminClient(), chainId, parsed.data);
  } catch (error) {
    return { ok: false, error: logged("update chain", error, { chainId }) };
  }
  revalidatePath(`/chains/${chainId}`);
  revalidatePath("/");
  return { ok: true };
}

export async function deleteChain(chainId: string): Promise<ActionResult<null>> {
  await requireAdmin();
  if (!idSchema.safeParse(chainId).success) return fail("Unknown chain.");
  try {
    await repo.deleteChainRow(createAdminClient(), chainId);
  } catch (error) {
    return fail(logged("delete chain", error, { chainId }));
  }
  revalidatePath("/");
  redirect("/");
}

export async function saveStep(chainId: string, stepId: string | null, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = readStepForm(formData);
  const idsOk = idSchema.safeParse(chainId).success && (stepId === null || idSchema.safeParse(stepId).success);
  if (!idsOk) return { ok: false, error: "Unknown chain or step." };
  if (!parsed.success) return invalid(parsed.error);
  try {
    const admin = createAdminClient();
    if (stepId) await repo.updateStepRow(admin, stepId, parsed.data);
    else await repo.appendStep(admin, chainId, parsed.data);
  } catch (error) {
    return { ok: false, error: logged("save step", error, { chainId, stepId }) };
  }
  revalidatePath(`/chains/${chainId}`);
  return { ok: true };
}

export async function deleteStep(chainId: string, stepId: string): Promise<ActionResult<null>> {
  await requireAdmin();
  if (!idSchema.safeParse(chainId).success || !idSchema.safeParse(stepId).success) return fail("Unknown step.");
  try {
    await repo.deleteStepRow(createAdminClient(), stepId);
  } catch (error) {
    return fail(logged("delete step", error, { chainId, stepId }));
  }
  revalidatePath(`/chains/${chainId}`);
  return ok(null);
}

export async function reorderSteps(chainId: string, stepIds: string[]): Promise<ActionResult<null>> {
  await requireAdmin();
  const parsed = reorderSchema.safeParse({ chainId, stepIds });
  if (!parsed.success) return fail("That order isn't valid.");
  try {
    await repo.reorderStepRows(createAdminClient(), parsed.data.chainId, parsed.data.stepIds);
  } catch (error) {
    return fail(logged("reorder", error, { chainId }));
  }
  revalidatePath(`/chains/${chainId}`);
  return ok(null);
}
