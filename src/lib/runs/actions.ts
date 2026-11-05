"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { pad2 } from "@/lib/chains/presentation";
import { buildGeminiCall, hasInput, stepInput, TEXT_TIMEOUT_MS, type ClaimedStep } from "./plan";
import { mapGeminiError, mapRunStartError } from "./errors";
import { createGeminiClient, type GeminiOutput } from "./gemini";
import { downloadRunImage, extFromMime, RUN_BUCKET, signRunImages, uploadRunImage } from "./storage";
import * as runs from "./repository";
import type { AdvanceResult } from "./live-run";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const dimension = z.coerce.number().int().min(1).max(20000).nullable();
const startSchema = z.object({
  chainId: z.guid(),
  text: z.string().trim().max(2000, "Keep the text under 2,000 characters").transform((v) => (v === "" ? null : v)),
  width: dimension,
  height: dimension,
});

function readImage(formData: FormData): File | null | "invalid" {
  const value = formData.get("image");
  if (!(value instanceof File) || value.size === 0) return null;
  return IMAGE_TYPES.has(value.type) && value.size <= MAX_IMAGE_BYTES ? value : "invalid";
}

export async function startRun(chainId: string, formData: FormData): Promise<ActionResult<{ runId: string }>> {
  const { user } = await requireAdmin();
  const image = readImage(formData);
  const parsed = startSchema.safeParse({
    chainId, text: formData.get("text") ?? "", width: formData.get("width") || null, height: formData.get("height") || null,
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the run input.");
  if (image === "invalid") return fail("Use a JPG, PNG or WebP image under 4 MB.");
  if (!image && !parsed.data.text) return fail("Add an image or some text.");

  const admin = createAdminClient();
  const runId = randomUUID();
  const imagePath = image ? `${runId}/input.${extFromMime(image.type)}` : null;
  try {
    if (image && imagePath) await uploadRunImage(admin, imagePath, image, image.type);
    await runs.createRun(admin, {
      runId, chainId: parsed.data.chainId, userId: user.id, text: parsed.data.text, imagePath,
      width: image ? parsed.data.width : null, height: image ? parsed.data.height : null,
    });
  } catch (error) {
    const message = (error as Error).message;
    console.error("[runs] start failed", { chainId, message });
    if (imagePath) await admin.storage.from(RUN_BUCKET).remove([imagePath]);
    return fail(mapRunStartError(message));
  }
  return ok({ runId });
}

export async function advanceRun(runId: string): Promise<ActionResult<AdvanceResult>> {
  await requireAdmin();
  if (!z.guid().safeParse(runId).success) return fail("Unknown run.");
  const admin = createAdminClient();
  let claim: runs.Claim;
  try {
    claim = await runs.claimNextStep(admin, runId);
  } catch (error) {
    console.error("[runs] claim failed", { runId, message: (error as Error).message });
    return fail("Couldn't continue the run. Try again.");
  }
  if (claim.state !== "claimed") return ok({ state: claim.state, step: null });
  return ok(await executeStep(admin, runId, claim));
}

async function executeStep(admin: AdminClient, runId: string, claim: runs.ClaimedRun): Promise<AdvanceResult> {
  const { step } = claim;
  const input = stepInput(claim.runInput, claim.previous);
  if (!hasInput(input)) return failWith(admin, runId, step, `Step ${pad2(step.stepOrder)} received no input.`, 0);
  const started = Date.now();
  let timeoutMs = TEXT_TIMEOUT_MS;
  let output: GeminiOutput;
  try {
    const image = input.imagePath ? await downloadRunImage(admin, input.imagePath) : null;
    const call = buildGeminiCall(step, { text: input.text, image });
    timeoutMs = call.timeoutMs;
    output = await createGeminiClient().generate(call);
  } catch (error) {
    const mapped = mapGeminiError(error, step.stepOrder, timeoutMs);
    console.error("[runs] step failed", {
      runId, stepOrder: step.stepOrder, model: step.modelIdentifier, latencyMs: Date.now() - started, code: mapped.code,
    });
    return failWith(admin, runId, step, mapped.message, Date.now() - started);
  }
  return saveOutput(admin, runId, claim, output, Date.now() - started);
}

async function saveOutput(admin: AdminClient, runId: string, claim: runs.ClaimedRun, output: GeminiOutput, latencyMs: number): Promise<AdvanceResult> {
  const { step } = claim;
  try {
    const imagePath = "image" in output ? `${runId}/step-${pad2(step.stepOrder)}.${extFromMime(output.image.mimeType)}` : null;
    if ("image" in output && imagePath) await uploadRunImage(admin, imagePath, output.image.bytes, output.image.mimeType);
    const text = "text" in output ? output.text.slice(0, 20000) : null;
    await runs.completeStep(admin, step.id, { text, imagePath, latencyMs });
    if (claim.isLast) await runs.completeRun(admin, runId);
    const urls = imagePath ? await signRunImages(admin, [imagePath]) : new Map<string, string>();
    return {
      state: claim.isLast ? "succeeded" : "running",
      step: { stepOrder: step.stepOrder, status: "succeeded", text, imageUrl: imagePath ? urls.get(imagePath) ?? null : null, error: null, latencyMs },
    };
  } catch (error) {
    console.error("[runs] saving output failed", { runId, stepOrder: step.stepOrder, message: (error as Error).message });
    return failWith(admin, runId, step, `Step ${pad2(step.stepOrder)}: couldn't save the output. Try again.`, latencyMs);
  }
}

async function failWith(admin: AdminClient, runId: string, step: ClaimedStep, message: string, latencyMs: number): Promise<AdvanceResult> {
  try {
    await runs.failStep(admin, runId, step.id, message, latencyMs);
  } catch (error) {
    console.error("[runs] recording failure failed", { runId, message: (error as Error).message });
  }
  return { state: "failed", step: { stepOrder: step.stepOrder, status: "failed", text: null, imageUrl: null, error: message, latencyMs } };
}
