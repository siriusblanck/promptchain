"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import { reorderSteps } from "@/lib/chains/actions";
import { describeFlow } from "@/lib/chains/card-view";
import { moveStep } from "@/lib/chains/order";
import type { ChainDetail, LlmModel } from "@/lib/chains/types";
import { smoothScrollTo } from "@/lib/ui/smooth-scroll";
import { ChainHeader } from "./chain-header";
import { RunPanel } from "./run-panel";
import { StepEditor } from "./step-editor";
import { useChainRun } from "./use-chain-run";
import { useRunInput } from "./use-run-input";
import { Wall } from "./wall";

export function ChainWorkspace({ chain, models }: { chain: ChainDetail; models: LlmModel[] }) {
  const [steps, setOptimisticSteps] = useOptimistic(chain.steps);
  const [selected, setSelected] = useState<string | null>(null);
  // A chain that has never run opens with the run panel showing, so the next action is obvious.
  const [runOpen, setRunOpen] = useState(chain.runCount === 0 && chain.steps.length > 0);
  const [pickRequest, setPickRequest] = useState(0);
  const [openedByUser, setOpenedByUser] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const wallRef = useRef<HTMLDivElement>(null);
  const [, startMove] = useTransition();
  const run = useChainRun(chain.id, chain.steps.length);
  const input = useRunInput();
  const canRun = steps.length > 0 && !run.running;

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
    setPickRequest(0);
    setOpenedByUser(true);
    setRunOpen(!runOpen);
  }

  function openInput() {
    if (!canRun) return;
    setOpenedByUser(true);
    setRunOpen(true);
    setPickRequest((n) => n + 1);
  }

  function dropInput(file: File) {
    if (!canRun) return;
    setOpenedByUser(true);
    setRunOpen(true);
    void input.choose(file);
  }

  // After Save, Cancel or Delete in the editor, glide back up to the wall.
  function closeEditor() {
    setSelected(null);
    smoothScrollTo(wallRef.current, { duration: 700, offset: 24 });
  }

  const selectedIndex = selected === "new" ? steps.length : steps.findIndex((s) => s.id === selected);
  const editing = selected !== null && selectedIndex >= 0;

  return (
    <>
      <ChainHeader chain={chain} runOpen={runOpen} onToggleRun={toggleRun} />
      {runOpen && (
        <RunPanel stepCount={steps.length} live={run.live} running={run.running} input={input} pickRequest={pickRequest}
          scrollOnOpen={openedByUser} onStart={run.start} />
      )}
      {notice && <p className="notice" role="alert">{notice}</p>}
      <div ref={wallRef}>
        <Wall latestInput={chain.latestInput} steps={steps} live={run.live} selectedId={selected} locked={run.running} inputEnabled={canRun}
          onSelect={(id) => setSelected((current) => (current === id ? null : id))} onMove={move} onInput={openInput} onDropInput={dropInput} />
      </div>
      {editing && (
        <StepEditor key={selected} chainId={chain.id} step={selected === "new" ? null : steps[selectedIndex]}
          position={selectedIndex + 1} models={models} {...describeFlow(steps, selectedIndex)} onClose={closeEditor} />
      )}
    </>
  );
}
