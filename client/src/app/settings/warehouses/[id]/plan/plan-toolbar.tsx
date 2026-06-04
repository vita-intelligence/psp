"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ToolMode } from "./plan-types";
import {
  ArrowUpRight,
  CircleDashed,
  Frame,
  Hand,
  Maximize2,
  Minus,
  MousePointer2,
  PackageOpen,
  Type,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

interface PlanToolbarProps {
  tool: ToolMode;
  onToolChange: (next: ToolMode) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  /** Hole tool is only enabled once an outline exists — there's
   *  nothing to cut a hole out of otherwise. */
  hasOutline: boolean;
  disabled?: boolean;
  /** Mobile layout: render as a horizontal scrollable bar instead of
   *  the vertical desktop column. */
  layout?: "vertical" | "horizontal";
}

interface ToolDef {
  id: ToolMode;
  label: string;
  icon: typeof MousePointer2;
  shortcut: string;
}

const TOOLS: ToolDef[] = [
  { id: "select", label: "Select", icon: MousePointer2, shortcut: "V" },
  { id: "pan", label: "Pan", icon: Hand, shortcut: "H" },
  { id: "wall", label: "Wall", icon: Minus, shortcut: "W" },
  { id: "outline", label: "Floor outline", icon: Frame, shortcut: "F" },
  { id: "hole", label: "Cut a hole", icon: CircleDashed, shortcut: "O" },
  { id: "location", label: "Storage location", icon: PackageOpen, shortcut: "L" },
  { id: "text", label: "Text", icon: Type, shortcut: "T" },
  { id: "arrow", label: "Arrow", icon: ArrowUpRight, shortcut: "A" },
];

/**
 * Tool palette + zoom controls. Two layouts:
 *   - `vertical`   (desktop): narrow column flush against the canvas
 *   - `horizontal` (mobile): scrollable bar pinned below the canvas
 *
 * Active tool gets a filled background; disabled tools (hole without
 * an outline, anything on a read-only floor) are dimmed.
 */
export function PlanToolbar({
  tool,
  onToolChange,
  onZoomIn,
  onZoomOut,
  onResetView,
  hasOutline,
  disabled = false,
  layout = "vertical",
}: PlanToolbarProps) {
  const isVertical = layout === "vertical";

  return (
    <div
      className={cn(
        "shrink-0 rounded-md border border-border/60 bg-background p-1.5 shadow-sm",
        isVertical
          ? "flex h-full w-12 flex-col gap-1"
          : "flex w-full flex-row gap-1 overflow-x-auto",
      )}
    >
      {TOOLS.map((t) => (
        <ToolButton
          key={t.id}
          active={tool === t.id}
          disabled={
            disabled ||
            // Hole only makes sense after we have an outline.
            (t.id === "hole" && !hasOutline)
          }
          title={`${t.label} (${t.shortcut})`}
          onClick={() => onToolChange(t.id)}
        >
          <t.icon className="size-4" />
        </ToolButton>
      ))}

      <div
        className={cn(
          isVertical
            ? "mt-auto flex flex-col gap-1 border-t border-border/60 pt-1.5"
            : "ml-auto flex flex-row gap-1 border-l border-border/60 pl-1.5",
        )}
      >
        <ToolButton title="Zoom in" onClick={onZoomIn}>
          <ZoomIn className="size-4" />
        </ToolButton>
        <ToolButton title="Zoom out" onClick={onZoomOut}>
          <ZoomOut className="size-4" />
        </ToolButton>
        <ToolButton title="Reset view" onClick={onResetView}>
          <Maximize2 className="size-4" />
        </ToolButton>
      </div>
    </div>
  );
}

function ToolButton({
  active,
  disabled,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={cn(
        "size-9 shrink-0 text-muted-foreground hover:text-foreground",
        active && "bg-foreground/10 text-foreground",
      )}
    >
      {children}
    </Button>
  );
}
