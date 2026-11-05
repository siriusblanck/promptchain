"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ChainForm } from "@/components/chain-form";
import { deleteChain } from "@/lib/chains/actions";
import type { ChainDetail } from "@/lib/chains/types";

type Props = { chain: ChainDetail; runOpen: boolean; onToggleRun: () => void };

export function ChainHeader({ chain, runOpen, onToggleRun }: Props) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();
  const steps = chain.steps.length;

  if (editing) {
    const values = { name: chain.name, description: chain.description, isActive: chain.isActive };
    return <ChainForm mode="edit" chainId={chain.id} values={values} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />;
  }

  const remove = () => startDelete(async () => {
    const result = await deleteChain(chain.id);
    if (!result.ok) setError(result.error);
  });

  return (
    <header className="chain-head">
      <div>
        <p className="crumb"><Link href="/">Collection</Link> / <strong>{chain.name}</strong></p>
        <h1 className="display-1">{chain.name}</h1>
        <p className="chain-head__meta">
          {chain.description ? `${chain.description} · ` : ""}<strong>{chain.isActive ? "Active" : "Inactive"}</strong> · {steps} {steps === 1 ? "step" : "steps"}
        </p>
      </div>
      <div className="chain-head__actions">
        <button className="btn btn--primary" type="button" onClick={onToggleRun} disabled={steps === 0} aria-expanded={runOpen}>Run chain</button>
        <button className="btn" type="button" onClick={() => setEditing(true)}>Edit details</button>
        {confirming ? (
          <span className="confirm">
            Delete chain and its {chain.runCount} runs?
            <button className="btn btn--danger" type="button" disabled={deleting} onClick={remove}>{deleting ? "Deleting…" : "Confirm"}</button>
            <button className="btn" type="button" onClick={() => setConfirming(false)}>Cancel</button>
          </span>
        ) : (
          <button className="btn" type="button" onClick={() => setConfirming(true)}>Delete</button>
        )}
        <Link className="link" href={`/chains/${chain.id}/media`}>View media ({chain.runCount}) →</Link>
      </div>
      {error && <p className="notice" role="alert">{error}</p>}
    </header>
  );
}
