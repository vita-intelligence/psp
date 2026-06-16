import type { AuditActor } from "../types";

/** Polymorphic-comment entity types. Mirror the server-side
 *  `Backend.Comments.entity_types/0` list — keep them in sync. */
export type CommentEntityType =
  | "vendor"
  | "purchase_order"
  | "stock_lot"
  | "purchase_order_line"
  | "bom"
  | "workstation_group"
  | "workstation";

export type CommentVisibility = "internal" | "shared";

/** One row from `GET /api/<entity>/:uuid/comments`. */
export interface Comment {
  id: number;
  uuid: string;
  entity_type: CommentEntityType;
  entity_id: number;
  body: string;
  visibility: CommentVisibility;
  parent_comment_id: number | null;
  mentioned_user_ids: number[];
  edited_at: string | null;
  created_at: string;
  updated_at: string;
  author: AuditActor | null;
}
