"use client";

import { useEffect, useState } from "react";
import type { ColumnFilterValue, PersistedTableState } from "./types";

const STORAGE_PREFIX = "dataTable";

function storageKey(tableId: string) {
  return `${STORAGE_PREFIX}.${tableId}`;
}

function readState(tableId: string): PersistedTableState {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey(tableId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistedTableState;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeState(tableId: string, state: PersistedTableState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(tableId), JSON.stringify(state));
  } catch {
    // Quota exceeded / private mode — degrade silently. The table
    // still works for the current session; preferences won't persist.
  }
}

/**
 * Persistent column order + visibility per table. Returns the current
 * state plus setters that immediately write back to localStorage.
 *
 * Defers initial read to a useEffect so SSR + first client render
 * match (no hydration mismatch from variable localStorage).
 *
 * `defaultHiddenIds` seeds the hidden-column set on the very first
 * visit (no persisted entry yet). Once the user customizes via the
 * Columns menu, their preference takes over.
 */
export function useTableState(tableId: string, defaultHiddenIds: string[] = []) {
  const [state, setState] = useState<PersistedTableState>({});

  useEffect(() => {
    const persisted = readState(tableId);
    if (persisted.hiddenColumns === undefined && defaultHiddenIds.length > 0) {
      // First visit — seed with the columns the table author marked
      // as `defaultHidden`. We don't persist the seed; if the user
      // toggles one on later, that becomes the persisted state.
      setState({ ...persisted, hiddenColumns: [...defaultHiddenIds] });
    } else {
      setState(persisted);
    }
    // defaultHiddenIds is stable per render of the parent (it's
    // derived from a static columns config), so depending on it would
    // just re-seed every render. Read on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId]);

  function setColumnOrder(order: string[]) {
    setState((s) => {
      const next = { ...s, columnOrder: order };
      writeState(tableId, next);
      return next;
    });
  }

  function setHiddenColumns(hidden: string[]) {
    setState((s) => {
      const next = { ...s, hiddenColumns: hidden };
      writeState(tableId, next);
      return next;
    });
  }

  function toggleColumn(id: string, hidden: boolean) {
    setState((s) => {
      const current = new Set(s.hiddenColumns ?? []);
      if (hidden) current.add(id);
      else current.delete(id);
      const next = { ...s, hiddenColumns: Array.from(current) };
      writeState(tableId, next);
      return next;
    });
  }

  function setColumnFilter(field: string, value: ColumnFilterValue | null) {
    setState((s) => {
      const current = { ...(s.columnFilters ?? {}) };
      if (value === null) {
        delete current[field];
      } else {
        current[field] = value;
      }
      const next = { ...s, columnFilters: current };
      writeState(tableId, next);
      return next;
    });
  }

  function clearAllColumnFilters() {
    setState((s) => {
      const next = { ...s, columnFilters: {} };
      writeState(tableId, next);
      return next;
    });
  }

  return {
    columnOrder: state.columnOrder ?? null,
    hiddenColumns: new Set(state.hiddenColumns ?? []),
    columnFilters: state.columnFilters ?? {},
    setColumnOrder,
    setHiddenColumns,
    toggleColumn,
    setColumnFilter,
    clearAllColumnFilters,
  };
}
