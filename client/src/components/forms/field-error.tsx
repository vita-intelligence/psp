import { AlertCircle } from "lucide-react";

interface FieldErrorProps {
  messages?: string[];
  id?: string;
}

/**
 * Renders the first error string under a form field. We only show the
 * first one to keep the UI tight — backend changesets sometimes return
 * 2-3 messages per field, and stacking them visually clutters the form.
 */
export function FieldError({ messages, id }: FieldErrorProps) {
  if (!messages || messages.length === 0) return null;
  return (
    <p
      id={id}
      role="alert"
      className="flex items-start gap-1.5 text-xs text-destructive"
    >
      <AlertCircle className="mt-0.5 size-3 shrink-0" />
      <span>{messages[0]}</span>
    </p>
  );
}
