"use client";

import { useEffect, useState } from "react";
import type { PersistedTableState } from "./types";

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
 */
export function useTableState(tableId: string) {
  const [state, setState] = useState<PersistedTableState>({});

  useEffect(() => {
    setState(readState(tableId));
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

  return {
    columnOrder: state.columnOrder ?? null,
    hiddenColumns: new Set(state.hiddenColumns ?? []),
    setColumnOrder,
    setHiddenColumns,
    toggleColumn,
  };
}
