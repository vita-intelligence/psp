// Client-side image compression for avatars (and anything else we
// want to keep under a byte budget). Resize + re-encode to JPEG so the
// payload stays well under our 500KB cap. Runs entirely in the
// browser; the server never sees the original.

interface CompressOptions {
  /** Max side length in pixels. Aspect ratio is preserved. */
  maxDimension?: number;
  /** Byte budget for the final base64 data URL. */
  maxBytes?: number;
  /** Starting JPEG quality. We step down until the budget is hit. */
  startQuality?: number;
  /** Floor — quality stops dropping below this even if oversized. */
  minQuality?: number;
}

const DEFAULTS: Required<CompressOptions> = {
  maxDimension: 512,
  maxBytes: 500 * 1024,
  startQuality: 0.92,
  minQuality: 0.5,
};

/**
 * Reads a `File`, resizes it to fit `maxDimension`, and re-encodes as
 * JPEG at progressively lower quality until the result fits in
 * `maxBytes`. Returns a base64 data URL ready to POST.
 *
 * Throws if the image can't be decoded — caller should fall back to
 * showing an error so the user can pick a different file.
 */
export async function compressImage(
  file: File,
  options: CompressOptions = {},
): Promise<string> {
  const opts = { ...DEFAULTS, ...options };
  const sourceDataUrl = await readAsDataURL(file);
  const img = await loadImage(sourceDataUrl);

  const { width, height } = fitWithin(img.width, img.height, opts.maxDimension);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  // White backdrop — transparency would be lost when we go to JPEG;
  // explicit fill avoids the default black bleed-through.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  let quality = opts.startQuality;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);

  while (byteLength(dataUrl) > opts.maxBytes && quality > opts.minQuality) {
    quality = Math.max(opts.minQuality, quality - 0.1);
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }

  return dataUrl;
}

/** Same idea but operates on an existing data URL (e.g. from FileReader). */
export async function compressDataUrl(
  source: string,
  options: CompressOptions = {},
): Promise<string> {
  const opts = { ...DEFAULTS, ...options };
  const img = await loadImage(source);
  const { width, height } = fitWithin(img.width, img.height, opts.maxDimension);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  let quality = opts.startQuality;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);

  while (byteLength(dataUrl) > opts.maxBytes && quality > opts.minQuality) {
    quality = Math.max(opts.minQuality, quality - 0.1);
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }

  return dataUrl;
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Unexpected reader result"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Read failed"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image decode failed"));
    img.src = src;
  });
}

function fitWithin(
  w: number,
  h: number,
  max: number,
): { width: number; height: number } {
  if (w <= max && h <= max) return { width: w, height: h };
  const ratio = w > h ? max / w : max / h;
  return { width: Math.round(w * ratio), height: Math.round(h * ratio) };
}

/** Approximate byte length of a data URL once the base64 is decoded. */
function byteLength(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(",");
  if (commaIdx === -1) return dataUrl.length;
  const b64 = dataUrl.slice(commaIdx + 1);
  // base64 -> raw bytes: chars * 3/4, minus padding "="
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}
