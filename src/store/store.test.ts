/** Integration tests for the store action surface (FOUNDATION-SPEC §2.3).
 *  Runs in node — zustand + immer work without a DOM. Each mutation that lands
 *  in ProjectDoc routes through _history; we assert undo/redo, atomic-txn
 *  grouping (macro fan-out, applyLook patch), lifecycle history-clearing, and
 *  immer structural sharing of the untouched `export` slice. */

import { describe, it, expect, beforeEach } from "vitest";
import { useStore, DEFAULT_MACROS } from "./store";
import { DEFAULT_PARAMS, DEFAULT_EXPORT } from "../params";
import { createDefaultDoc } from "./store";
import { deriveMacro } from "./macros";

const store = () => useStore.getState();
// store.ts defers history.writeback via queueMicrotask(reflect); writeback is
// undefined in tests (no Leva), so it's a safe no-op. Flush microtasks anyway
// so each test starts from a settled state and nothing leaks across tests.
const flush = () => Promise.resolve();

beforeEach(async () => {
  store().resetProject();
  await flush();
});

describe("setParam — undoable single edit", () => {
  it("records an undoable change; undo reverts; redo re-applies", () => {
    expect(store().project.params.boxScale).toBe(DEFAULT_PARAMS.boxScale);
    expect(store()._history.canUndo()).toBe(false);

    store().setParam("boxScale", 77);
    expect(store().project.params.boxScale).toBe(77);
    expect(store()._history.canUndo()).toBe(true);

    store().undo();
    expect(store().project.params.boxScale).toBe(DEFAULT_PARAMS.boxScale);
    expect(store()._history.canUndo()).toBe(false);
    expect(store()._history.canRedo()).toBe(true);

    store().redo();
    expect(store().project.params.boxScale).toBe(77);
    expect(store()._history.canRedo()).toBe(false);
  });

  it("is a no-op when the value does not change (before === after)", () => {
    store().setParam("boxScale", DEFAULT_PARAMS.boxScale);
    expect(store()._history.canUndo()).toBe(false);
  });
});

describe("setMacro — derives children as ONE undo entry", () => {
  it("writes the macro position AND its derived children", () => {
    const children = deriveMacro("size", 0.9);
    store().setMacro("size", 0.9);

    expect(store().project.macros.size).toBe(0.9);
    // size -> { boxScale }
    expect(store().project.params.boxScale).toBe(children.boxScale);
    expect(children.boxScale).toBe(90);
  });

  it("undo reverts the macro AND its children together (single entry)", () => {
    const baseMacro = store().project.macros.responsiveness;
    const baseThreshold = store().project.params.motionThreshold;
    const baseTrail = store().project.params.trailDecay;
    const baseSmoothing = store().project.params.boxSmoothing;

    store().setMacro("responsiveness", 1);
    const children = deriveMacro("responsiveness", 1);
    expect(store().project.macros.responsiveness).toBe(1);
    expect(store().project.params.motionThreshold).toBe(
      children.motionThreshold
    );
    expect(store().project.params.trailDecay).toBe(children.trailDecay);
    expect(store().project.params.boxSmoothing).toBe(children.boxSmoothing);

    // ONE undo rewinds the macro slider AND all three children at once.
    store().undo();
    expect(store().project.macros.responsiveness).toBe(baseMacro);
    expect(store().project.params.motionThreshold).toBe(baseThreshold);
    expect(store().project.params.trailDecay).toBe(baseTrail);
    expect(store().project.params.boxSmoothing).toBe(baseSmoothing);
    // Exactly one entry consumed — nothing left to undo.
    expect(store()._history.canUndo()).toBe(false);
  });
});

describe("applyLook — flat params+macros patch as ONE entry", () => {
  it("applies macros (with derived children) and params in a single transaction", () => {
    store().applyLook({ density: 1, motionThreshold: 0.01 });

    // macro applied + its children derived
    expect(store().project.macros.density).toBe(1);
    const densityChildren = deriveMacro("density", 1);
    expect(store().project.params.motionGrid).toBe(densityChildren.motionGrid);
    expect(store().project.params.connectorMaxDist).toBe(
      densityChildren.connectorMaxDist
    );
    // plain param applied
    expect(store().project.params.motionThreshold).toBe(0.01);
  });

  it("undo reverts the entire patch at once", () => {
    const baseDensity = store().project.macros.density;
    const baseGrid = store().project.params.motionGrid;
    const baseThreshold = store().project.params.motionThreshold;

    store().applyLook({ density: 1, motionThreshold: 0.01 });
    expect(store()._history.canUndo()).toBe(true);

    store().undo();
    expect(store().project.macros.density).toBe(baseDensity);
    expect(store().project.params.motionGrid).toBe(baseGrid);
    expect(store().project.params.motionThreshold).toBe(baseThreshold);
    // applyLook uses commitOnce — exactly one entry.
    expect(store()._history.canUndo()).toBe(false);
  });
});

describe("patchExport — mutates project.export, undoable", () => {
  it("merges the patch and is reverted by undo", () => {
    expect(store().project.export.exportFps).toBe(DEFAULT_EXPORT.exportFps);

    store().patchExport({ exportFps: 60, exportSeconds: 12 });
    expect(store().project.export.exportFps).toBe(60);
    expect(store().project.export.exportSeconds).toBe(12);
    // untouched fields preserved
    expect(store().project.export.exportScale).toBe(DEFAULT_EXPORT.exportScale);
    expect(store()._history.canUndo()).toBe(true);

    store().undo();
    expect(store().project.export.exportFps).toBe(DEFAULT_EXPORT.exportFps);
    expect(store().project.export.exportSeconds).toBe(
      DEFAULT_EXPORT.exportSeconds
    );
  });
});

describe("loadProject — replaces doc, clears history", () => {
  it("swaps the doc and leaves canUndo false", () => {
    // Build some history first.
    store().setParam("boxScale", 99);
    expect(store()._history.canUndo()).toBe(true);

    const incoming = createDefaultDoc();
    incoming.params.boxScale = 12;
    incoming.macros.density = 0.25;

    store().loadProject(incoming);

    expect(store().project.params.boxScale).toBe(12);
    expect(store().project.macros.density).toBe(0.25);
    // History is wiped — a restored session starts a fresh timeline.
    expect(store()._history.canUndo()).toBe(false);
    expect(store()._history.canRedo()).toBe(false);
  });
});

describe("structural sharing — untouched slices keep reference identity", () => {
  it("setParam leaves the export slice referentially equal (immer)", () => {
    const exportBefore = store().project.export;
    const macrosBefore = store().project.macros;

    store().setParam("boxScale", 64);

    // Only params changed; export + macros are the same object (no needless copy).
    expect(store().project.export).toBe(exportBefore);
    expect(store().project.macros).toBe(macrosBefore);
  });
});

describe("defaults sanity", () => {
  it("resetProject restores DEFAULT_PARAMS / DEFAULT_MACROS / DEFAULT_EXPORT", () => {
    expect(store().project.params).toEqual(DEFAULT_PARAMS);
    expect(store().project.macros).toEqual(DEFAULT_MACROS);
    expect(store().project.export).toEqual(DEFAULT_EXPORT);
  });
});
