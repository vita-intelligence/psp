"use client";

// Minimal image lightbox. No fancy transforms — the goal is only to
// let auditors see a full-resolution artefact when they click the
// thumbnail in a comment bubble. Click backdrop / press Escape to
// close. Uses PSP's own Dialog primitive so it inherits the app's
// focus-trap + return-focus behaviour.

import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

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
        showCloseButton
        className="max-w-[92vw] border-none bg-transparent p-0 shadow-none sm:max-w-[92vw]"
      >
        <VisuallyHidden.Root>
          <DialogTitle>{alt}</DialogTitle>
        </VisuallyHidden.Root>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className="mx-auto max-h-[85vh] w-auto rounded-md object-contain shadow-2xl"
        />
      </DialogContent>
    </Dialog>
  );
}
