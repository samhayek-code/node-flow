/** Hand-rolled command stack of before/after ProjectDoc snapshots, with two-layer
 *  coalescing (pointer-bracketed drag window + 350ms same-label time window).
 *  See FOUNDATION-SPEC §2.4. */

import { produce, type Draft } from "immer";
import type { ProjectDoc } from "./types";

export const COALESCE_MS = 350;
export const MAX_DEPTH = 100;

interface Entry {
  label: string;
  before: ProjectDoc;
  after: ProjectDoc;
}

/** Structural deep equality over the plain-data ProjectDoc (primitives, arrays,
 *  objects only — no media). Used for the before===after no-op guard. */
export function docEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // NaN guard: Leva number fields can emit NaN on empty input; treat NaN===NaN
  // as equal so an unchanged NaN value never records a phantom no-op entry.
  if (typeof a === "number" && typeof b === "number") {
    return Number.isNaN(a) && Number.isNaN(b);
  }
  if (
    a === null ||
    b === null ||
    typeof a !== "object" ||
    typeof b !== "object"
  ) {
    return false;
  }
  const aArr = Array.isArray(a);
  if (aArr !== Array.isArray(b)) return false;
  if (aArr) {
    const al = a as unknown[];
    const bl = b as unknown[];
    if (al.length !== bl.length) return false;
    for (let i = 0; i < al.length; i++) {
      if (!docEqual(al[i], bl[i])) return false;
    }
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao);
  const bKeys = Object.keys(bo);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
    if (!docEqual(ao[k], bo[k])) return false;
  }
  return true;
}

export interface History {
  record(label: string, mut: (d: Draft<ProjectDoc>) => void): void; // coalesces by label+window
  commitOnce(label: string, mut: (d: Draft<ProjectDoc>) => void): void; // never coalesces
  beginDrag(): void; // pointer-down: opens a coalescing window, captures baseline
  endDrag(): void; // pointer-up: seals ONE entry spanning the drag
  undo(): void;
  redo(): void;
  clear(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** store->Leva reflection hook, wired once in App after Leva mounts (§3). */
  writeback?: (doc: ProjectDoc) => void;
}

export interface HistoryDeps {
  /** Reads the current persisted ProjectDoc from the store. */
  getDoc: () => ProjectDoc;
  /** Commits a new ProjectDoc into the store (immer-produced, structurally shared). */
  setDoc: (doc: ProjectDoc) => void;
  /** Time source; injectable for deterministic tests. Defaults to performance.now. */
  now?: () => number;
}

export function createHistory(deps: HistoryDeps): History {
  const { getDoc, setDoc } = deps;
  const now = deps.now ?? (() => performance.now());

  const undoStack: Entry[] = [];
  const redoStack: Entry[] = [];

  let lastLabel: string | null = null;
  let lastAt = 0;

  // Drag bracket: while open, record() mutates live but pushes nothing.
  let dragOpen = false;
  let dragBaseline: ProjectDoc | null = null;

  const history: History = {
    record(label, mut) {
      const before = getDoc();
      const after = produce(before, mut);

      // No-op guard (Risk #1 belt-and-suspenders): nothing changed, push nothing.
      if (docEqual(before, after)) return;

      // Commit the mutation to the store either way.
      setDoc(after);

      if (dragOpen) {
        // Baseline captured at beginDrag; entry is sealed on endDrag.
        return;
      }

      const t = now();
      const coalesce =
        undoStack.length > 0 &&
        lastLabel === label &&
        t - lastAt <= COALESCE_MS;

      if (coalesce) {
        undoStack[undoStack.length - 1].after = after;
      } else {
        undoStack.push({ label, before, after });
        if (undoStack.length > MAX_DEPTH) undoStack.shift();
      }
      lastLabel = label;
      lastAt = t;
      redoStack.length = 0;
    },

    commitOnce(label, mut) {
      const before = getDoc();
      const after = produce(before, mut);
      if (docEqual(before, after)) return;

      setDoc(after);

      if (dragOpen) {
        // A structural edit arrived mid-drag. commitOnce must NEVER coalesce
        // (its contract), so seal the drag accumulated so far as its own entry,
        // push the structural edit as a separate entry, then re-baseline the
        // drag so the remaining pointer movement brackets cleanly on endDrag.
        if (dragBaseline && !docEqual(dragBaseline, before)) {
          undoStack.push({ label: "drag", before: dragBaseline, after: before });
          if (undoStack.length > MAX_DEPTH) undoStack.shift();
        }
        undoStack.push({ label, before, after });
        if (undoStack.length > MAX_DEPTH) undoStack.shift();
        dragBaseline = after;
        lastLabel = null;
        lastAt = 0;
        redoStack.length = 0;
        return;
      }

      undoStack.push({ label, before, after });
      if (undoStack.length > MAX_DEPTH) undoStack.shift();
      // commitOnce never coalesces with subsequent edits.
      lastLabel = null;
      lastAt = 0;
      redoStack.length = 0;
    },

    beginDrag() {
      if (dragOpen) return;
      dragOpen = true;
      dragBaseline = getDoc();
    },

    endDrag() {
      if (!dragOpen) return;
      dragOpen = false;
      const before = dragBaseline;
      dragBaseline = null;
      // Reset coalescing markers regardless of net change: a drag is always an
      // interaction boundary, so the next edit must start a fresh entry.
      lastLabel = null;
      lastAt = 0;
      if (!before) return;
      const after = getDoc();
      if (docEqual(before, after)) return; // drag with no net change

      undoStack.push({ label: "drag", before, after });
      if (undoStack.length > MAX_DEPTH) undoStack.shift();
      redoStack.length = 0;
    },

    undo() {
      const entry = undoStack.pop();
      if (!entry) return;
      redoStack.push(entry);
      setDoc(entry.before);
      lastLabel = null;
      lastAt = 0;
      history.writeback?.(entry.before);
    },

    redo() {
      const entry = redoStack.pop();
      if (!entry) return;
      undoStack.push(entry);
      if (undoStack.length > MAX_DEPTH) undoStack.shift();
      setDoc(entry.after);
      lastLabel = null;
      lastAt = 0;
      history.writeback?.(entry.after);
    },

    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
      lastLabel = null;
      lastAt = 0;
      dragOpen = false;
      dragBaseline = null;
    },

    canUndo() {
      return undoStack.length > 0;
    },

    canRedo() {
      return redoStack.length > 0;
    },
  };

  return history;
}
