"use client";

/**
 * One entry point every photo-capture site funnels through before
 * appending the file to a ``FormData`` and POSTing it. Runs JPEG /
 * PNG / WebP inputs through :func:`compressImageToFile` (1600px
 * longest side, ~600 KB budget) so operator-uplink bandwidth AND
 * long-term evidence storage costs both come down. Non-image inputs
 * (PDFs, docs — e.g. inspection wizard's CoA uploads) are passed
 * through untouched.
 *
 * Silent fallback: if compression throws (browser without canvas,
 * corrupt file, HEIC without decoder), the original file goes up.
 * Operators are usually finalising a step under time pressure —
 * blocking on a compression fault would be worse than an uncompressed
 * upload.
 *
 * Wire this into every new upload site instead of appending the raw
 * ``File`` to ``FormData`` directly. The 12 existing photo capture
 * paths (goods-in inspection, closeout, return-pickup, mo-pickup,
 * lot-move desktop/mobile, item images, shipment dispatch, 3PL
 * dispatch, shipment detail file attach, final-release capture) all
 * migrated to this helper in the same PR that shipped it.
 */

import { compressImageToFile } from "@/lib/image-compress";


export async function preparePhotoForUpload(file: File): Promise<File> {
  const mime = (file.type || "").toLowerCase();
  const isImage =
    mime.startsWith("image/") &&
    // HEIC / HEIF often can't be decoded by canvas without a
    // dedicated decoder; skip compression so the raw file rides
    // through. Server-side re-encode is a separate future task.
    !mime.includes("heic") &&
    !mime.includes("heif");

  if (!isImage) return file;

  try {
    return await compressImageToFile(file);
  } catch (err) {
    // Compression is a best-effort optimisation; never block a
    // legitimate upload because canvas / toBlob glitched.
    console.warn(
      "[upload] photo compression failed; uploading original",
      err,
    );
    return file;
  }
}
