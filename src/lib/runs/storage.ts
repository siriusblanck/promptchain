import "server-only";

import type { AdminClient } from "@/lib/supabase/admin";

export const RUN_BUCKET = "chain-runs";
const SIGNED_URL_TTL_S = 60 * 60;

export const extFromMime = (mime: string) => (mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg");
const mimeFromPath = (path: string) =>
  path.endsWith(".png") ? "image/png" : path.endsWith(".webp") ? "image/webp" : "image/jpeg";

export async function uploadRunImage(admin: AdminClient, path: string, bytes: Blob | Buffer, contentType: string) {
  const { error } = await admin.storage.from(RUN_BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(`upload failed for ${path}: ${error.message}`);
}

export async function downloadRunImage(admin: AdminClient, path: string) {
  const { data, error } = await admin.storage.from(RUN_BUCKET).download(path);
  if (error || !data) throw new Error(`download failed for ${path}: ${error?.message ?? "empty"}`);
  const base64 = Buffer.from(await data.arrayBuffer()).toString("base64");
  return { mimeType: data.type || mimeFromPath(path), base64 };
}

/** Signs many paths in one request; unsigned paths are simply absent from the map. */
export async function signRunImages(admin: AdminClient, paths: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths)];
  if (unique.length === 0) return new Map();
  const { data, error } = await admin.storage.from(RUN_BUCKET).createSignedUrls(unique, SIGNED_URL_TTL_S);
  if (error || !data) {
    console.error("[storage] signing failed", { count: unique.length, message: error?.message });
    return new Map();
  }
  return new Map(data.flatMap((d) => (d.path && d.signedUrl ? [[d.path, d.signedUrl] as const] : [])));
}

/** Best effort: rows are already gone, so failures are logged, never thrown. */
export async function removeRunFolders(admin: AdminClient, runIds: readonly string[]) {
  for (const runId of runIds) {
    const { data, error } = await admin.storage.from(RUN_BUCKET).list(runId);
    if (error) {
      console.error("[storage] list failed", { runId, message: error.message });
      continue;
    }
    const paths = (data ?? []).map((file) => `${runId}/${file.name}`);
    if (paths.length === 0) continue;
    const { error: removeError } = await admin.storage.from(RUN_BUCKET).remove(paths);
    if (removeError) console.error("[storage] remove failed", { runId, message: removeError.message });
  }
}
