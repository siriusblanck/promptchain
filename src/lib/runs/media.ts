import type { Modality, SignedImage } from "@/lib/chains/types";

export type MediaStepRow = {
  step_order: number; title: string; modality: Modality; status: string; output_text: string | null;
  output_image_path: string | null; latency_ms: number | null; started_at: string | null; completed_at: string | null;
};
export type MediaRunRow = {
  id: string; created_at: string; status: "running" | "succeeded" | "failed"; error_message: string | null;
  input_text: string | null; input_image_path: string | null; input_image_width: number | null; input_image_height: number | null;
  prompt_chain_run_steps: MediaStepRow[];
};
export type MediaRun = {
  id: string; createdAt: string; statusLabel: string; failed: boolean; photo: SignedImage | null;
  finalText: string | null; finalLines: string[] | null; inputText: string | null;
  trail: { order: number; title: string; status: string }[];
};

const STALE_MS = 90_000;
const NUMBERED = /^\d+[.)]\s+/;

/** "1. a\n2. b" → ["a", "b"]; null unless every non-empty line is numbered (and there are ≥ 2). */
export function splitNumbered(text: string): string[] | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length >= 2 && lines.every((l) => NUMBERED.test(l)) ? lines.map((l) => l.replace(NUMBERED, "")) : null;
}

function statusLabel(row: MediaRunRow, steps: MediaStepRow[], now: number): string {
  if (row.status === "succeeded") {
    const totalMs = steps.reduce((sum, s) => sum + (s.latency_ms ?? 0), 0);
    return `Done in ${(totalMs / 1000).toFixed(1)} s`;
  }
  if (row.status === "failed") return `Failed: ${row.error_message ?? "unknown error"}`;
  const times = [row.created_at, ...steps.flatMap((s) => [s.started_at, s.completed_at])].filter((t): t is string => Boolean(t));
  return now - Math.max(...times.map((t) => Date.parse(t))) > STALE_MS ? "Incomplete" : "Running…";
}

export function toMediaRun(row: MediaRunRow, urls: Map<string, string>, now: number): MediaRun {
  const steps = [...row.prompt_chain_run_steps].sort((a, b) => a.step_order - b.step_order);
  const done = steps.filter((s) => s.status === "succeeded");
  const lastImage = [...done].reverse().find((s) => s.output_image_path && urls.has(s.output_image_path));
  const lastText = [...done].reverse().find((s) => s.output_text);
  const inputUrl = row.input_image_path ? urls.get(row.input_image_path) : undefined;
  const photo: SignedImage | null = lastImage
    ? { url: urls.get(lastImage.output_image_path!)!, width: null, height: null }
    : inputUrl ? { url: inputUrl, width: row.input_image_width, height: row.input_image_height } : null;
  const finalText = lastText?.output_text ?? null;
  return {
    id: row.id, createdAt: row.created_at, statusLabel: statusLabel(row, steps, now), failed: row.status === "failed",
    photo, finalText, finalLines: finalText ? splitNumbered(finalText) : null, inputText: row.input_text,
    trail: steps.map((s) => ({ order: s.step_order, title: s.title, status: s.status })),
  };
}
