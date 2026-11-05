import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChainWorkspace } from "@/components/workspace/chain-workspace";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getChainDetail, listActiveModels } from "@/lib/chains/queries";
import { idSchema } from "@/lib/chains/schemas";

// advanceRun runs one Gemini step (≤55 s) plus storage; keep well above that.
export const maxDuration = 120;
export const metadata: Metadata = { title: "Chain" };

export default async function ChainPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const [chain, models] = await Promise.all([getChainDetail(id), listActiveModels()]);
  if (!chain) notFound();
  return <ChainWorkspace chain={chain} models={models} />;
}
