import type { AuditActor } from "../types";

/** Polymorphic-comment entity types. Mirror the server-side
 *  `Backend.Comments.entity_types/0` list — keep them in sync. */
export type CommentEntityType =
  | "vendor"
  | "customer"
  | "pricelist"
  | "customer_order"
  | "customer_invoice"
  | "customer_return"
  | "loyalty_program"
  | "purchase_order"
  | "stock_lot"
  | "purchase_order_line"
  | "bom"
  | "workstation_group"
  | "workstation"
  | "routing"
  | "manufacturing_order"
  | "manufacturing_order_step"
  | "shipment"
  | "equipment"
  | "hr_employee";

export type CommentVisibility = "internal" | "shared";

/** Kind of a comment attachment. `gif` is a Tenor-sourced looping
 *  animation; `voice` isn't a separate kind because voice notes are
 *  stored as `audio` with `waveform` populated. Everything else falls
 *  under the generic `file` bucket rendered as a downloadable card. */
export type CommentFileKind = "image" | "video" | "audio" | "gif" | "file";

/** One attachment on a comment. Shape mirrors the backend serializer
 *  in `Backend.Comments.file_view/1` — every field is present in the
 *  wire payload (with `null` where irrelevant) so the renderer can
 *  branch on `kind` and read exactly the fields that matter for that
 *  media type. */
export interface CommentFile {
  uuid: string;
  filename: string;
  mime: string;
  byte_size: number;
  kind: CommentFileKind;
  /** Fully-qualified URL the browser can `<img src>` / `<video src>` /
   *  fetch directly. Backend hands us a signed URL with a short TTL —
   *  DO NOT cache the URL past the current render pass. */
  url: string;
  /** Populated for `image` / `video` / `gif` so the bubble can reserve
   *  the correct aspect ratio before the pixels arrive (no layout
   *  shift). Null for `audio` / `file`. */
  width_px: number | null;
  height_px: number | null;
  /** Populated for `audio` / `video`. Milliseconds. Null for
   *  `image` / `gif` / `file`. */
  duration_ms: number | null;
  /** Base64-encoded 60-sample RMS envelope for voice notes — feeds
   *  the `<VoiceWaveform>` renderer without a decode round-trip.
   *  Null for everything except voice notes. */
  waveform: string | null;
}

/** Aggregated reaction row. One entry per emoji per comment; the
 *  `own_reacted` flag is per-viewer so different users see the same
 *  `count` but different `own_reacted`. */
export interface CommentReaction {
  emoji: string;
  count: number;
  own_reacted: boolean;
}

/** Shallow reference to a parent comment for the reply-quote chip.
 *  Small on purpose — the child bubble only needs enough context to
 *  render a one-line "replying to X: <snippet>" quote, and tapping
 *  the chip jumps to the parent (which carries the full body). */
export interface CommentParentRef {
  uuid: string;
  author_name: string;
  /** Server-truncated preview of the parent's body — safe to render
   *  as plain text (no markdown, no HTML). Backend caps this at 120
   *  chars to keep the payload small even when the parent is a huge
   *  paragraph. */
  snippet: string;
}

/** One row from `GET /api/<entity>/:uuid/comments`. */
export interface Comment {
  id: number;
  uuid: string;
  entity_type: CommentEntityType;
  entity_id: number;
  body: string;
  visibility: CommentVisibility;
  parent_comment_id: number | null;
  /** Denormalised reference to the parent comment — populated by the
   *  backend serializer so the bubble can render the reply-quote chip
   *  without an extra fetch. Null for top-level comments. */
  parent: CommentParentRef | null;
  mentioned_user_ids: number[];
  edited_at: string | null;
  created_at: string;
  updated_at: string;
  author: AuditActor | null;
  /** Zero-or-more attachments. Empty array (never null) for text-only
   *  comments so callers can `.map` unconditionally. */
  files: CommentFile[];
  /** Per-emoji reaction counts. Empty array when nobody's reacted. */
  reactions: CommentReaction[];
}
