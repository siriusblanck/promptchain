"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function SignInButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    if (pending) return;
    setPending(true);
    setError(null);
    const { error: authError } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (authError) {
      setError("We couldn't start sign-in. Please try again.");
      setPending(false);
    }
  }

  return (
    <div className="actions-row">
      <button className="btn btn--strong" type="button" onClick={signIn} disabled={pending} aria-busy={pending}>
        {pending ? "Opening Google…" : "Sign in with Google"}
      </button>
      {error && <p className="field__error" role="alert">{error}</p>}
    </div>
  );
}
