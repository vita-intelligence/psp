"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { FieldError } from "@/components/forms/field-error";
import { UserAvatar } from "@/components/users/user-avatar";
import { cn } from "@/lib/utils";
import { updateProfileAction } from "@/lib/auth/profile-actions";
import { compressImage } from "@/lib/image-compress";
import type { FieldErrors } from "@/lib/auth/actions";
import { AlertCircle, ImageUp, Loader2, Trash2 } from "lucide-react";

interface ProfileFormProps {
  initialName: string;
  initialAvatar: string | null;
  email: string;
}

// Targeted budget after compression — the JPEG re-encode below
// will resize + step quality down to fit. Phone-camera photos arriving
// as 5MB+ are handled silently; the user never sees a size error.
const TARGET_AVATAR_BYTES = 500 * 1024;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export function ProfileForm({
  initialName,
  initialAvatar,
  email,
}: ProfileFormProps) {
  const [name, setName] = useState(initialName);
  const [avatar, setAvatar] = useState<string | null>(initialAvatar);
  const [originalName] = useState(initialName);
  const [originalAvatar] = useState(initialAvatar);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const dirty = name.trim() !== originalName || avatar !== originalAvatar;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setFileError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      setFileError("Pick a PNG, JPG, WEBP, or GIF.");
      return;
    }

    setProcessing(true);
    try {
      // Resize + re-encode to fit the budget. The original file is
      // discarded — we only persist the compressed version.
      const compressed = await compressImage(file, {
        maxBytes: TARGET_AVATAR_BYTES,
      });
      setAvatar(compressed);
    } catch {
      setFileError(
        "We couldn't read that image. Try a different one.",
      );
    } finally {
      setProcessing(false);
    }
  }

  function onRemoveAvatar() {
    setAvatar(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function onReset() {
    setName(originalName);
    setAvatar(originalAvatar);
    setFieldErrors({});
    setFormError(null);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setFormError(null);

    startTransition(async () => {
      const res = await updateProfileAction({
        name: name.trim(),
        avatar,
      });
      if (res.ok) {
        toast.success("Profile updated");
        return;
      }
      setFieldErrors(res.fields ?? {});
      if (!res.fields || Object.keys(res.fields).length === 0) {
        setFormError(res.detail);
      }
    });
  }

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>
          Your name and avatar are shown to teammates across PSP.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-6">
          {/* Avatar row */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <UserAvatar
              name={name}
              email={email}
              avatar={avatar}
              sizeClassName="size-20"
              fallbackClassName="text-xl"
              className="ring-2 ring-border"
            />
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={processing}
                >
                  {processing ? (
                    <Loader2 className="mr-1.5 size-4 animate-spin" />
                  ) : (
                    <ImageUp className="mr-1.5 size-4" />
                  )}
                  {processing ? "Processing…" : "Choose photo"}
                </Button>
                {avatar && !processing && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onRemoveAvatar}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="mr-1.5 size-4" />
                    Remove
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                PNG, JPG, WEBP or GIF — any size. We'll resize and compress
                it for you.
              </p>
              {fileError && (
                <p className="flex items-start gap-1.5 text-xs text-destructive">
                  <AlertCircle className="mt-0.5 size-3 shrink-0" />
                  <span>{fileError}</span>
                </p>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED.join(",")}
                className="sr-only"
                onChange={onFile}
              />
            </div>
          </div>

          <Separator />

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="profile-name" className="text-sm font-medium">
              Full name
            </Label>
            <Input
              id="profile-name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              className={cn(
                "h-11",
                fieldErrors.name &&
                  "border-destructive focus-visible:ring-destructive/20",
              )}
              aria-invalid={Boolean(fieldErrors.name)}
            />
            <FieldError messages={fieldErrors.name} />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Email</Label>
            <Input value={email} disabled className="h-11" />
            <p className="text-xs text-muted-foreground">
              Email can't be changed. Contact an admin if it needs to update.
            </p>
          </div>

          {formError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            {dirty && !pending && (
              <Button type="button" variant="ghost" onClick={onReset}>
                Discard
              </Button>
            )}
            <Button
              type="submit"
              disabled={!dirty || pending || processing}
            >
              {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save changes
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
