import type { Modality, SignedImage } from "./types";

const TILE_COLORS = ["cyan", "lime", "orange", "mint"] as const;
export type TileColor = (typeof TILE_COLORS)[number];

export const tileColor = (index: number): TileColor => TILE_COLORS[((index % 4) + 4) % 4];
export const pad2 = (n: number) => String(n).padStart(2, "0");

export function snippet(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function describeTrail(trail: readonly Modality[]): string {
  if (trail.length === 0) return "No steps yet";
  const runs = trail.filter((m, i) => i === 0 || m !== trail[i - 1]);
  return `${trail.length} ${trail.length === 1 ? "step" : "steps"} · ${runs.join(" → ")}`;
}

export const ratioOf = (image: SignedImage) =>
  image.width && image.height ? `${image.width} / ${image.height}` : "3 / 4";
