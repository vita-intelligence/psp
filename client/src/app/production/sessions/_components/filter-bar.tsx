"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AsyncKeyPicker } from "@/components/forms/async-key-picker";
import type { KeyPickerOption } from "@/components/forms/async-key-picker";
import { TRIGGER_LABELS } from "@/lib/forms/types";
import type { FormTrigger } from "@/lib/forms/types";
import { ACTIVITY_KIND_LABELS } from "@/lib/sessions/types";
import type {
  ActivityKind,
  SubmissionLookupItem,
  SubmissionLookupType,
} from "@/lib/sessions/types";
import { fetchSubmissionLookup } from "@/lib/sessions/client";

/**
 * Filter bar for /production/sessions. Every filter writes back to
 * the URL — the RSC re-renders on each change with the new query.
 *
 * Facet pickers are async comboboxes: they hit
 * `/api/production/form-submissions/lookups?type=…` with debounced
 * typeahead. No preloaded lists — the page scales to millions of
 * workstations / machines / forms / workers without shipping the
 * catalog to the browser.
 */

interface Props {
  /** Labels for currently-selected filter uuids, resolved on the
   *  server so the trigger button reads "Blending #1" instead of
   *  "abc-…" the moment the page loads. */
  initialLabels: Partial<Record<SubmissionLookupType, SubmissionLookupItem>>;
  lockedFilters?: {
    workstation_uuid?: boolean;
    equipment_uuid?: boolean;
    form_template_uuid?: boolean;
    submitted_by_id?: boolean;
    submitted_by_uuid?: boolean;
  };
}

const ANY = "__any__";

function toOption(item: SubmissionLookupItem | null): KeyPickerOption | null {
  if (!item) return null;
  return { key: item.key, label: item.label, sublabel: item.sublabel };
}

export function FilterBar({ initialLabels, lockedFilters = {} }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(searchParams.get("search") ?? "");

  const currentTrigger = (searchParams.get("trigger") ?? "") as FormTrigger | "";
  const currentActivity = (searchParams.get("activity_kind") ?? "") as
    | ActivityKind
    | "";
  const currentWs = searchParams.get("workstation_uuid") ?? "";
  const currentEq = searchParams.get("equipment_uuid") ?? "";
  const currentForm = searchParams.get("form_template_uuid") ?? "";
  const currentSubmitterId = searchParams.get("submitted_by_id") ?? "";
  const currentSubmitterUuid = searchParams.get("submitted_by_uuid") ?? "";
  const currentFrom = searchParams.get("from") ?? "";
  const currentTo = searchParams.get("to") ?? "";

  function updateParams(mutator: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutator(params);
    startTransition(() => {
      router.replace(`?${params.toString()}`, { scroll: false });
    });
  }

  function setValue(key: string, value: string) {
    updateParams((p) => {
      if (value && value !== ANY) p.set(key, value);
      else p.delete(key);
    });
  }

  function setUuidPicker(key: string, option: KeyPickerOption | null) {
    updateParams((p) => {
      if (option) p.set(key, option.key);
      else p.delete(key);
    });
  }

  function setSubmitter(option: KeyPickerOption | null) {
    updateParams((p) => {
      p.delete("submitted_by_id");
      p.delete("submitted_by_uuid");
      if (!option) return;
      if (option.key.startsWith("u:"))
        p.set("submitted_by_id", option.key.slice(2));
      if (option.key.startsWith("w:"))
        p.set("submitted_by_uuid", option.key.slice(2));
    });
  }

  function handleSearchCommit() {
    updateParams((p) => {
      if (search.trim()) p.set("search", search.trim());
      else p.delete("search");
    });
  }

  function clearAll() {
    setSearch("");
    updateParams((p) => {
      const preserved = new URLSearchParams();
      const carry = [
        lockedFilters.workstation_uuid ? "workstation_uuid" : null,
        lockedFilters.equipment_uuid ? "equipment_uuid" : null,
        lockedFilters.form_template_uuid ? "form_template_uuid" : null,
        lockedFilters.submitted_by_id ? "submitted_by_id" : null,
        lockedFilters.submitted_by_uuid ? "submitted_by_uuid" : null,
      ].filter(Boolean) as string[];
      carry.forEach((k) => {
        const v = p.get(k);
        if (v) preserved.set(k, v);
      });
      Array.from(p.keys()).forEach((k) => p.delete(k));
      preserved.forEach((v, k) => p.set(k, v));
    });
  }

  const submitterOption = toOption(initialLabels.submitter ?? null);
  const workstationOption = toOption(initialLabels.workstation ?? null);
  const equipmentOption = toOption(initialLabels.equipment ?? null);
  const formOption = toOption(initialLabels.form ?? null);

  const hasFilters =
    !!search.trim() ||
    !!currentTrigger ||
    !!currentActivity ||
    !!currentFrom ||
    !!currentTo ||
    (!lockedFilters.workstation_uuid && !!currentWs) ||
    (!lockedFilters.equipment_uuid && !!currentEq) ||
    (!lockedFilters.form_template_uuid && !!currentForm) ||
    (!lockedFilters.submitted_by_id && !!currentSubmitterId) ||
    (!lockedFilters.submitted_by_uuid && !!currentSubmitterUuid);

  return (
    <div className="grid gap-3 rounded-lg border border-border/60 bg-background/80 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-2">
        <Label className="text-xs text-muted-foreground" htmlFor="search">
          Search
        </Label>
        <Input
          id="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onBlur={handleSearchCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSearchCommit();
          }}
          placeholder="Form name or submitter…"
          className="h-9"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Trigger</Label>
        <Select
          value={currentTrigger || ANY}
          onValueChange={(v) => setValue("trigger", v)}
        >
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Any" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any trigger</SelectItem>
            {(
              Object.keys(TRIGGER_LABELS) as (keyof typeof TRIGGER_LABELS)[]
            ).map((trig) => (
              <SelectItem key={trig} value={trig}>
                {TRIGGER_LABELS[trig]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Activity</Label>
        <Select
          value={currentActivity || ANY}
          onValueChange={(v) => setValue("activity_kind", v)}
        >
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Any" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any activity</SelectItem>
            {(
              Object.keys(
                ACTIVITY_KIND_LABELS,
              ) as (keyof typeof ACTIVITY_KIND_LABELS)[]
            ).map((k) => (
              <SelectItem key={k} value={k}>
                {ACTIVITY_KIND_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Workstation</Label>
        <AsyncKeyPicker
          value={workstationOption}
          onChange={(o) => setUuidPicker("workstation_uuid", o)}
          fetcher={(q, _cursor, signal) =>
            fetchSubmissionLookup("workstation", q, signal)
          }
          disabled={lockedFilters.workstation_uuid}
          placeholder="Any workstation"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Machine</Label>
        <AsyncKeyPicker
          value={equipmentOption}
          onChange={(o) => setUuidPicker("equipment_uuid", o)}
          fetcher={(q, _cursor, signal) =>
            fetchSubmissionLookup("equipment", q, signal)
          }
          disabled={lockedFilters.equipment_uuid}
          placeholder="Any machine"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Form template</Label>
        <AsyncKeyPicker
          value={formOption}
          onChange={(o) => setUuidPicker("form_template_uuid", o)}
          fetcher={(q, _cursor, signal) =>
            fetchSubmissionLookup("form", q, signal)
          }
          disabled={lockedFilters.form_template_uuid}
          placeholder="Any form"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Worker</Label>
        <AsyncKeyPicker
          value={submitterOption}
          onChange={setSubmitter}
          fetcher={(q, _cursor, signal) =>
            fetchSubmissionLookup("submitter", q, signal)
          }
          disabled={
            lockedFilters.submitted_by_id || lockedFilters.submitted_by_uuid
          }
          placeholder="Any worker"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground" htmlFor="from">
          From
        </Label>
        <Input
          id="from"
          type="date"
          value={currentFrom ? currentFrom.slice(0, 10) : ""}
          className="h-9"
          onChange={(e) =>
            setValue("from", e.target.value ? `${e.target.value}T00:00:00Z` : "")
          }
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground" htmlFor="to">
          To
        </Label>
        <Input
          id="to"
          type="date"
          value={currentTo ? currentTo.slice(0, 10) : ""}
          className="h-9"
          onChange={(e) =>
            setValue("to", e.target.value ? `${e.target.value}T23:59:59Z` : "")
          }
        />
      </div>

      <div className="sm:col-span-2 lg:col-span-4 flex items-center justify-end gap-2">
        {pending ? (
          <span className="text-xs text-muted-foreground">Updating…</span>
        ) : null}
        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            <X className="mr-1 size-3.5" /> Clear filters
          </Button>
        ) : null}
      </div>
    </div>
  );
}
