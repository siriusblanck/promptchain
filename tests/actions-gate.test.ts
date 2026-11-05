import { expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => {
    throw new Error("/login?reason=restricted");
  }),
  admin: vi.fn(),
}));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: h.requireAdmin }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: h.admin }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import * as chains from "@/lib/chains/actions";
import * as runs from "@/lib/runs/actions";

const ID = "c270c3da-f5b1-47dd-8e21-b76703c91c2f";
const calls: [string, () => Promise<unknown>][] = [
  ["createChain", () => chains.createChain({ ok: false }, new FormData())],
  ["updateChain", () => chains.updateChain(ID, { ok: false }, new FormData())],
  ["deleteChain", () => chains.deleteChain(ID)],
  ["saveStep", () => chains.saveStep(ID, null, { ok: false }, new FormData())],
  ["deleteStep", () => chains.deleteStep(ID, ID)],
  ["reorderSteps", () => chains.reorderSteps(ID, [ID])],
  ["startRun", () => runs.startRun(ID, new FormData())],
  ["advanceRun", () => runs.advanceRun(ID)],
];

it.each(calls)("%s denies non-admins before creating the service-role client", async (_name, call) => {
  await expect(call()).rejects.toThrow("restricted");
  expect(h.admin).not.toHaveBeenCalled();
});
