"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, ChevronsUpDown, GripVertical } from "lucide-react";
import type { DataTableColumn, SortSpec } from "./types";

interface DraggableHeaderProps<T> {
  column: DataTableColumn<T>;
  sort: SortSpec | null;
  onSort: () => void;
}

/** A column header that drags to reorder and clicks to toggle sort
 *  (when `sortField` is set). The drag handle is the GripVertical
 *  icon so accidental drags don't interrupt sort clicks. */
export function DraggableHeader<T>({
  column,
  sort,
  onSort,
}: DraggableHeaderProps<T>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: column.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isSorted = sort?.field === column.sortField;
  const SortIcon =
    !isSorted ? ChevronsUpDown : sort?.direction === "asc" ? ArrowUp : ArrowDown;

  const align =
    column.align === "right"
      ? "text-right justify-end"
      : column.align === "center"
        ? "text-center justify-center"
        : "text-left justify-start";

  return (
    <TableHead
      ref={setNodeRef}
      style={style}
      className={cn(
        "select-none",
        column.widthClassName,
        isDragging && "z-10 bg-muted/60 shadow-sm",
      )}
      {...attributes}
    >
      <div className={cn("flex items-center gap-1", align)}>
        {/* Drag handle — small, only the icon area triggers drag so
            the header text + sort click area remain crisp. */}
        <button
          type="button"
          {...listeners}
          aria-label={`Reorder column ${column.header}`}
          className="cursor-grab rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-3.5" />
        </button>

        {column.sortField ? (
          <button
            type="button"
            onClick={onSort}
            className="inline-flex items-center gap-1 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
          >
            <span className="truncate">{column.header}</span>
            <SortIcon
              className={cn(
                "size-3",
                isSorted ? "text-foreground" : "text-muted-foreground/50",
              )}
            />
          </button>
        ) : (
          <span className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {column.header}
          </span>
        )}
      </div>
    </TableHead>
  );
}
