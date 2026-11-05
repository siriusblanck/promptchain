"use client";

import { useRef } from "react";
import { inputCardView, stepCardView } from "@/lib/chains/card-view";
import { pad2 } from "@/lib/chains/presentation";
import type { ChainStep, StepOutput } from "@/lib/chains/types";
import type { LiveRun } from "@/lib/runs/live-run";
import { StepCard } from "./step-card";

type Props = {
  latestInput: StepOutput | null; steps: ChainStep[]; live: LiveRun | null; selectedId: string | null;
  locked: boolean; inputEnabled: boolean;
  onSelect: (id: string) => void; onMove: (index: number, direction: -1 | 1) => void;
  onInput: () => void; onDropInput: (file: File) => void;
};

function inputMeta(text: string | null | undefined, hasImage: boolean): string {
  if (hasImage && text) return "Image + text";
  if (hasImage) return "Image";
  return text ? "Text" : "Click or drop a photo";
}

function WallHelp({ hasSteps }: { hasSteps: boolean }) {
  if (!hasSteps) return <p className="wall-help">Start by adding a step with <strong>+</strong>, then run the chain.</p>;
  return (
    <p className="wall-help">
      Click <strong>Run chain</strong> or the <strong>Input</strong> card (or drop a photo on it) to give step 01 an image and/or
      text. Each step&apos;s output feeds the next. Click a step&apos;s tile to edit it, use <strong>← →</strong> to reorder, and <strong>+</strong> to add a step.
    </p>
  );
}

export function Wall(props: Props) {
  const { latestInput, steps, live, selectedId, locked, inputEnabled, onSelect, onMove, onInput, onDropInput } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const scroll = (direction: -1 | 1) => scroller.current?.scrollBy({ left: direction * 480, behavior: "smooth" });
  const input = live ? { text: live.input.text, hasImage: Boolean(live.input.previewUrl) } : { text: latestInput?.text, hasImage: Boolean(latestInput?.image) };
  const inputTitle = live ? "This run's input" : latestInput ? "Latest input" : "Add input";

  return (
    <section aria-label="Prompt chain steps">
      <div className="wall-bar">
        <WallHelp hasSteps={steps.length > 0} />
        <div className="wall-bar__arrows">
          <button type="button" onClick={() => scroll(-1)} aria-label="Scroll the wall left">←</button>
          <button type="button" onClick={() => scroll(1)} aria-label="Scroll the wall right">→</button>
        </div>
      </div>
      <div className="wall" ref={scroller}>
        <StepCard label="Input" tileNumber="In" title={inputTitle} meta={inputMeta(input.text, input.hasImage)}
          view={inputCardView(latestInput, live)} done={Boolean(live && live.state !== "starting")} hollow={false}
          onSelect={inputEnabled ? onInput : undefined} onDropFile={inputEnabled ? onDropInput : undefined}
          actionLabel="Add a photo or text and run the chain" />
        {steps.map((step, index) => {
          const status = live?.steps[index]?.status;
          const meta = step.model ? `${step.model.name}${step.model.isActive ? "" : " (inactive)"}` : "No model chosen";
          return (
            <StepCard key={step.id} label={pad2(index + 1)} title={step.title} meta={meta} view={stepCardView(step, index, live)}
              done={status === "succeeded"} hollow={status === "pending"} selected={selectedId === step.id} onSelect={() => onSelect(step.id)}
              moves={
                <div className="moves">
                  <button type="button" className="moves__btn" disabled={locked || index === 0} onClick={() => onMove(index, -1)} aria-label={`Move step ${index + 1} earlier`}>←</button>
                  <button type="button" className="moves__btn" disabled={locked || index === steps.length - 1} onClick={() => onMove(index, 1)} aria-label={`Move step ${index + 1} later`}>→</button>
                </div>
              } />
          );
        })}
        <div className="wall__col">
          <button type="button" className="add-tile" aria-pressed={selectedId === "new"} disabled={steps.length >= 20} onClick={() => onSelect("new")} aria-label="Add a step">+</button>
        </div>
      </div>
    </section>
  );
}
