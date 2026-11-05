export type PreparedImage = { blob: Blob; width: number; height: number; previewUrl: string };

const MAX_EDGE = 1600;
const MAX_BYTES = 4 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Downscales in the browser so uploads stay under Vercel's 4.5 MB request cap. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!TYPES.has(file.type)) throw new Error("Use a JPG, PNG or WebP image.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser can't resize images.");
  context.fillStyle = "#ffffff"; // flatten transparency before JPEG encoding
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't encode the image."))), "image/jpeg", 0.85),
  );
  if (blob.size > MAX_BYTES) throw new Error("That image is still over 4 MB after resizing.");
  return { blob, width, height, previewUrl: URL.createObjectURL(blob) };
}
