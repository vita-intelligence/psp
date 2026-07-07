"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  uploadEquipmentFileAction,
  deleteEquipmentFileAction,
} from "@/lib/equipment/actions";
import type { EquipmentFile, EquipmentFileKind } from "@/lib/equipment/types";
import type { CompanyDefaults } from "@/lib/types";
import { formatCompanyDate } from "@/lib/format/company";

const KIND_LABEL: Record<EquipmentFileKind, string> = {
  calibration_certificate: "Calibration certificate",
  service_report: "Service report",
  manual: "Manual",
  warranty: "Warranty",
  photo: "Photo",
  other: "Other",
};

interface Props {
  equipmentUuid: string;
  files: EquipmentFile[];
  canEdit: boolean;
  prefs: CompanyDefaults;
}

/**
 * File attachments for an equipment unit — calibration certs, service
 * reports, manuals, warranty PDFs, photos of the nameplate. Uploads
 * via multipart POST; deletes wipe both the metadata row and the
 * blob on Backend.Storage.
 */
export function EquipmentFilesCard({
  equipmentUuid,
  files,
  canEdit,
  prefs,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<EquipmentFileKind>(
    "calibration_certificate",
  );
  const inputRef = useRef<HTMLInputElement | null>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    startTransition(async () => {
      const res = await uploadEquipmentFileAction(equipmentUuid, kind, file);
      if (res.ok) {
        toast.success(`Uploaded ${file.name}`);
        router.refresh();
      } else {
        toast.error(res.detail);
      }
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  function onDelete(uuid: string, filename: string) {
    if (!confirm(`Delete ${filename}?`)) return;
    startTransition(async () => {
      const res = await deleteEquipmentFileAction(equipmentUuid, uuid);
      if (res.ok) {
        toast.success("Deleted");
        router.refresh();
      } else {
        toast.error(res.detail);
      }
    });
  }

  return (
    <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Files</h2>
        <span className="text-[11px] text-muted-foreground">
          {files.length} attached
        </span>
      </header>

      {canEdit && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-border/40 bg-muted/30 p-3">
          <Select
            value={kind}
            onValueChange={(v) => setKind(v as EquipmentFileKind)}
          >
            <SelectTrigger className="h-9 w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(KIND_LABEL) as EquipmentFileKind[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {KIND_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <input
            ref={inputRef}
            type="file"
            hidden
            onChange={onPick}
          />

          <Button
            size="sm"
            onClick={() => inputRef.current?.click()}
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

      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No files attached yet.
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {files.map((f) => (
            <li
              key={f.uuid}
              className="flex items-center gap-3 py-2 text-sm"
            >
              <a
                href={`/api/equipment/${equipmentUuid}/files/${f.uuid}/blob`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-w-0 flex-1 items-center gap-2 hover:underline"
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{f.filename}</span>
              </a>
              <span className="hidden shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground sm:inline">
                {KIND_LABEL[f.kind] ?? f.kind}
              </span>
              <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                {formatBytes(f.byte_size)}
              </span>
              <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                {formatCompanyDate(f.inserted_at, prefs)}
              </span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => onDelete(f.uuid, f.filename)}
                  disabled={pending}
                  className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-40"
                  aria-label="Delete file"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
