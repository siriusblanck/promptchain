"use client";

import { useOptimistic, useState, useTransition } from "react";
import { reorderSteps } from "@/lib/chains/actions";
import { describeFlow } from "@/lib/chains/card-view";
import { moveStep } from "@/lib/chains/order";
import type { ChainDetail, LlmModel } from "@/lib/chains/types";
import { ChainHeader } from "./chain-header";
import { RunPanel } from "./run-panel";
import { StepEditor } from "./step-editor";
import { useChainRun } from "./use-chain-run";
import { Wall } from "./wall";

export function ChainWorkspace({ chain, models }: { chain: ChainDetail; models: LlmModel[] }) {
  const [steps, setOptimisticSteps] = useOptimistic(chain.steps);
  const [selected, setSelected] = useState<string | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [, startMove] = useTransition();
  const run = useChainRun(chain.id, chain.steps.length);

  function move(index: number, direction: -1 | 1) {
    const next = moveStep(steps, index, index + direction);
    setNotice(null);
    startMove(async () => {
      setOptimisticSteps(next);
      const result = await reorderSteps(chain.id, next.map((s) => s.id));
      if (!result.ok) setNotice(result.error);
    });
  }

  function toggleRun() {
    if (runOpen && !run.running) run.clear();
    setRunOpen(!runOpen);
  }

  const selectedIndex = selected === "new" ? steps.length : steps.findIndex((s) => s.id === selected);
  const editing = selected !== null && selectedIndex >= 0;

  return (
    <>
      <ChainHeader chain={chain} runOpen={runOpen} onToggleRun={toggleRun} />
      {runOpen && <RunPanel stepCount={steps.length} live={run.live} running={run.running} onStart={run.start} />}
      {notice && <p className="notice" role="alert">{notice}</p>}
      <Wall latestInput={chain.latestInput} steps={steps} live={run.live} selectedId={selected} locked={run.running}
        onSelect={(id) => setSelected((current) => (current === id ? null : id))} onMove={move} />
      {editing && (
        <StepEditor key={selected} chainId={chain.id} step={selected === "new" ? null : steps[selectedIndex]}
          position={selectedIndex + 1} models={models} {...describeFlow(steps, selectedIndex)} onClose={() => setSelected(null)} />
      )}
    </>
  );
}
