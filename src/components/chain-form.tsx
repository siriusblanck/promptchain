"use client";

import { useActionState } from "react";
import type { FormState } from "@/lib/action-result";
import { createChain, updateChain } from "@/lib/chains/actions";

type Values = { name: string; description: string | null; isActive: boolean };
type Props =
  | { mode: "create" }
  | { mode: "edit"; chainId: string; values: Values; onDone: () => void; onCancel: () => void };

const EMPTY: Values = { name: "", description: null, isActive: true };

export function ChainForm(props: Props) {
  const values = props.mode === "edit" ? props.values : EMPTY;
  const [state, formAction, pending] = useActionState<FormState, FormData>(async (prev, formData) => {
    if (props.mode === "create") return createChain(prev, formData);
    const result = await updateChain(props.chainId, prev, formData);
    if (result.ok) props.onDone();
    return result;
  }, { ok: false });

  return (
    <form action={formAction} noValidate>
      <label className="field">
        <span className="field__label">Name</span>
        <input className="field__input" name="name" defaultValue={values.name} maxLength={120} aria-invalid={Boolean(state.fieldErrors?.name)} />
      </label>
      {state.fieldErrors?.name && <p className="field__error">{state.fieldErrors.name}</p>}
      <label className="field">
        <span className="field__label">Description</span>
        <textarea className="field__input" name="description" defaultValue={values.description ?? ""} maxLength={600} rows={3} />
      </label>
      {state.fieldErrors?.description && <p className="field__error">{state.fieldErrors.description}</p>}
      <label className="check">
        <input type="checkbox" name="isActive" defaultChecked={values.isActive} /> Active
      </label>
      {state.error && <p className="notice" role="alert">{state.error}</p>}
      <div className="actions-row">
        <button className="btn btn--strong" type="submit" disabled={pending}>
          {pending ? "Saving…" : props.mode === "create" ? "Create chain" : "Save details"}
        </button>
        {props.mode === "edit" && <button className="btn" type="button" onClick={props.onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
