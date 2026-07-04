"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  EyeOff,
  Filter,
  GripVertical,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ColumnFilterEditor } from "./column-filter";
import type {
  ColumnFilterValue,
  DataTableColumn,
  SortSpec,
} from "./types";

interface DraggableHeaderProps<T> {
  column: DataTableColumn<T>;
  sort: SortSpec | null;
  onSort: (direction: "asc" | "desc" | null) => void;
  filterValue: ColumnFilterValue | null;
  onFilterChange: (value: ColumnFilterValue | null) => void;
  onHide: () => void;
}

/** Column header. Clicking anywhere in the label opens a dropdown with
 *  Sort ↑ / Sort ↓ / Filter… / Hide. The drag handle stays as a
 *  dedicated grip on the left so accidental drags don't interrupt
 *  header clicks. When a filter or sort is active, chip indicators in
 *  the header make the state visible at a glance. */
export function DraggableHeader<T>({
  column,
  sort,
  onSort,
  filterValue,
  onFilterChange,
  onHide,
}: DraggableHeaderProps<T>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: column.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isSorted = sort?.field === column.sortField;
  const SortIcon = !isSorted
    ? ChevronsUpDown
    : sort?.direction === "asc"
      ? ArrowUp
      : ArrowDown;

  const align =
    column.align === "right"
      ? "text-right justify-end"
      : column.align === "center"
        ? "text-center justify-center"
        : "text-left justify-start";

  const canSort = Boolean(column.sortField);
  const canFilter = Boolean(column.filterKind && column.filterField);
  const canHide = column.hideable !== false;
  const canOpenMenu = canSort || canFilter || canHide;
  const hasFilter = filterValue !== null;

  const sortLabels = column.sortLabels ?? { asc: "Ascending", desc: "Descending" };

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
        <button
          type="button"
          {...listeners}
          aria-label={`Reorder column ${column.header}`}
          className="cursor-grab rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-3.5" />
        </button>

        {canOpenMenu ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex items-center gap-1 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground",
                  (isSorted || hasFilter) && "text-foreground",
                )}
              >
                <span className="truncate">{column.header}</span>
                {canSort && (
                  <SortIcon
                    className={cn(
                      "size-3",
                      isSorted ? "text-foreground" : "text-muted-foreground/50",
                    )}
                  />
                )}
                {hasFilter && (
                  <span
                    className="ml-0.5 inline-block size-1.5 rounded-full bg-brand"
                    aria-label="Filter active"
                  />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {column.header}
              </DropdownMenuLabel>

              {canSort && (
                <>
                  <DropdownMenuItem onClick={() => onSort("asc")}>
                    <ArrowUp className="mr-1.5 size-3.5" aria-hidden />
                    {sortLabels.asc}
                    {isSorted && sort?.direction === "asc" && (
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        active
                      </span>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onSort("desc")}>
                    <ArrowDown className="mr-1.5 size-3.5" aria-hidden />
                    {sortLabels.desc}
                    {isSorted && sort?.direction === "desc" && (
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        active
                      </span>
                    )}
                  </DropdownMenuItem>
                  {isSorted && (
                    <DropdownMenuItem onClick={() => onSort(null)}>
                      <X className="mr-1.5 size-3.5" aria-hidden />
                      Clear sort
                    </DropdownMenuItem>
                  )}
                </>
              )}

              {canSort && canFilter && <DropdownMenuSeparator />}

              {canFilter && column.filterKind && (
                <div className="px-1.5 py-1.5">
                  <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <Filter className="size-3" aria-hidden />
                    Filter
                    {hasFilter && (
                      <button
                        type="button"
                        onClick={() => onFilterChange(null)}
                        className="ml-auto text-[10px] font-normal normal-case text-muted-foreground hover:text-foreground"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <ColumnFilterEditor
                    kind={column.filterKind}
                    value={filterValue}
                    onChange={onFilterChange}
                    options={column.filterOptions}
                    placeholder={column.filterPlaceholder ?? column.header}
                  />
                </div>
              )}

              {canHide && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onHide}>
                    <EyeOff className="mr-1.5 size-3.5" aria-hidden />
                    Hide column
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {column.header}
          </span>
        )}
      </div>
    </TableHead>
  );
}
