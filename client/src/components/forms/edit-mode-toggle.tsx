"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LockKeyhole, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface EditModeToggleProps {
  /** True ⇒ the actor has the underlying perm; false ⇒ no Edit
   *  button shown, everything stays view-only regardless. */
  canEdit: boolean;
  /** The form (or any element) that takes `canEdit` + an optional
   *  `onSavedSuccess` prop. EditModeToggle clones the single root
   *  element and INJECTS its own `canEdit={isEditing}` +
   *  `onSavedSuccess` so the form doesn't need to know whether
   *  it's wrapped. */
  children: ReactNode;
  /** Optional label that replaces the default "Edit" copy. */
  editLabel?: string;
  className?: string;
}

interface InjectableFormProps {
  canEdit?: boolean;
  onSavedSuccess?: () => void;
}

/**
 * Standard view ⇄ edit toggle wrapper. Wraps any edit form so the
 * detail page reads as view-only by default + flips to editable only
 * after the operator hits Edit. Save / discard inside the form flips
 * back to view via the injected `onSavedSuccess` callback.
 *
 * Why the cloneElement-based injection: Server Components can render
 * Client Components as children, but they CANNOT pass *functions* as
 * children (render-prop) or as props that need to be serialized
 * across the boundary. So EditModeToggle accepts a plain element
 * child (the form), and at render time clones it with overrides.
 *
 *     <EditModeToggle canEdit={hasPerm}>
 *       <MyForm canEdit={hasPerm} ... />
 *     </EditModeToggle>
 *
 * The form's own `canEdit` prop is overridden — the page passes the
 * perm check (so TypeScript stays happy) and the toggle then injects
 * `canEdit={isEditing}` at runtime. Any `onSavedSuccess` already on
 * the child is wrapped so the toggle's own setView fires too.
 */
export function EditModeToggle({
  canEdit,
  children,
  editLabel = "Edit",
  className,
}: EditModeToggleProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);

  const setView = useCallback(() => {
    setIsEditing(false);
    router.refresh();
  }, [router]);

  const onCancel = useCallback(() => {
    setIsEditing(false);
    router.refresh();
  }, [router]);

  // Clone each element child and inject `canEdit` + `onSavedSuccess`
  // overrides. Non-element children (strings, fragments, etc.) pass
  // through untouched.
  const enhanced = Children.map(children, (child) => {
    if (!isValidElement<InjectableFormProps>(child)) return child;

    const existingOnSavedSuccess = child.props.onSavedSuccess;

    const overrides: InjectableFormProps = {
      canEdit: canEdit && isEditing,
      onSavedSuccess: () => {
        existingOnSavedSuccess?.();
        setView();
      },
    };

    return cloneElement(child as ReactElement<InjectableFormProps>, overrides);
  });

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-end gap-2">
        {!canEdit ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
            <LockKeyhole className="size-3" />
            Read-only
          </span>
        ) : isEditing ? (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            <X className="mr-1.5 size-3.5" />
            Cancel
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={() => setIsEditing(true)}
          >
            <Pencil className="mr-1.5 size-3.5" />
            {editLabel}
          </Button>
        )}
      </div>
      {enhanced}
    </div>
  );
}
