import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MediaCard } from "@/components/media-card";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getChainName } from "@/lib/chains/queries";
import { idSchema } from "@/lib/chains/schemas";
import { toMediaRun } from "@/lib/runs/media";
import { listMediaRuns } from "@/lib/runs/repository";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Media" };

// Plain async helper (not a component), so reading the clock here is fine.
async function loadMedia(chainId: string) {
  const { runs, urls } = await listMediaRuns(createAdminClient(), chainId);
  const now = Date.now();
  return runs.map((row) => toMediaRun(row, urls, now));
}

export default async function MediaPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const name = await getChainName(id);
  if (!name) notFound();
  const media = await loadMedia(id);
  return (
    <section className="split">
      <div>
        <h1 className="display-2">Media</h1>
        <p className="lede">{name}</p>
        <p className="actions-row"><Link className="link" href={`/chains/${id}`}>← Back to chain</Link></p>
      </div>
      <div>
        <h2 className="section-title">Runs in this tool</h2>
        {media.length === 0
          ? <p className="lede">No runs yet. Run the chain to generate media.</p>
          : media.map((run) => <MediaCard key={run.id} run={run} />)}
      </div>
    </section>
  );
}
