"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Image as ImageIcon,
  Loader2,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ErrorBanner } from "@/components/forms/error-banner";
import { invalidateAudit } from "@/lib/audit/invalidator";
import {
  deleteImageAction,
  setPrimaryImageAction,
  uploadImageAction,
} from "@/lib/item-images/actions";
import type { ErrorResult } from "@/lib/errors/server";
import type { Item, ItemImage } from "@/lib/types";

interface Props {
  item: Item;
  canEdit: boolean;
}

const ALLOWED_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PER_ITEM = 12;

export function ItemImagesSection({ item, canEdit }: Props) {
  const images = item.images ?? [];
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<ErrorResult | null>(null);

  function openPicker() {
    fileInputRef.current?.click();
  }

  function validateFile(file: File): string | null {
    if (!ALLOWED_MIMES.includes(file.type)) {
      return `Unsupported file type (${file.type || "unknown"}). Allowed: PNG, JPEG, WebP, GIF.`;
    }
    if (file.size > MAX_BYTES) {
      const mb = (file.size / 1024 / 1024).toFixed(1);
      return `File is ${mb} MB; max allowed is 5.0 MB.`;
    }
    return null;
  }

  function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setActionError(null);

    // Multi-select: walk through each file sequentially. If one fails,
    // we surface the banner and stop — partial uploads are fine, they
    // stay attached.
    startTransition(async () => {
      for (const file of Array.from(files)) {
        if (images.length >= MAX_PER_ITEM) {
          setActionError({
            ok: false,
            code: "too_many_images",
            detail: `Up to ${MAX_PER_ITEM} images per item. Delete one first.`,
            debug: {
              source: "ItemImagesSection",
              request_id: `fe-${Date.now()}`,
            },
          });
          break;
        }

        const validationError = validateFile(file);
        if (validationError) {
          setActionError({
            ok: false,
            code: "validation_failed",
            detail: validationError,
            debug: {
              source: "ItemImagesSection",
              request_id: `fe-${Date.now()}`,
            },
          });
          break;
        }

        const fd = new FormData();
        fd.append("file", file);
        const res = await uploadImageAction(item.uuid, fd);
        if (!res.ok) {
          setActionError(res);
          break;
        }
        toast.success("Image uploaded");
        invalidateAudit("item", item.id);
      }
      // Clear input so the same file can be re-picked after a delete.
      if (fileInputRef.current) fileInputRef.current.value = "";
    });
  }

  function onSetPrimary(image: ItemImage) {
    if (image.is_primary) return;
    setActionError(null);
    startTransition(async () => {
      const res = await setPrimaryImageAction(item.uuid, image.uuid);
      if (!res.ok) {
        setActionError(res);
        return;
      }
      toast.success("Primary image updated");
      invalidateAudit("item", item.id);
    });
  }

  function onDelete(image: ItemImage) {
    if (
      !window.confirm(
        `Delete "${image.original_filename ?? "this image"}"? This can't be undone.`,
      )
    ) {
      return;
    }
    setActionError(null);
    startTransition(async () => {
      const res = await deleteImageAction(item.uuid, image.uuid);
      if (!res.ok) {
        setActionError(res);
        return;
      }
      toast.success("Image removed");
      invalidateAudit("item", item.id);
    });
  }

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <ImageIcon className="size-4 text-muted-foreground" />
              Images
            </CardTitle>
            <CardDescription>
              Up to {MAX_PER_ITEM} images per item. PNG, JPEG, WebP, GIF up to
              5 MB each. The primary image is what shows on the items list.
            </CardDescription>
          </div>
          {canEdit && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={openPicker}
              disabled={pending || images.length >= MAX_PER_ITEM}
            >
              {pending ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Upload className="mr-1.5 size-3.5" />
              )}
              Upload
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_MIMES.join(",")}
          multiple
          onChange={onFileChosen}
          className="hidden"
        />

        {images.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            No images yet.
            {canEdit && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={openPicker}
                  className="text-foreground underline-offset-4 hover:underline"
                >
                  Upload the first one.
                </button>
              </>
            )}
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {images.map((image) => (
              <ImageTile
                key={image.uuid}
                image={image}
                canEdit={canEdit}
                pending={pending}
                onSetPrimary={() => onSetPrimary(image)}
                onDelete={() => onDelete(image)}
              />
            ))}
          </ul>
        )}

        {actionError && (
          <ErrorBanner
            detail={actionError.detail}
            code={actionError.code}
            debug={actionError.debug}
          />
        )}
      </CardContent>
    </Card>
  );
}

function ImageTile({
  image,
  canEdit,
  pending,
  onSetPrimary,
  onDelete,
}: {
  image: ItemImage;
  canEdit: boolean;
  pending: boolean;
  onSetPrimary: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="group relative overflow-hidden rounded-md border border-border/40 bg-muted/20">
      {image.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image.url}
          alt={image.caption ?? image.original_filename ?? "Item image"}
          className="aspect-square w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center text-xs text-muted-foreground">
          (no preview)
        </div>
      )}

      {image.is_primary && (
        <span
          className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-foreground/80 px-2 py-0.5 text-[10px] font-medium text-background"
          title="Primary image — shown on the items list"
        >
          <Star className="size-3" />
          Primary
        </span>
      )}

      {canEdit && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-black/55 px-2 py-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100">
          {!image.is_primary ? (
            <button
              type="button"
              onClick={onSetPrimary}
              disabled={pending}
              className="inline-flex items-center gap-1 text-[10px] font-medium hover:underline"
              title="Make this the primary image"
            >
              <Star className="size-3" />
              Set primary
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onDelete}
            disabled={pending}
            className="inline-flex items-center gap-1 text-[10px] font-medium text-red-200 hover:text-red-100 hover:underline"
            title="Delete this image"
          >
            <Trash2 className="size-3" />
            Delete
          </button>
        </div>
      )}
    </li>
  );
}
