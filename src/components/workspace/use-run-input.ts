"use client";

import { useState } from "react";
import { prepareImage, type PreparedImage } from "@/lib/runs/prepare-image";

/** The next run's input, shared by the wall's Input card (click/drop) and the run panel. */
export type RunInput = {
  image: PreparedImage | null;
  text: string;
  preparing: boolean;
  error: string | null;
  choose: (file: File | undefined) => Promise<void>;
  setText: (text: string) => void;
  setError: (message: string | null) => void;
};

export function useRunInput(): RunInput {
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [text, setText] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return { image, text, preparing, error, choose, setText, setError };
}
