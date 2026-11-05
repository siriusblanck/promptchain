"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import type { FormState } from "@/lib/action-result";
import { deleteStep, saveStep } from "@/lib/chains/actions";
import { pad2 } from "@/lib/chains/presentation";
import type { ChainStep, LlmModel } from "@/lib/chains/types";
import { smoothScrollTo } from "@/lib/ui/smooth-scroll";

const GLIDE_MS = 800;

type Props = {
  chainId: string; step: ChainStep | null; position: number; models: LlmModel[];
  receives: string; sends: string; onClose: () => void;
};

export function StepEditor({ chainId, step, position, models, receives, sends, onClose }: Props) {
  const [count, setCount] = useState(step?.instructions.length ?? 0);
  const [confirming, setConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();
  const sectionRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // The editor opens below the wall: glide the reader down to it, then put the cursor in Title.
  useEffect(() => {
    smoothScrollTo(sectionRef.current, { duration: GLIDE_MS, offset: 24 });
    const timer = window.setTimeout(() => titleRef.current?.focus({ preventScroll: true }), GLIDE_MS + 40);
    return () => window.clearTimeout(timer);
  }, []);

  const [state, formAction, pending] = useActionState<FormState, FormData>(async (prev, formData) => {
    const result = await saveStep(chainId, step?.id ?? null, prev, formData);
    if (result.ok) onClose();
    return result;
  }, { ok: false });

  const remove = () => startDelete(async () => {
    if (!step) return;
    const result = await deleteStep(chainId, step.id);
    if (result.ok) onClose();
    else setDeleteError(result.error);
  });

  const label = pad2(position);
  return (
    <section ref={sectionRef} className="editor" aria-label={step ? `Edit step ${label}` : "New step"}>
      <div>
        <p className="eyebrow">{step ? "Editing step" : "New step"}</p>
        <h2 className="display-2">{label}<br />{step?.title ?? "Untitled step"}</h2>
        <p className="editor__flow">{receives}<br />{sends}</p>
      </div>
      <form action={formAction} noValidate>
        <label className="field">
          <span className="field__label">Title</span>
          <input ref={titleRef} className="field__input" name="title" defaultValue={step?.title ?? ""} maxLength={80} />
        </label>
        {state.fieldErrors?.title && <p className="field__error">{state.fieldErrors.title}</p>}
        <label className="field">
          <span className="field__label">Model</span>
          <select className="field__input" name="modelId" defaultValue={step?.model?.isActive ? step.model.id : ""}>
            <option value="" disabled>Choose a model</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.modality}</option>)}
          </select>
        </label>
        {state.fieldErrors?.modelId && <p className="field__error">{state.fieldErrors.modelId}</p>}
        <label className="field">
          <span className="field__label">Instructions</span>
          <textarea className="field__input" name="instructions" rows={7} maxLength={4000} defaultValue={step?.instructions ?? ""} onChange={(e) => setCount(e.target.value.length)} />
        </label>
        <p className="field__count">{count.toLocaleString("en-US")} / 4,000</p>
        {state.fieldErrors?.instructions && <p className="field__error">{state.fieldErrors.instructions}</p>}
        {state.error && <p className="notice" role="alert">{state.error}</p>}
        <div className="actions-row">
          <button className="btn btn--strong" type="submit" disabled={pending}>{pending ? "Saving…" : step ? "Save step" : "Add step"}</button>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          {step && !confirming && <button className="link link--danger" type="button" onClick={() => setConfirming(true)}>Delete step</button>}
          {step && confirming && (
            <span className="confirm">
              Delete step {label}?
              <button className="btn btn--danger" type="button" disabled={deleting} onClick={remove}>{deleting ? "Deleting…" : "Confirm"}</button>
              <button className="btn" type="button" onClick={() => setConfirming(false)}>Cancel</button>
            </span>
          )}
        </div>
        {deleteError && <p className="notice" role="alert">{deleteError}</p>}
      </form>
    </section>
  );
}
