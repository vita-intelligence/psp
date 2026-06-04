"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ToolMode } from "./plan-types";
import {
  Hand,
  MousePointer2,
  Minus,
  PackageOpen,
  Square,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from "lucide-react";

interface PlanToolbarProps {
  tool: ToolMode;
  onToolChange: (next: ToolMode) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  disabled?: boolean;
}

interface ToolDef {
  id: ToolMode;
  label: string;
  icon: typeof MousePointer2;
  /** Keyboard shortcut. Surfaced in the tooltip title. */
  shortcut: string;
}

const TOOLS: ToolDef[] = [
  { id: "select", label: "Select", icon: MousePointer2, shortcut: "V" },
  { id: "pan", label: "Pan", icon: Hand, shortcut: "H" },
  { id: "wall", label: "Wall", icon: Minus, shortcut: "W" },
  { id: "room", label: "Room", icon: Square, shortcut: "R" },
  { id: "location", label: "Storage location", icon: PackageOpen, shortcut: "L" },
];

/**
 * Vertical toolbar that sits flush against the left edge of the
 * canvas. Mirrors Figma / Miro: drawing tools first, then zoom
 * controls grouped at the bottom.
 *
 * Keyboard shortcuts (V/H/W/R/L) are wired up at the editor shell
 * level — this component just shows them in tooltips.
 */
export function PlanToolbar({
  tool,
  onToolChange,
  onZoomIn,
  onZoomOut,
  onResetView,
  disabled = false,
}: PlanToolbarProps) {
  return (
    <div className="flex h-full w-12 flex-col gap-1 rounded-md border border-border/60 bg-background p-1.5 shadow-sm">
      {TOOLS.map((t) => (
        <ToolButton
          key={t.id}
          active={tool === t.id}
          disabled={disabled && t.id !== "select" && t.id !== "pan"}
          title={`${t.label} (${t.shortcut})`}
          onClick={() => onToolChange(t.id)}
        >
          <t.icon className="size-4" />
        </ToolButton>
      ))}

      <div className="mt-auto flex flex-col gap-1 border-t border-border/60 pt-1.5">
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
