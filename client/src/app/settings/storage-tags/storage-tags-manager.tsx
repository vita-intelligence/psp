"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorBanner } from "@/components/forms/error-banner";
import {
  createTagAction,
  deleteTagAction,
  updateTagAction,
} from "@/lib/storage-tags/actions";
import type { StorageTag } from "@/lib/types";
import type { ErrorResult } from "@/lib/errors/server";

interface ManagerProps {
  initialTags: StorageTag[];
  canEdit: boolean;
}

const KIND_OPTIONS: Array<{ value: StorageTag["kind"]; label: string }> = [
  { value: "both", label: "Both — racks and shelves" },
  { value: "location", label: "Racks/zones only" },
  { value: "cell", label: "Shelves/levels only" },
];

/** Add a tag (top form) + list existing tags with inline edit and
 *  delete. Every change goes straight to the server — there's no
 *  batched dirty buffer because tag edits are infrequent and
 *  collaborative concurrency isn't a concern here. */
export function StorageTagsManager({ initialTags, canEdit }: ManagerProps) {
  const router = useRouter();
  const [error, setError] = useState<ErrorResult | null>(null);
  const [pending, startTransition] = useTransition();

  // Create-form state — local only; clears on submit.
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<StorageTag["kind"]>("both");

  function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createTagAction({
        key: key.trim(),
        label: label.trim(),
        description: description.trim() || null,
        kind,
      });
      if (!res.ok) {
        setError(res);
        return;
      }
      toast.success("Tag added");
      setKey("");
      setLabel("");
      setDescription("");
      setKind("both");
      router.refresh();
    });
  }

  function onDelete(uuid: string, label: string) {
    if (
      !window.confirm(
        `Delete "${label}"? Locations and cells already tagged with it will keep the value but it'll be flagged as missing.`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await deleteTagAction(uuid);
      if (!res.ok) {
        setError(res);
        return;
      }
      toast.success("Tag removed");
      router.refresh();
    });
  }

  function onPatch(uuid: string, patch: Partial<StorageTag>) {
    setError(null);
    startTransition(async () => {
      const res = await updateTagAction(uuid, patch);
      if (!res.ok) {
        setError(res);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {canEdit && (
        <form
          onSubmit={onCreate}
          className="space-y-3 rounded-md border border-border/60 bg-muted/30 p-3"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Add a tag
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="t-key" className="text-xs">
                Key (machine identifier)
              </Label>
              <Input
                id="t-key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="cold-zone"
                maxLength={60}
                className="h-8 font-mono text-xs"
                required
              />
              <p className="text-[10px] text-muted-foreground">
                Lowercase letters / digits / hyphens. Allocation
                matches on this.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="t-label" className="text-xs">
                Label (shown in the picker)
              </Label>
              <Input
                id="t-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Cold zone"
                maxLength={80}
                className="h-8 text-xs"
                required
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Where it applies</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as StorageTag["kind"])}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIND_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="t-desc" className="text-xs">
                Description (optional)
              </Label>
              <Textarea
                id="t-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="text-xs"
                placeholder="What's this tag for? Helps operators pick the right one."
              />
            </div>
          </div>

          {error && (
            <ErrorBanner
              detail={error.detail}
              code={error.code}
              debug={error.debug}
            />
          )}

          <div className="flex justify-end">
            <Button
              type="submit"
              size="sm"
              disabled={pending || !key.trim() || !label.trim()}
            >
              {pending ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Plus className="mr-1.5 size-3.5" />
              )}
              Add tag
            </Button>
          </div>
        </form>
      )}

      {initialTags.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/60 px-4 py-8 text-center text-xs text-muted-foreground">
          No tags yet. Add the vocabulary your warehouse uses above —
          common starters: <span className="font-mono">pallet</span>,
          <span className="font-mono"> cold-zone</span>,
          <span className="font-mono"> hazmat-3</span>,
          <span className="font-mono"> picking</span>,
          <span className="font-mono"> quarantine</span>.
        </div>
      ) : (
        <ul className="divide-y divide-border/60 rounded-md border border-border/60">
          {initialTags.map((t) => (
            <li key={t.uuid} className="p-3">
              <TagRow tag={t} canEdit={canEdit} onPatch={onPatch} onDelete={onDelete} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TagRow({
  tag,
  canEdit,
  onPatch,
  onDelete,
}: {
  tag: StorageTag;
  canEdit: boolean;
  onPatch: (uuid: string, patch: Partial<StorageTag>) => void;
  onDelete: (uuid: string, label: string) => void;
}) {
  const [label, setLabel] = useState(tag.label);
  const [description, setDescription] = useState(tag.description ?? "");
  const [kind, setKind] = useState<StorageTag["kind"]>(tag.kind);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs text-muted-foreground">{tag.key}</p>
        </div>
        {canEdit && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onDelete(tag.uuid, tag.label)}
            className="h-7 text-xs text-destructive hover:text-destructive"
          >
            <Trash2 className="mr-1 size-3" />
            Delete
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-[11px]">Label</Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => {
              if (label.trim() && label !== tag.label) {
                onPatch(tag.uuid, { label: label.trim() });
              }
            }}
            disabled={!canEdit}
            maxLength={80}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">Where it applies</Label>
          <Select
            value={kind}
            onValueChange={(v) => {
              const next = v as StorageTag["kind"];
              setKind(next);
              if (next !== tag.kind) onPatch(tag.uuid, { kind: next });
            }}
            disabled={!canEdit}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="both">Both</SelectItem>
              <SelectItem value="location">Racks/zones only</SelectItem>
              <SelectItem value="cell">Shelves/levels only</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-[11px]">Description</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => {
              const next = description.trim() || null;
              if (next !== (tag.description ?? null)) {
                onPatch(tag.uuid, { description: next });
              }
            }}
            disabled={!canEdit}
            rows={1}
            className="text-xs"
            placeholder="(no description)"
          />
        </div>
      </div>
    </div>
  );
}
