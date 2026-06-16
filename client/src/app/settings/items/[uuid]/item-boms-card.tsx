import Link from "next/link";
import { ListChecks, Plus, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge-mini";
import { formatCompanyDate } from "@/lib/format/company";
import { getCompanyDefaults } from "@/lib/company/server";
import { listBOMsForItem } from "@/lib/production/server";
import type { Item } from "@/lib/types";

interface Props {
  item: Item;
  canCreate: boolean;
}

// Mirror of `Backend.Production.@bommable_item_types`. Server-side
// is authoritative — this set is just to decide whether to render
// the card on the desktop. Anything else is a recipe input
// (raw_material, packaging) and never owns a BOM.
const BOMMABLE_ITEM_TYPES = new Set(["finished_product", "semi_finished"]);

/**
 * BOMs attached to this item. Renders only when `item.item_type` is
 * a bommable kind; server-side enforces the same rule so a forged
 * POST gets the same rejection.
 *
 * Server-rendered so the audit-style data lands without a
 * client-side fetch.
 */
export async function ItemBOMsCard({ item, canCreate }: Props) {
  if (!BOMMABLE_ITEM_TYPES.has(item.item_type)) return null;

  const [boms, prefs] = await Promise.all([
    listBOMsForItem(item.id),
    getCompanyDefaults(),
  ]);

  return (
    <section className="rounded-lg border border-border/60 bg-card p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <ListChecks className="size-4" />
          Bills of Materials
          {boms.length > 0 && (
            <span className="text-xs text-muted-foreground/70">
              · {boms.length}
            </span>
          )}
        </h2>
        {canCreate && (
          <Button asChild size="sm" variant="outline">
            <Link
              href={`/production/boms/new?item=${encodeURIComponent(item.uuid)}`}
            >
              <Plus className="mr-1.5 size-3.5" />
              Create BOM
            </Link>
          </Button>
        )}
      </header>

      {boms.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No BOMs on this item yet. The first one you create is
          auto-flagged as primary.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {boms.map((b) => (
            <li key={b.uuid}>
              <Link
                href={`/production/boms/${b.uuid}`}
                className="flex flex-wrap items-start gap-3 rounded-md border border-border/40 px-3 py-2 hover:bg-muted/30"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-xs font-semibold text-muted-foreground">
                      {b.code ?? `#${b.id}`}
                    </span>
                    {b.is_primary && (
                      <Badge tone="emerald">
                        <Star className="size-2.5" />
                        Primary
                      </Badge>
                    )}
                    {!b.is_active && <Badge tone="muted">Archived</Badge>}
                  </div>
                  <p className="truncate text-sm font-medium">{b.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Updated {formatCompanyDate(b.updated_at, prefs)}
                    {b.updated_by ? ` · by ${b.updated_by.name}` : ""}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
