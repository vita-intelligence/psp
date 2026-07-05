"use client";

// Minimal image lightbox. No fancy transforms — the goal is only to
// let auditors see a full-resolution artefact when they click the
// thumbnail in a comment bubble. Click backdrop / press Escape to
// close. Uses PSP's own Dialog primitive so it inherits the app's
// focus-trap + return-focus behaviour.

import { X } from "lucide-react";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

export function Lightbox({
  open,
  onOpenChange,
  src,
  alt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  alt: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[92vw] border-none bg-transparent p-0 shadow-none sm:max-w-[92vw]"
      >
        <VisuallyHidden.Root>
          <DialogTitle>{alt}</DialogTitle>
        </VisuallyHidden.Root>
        <div className="relative mx-auto inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            className="block max-h-[85vh] w-auto rounded-md object-contain shadow-2xl"
          />
          <DialogClose
            aria-label="Close preview"
            className="absolute right-2 top-2 z-10 inline-flex size-9 items-center justify-center rounded-full bg-black/60 text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <X className="size-5" aria-hidden />
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
