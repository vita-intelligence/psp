"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileText,
  Lock,
  LockKeyhole,
  Pause,
  Paperclip,
  ShieldCheck,
  Signature,
  Smartphone,
  Sparkles,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { RemoteCursor } from "@/components/realtime/remote-cursor";
import { useLiveForm } from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import type { CollabPeer, JoinError } from "@/lib/realtime/use-live-form";
import { ErrorBanner } from "@/components/forms/error-banner";
import { pushNavigateToMyDevicesAction } from "@/lib/devices/actions";
import {
  clearSignatureAction,
  generateBmrAction,
  holdAction,
  rejectAction,
  releaseAction,
  signApproverAction,
  signReleaserAction,
  updateReleaseNotesAction,
} from "@/lib/production-final-release/actions";
import {
  FILE_KIND_HINT,
  FILE_KIND_LABEL,
  FINAL_RELEASE_FILE_KINDS,
  type FinalRelease,
  type FinalReleaseFileKind,
  type FinalReleaseFileRow,
} from "@/lib/production-final-release/types";

interface Props {
  initialRelease: FinalRelease;
  lotUuid: string;
  currentUserId: number;
  currentUserName: string;
  canRelease: boolean;
}

interface CommitPayload {
  kind: "release-updated" | "release-finalized";
  status: FinalRelease["status"];
}

// Draft state that peers in the room see live — only the freeform
// notes. Signatures + files + finalisation are one-shot server-side
// actions, so they don't need a broadcast draft representation.
interface FormState {
  notes: string;
}

export function FinalReleaseForm({
  initialRelease,
  lotUuid,
  currentUserId,
  currentUserName,
  canRelease,
}: Props) {
  const router = useRouter();
  const [release, setRelease] = useState<FinalRelease>(initialRelease);
  const [pending, startTransition] = useTransition();
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  useFormPresenceBeacon(`final-release:${lotUuid}`);

  const initialState: FormState = useMemo(
    () => ({ notes: release.notes ?? "" }),
    // Only seed once — subsequent server refreshes come through onCommit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const {
    state,
    setField,
    resetState,
    presence,
    fieldEditors,
    focusField,
    blurField,
    joinError,
    creator,
    isCreator,
    cursors,
    setCursor,
    hideCursor,
    broadcastCommit,
  } = useLiveForm<FormState>({
    resource: `final-release:${lotUuid}`,
    disabled: !canRelease,
    initialState,
    onCommit: (raw) => {
      const msg = raw as CommitPayload | null;
      if (!msg) return;
      // Peer just fired an action — refetch through the proxy so
      // every observer sees the latest signatures / files / status.
      void refetchRelease();
    },
  });

  const refetchRelease = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/production/final-releases/by-lot/${encodeURIComponent(lotUuid)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const data = (await res.json()) as { release: FinalRelease };
      setRelease(data.release);
      resetState({ notes: data.release.notes ?? "" });
    } catch {
      // Network blip — ignore; the next explicit action will refetch.
    }
  }, [lotUuid, resetState]);

  const cursorAnchorRef = useRef<HTMLDivElement | null>(null);
  const [anchorSize, setAnchorSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = cursorAnchorRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setAnchorSize({ w: rect.width, h: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Debounced notes autosave — peer-drafted through the channel + a
  // server round-trip when the creator pauses typing.
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isCreator || release.status !== "pending") return;
    if (state.notes === (release.notes ?? "")) return;
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(async () => {
      const res = await updateReleaseNotesAction(release.uuid, state.notes);
      if (res.ok) {
        setRelease(res.release);
        broadcastCommit({ kind: "release-updated", status: res.release.status });
      }
    }, 800);
    return () => {
      if (notesTimer.current) clearTimeout(notesTimer.current);
    };
  }, [state.notes, isCreator, release, broadcastCommit]);

  if (joinError) return <JoinErrorCard error={joinError} />;

  const finalized = release.status !== "pending";
  const missingFileKinds = FINAL_RELEASE_FILE_KINDS.filter(
    (kind) => !release.files.some((f) => f.kind === kind),
  );
  const hasDualSigs =
    !!release.releaser_id &&
    !!release.approver_id &&
    release.releaser_id !== release.approver_id;
  // BRCGS Issue 9 § 5.6 + § 4.4 segregation: lot must physically sit
  // in a finished_quarantine cell during the release ceremony. When
  // it's not (legacy stock on general shelving, or the picker hasn't
  // moved it back from production yet), block every finalisation
  // action until the warehouse team completes the move.
  const cellPurpose = release.stock_lot?.placement?.cell_purpose ?? null;
  const lotInFinishedQuarantine = cellPurpose === "finished_quarantine";
  const lotHasPlacement = !!release.stock_lot?.placement;

  const canFinalizeRelease =
    !finalized &&
    hasDualSigs &&
    missingFileKinds.length === 0 &&
    lotInFinishedQuarantine;

  const currentUserIsReleaser = release.releaser_id === currentUserId;
  const currentUserIsApprover = release.approver_id === currentUserId;

  return (
    <div
      className="relative space-y-4"
      ref={cursorAnchorRef}
      onMouseMove={(e) => {
        const el = cursorAnchorRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        setCursor(
          (e.clientX - rect.left) / rect.width,
          (e.clientY - rect.top) / rect.height,
        );
      }}
      onMouseLeave={() => hideCursor()}
    >
      <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-xl">
        {Object.values(cursors).map((c) => (
          <RemoteCursor
            key={c.peer.id}
            cursor={c}
            anchorWidth={anchorSize.w}
            anchorHeight={anchorSize.h}
          />
        ))}
      </div>

      <Header
        release={release}
        peers={presence}
        onBack={() => router.back()}
      />

      {errorDetail && <ErrorBanner detail={errorDetail} />}

      <LotInfoCard release={release} />

      {finalized && <FinalisedBanner release={release} />}

      {/* Placement check — if the lot slipped out of finished_quarantine
          AFTER the form opened (rare but possible during long-running
          collab sessions), block finalisation with a lightweight
          reminder and let the page.tsx re-decide on next refresh.
          The heavy "Move the lot first" splash is served by the
          server component's PlacementBlockScreen. */}
      {!finalized && !lotInFinishedQuarantine && (
        <PlacementSlippedBanner cellPurpose={cellPurpose} />
      )}

      {!finalized && !isCreator && creator && (
        <CreatorLockBanner creator={creator} action="finalize" />
      )}

      <NotesCard
        notes={state.notes}
        onChange={(v) => setField("notes", v)}
        onFocus={() => focusField("notes")}
        onBlur={() => blurField("notes")}
        editor={fieldEditors.notes}
        disabled={finalized || !canRelease}
      />

      <FilesCard
        release={release}
        canEdit={!finalized && canRelease}
        onChanged={(next) => {
          setRelease(next);
          broadcastCommit({ kind: "release-updated", status: next.status });
        }}
      />

      <SignaturesCard
        release={release}
        currentUserId={currentUserId}
        currentUserName={currentUserName}
        canSign={!finalized && canRelease}
        pending={pending}
        onAction={(fn) =>
          startTransition(async () => {
            const res = await fn();
            if (res.ok) {
              setRelease(res.release);
              broadcastCommit({
                kind: "release-updated",
                status: res.release.status,
              });
              setErrorDetail(null);
            } else {
              setErrorDetail(res.detail);
            }
          })
        }
      />

      {!finalized && (
        <DecisionCard
          release={release}
          canFinalizeRelease={canFinalizeRelease}
          missingFileKinds={missingFileKinds}
          hasDualSigs={hasDualSigs}
          lotInFinishedQuarantine={lotInFinishedQuarantine}
          currentUserIsReleaser={currentUserIsReleaser}
          currentUserIsApprover={currentUserIsApprover}
          canRelease={canRelease}
          pending={pending}
          onRelease={() =>
            startTransition(async () => {
              const res = await releaseAction(release.uuid, state.notes);
              if (res.ok) {
                setRelease(res.release);
                broadcastCommit({
                  kind: "release-finalized",
                  status: res.release.status,
                });
                toast.success("Final Product Released.", {
                  description: "Lot is now available for dispatch.",
                });
                setErrorDetail(null);
              } else {
                setErrorDetail(res.detail);
              }
            })
          }
          onHold={(reason) =>
            startTransition(async () => {
              const res = await holdAction(release.uuid, reason);
              if (res.ok) {
                setRelease(res.release);
                broadcastCommit({
                  kind: "release-finalized",
                  status: res.release.status,
                });
                toast.success("Lot placed on hold.");
                setErrorDetail(null);
              } else {
                setErrorDetail(res.detail);
              }
            })
          }
          onReject={(reason) =>
            startTransition(async () => {
              const res = await rejectAction(release.uuid, reason);
              if (res.ok) {
                setRelease(res.release);
                broadcastCommit({
                  kind: "release-finalized",
                  status: res.release.status,
                });
                toast.success("Lot rejected.");
                setErrorDetail(null);
              } else {
                setErrorDetail(res.detail);
              }
            })
          }
        />
      )}
    </div>
  );
}

// ---------------- Header ----------------

function Header({
  release,
  peers,
  onBack,
}: {
  release: FinalRelease;
  peers: CollabPeer[];
  onBack: () => void;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border/60 pb-4">
      <div className="flex items-start gap-3 min-w-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          aria-label="Back"
          className="mt-0.5 shrink-0"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0 space-y-1">
          <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <ShieldCheck className="size-3" />
            Final Product Release · BRCGS 5.6
          </p>
          <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">
            {release.stock_lot?.item?.name ?? "Finished lot"}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            <span className="font-mono">
              Lot {release.stock_lot?.code ?? release.stock_lot?.uuid.slice(0, 8)}
            </span>
            {release.manufacturing_order?.code && (
              <>
                <span className="mx-1.5 text-border">·</span>
                <span className="font-mono">
                  {release.manufacturing_order.code}
                </span>
              </>
            )}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <CollabAvatars peers={peers} />
        <StatusPill status={release.status} />
      </div>
    </header>
  );
}

function StatusPill({ status }: { status: FinalRelease["status"] }) {
  const cfg = {
    pending: {
      label: "Awaiting release",
      cls: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
    },
    released: {
      label: "Released",
      cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    },
    on_hold: {
      label: "On hold",
      cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    },
    rejected: {
      label: "Rejected",
      cls: "bg-destructive/15 text-destructive",
    },
  }[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        cfg.cls,
      )}
    >
      {cfg.label}
    </span>
  );
}

// ---------------- Lot info ----------------

function LotInfoCard({ release }: { release: FinalRelease }) {
  const lot = release.stock_lot;
  const placement = lot?.placement;

  // Same fallback chain as the release worklist + pickup + closeout:
  // named cell wins, then Level N derived from ordinal, then blank.
  // Filter out null segments so the crumb never renders "· —".
  const rack =
    placement?.location?.code ?? placement?.location?.name ?? null;
  const cellLabel =
    placement?.cell_name ??
    (typeof placement?.cell_ordinal === "number"
      ? `Level ${placement.cell_ordinal + 1}`
      : null);
  const locationCrumb = placement
    ? [placement.warehouse?.name, placement.floor?.name, rack, cellLabel]
        .filter((x): x is string => !!x)
        .join(" · ") || "—"
    : "Not on shelf";

  const purposeLabel = placement?.cell_purpose
    ? placement.cell_purpose === "finished_quarantine"
      ? "Finished quarantine"
      : placement.cell_purpose
          .split("_")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ")
    : "—";
  const purposeTone =
    placement?.cell_purpose === "finished_quarantine"
      ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
      : "bg-muted text-muted-foreground";

  return (
    <Card>
      <CardContent className="grid gap-4 py-4 text-sm sm:grid-cols-2">
        <InfoRow label="Product" value={lot?.item?.name ?? "—"} />
        <InfoRow
          label="Lot code"
          value={
            <span className="font-mono">{lot?.code ?? "—"}</span>
          }
        />
        <InfoRow label="Batch qty" value={lot?.qty_received ?? "—"} />
        <InfoRow
          label="Expiry"
          value={
            lot?.expiry_at
              ? new Date(lot.expiry_at).toLocaleDateString()
              : "—"
          }
        />
        <InfoRow label="Location" value={locationCrumb} />
        <InfoRow
          label="Cell purpose"
          value={
            <span
              className={cn(
                "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                purposeTone,
              )}
            >
              {purposeLabel}
            </span>
          }
        />
      </CardContent>
    </Card>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

// ---------------- Notes ----------------

function NotesCard({
  notes,
  onChange,
  onFocus,
  onBlur,
  editor,
  disabled,
}: {
  notes: string;
  onChange: (v: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  editor: CollabPeer | null;
  disabled: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <FileText className="size-4" />
          Release notes
          <FieldEditingIndicator peer={editor} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Textarea
          value={notes}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          disabled={disabled}
          placeholder="Summary of batch review — actives verified vs spec, deviations noted, corrective actions taken. (Test detail lives in the attached CoA / micro reports.)"
          rows={4}
        />
      </CardContent>
    </Card>
  );
}

// ---------------- Files ----------------

function FilesCard({
  release,
  canEdit,
  onChanged,
}: {
  release: FinalRelease;
  canEdit: boolean;
  onChanged: (release: FinalRelease) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Paperclip className="size-4" />
          Evidence files
          <span className="text-xs font-normal text-muted-foreground">
            All {FINAL_RELEASE_FILE_KINDS.length} kinds required
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {FINAL_RELEASE_FILE_KINDS.map((kind) => (
          <FileRow
            key={kind}
            kind={kind}
            release={release}
            canEdit={canEdit}
            onChanged={onChanged}
          />
        ))}
      </CardContent>
    </Card>
  );
}

// Which file kinds can PSP assemble from the DB? BMR is a full
// production record (MO, materials consumed, routing, output, sign-
// offs). CoA / Micro / Label need external test data or physical
// artefacts, so those stay upload-only.
const AUTO_GENERATABLE: readonly FinalReleaseFileKind[] = ["bmr"] as const;

// Camera-first kinds — pushing operators to a paired phone to snap
// them via /m/final-release-capture makes sense here (label proof =
// finished pack, retention = physical sample on the shelf). CoA /
// BMR / Micro are typically PDFs so the button doesn't render.
const CAMERA_KINDS: readonly FinalReleaseFileKind[] = [
  "label_proof",
  "retain_sample",
] as const;

function FileRow({
  kind,
  release,
  canEdit,
  onChanged,
}: {
  kind: FinalReleaseFileKind;
  release: FinalRelease;
  canEdit: boolean;
  onChanged: (release: FinalRelease) => void;
}) {
  const files = release.files.filter((f) => f.kind === kind);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pushingToDevice, setPushingToDevice] = useState(false);
  const [awaitingCapture, setAwaitingCapture] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canGenerate = AUTO_GENERATABLE.includes(kind);
  const canSendToDevice = CAMERA_KINDS.includes(kind);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("kind", kind);
      form.append("file", file);
      const res = await fetch(
        `/api/production/final-releases/${encodeURIComponent(release.uuid)}/files`,
        { method: "POST", body: form },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        toast.error(err.detail ?? "Couldn't upload the file.");
        return;
      }
      // Refetch the release to get the freshly appended file row.
      const detail = await fetch(
        `/api/production/final-releases/by-lot/${encodeURIComponent(release.stock_lot?.uuid ?? "")}`,
        { cache: "no-store" },
      );
      if (detail.ok) {
        const data = (await detail.json()) as { release: FinalRelease };
        onChanged(data.release);
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const remove = async (fileUuid: string) => {
    const res = await fetch(
      `/api/production/final-releases/${encodeURIComponent(release.uuid)}/files/${encodeURIComponent(fileUuid)}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      toast.error("Couldn't delete the file.");
      return;
    }
    const detail = await fetch(
      `/api/production/final-releases/by-lot/${encodeURIComponent(release.stock_lot?.uuid ?? "")}`,
      { cache: "no-store" },
    );
    if (detail.ok) {
      const data = (await detail.json()) as { release: FinalRelease };
      onChanged(data.release);
    }
  };

  const attached = files.length > 0;

  // The desktop form doesn't know when the mobile page uploads a
  // photo — no collab channel between the two. After Send to device,
  // poll the by-lot endpoint every 4 s for up to 60 s; the moment
  // the file count on this kind bumps up, refetch + clear the flag.
  useEffect(() => {
    if (!awaitingCapture) return;
    const startCount = files.length;
    let elapsed = 0;
    pollRef.current = setInterval(async () => {
      elapsed += 4;
      try {
        const res = await fetch(
          `/api/production/final-releases/by-lot/${encodeURIComponent(release.stock_lot?.uuid ?? "")}`,
          { cache: "no-store" },
        );
        if (res.ok) {
          const data = (await res.json()) as { release: FinalRelease };
          const nextCount = data.release.files.filter(
            (f) => f.kind === kind,
          ).length;
          if (nextCount > startCount) {
            onChanged(data.release);
            setAwaitingCapture(false);
            toast.success("Photo arrived from mobile.");
            return;
          }
        }
      } catch {
        // ignore transient network blips
      }
      if (elapsed >= 60) {
        setAwaitingCapture(false);
      }
    }, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [awaitingCapture, files.length, release.stock_lot?.uuid, kind, onChanged]);

  const sendToDevice = async () => {
    setPushingToDevice(true);
    try {
      const path = `/m/final-release-capture/${encodeURIComponent(release.uuid)}/${encodeURIComponent(kind)}`;
      const res = await pushNavigateToMyDevicesAction(path);
      if (!res.ok) {
        toast.error(res.detail ?? "Couldn't push to your paired devices.");
        return;
      }
      const count = res.pushed_to.length;
      if (count === 0) {
        toast.warning(
          "No paired devices — open PSP on the warehouse phone first, then try again.",
        );
      } else {
        toast.success(
          count === 1
            ? "Camera opened on your phone."
            : `Camera opened on ${count} paired devices.`,
        );
        setAwaitingCapture(true);
      }
    } finally {
      setPushingToDevice(false);
    }
  };

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await generateBmrAction(release.uuid);
      if (!res.ok) {
        toast.error(res.detail ?? "Couldn't generate the PDF.");
        return;
      }
      toast.success("Batch Manufacturing Record generated.");
      const detail = await fetch(
        `/api/production/final-releases/by-lot/${encodeURIComponent(release.stock_lot?.uuid ?? "")}`,
        { cache: "no-store" },
      );
      if (detail.ok) {
        const data = (await detail.json()) as { release: FinalRelease };
        onChanged(data.release);
      }
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-md border p-3 transition-colors",
        attached
          ? "border-emerald-500/40 bg-emerald-500/[0.03]"
          : "border-border/60 bg-muted/20",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <span
            className={cn(
              "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full",
              attached
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                : "bg-muted text-muted-foreground",
            )}
          >
            {attached ? (
              <CheckCircle2 className="size-3" />
            ) : (
              <XCircle className="size-3" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">{FILE_KIND_LABEL[kind]}</p>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              {FILE_KIND_HINT[kind]}
            </p>
            <p className="mt-1 text-[11px] font-medium text-muted-foreground">
              {attached
                ? `${files.length} file${files.length === 1 ? "" : "s"} attached`
                : "No file attached"}
            </p>
          </div>
        </div>
        {canEdit && (
          <div className="flex shrink-0 items-center gap-1.5">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
            {canGenerate && !attached && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={generating || uploading}
                onClick={() => void generate()}
                title="Auto-assemble this document from the MO's production record."
              >
                <Sparkles className="mr-1 size-3.5" />
                {generating ? "Generating…" : "Generate"}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading || generating}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mr-1 size-3.5" />
              {uploading ? "Uploading…" : attached ? "Replace" : "Upload"}
            </Button>
            {canSendToDevice && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pushingToDevice || uploading || generating}
                onClick={() => void sendToDevice()}
                title="Open the camera on your paired warehouse phone. When you snap the photo it attaches straight to this form."
              >
                <Smartphone className="mr-1 size-3.5" />
                {pushingToDevice
                  ? "Sending…"
                  : awaitingCapture
                    ? "Waiting for photo…"
                    : "Send to device"}
              </Button>
            )}
          </div>
        )}
      </div>
      {attached && (
        <ul className="mt-2 space-y-1 pl-7">
          {files.map((f) => (
            <li
              key={f.uuid}
              className="flex items-center justify-between gap-2 rounded border border-border/40 bg-background px-2 py-1 text-xs"
            >
              <div className="min-w-0 flex-1 truncate">
                <FileLink release={release} file={f} />
                <span className="ml-2 text-[10px] text-muted-foreground">
                  {formatSize(f.byte_size)} · {f.uploaded_by?.name ?? "unknown"}
                </span>
              </div>
              {canEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => void remove(f.uuid)}
                  aria-label="Delete file"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FileLink({
  release,
  file,
}: {
  release: FinalRelease;
  file: FinalReleaseFileRow;
}) {
  return (
    <a
      href={`/api/production/final-releases/${encodeURIComponent(release.uuid)}/files/${encodeURIComponent(file.uuid)}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-brand underline-offset-2 hover:underline"
    >
      {file.filename}
    </a>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ---------------- Signatures ----------------

function SignaturesCard({
  release,
  currentUserId,
  currentUserName,
  canSign,
  pending,
  onAction,
}: {
  release: FinalRelease;
  currentUserId: number;
  currentUserName: string;
  canSign: boolean;
  pending: boolean;
  onAction: (
    fn: () => Promise<{
      ok: boolean;
      release?: FinalRelease;
      detail?: string;
    } & { ok: false; detail: string } | { ok: true; release: FinalRelease }>,
  ) => void;
}) {
  const releaserFilled = !!release.releaser_id;
  const approverFilled = !!release.approver_id;
  const currentIsReleaser = release.releaser_id === currentUserId;
  const currentIsApprover = release.approver_id === currentUserId;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Signature className="size-4" />
          Dual sign-off
          <span className="text-xs font-normal text-muted-foreground">
            Two different users required
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <SignatureSlot
          role="releaser"
          label="Releaser"
          filledById={release.releaser_id}
          filledByName={release.releaser?.name ?? release.releaser?.email ?? null}
          signedAt={release.releaser_signed_at}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          blocked={currentIsApprover}
          blockedReason="You already signed as approver."
          canSign={canSign}
          pending={pending}
          onSign={() =>
            onAction(async () => signReleaserAction(release.uuid, null))
          }
          onClear={() =>
            onAction(async () => clearSignatureAction(release.uuid, "releaser"))
          }
        />
        <SignatureSlot
          role="approver"
          label="Approver"
          filledById={release.approver_id}
          filledByName={release.approver?.name ?? release.approver?.email ?? null}
          signedAt={release.approver_signed_at}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          blocked={currentIsReleaser}
          blockedReason="You already signed as releaser."
          canSign={canSign}
          pending={pending}
          onSign={() =>
            onAction(async () => signApproverAction(release.uuid, null))
          }
          onClear={() =>
            onAction(async () => clearSignatureAction(release.uuid, "approver"))
          }
        />
      </CardContent>
    </Card>
  );
}

function SignatureSlot({
  role,
  label,
  filledById,
  filledByName,
  signedAt,
  currentUserId,
  blocked,
  blockedReason,
  canSign,
  pending,
  onSign,
  onClear,
}: {
  role: "releaser" | "approver";
  label: string;
  filledById: number | null;
  filledByName: string | null;
  signedAt: string | null;
  currentUserId: number;
  currentUserName: string;
  blocked: boolean;
  blockedReason: string;
  canSign: boolean;
  pending: boolean;
  onSign: () => void;
  onClear: () => void;
}) {
  const isMine = filledById === currentUserId;
  return (
    <div
      className={cn(
        "rounded-md border p-3",
        filledById
          ? "border-emerald-500/40 bg-emerald-500/5"
          : "border-border/60 bg-muted/20",
      )}
    >
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {filledById ? (
        <div className="mt-1 space-y-1">
          <p className="text-sm font-medium">
            {filledByName ?? "Signed"}
            {isMine && (
              <span className="ml-1 text-[10px] text-muted-foreground">
                (you)
              </span>
            )}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {signedAt ? new Date(signedAt).toLocaleString() : ""}
          </p>
          {isMine && canSign && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-[11px]"
              disabled={pending}
              onClick={onClear}
            >
              Clear signature
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          {blocked ? (
            <p className="text-xs text-muted-foreground">{blockedReason}</p>
          ) : canSign ? (
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={onSign}
            >
              <Signature className="mr-1 size-3.5" />
              Sign as {role}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">Not signed yet.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------- Decision ----------------

function DecisionCard({
  release,
  canFinalizeRelease,
  missingFileKinds,
  hasDualSigs,
  lotInFinishedQuarantine,
  currentUserIsReleaser,
  currentUserIsApprover,
  canRelease,
  pending,
  onRelease,
  onHold,
  onReject,
}: {
  release: FinalRelease;
  canFinalizeRelease: boolean;
  missingFileKinds: FinalReleaseFileKind[];
  hasDualSigs: boolean;
  lotInFinishedQuarantine: boolean;
  currentUserIsReleaser: boolean;
  currentUserIsApprover: boolean;
  canRelease: boolean;
  pending: boolean;
  onRelease: () => void;
  onHold: (reason: string) => void;
  onReject: (reason: string) => void;
}) {
  const [holdReason, setHoldReason] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const canHoldOrReject =
    canRelease &&
    lotInFinishedQuarantine &&
    (currentUserIsReleaser || currentUserIsApprover);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Decision</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Release */}
        <div className="space-y-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3">
          <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
            Release for dispatch
          </p>
          <ul className="text-[11px] text-muted-foreground space-y-0.5">
            <li className="flex items-center gap-1.5">
              {hasDualSigs ? (
                <CheckCircle2 className="size-3 text-emerald-600" />
              ) : (
                <XCircle className="size-3 text-muted-foreground" />
              )}
              Two different signatures on file
            </li>
            <li className="flex items-center gap-1.5">
              {lotInFinishedQuarantine ? (
                <CheckCircle2 className="size-3 text-emerald-600" />
              ) : (
                <XCircle className="size-3 text-muted-foreground" />
              )}
              Lot in a finished-quarantine cell
            </li>
            <li className="flex items-center gap-1.5">
              {missingFileKinds.length === 0 ? (
                <CheckCircle2 className="size-3 text-emerald-600" />
              ) : (
                <XCircle className="size-3 text-muted-foreground" />
              )}
              All four required files attached
              {missingFileKinds.length > 0 && (
                <span className="text-[10px]">
                  {" "}
                  (missing:{" "}
                  {missingFileKinds
                    .map((k) => FILE_KIND_LABEL[k])
                    .join(", ")}
                  )
                </span>
              )}
            </li>
          </ul>
          <Button
            type="button"
            disabled={!canFinalizeRelease || !canRelease || pending}
            onClick={onRelease}
          >
            <CheckCircle2 className="mr-1 size-4" />
            Release {release.stock_lot?.code ?? "lot"}
          </Button>
        </div>

        {/* Hold */}
        <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
            Place on hold
          </p>
          <p className="text-[11px] text-muted-foreground">
            Pause the lot pending investigation (allergen review, out-of-spec
            follow-up, supplier query). Stays in the finished-quarantine bay.
          </p>
          <Input
            value={holdReason}
            onChange={(e) => setHoldReason(e.target.value)}
            placeholder="Reason for hold — what's under investigation?"
            disabled={!canHoldOrReject || pending}
          />
          <Button
            type="button"
            variant="outline"
            className="border-amber-500/60 text-amber-800 hover:bg-amber-500/10"
            disabled={
              !canHoldOrReject || pending || holdReason.trim().length === 0
            }
            onClick={() => onHold(holdReason.trim())}
          >
            <Pause className="mr-1 size-4" />
            Place on hold
          </Button>
        </div>

        {/* Reject */}
        <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm font-semibold text-destructive">
            Reject
          </p>
          <p className="text-[11px] text-muted-foreground">
            Lot failed final QA. Moves to a rejected cell awaiting disposal per
            SOP. Immutable — a rejected lot can only be disposed, not
            re-released.
          </p>
          <Input
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Reason for reject — what went wrong?"
            disabled={!canHoldOrReject || pending}
          />
          <Button
            type="button"
            variant="destructive"
            disabled={
              !canHoldOrReject || pending || rejectReason.trim().length === 0
            }
            onClick={() => onReject(rejectReason.trim())}
          >
            <XCircle className="mr-1 size-4" />
            Reject
          </Button>
        </div>

        {!canHoldOrReject && (
          <p className="text-[11px] text-muted-foreground">
            Sign as releaser or approver before Hold / Reject becomes
            available.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------- Finalised banner ----------------

function FinalisedBanner({ release }: { release: FinalRelease }) {
  const cfg = {
    released: {
      Icon: CheckCircle2,
      cls: "border-emerald-500/40 bg-emerald-500/5",
      msg: "Batch released for dispatch.",
    },
    on_hold: {
      Icon: Pause,
      cls: "border-amber-500/40 bg-amber-500/5",
      msg: `On hold: ${release.hold_reason ?? "no reason recorded"}.`,
    },
    rejected: {
      Icon: XCircle,
      cls: "border-destructive/40 bg-destructive/5",
      msg: `Rejected: ${release.reject_reason ?? "no reason recorded"}.`,
    },
    pending: null,
  }[release.status];
  if (!cfg) return null;
  const { Icon } = cfg;
  return (
    <div className={cn("flex items-start gap-2 rounded-md border p-3", cfg.cls)}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="text-sm">
        <p className="font-semibold">{cfg.msg}</p>
        {release.finalized_at && (
          <p className="text-[11px] text-muted-foreground">
            Finalised {new Date(release.finalized_at).toLocaleString()}{" "}
            {release.finalized_by?.name
              ? `by ${release.finalized_by.name}`
              : null}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------- Placement drift banner ----------------

function PlacementSlippedBanner({
  cellPurpose,
}: {
  cellPurpose: string | null;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="space-y-1">
        <p className="font-semibold">Lot slipped out of finished-quarantine.</p>
        <p className="text-destructive/90">
          Someone moved this lot to a{" "}
          <span className="font-mono">{cellPurpose ?? "different"}</span> cell
          while this room was open. Finalisation is blocked — refresh the page
          to re-run the placement check.
        </p>
      </div>
    </div>
  );
}

// ---------------- Shared collab helpers ----------------

function CreatorLockBanner({
  creator,
  action = "finalize",
}: {
  creator: CollabPeer | null;
  action?: string;
}) {
  if (!creator) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
      <Lock className="mt-0.5 size-3.5 shrink-0" />
      <span>
        Only <span className="font-medium text-foreground">{creator.name}</span>{" "}
        can {action} from this room. Your edits sync to them live.
      </span>
    </div>
  );
}

function JoinErrorCard({ error }: { error: JoinError }) {
  const cfg = {
    form_full: {
      Icon: AlertTriangle,
      title: "Form is at capacity",
      detail: error.limit
        ? `Up to ${error.limit} people can review this release at once. Wait for someone to leave, then refresh.`
        : "Wait for someone to leave, then refresh.",
    },
    forbidden: {
      Icon: LockKeyhole,
      title: "You can't sign here",
      detail:
        "Ask an admin for the `production.final_release` permission to join this ceremony.",
    },
    bad_topic: {
      Icon: AlertTriangle,
      title: "Unknown release",
      detail: "We couldn't find this release. The link may be malformed.",
    },
    unknown: {
      Icon: AlertTriangle,
      title: "Couldn't open the form",
      detail: "Something went wrong on our end. Please try again.",
    },
  }[error.reason];
  const { Icon } = cfg;
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-background">
          <Icon className="size-6" />
        </div>
        <p className="text-sm font-semibold">{cfg.title}</p>
        <p className="text-xs text-muted-foreground">{cfg.detail}</p>
        <Button asChild variant="outline" size="sm">
          <Link href="/production/runs">Back to runs</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
