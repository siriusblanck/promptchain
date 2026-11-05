import type { CSSProperties } from "react";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-admin";
import { describeTrail, ratioOf, tileColor } from "@/lib/chains/presentation";
import { listChainSummaries } from "@/lib/chains/queries";

export default async function CollectionPage() {
  await requireAdmin();
  const chains = await listChainSummaries();
  const active = chains.filter((chain) => chain.isActive).length;
  return (
    <section className="split">
      <div>
        <h1 className="display-2">Prompt chains in the collection</h1>
        <p className="lede">{chains.length} chains · {active} active</p>
        <p className="actions-row"><Link className="link" href="/chains/new">+ New chain →</Link></p>
      </div>
      <ul className="collection-grid">
        {chains.map((chain, index) => (
          <li key={chain.id} style={{ "--i": index } as CSSProperties}>
            <Link className="chain-card" href={`/chains/${chain.id}`}>
              <div className="chain-card__cover">
                {chain.cover ? (
                  <img src={chain.cover.url} alt="" style={{ aspectRatio: ratioOf(chain.cover) }} />
                ) : (
                  <span className={`tile tile--${tileColor(index)}`}>
                    <span className="tile__n">{chain.trail.length}</span>
                    <span className="tile__q">{chain.trail.length === 1 ? "step" : "steps"}</span>
                  </span>
                )}
              </div>
              <p className="card-title">{chain.name}</p>
              <p className="card-meta">{describeTrail(chain.trail)}{chain.isActive ? "" : " · Inactive"}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
