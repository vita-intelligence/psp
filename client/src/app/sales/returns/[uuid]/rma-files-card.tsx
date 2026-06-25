"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  CompanyDefaults,
  CustomerReturn,
  CustomerReturnFileKind,
  CustomerReturnFileRow,
} from "@/lib/types";
import {
  removeRMAFileAction,
  uploadRMAFileAction,
} from "@/lib/customer-returns/actions";
import { formatCompanyDate } from "@/lib/format/company";

interface Props {
  rma: CustomerReturn;
  canEdit: boolean;
  canDelete: boolean;
  prefs: CompanyDefaults;
}

const KIND_OPTIONS: Array<{ value: CustomerReturnFileKind; label: string }> = [
  { value: "photo", label: "Photo" },
  { value: "doc", label: "Document" },
];

export function RMAFilesCard({ rma, canEdit, canDelete, prefs }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [kind, setKind] = useState<CustomerReturnFileKind>("photo");
  const [pending, startTransition] = useTransition();

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    startTransition(async () => {
      const res = await uploadRMAFileAction(rma.uuid, file, kind);
      if (res.ok) {
        toast.success("File uploaded");
        router.refresh();
      } else {
        toast.error(res.detail);
      }
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  function remove(file: CustomerReturnFileRow) {
    if (!confirm(`Remove "${file.filename}"?`)) return;
    startTransition(async () => {
      const res = await removeRMAFileAction(rma.uuid, file.uuid);
      if (res.ok) {
        toast.success("File removed");
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  const files = rma.files ?? [];

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Paperclip className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold tracking-tight">Evidence</h2>
          <span className="text-[11px] text-muted-foreground">
            {files.length}
          </span>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Select
              value={kind}
              onValueChange={(v) => setKind(v as CustomerReturnFileKind)}
            >
              <SelectTrigger className="h-8 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={onFileChange}
              accept=".pdf,image/*,.doc,.docx,.xls,.xlsx,.txt"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={pending}
            >
              {pending ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Upload className="mr-1.5 size-4" />
              )}
              Upload
            </Button>
          </div>
        )}
      </header>

      {files.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground">
          No evidence yet. Photos of damaged goods and any supporting
          documents (delivery notes, customer emails) live here for the
          audit trail.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {files.map((f) => {
            const Icon = f.kind === "photo" ? ImageIcon : FileText;
            return (
              <li
                key={f.uuid}
                className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-card/60 px-3 py-2"
              >
                <a
                  href={f.url ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-w-0 items-center gap-2 text-sm text-brand hover:underline"
                >
                  <Icon className="size-3.5 shrink-0" />
                  <span className="truncate">{f.filename}</span>
                  <span className="text-[10px] text-muted-foreground">
                    · {f.kind}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    · {formatCompanyDate(f.uploaded_at, prefs)}
                  </span>
                  {f.uploaded_by && (
                    <span className="text-[10px] text-muted-foreground">
                      · {f.uploaded_by.name}
                    </span>
                  )}
                </a>
                {canDelete && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => remove(f)}
                    aria-label="Remove file"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
