"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import {
  Download,
  FileSpreadsheet,
  Mail,
  Send,
  StickyNote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PurchaseOrder } from "@/lib/types";

interface Props {
  po: PurchaseOrder;
}

// Vendor-facing finalised documents — only after director sign.
const FINAL_STATUSES: PurchaseOrder["status"][] = [
  "approved",
  "ordered",
  "partially_received",
  "received",
];

// RFQ + note live earlier — you need a quote before the PO is firm.
const RFQ_STATUSES: PurchaseOrder["status"][] = [
  "draft",
  "pending_approver",
  "pending_director",
  "approved",
  "ordered",
  "partially_received",
];

type MailKind = "po" | "rfq" | "note";

/**
 * MRPEasy-style document toolbar. Downloads are GETs to a same-origin
 * Next proxy that forwards the session bearer to Phoenix. Send buttons
 * open the user's own mail client via `mailto:` with subject + body
 * pre-filled from company-settings letterhead — no server-side send.
 */
export function PODocumentsToolbar({ po }: Props) {
  const finalReady = FINAL_STATUSES.includes(po.status);
  const rfqReady = RFQ_STATUSES.includes(po.status);

  if (!finalReady && !rfqReady) return null;

  const base = `/api/purchase-orders/${encodeURIComponent(po.uuid)}/documents`;
  const vendorEmail = po.vendor?.email ?? null;
  const noEmail = !vendorEmail;

  return (
    <section
      aria-label="Documents"
      className="rounded-lg border border-border/60 bg-card p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Documents</h2>
        <p className="text-[11px] text-muted-foreground">
          Letterhead + addresses pulled from{" "}
          <a
            href="/settings/company"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Settings &middot; Company
          </a>
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {finalReady && (
            <>
              <MailtoButton
                base={base}
                kind="po"
                icon={Send}
                label="Send PO"
                attachHref={`${base}/vendor-pdf`}
                noEmail={noEmail}
              />
              <DownloadButton
                icon={Download}
                href={`${base}/internal-pdf`}
                label="Internal PDF"
              />
              <DownloadButton
                icon={Download}
                href={`${base}/vendor-pdf`}
                label="PDF for vendor"
                emphasis
              />
            </>
          )}
          {rfqReady && (
            <MailtoButton
              base={base}
              kind="note"
              icon={StickyNote}
              label="Send note"
              attachHref={null}
              noEmail={noEmail}
            />
          )}
          {finalReady && (
            <DownloadButton
              icon={Download}
              href={`${base}/delivery-note`}
              label="Delivery note"
            />
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {rfqReady && (
            <MailtoButton
              base={base}
              kind="rfq"
              icon={Mail}
              label="Send RFQ"
              attachHref={`${base}/rfq`}
              noEmail={noEmail}
            />
          )}
          {rfqReady && (
            <DownloadButton icon={Download} href={`${base}/rfq`} label="RFQ" />
          )}
          {finalReady && (
            <DownloadButton
              icon={FileSpreadsheet}
              href={`${base}/csv`}
              label="CSV"
            />
          )}
        </div>

        {noEmail && (
          <p className="pt-1 text-[11px] text-amber-700">
            Add a primary email on{" "}
            <a
              href={po.vendor ? `/procurement/vendors/${po.vendor.uuid}` : "#"}
              className="underline underline-offset-2"
            >
              {po.vendor?.name ?? "the vendor"}
            </a>{" "}
            to enable the Send buttons.
          </p>
        )}
      </div>
    </section>
  );
}

interface DownloadButtonProps {
  icon: typeof Download;
  href: string;
  label: string;
  emphasis?: boolean;
}

function DownloadButton({
  icon: Icon,
  href,
  label,
  emphasis,
}: DownloadButtonProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={
        emphasis
          ? "inline-flex items-center gap-1.5 rounded-md bg-foreground/90 px-3 py-1.5 text-xs font-medium text-background hover:bg-foreground"
          : "inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs hover:bg-muted"
      }
    >
      <Icon className="size-3.5" />
      {label}
    </a>
  );
}

interface MailtoButtonProps {
  base: string;
  kind: MailKind;
  icon: typeof Send;
  label: string;
  /** PDF download URL to open alongside the mailto so the user can
   *  drag-attach. `null` for Send note (no attachment). */
  attachHref: string | null;
  noEmail: boolean;
}

function MailtoButton({
  base,
  kind,
  icon: Icon,
  label,
  attachHref,
  noEmail,
}: MailtoButtonProps) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (noEmail || pending) return;
    startTransition(async () => {
      try {
        const res = await fetch(`${base}/mailto/${kind}`);
        if (!res.ok) {
          toast.error("Couldn't build the email draft.");
          return;
        }
        const { to, subject, body } = (await res.json()) as {
          to: string;
          subject: string;
          body: string;
        };
        if (!to) {
          toast.error("Vendor has no primary email.");
          return;
        }
        const href = `mailto:${encodeURIComponent(
          to,
        )}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

        // Open the PDF first (new tab, downloads on click) so the user
        // can grab it for the attachment, then hand off to their mail
        // client. Two top-level navigations would lose the popup
        // permission, so the PDF goes via window.open + the mailto via
        // location.href.
        if (attachHref) {
          window.open(attachHref, "_blank", "noopener,noreferrer");
        }
        window.location.href = href;
      } catch {
        toast.error("Network error preparing email.");
      }
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={noEmail || pending}
      onClick={onClick}
      className="h-auto px-3 py-1.5 text-xs"
      title={noEmail ? "Vendor has no primary email" : "Open in your mail app"}
    >
      <Icon className="mr-1 size-3.5" />
      {pending ? "Opening…" : label}
    </Button>
  );
}

