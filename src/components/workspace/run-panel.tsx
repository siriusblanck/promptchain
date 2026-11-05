"use client";

import { useState, type FormEvent } from "react";
import { prepareImage, type PreparedImage } from "@/lib/runs/prepare-image";
import { runningStepNumber, type LiveRun } from "@/lib/runs/live-run";
import type { RunRequest } from "./use-chain-run";

function statusLine(live: LiveRun, total: number): string | null {
  if (live.state === "starting") return "Starting…";
  if (live.state === "running") return `Running step ${runningStepNumber(live)} of ${total}…`;
  if (live.state === "succeeded") return "Done. The outputs are on the wall.";
  return live.message;
}

type Props = { stepCount: number; live: LiveRun | null; running: boolean; onStart: (request: RunRequest) => void };

export function RunPanel({ stepCount, live, running, onStart }: Props) {
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  async function choose(file: File | undefined) {
    if (!file) return;
    setError(null);
    setPreparing(true);
    try {
      setImage(await prepareImage(file));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPreparing(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!image && !text.trim()) return setError("Add an image or some text.");
    setError(null);
    onStart({ image, text });
  }

  const status = live ? statusLine(live, stepCount) : null;
  return (
    <section className="run-panel" aria-label="Run this chain">
      <div>
        <h2 className="display-3">Run this chain</h2>
        <p>Step 01 receives your image and text. Each step&apos;s output becomes the next step&apos;s input.</p>
      </div>
      <form onSubmit={submit}>
        <label className="drop">
          {image && <img src={image.previewUrl} alt="Selected input" />}
          <span>
            {image ? `${image.width} × ${image.height} · ${(image.blob.size / 1024 / 1024).toFixed(1)} MB` : preparing ? "Preparing image…" : "Choose an image (JPG, PNG or WebP)"}
            <br /><u>{image ? "Replace" : "Browse"}</u>
          </span>
          <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={running} onChange={(e) => choose(e.target.files?.[0])} />
        </label>
        <label className="field">
          <span className="field__label">Text for step 01 (optional)</span>
          <textarea className="field__input" rows={2} maxLength={2000} value={text} disabled={running} onChange={(e) => setText(e.target.value)} />
        </label>
        {error && <p className="notice" role="alert">{error}</p>}
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
