/** Single source of truth: zustand + immer + subscribeWithSelector. The render
 *  loop reads `project`/`view` off a vanilla subscription mirror; ~5 UI widgets
 *  read slices via hooks. Every ProjectDoc mutation routes through `_history`;
 *  `view`/`ui` mutate via plain set. See FOUNDATION-SPEC §2.3. */

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { setAutoFreeze } from "immer";

// The store state holds a non-plain object (`_history`, with a mutable `writeback`
// hook the App assigns after mount). immer's default auto-freeze would freeze it
// and make that assignment throw, so disable it. Snapshots stay structurally
// shared; we never mutate captured history snapshots, so freezing buys nothing.
setAutoFreeze(false);
import type { Params, ExportSettings } from "../params";
import { DEFAULT_PARAMS, DEFAULT_EXPORT } from "../params";
import { deriveMacro } from "./macros";
import { createHistory, type History } from "./history";
import type {
  ProjectDoc,
  ViewState,
  UiState,
  MacroState,
  ModSource,
  Modulator,
  SourceMeta,
} from "./types";

/** Leva<->store bridge guard. App sets `writebackActive` true around a
 *  programmatic Leva `set(...)` (undo/redo/load/macro/preset reflection) so the
 *  resulting onChange echoes are ignored instead of re-recorded. The history
 *  `before===after` no-op guard is the async backstop if Leva ever defers
 *  onChange past this synchronous window. */
export const bridge = { writebackActive: false };

export const DEFAULT_MACROS: MacroState = {
  responsiveness: 0.5,
  density: 0.5,
  boldness: 0.5,
  size: 0.4,
};

export const DEFAULT_SOURCE: SourceMeta = {
  kind: "generated",
  duration: null,
};

export function createDefaultDoc(): ProjectDoc {
  return {
    schemaVersion: 1,
    params: { ...DEFAULT_PARAMS },
    macros: { ...DEFAULT_MACROS },
    modSources: [],
    modulators: [],
    source: { ...DEFAULT_SOURCE },
    export: { ...DEFAULT_EXPORT },
  };
}

let _idCounter = 0;
function genId(prefix: string): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${(_idCounter++).toString(36)}`;
}

export interface StoreApi {
  project: ProjectDoc;
  view: ViewState;
  ui: UiState;

  // --- internal (not public) ---
  _history: History;

  // === PARAM EDITS (undoable, coalesced by key) ===
  setParam<K extends keyof Params>(key: K, value: Params[K]): void;
  patchParams(patch: Partial<Params>, label?: string): void; // preset: one txn

  // === MACRO EDITS (undoable; fan-out is ONE atomic txn; coalesces on drag) ===
  setMacro(key: keyof MacroState, value: number): void;

  // === RANDOMIZE / PRESET (undoable; ONE atomic txn across params + macros) ===
  applyLook(flat: Record<string, unknown>): void;

  // === MODULATORS (undoable) ===
  addModSource(s: Omit<ModSource, "id">): string; // returns id
  removeModSource(id: string): void;
  addModulator(m: Omit<Modulator, "id">): string;
  updateModulator(id: string, patch: Partial<Modulator>): void;
  removeModulator(id: string): void;

  // === STRUCTURAL (undoable; carries a runtime-reset effect) ===
  setSource(meta: SourceMeta): void;

  // === EXPORT (undoable, coalesced) ===
  patchExport(patch: Partial<ExportSettings>): void;

  // === LIFECYCLE ===
  loadProject(doc: ProjectDoc): void; // .nodeflow open / autosave restore; clears history
  resetProject(): void;

  // === UNDO/REDO + drag bracketing ===
  undo(): void;
  redo(): void;
  beginDrag(): void;
  endDrag(): void;

  // === TRANSIENT (never undoable) ===
  setView(patch: Partial<ViewState>): void;
  setUi(patch: Partial<UiState>): void;
}

const DEFAULT_VIEW: ViewState = {
  raw: false,
  zoom: 1,
  pan: { x: 0, y: 0 },
};

const DEFAULT_UI: UiState = {
  dragging: false,
  loading: false,
  toast: null,
  exportProgress: null,
  showExport: false,
  needsRelink: false,
};

export const useStore = create<StoreApi>()(
  subscribeWithSelector(
    immer((set, get) => {
      const history = createHistory({
        getDoc: () => get().project,
        setDoc: (doc) =>
          set((s) => {
            s.project = doc;
          }),
      });

      // Reflect the current store doc back into Leva, deferred to a microtask so
      // it never re-enters a Leva onChange synchronously (avoids reentrancy when
      // a macro/preset edit originates from the panel itself).
      const reflect = () =>
        queueMicrotask(() => history.writeback?.(get().project));

      return {
        project: createDefaultDoc(),
        view: { ...DEFAULT_VIEW },
        ui: { ...DEFAULT_UI },

        _history: history,

        setParam(key, value) {
          history.record(`param:${String(key)}`, (d) => {
            (d.params[key] as Params[typeof key]) = value;
          });
        },

        patchParams(patch, label = "params") {
          history.commitOnce(label, (d) => {
            Object.assign(d.params, patch);
          });
          reflect();
        },

        setMacro(key, value) {
          const children = deriveMacro(key, value);
          // record (not commitOnce): macro + its derived children land in ONE
          // entry, AND successive ticks of a macro drag coalesce by label/window.
          history.record(`macro:${key}`, (d) => {
            d.macros[key] = value;
            Object.assign(d.params, children);
          });
          reflect();
        },

        applyLook(flat) {
          history.commitOnce("randomize", (d) => {
            for (const k of Object.keys(flat)) {
              const v = flat[k];
              if (k in d.macros) {
                (d.macros as Record<string, unknown>)[k] = v;
                Object.assign(d.params, deriveMacro(k as keyof MacroState, v as number));
              } else if (k in d.params) {
                (d.params as Record<string, unknown>)[k] = v;
              }
            }
          });
          reflect();
        },

        addModSource(s) {
          const id = genId("src");
          history.commitOnce("addModSource", (d) => {
            d.modSources.push({ ...s, id });
          });
          return id;
        },

        removeModSource(id) {
          history.commitOnce("removeModSource", (d) => {
            d.modSources = d.modSources.filter((s) => s.id !== id);
            d.modulators = d.modulators.filter((m) => m.sourceId !== id);
          });
        },

        addModulator(m) {
          const id = genId("mod");
          history.commitOnce("addModulator", (d) => {
            d.modulators.push({ ...m, id });
          });
          return id;
        },

        updateModulator(id, patch) {
          history.record(`updateModulator:${id}`, (d) => {
            const m = d.modulators.find((x) => x.id === id);
            if (m) Object.assign(m, patch);
          });
        },

        removeModulator(id) {
          history.commitOnce("removeModulator", (d) => {
            d.modulators = d.modulators.filter((m) => m.id !== id);
          });
        },

        setSource(meta) {
          // Non-undoable: source meta is coupled to a runtime FrameSource and (for
          // files) a re-link flow, so undoing a swap would desync meta from the
          // live source. It is still persisted (autosave + .nodeflow capture it),
          // just kept out of the undo timeline.
          set((s) => {
            s.project.source = meta;
          });
        },

        patchExport(patch) {
          history.record("export", (d) => {
            Object.assign(d.export, patch);
          });
        },

        loadProject(doc) {
          set((s) => {
            s.project = doc;
          });
          history.clear();
          reflect();
        },

        resetProject() {
          set((s) => {
            s.project = createDefaultDoc();
          });
          history.clear();
          reflect();
        },

        undo() {
          history.undo();
        },

        redo() {
          history.redo();
        },

        beginDrag() {
          history.beginDrag();
        },

        endDrag() {
          history.endDrag();
        },

        setView(patch) {
          set((s) => {
            Object.assign(s.view, patch);
          });
        },

        setUi(patch) {
          set((s) => {
            Object.assign(s.ui, patch);
          });
        },
      };
    })
  )
);

// Dev-only: expose the store for debugging + in-browser verification.
if (import.meta.env.DEV) {
  (globalThis as unknown as { __nf?: typeof useStore }).__nf = useStore;
}
