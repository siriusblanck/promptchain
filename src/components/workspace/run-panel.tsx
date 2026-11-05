"use client";

import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { runningStepNumber, type LiveRun } from "@/lib/runs/live-run";
import { smoothScrollTo } from "@/lib/ui/smooth-scroll";
import type { RunRequest } from "./use-chain-run";
import type { RunInput } from "./use-run-input";

function statusLine(live: LiveRun, total: number): string | null {
  if (live.state === "starting") return "Starting…";
  if (live.state === "running") return `Running step ${runningStepNumber(live)} of ${total}…`;
  if (live.state === "succeeded") return "Done. The outputs are on the wall.";
  return live.message;
}

const droppedImage = (event: DragEvent) => Array.from(event.dataTransfer.files).find((f) => f.type.startsWith("image/"));

type Props = {
  stepCount: number; live: LiveRun | null; running: boolean; input: RunInput;
  /** Incremented when the wall's Input card is clicked: the panel opens the photo picker. */
  pickRequest: number;
  /** False only for the automatic open on a never-run chain, which is already in view. */
  scrollOnOpen: boolean;
  onStart: (request: RunRequest) => void;
};

export function RunPanel({ stepCount, live, running, input, pickRequest, scrollOnOpen, onStart }: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollOnMount = useRef(scrollOnOpen);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (scrollOnMount.current) smoothScrollTo(panelRef.current, { duration: 650, offset: 24 });
  }, []);

  useEffect(() => {
    if (pickRequest === 0) return;
    smoothScrollTo(panelRef.current, { duration: 650, offset: 24 });
    fileRef.current?.click();
  }, [pickRequest]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!input.image && !input.text.trim()) return input.setError("Add an image or some text.");
    input.setError(null);
    onStart({ image: input.image, text: input.text });
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (running) return;
    const file = droppedImage(event);
    if (!file) return input.setError("Drop a JPG, PNG or WebP image.");
    void input.choose(file);
  }

  const { image, preparing } = input;
  const status = live ? statusLine(live, stepCount) : null;
  return (
    <section ref={panelRef} aria-label="Run this chain" className={`run-panel${dragging ? " run-panel--dragging" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}>
      <div>
        <h2 className="display-3">Run this chain</h2>
        <p>Step 01 receives your photo and/or text. Each step&apos;s output becomes the next step&apos;s input.</p>
      </div>
      <form onSubmit={submit}>
        <label className="drop">
          {image && <img src={image.previewUrl} alt="Selected input" />}
          <span>
            {image ? `${image.width} × ${image.height} · ${(image.blob.size / 1024 / 1024).toFixed(1)} MB` : preparing ? "Preparing image…" : "Drop a photo here, or click to choose (JPG, PNG or WebP)"}
            <br /><u>{image ? "Replace" : "Browse"}</u>
          </span>
          <input ref={fileRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={running}
            onChange={(e) => input.choose(e.target.files?.[0])} />
        </label>
        <label className="field">
          <span className="field__label">Text for step 01 (optional)</span>
          <textarea className="field__input" rows={2} maxLength={2000} value={input.text} disabled={running} onChange={(e) => input.setText(e.target.value)} />
        </label>
        {input.error && <p className="notice" role="alert">{input.error}</p>}
        <div className="actions-row">
          <button className="btn btn--strong" type="submit" disabled={running || preparing}>
            {running ? "Running…" : `Run ${stepCount} ${stepCount === 1 ? "step" : "steps"} →`}
          </button>
        </div>
        {status && <p className="run-status" role="status">{status}</p>}
      </form>
    </section>
  );
}
