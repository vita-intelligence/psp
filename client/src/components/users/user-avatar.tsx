import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initialsOf } from "@/lib/initials";
import { avatarColour } from "@/lib/avatar-color";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  name: string;
  email: string;
  avatar?: string | null;
  /** Tailwind size class (`size-8`, `size-10`, etc.). Default `size-10`. */
  sizeClassName?: string;
  /** Extra classes for the fallback (e.g. `text-xl` on big avatars). */
  fallbackClassName?: string;
  className?: string;
}

/**
 * Single source of truth for rendering a user's avatar: real image
 * when one is uploaded, deterministic tinted initials when not.
 * Drop this in wherever a user shows up — top bar, roster, comments,
 * mentions — so the look stays consistent across the app.
 */
export function UserAvatar({
  name,
  email,
  avatar,
  sizeClassName = "size-10",
  fallbackClassName,
  className,
}: UserAvatarProps) {
  const tint = avatarColour(email);

  return (
    <Avatar className={cn(sizeClassName, className)}>
      {avatar ? <AvatarImage src={avatar} alt={name} /> : null}
      <AvatarFallback
        className={cn(
          "font-semibold",
          tint.bg,
          tint.text,
          fallbackClassName,
        )}
      >
        {initialsOf(name || email)}
      </AvatarFallback>
    </Avatar>
  );
}
