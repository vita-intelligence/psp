"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ListChecks } from "lucide-react";
import {
  SearchPicker,
  type SearchPickerOption,
} from "@/components/forms/search-picker";
import { BOMEditor } from "../bom-editor";
import type { Item } from "@/lib/types";

interface ItemOption extends SearchPickerOption {
  uuid: string;
  name: string;
  itemType: string;
}

interface Props {
  initialItem: Item | null;
}

/**
 * Direct entry to "Create BOM". When an `?item=<uuid>` query lands
 * on the parent page, we pre-fill the picker. Otherwise the operator
 * picks a bommable item right here — no need to dive into Items
 * first. Picker is filtered server-side to
 * `item_type=finished_product,semi_finished` so raw materials and
 * packaging never show up (matches the BOM gate in
 * `Backend.Production`).
 */
export function NewBOMFlow({ initialItem }: Props) {
  const router = useRouter();
  const [outputItem, setOutputItem] = useState<Item | null>(initialItem);
  const [selected, setSelected] = useState<ItemOption | null>(() =>
    initialItem
      ? {
          id: initialItem.id,
          uuid: initialItem.uuid,
          label: initialItem.name,
          name: initialItem.name,
          itemType: initialItem.item_type,
          code: initialItem.code,
        }
      : null,
  );

  async function searchItems(q: string): Promise<ItemOption[]> {
    const qs = new URLSearchParams({
      item_type: "finished_product,semi_finished",
      limit: "25",
    });
    if (q.trim()) qs.set("search", q.trim());
    try {
      const res = await fetch(`/api/items?${qs.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) return [];
      const body = (await res.json()) as { items?: Item[] };
      const items = body.items ?? [];
      return items.map((i) => ({
        id: i.id,
        uuid: i.uuid,
        label: i.name,
        name: i.name,
        itemType: i.item_type,
        code: i.code,
        sublabel: humaniseType(i.item_type),
      }));
    } catch {
      return [];
    }
  }

  async function onPick(opt: ItemOption | null) {
    setSelected(opt);
    if (!opt) {
      setOutputItem(null);
      router.replace(`/production/boms/new`);
      return;
    }
    // Fetch the full item so the editor has stock_uom + product_family
    // and the URL gains `?item=<uuid>` so a reload preserves the pick.
    try {
      const res = await fetch(`/api/items/${encodeURIComponent(opt.uuid)}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = (await res.json()) as { item?: Item };
      if (!body.item) return;
      setOutputItem(body.item);
      router.replace(`/production/boms/new?item=${encodeURIComponent(opt.uuid)}`);
    } catch {
      /* picker stays selected; editor will warn on save if item is invalid */
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
        <header className="mb-3 flex items-center gap-2">
          <ListChecks className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold tracking-tight">Output item</h2>
        </header>
        <p className="mb-2 text-xs text-muted-foreground">
          Pick the item this recipe builds. Only{" "}
          <strong>finished</strong> and{" "}
          <strong>semi-finished</strong> items qualify — raw materials
          and packaging are recipe inputs.
        </p>
        <SearchPicker<ItemOption>
          value={selected}
          onChange={onPick}
          fetcher={searchItems}
          placeholder="Search by name or code…"
          renderRow={(opt) => (
            <div className="min-w-0">
              <p className="truncate text-sm">{opt.name}</p>
              <p className="text-[10px] text-muted-foreground">
                {humaniseType(opt.itemType)}
                {opt.code ? ` · ${opt.code}` : ""}
              </p>
            </div>
          )}
        />
      </section>

      {outputItem ? (
        <BOMEditor
          bom={null}
          outputItem={outputItem}
          canEdit={true}
          canDelete={false}
        />
      ) : (
        <div className="rounded-lg border border-dashed border-border/60 bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          Pick an output item above to start the recipe.
        </div>
      )}
    </div>
  );
}

function humaniseType(t: string): string {
  switch (t) {
    case "finished_product":
      return "Finished product";
    case "semi_finished":
      return "Semi-finished";
    case "raw_material":
      return "Raw material";
    case "packaging":
      return "Packaging";
    default:
      return t;
  }
}
