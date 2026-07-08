export function initialsOf(name: string | null | undefined): string {
  // Null-safe — an audit event actor with no name AND no email
  // (e.g. the system actor on the integration-token seed path)
  // would otherwise crash the whole audit card.
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
