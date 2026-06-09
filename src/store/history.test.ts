/** Keystone regression suite for the hand-rolled command stack (FOUNDATION-SPEC
 *  §2.4). Drives createHistory through getDoc/setDoc closures over a local doc and
 *  an injectable clock so coalescing is deterministic — never real timers. Every
 *  assertion pins the REAL behavior of src/store/history.ts as verified in-browser;
 *  the no-phantom and zero-net-drag cases guard Risk #1 and Risk #4 (B1/B2). */

import { describe, expect, it, vi } from "vitest";
import { createHistory, docEqual, COALESCE_MS, MAX_DEPTH } from "./history";
import type { ProjectDoc } from "./types";

/** Minimal-but-faithful ProjectDoc, built inline to keep this suite in pure-node
 *  env (importing store.ts would pull in zustand + import.meta.env.DEV). Shape
 *  matches ./types; only the handful of fields the tests mutate need real values. */
function makeDoc(): ProjectDoc {
  return {
    schemaVersion: 1,
    params: {
      renderWidth: 960,
      renderHeight: 540,
      background: "#000000",
      motionGrid: 96,
      motionThreshold: 0.035,
      trailDecay: 0.82,
      preBlur: 1,
      boxScale: 40,
      minBlobSize: 30,
      maxBlobSize: 100,
      maxBlobs: 12,
      mergeDistance: 40,
      boxPadding: 10,
      boxShape: "rect",
      boxSmoothing: 0.35,
      boxColor: "#ffffff",
      boxWidth: 1.5,
      showBoxes: true,
      cornerTicks: false,
      connectorStyle: "curved",
      connectorMaxDist: 320,
      connectorColor: "#ffffff",
      connectorWidth: 1,
      connectorCurve: 0.25,
      effect: "dither",
      effectScope: "blobs",
      pixelSize: 4,
      levels: 3,
      mono: false,
      invert: false,
      effectColor: "#ffffff",
    },
    macros: { responsiveness: 0.5, density: 0.5, boldness: 0.5, size: 0.4 },
    modSources: [],
    modulators: [],
    source: { kind: "generated", duration: null },
    export: {
      exportScale: 1,
      exportFps: 30,
      exportSeconds: 6,
      exportBitrateMbps: 12,
    },
  };
}

/** A harness binding a fresh history to a local doc, with a controllable clock.
 *  Advance time with `tick(ms)`; `now()` feeds createHistory's injected clock. */
function setup() {
  let doc = makeDoc();
  let now = 0;
  const history = createHistory({
    getDoc: () => doc,
    setDoc: (d) => {
      doc = d;
    },
    now: () => now,
  });
  return {
    history,
    getDoc: () => doc,
    tick: (ms: number) => {
      now += ms;
    },
    setNow: (ms: number) => {
      now = ms;
    },
  };
}

describe("docEqual", () => {
  it("treats NaN === NaN as equal (Leva empty-input guard)", () => {
    expect(docEqual(NaN, NaN)).toBe(true);
    expect(docEqual(1, 1)).toBe(true);
    expect(docEqual(1, 2)).toBe(false);
  });

  it("deep-compares nested objects and arrays", () => {
    expect(docEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(docEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false);
    expect(docEqual([1, 2], [1, 2, 3])).toBe(false);
  });
});

describe("record() coalescing", () => {
  it("coalesces same-label edits within COALESCE_MS into ONE undo entry", () => {
    const { history, getDoc, tick } = setup();

    history.record("param:boxScale", (d) => {
      d.params.boxScale = 41;
    });
    tick(COALESCE_MS - 1); // 349ms < 350ms window
    history.record("param:boxScale", (d) => {
      d.params.boxScale = 42;
    });

    expect(getDoc().params.boxScale).toBe(42);
    expect(history.canUndo()).toBe(true);

    history.undo();
    // ONE entry — undo reverts straight to the pre-first-edit baseline.
    expect(getDoc().params.boxScale).toBe(40);
    expect(history.canUndo()).toBe(false);
  });

  it("does NOT coalesce same-label edits past COALESCE_MS => two entries", () => {
    const { history, getDoc, tick } = setup();

    history.record("param:boxScale", (d) => {
      d.params.boxScale = 41;
    });
    tick(COALESCE_MS + 1); // 351ms > 350ms window
    history.record("param:boxScale", (d) => {
      d.params.boxScale = 42;
    });

    expect(getDoc().params.boxScale).toBe(42);

    history.undo();
    expect(getDoc().params.boxScale).toBe(41); // first entry survives
    expect(history.canUndo()).toBe(true);

    history.undo();
    expect(getDoc().params.boxScale).toBe(40);
    expect(history.canUndo()).toBe(false);
  });

  it("never coalesces distinct labels, even inside the time window", () => {
    const { history, getDoc, tick } = setup();

    history.record("param:boxScale", (d) => {
      d.params.boxScale = 41;
    });
    tick(10); // well within COALESCE_MS, but label differs
    history.record("param:boxWidth", (d) => {
      d.params.boxWidth = 2;
    });

    history.undo();
    expect(getDoc().params.boxWidth).toBe(1.5);
    expect(getDoc().params.boxScale).toBe(41);
    expect(history.canUndo()).toBe(true);

    history.undo();
    expect(getDoc().params.boxScale).toBe(40);
    expect(history.canUndo()).toBe(false);
  });
});

describe("no-op guard (Risk #1 belt-and-suspenders)", () => {
  it("records nothing when the mutation changes nothing", () => {
    const { history, getDoc } = setup();

    history.record("param:boxScale", (d) => {
      d.params.boxScale = 40; // identical to baseline
    });

    expect(history.canUndo()).toBe(false);
    expect(getDoc().params.boxScale).toBe(40);
  });

  it("docEqual treats NaN as equal so an unchanged NaN never records", () => {
    expect(docEqual(NaN, NaN)).toBe(true);
  });
});

describe("drag bracketing", () => {
  it("collapses beginDrag + 3 records + endDrag into ONE entry reverting to baseline", () => {
    const { history, getDoc, tick } = setup();

    history.beginDrag();
    history.record("param:boxScale", (d) => {
      d.params.boxScale = 41;
    });
    tick(5);
    history.record("param:boxScale", (d) => {
      d.params.boxScale = 55;
    });
    tick(5);
    history.record("param:boxScale", (d) => {
      d.params.boxScale = 72;
    });
    history.endDrag();

    // Live mutations applied during the drag.
    expect(getDoc().params.boxScale).toBe(72);
    expect(history.canUndo()).toBe(true);

    history.undo();
    // ONE entry — straight back to the pre-drag baseline (40), not 55 or 41.
    expect(getDoc().params.boxScale).toBe(40);
    expect(history.canUndo()).toBe(false);
  });

  it("a zero-net drag pushes nothing AND resets lastLabel so the next same-label edit does NOT coalesce into the pre-drag entry [Risk #4 / B2]", () => {
    const { history, getDoc, tick } = setup();

    // Pre-drag entry that the post-drag edit shares a label with.
    history.record("param:boxScale", (d) => {
      d.params.boxScale = 50;
    });

    // Drag that returns to its own baseline => zero net change => no entry.
    history.beginDrag();
    history.record("param:boxScale", (d) => {
      d.params.boxScale = 90;
    });
    history.record("param:boxScale", (d) => {
      d.params.boxScale = 50; // back to drag baseline
    });
    history.endDrag();
    expect(getDoc().params.boxScale).toBe(50);

    // Immediately after the zero-net drag, a same-label edit inside the window.
    tick(5);
    history.record("param:boxScale", (d) => {
      d.params.boxScale = 51;
    });

    // It must NOT have coalesced into the pre-drag entry: undo peels off 51->50,
    // leaving the pre-drag entry intact.
    history.undo();
    expect(getDoc().params.boxScale).toBe(50);
    expect(history.canUndo()).toBe(true);

    history.undo();
    expect(getDoc().params.boxScale).toBe(40);
    expect(history.canUndo()).toBe(false);
  });

  it("commitOnce mid-drag seals the drag and pushes a SEPARATE entry; undoing the structural edit does NOT revert the drag [B1]", () => {
    const { history, getDoc, tick } = setup();

    history.beginDrag();
    history.record("param:boxScale", (d) => {
      d.params.boxScale = 60; // drag moved boxScale away from baseline (40)
    });
    tick(5);
    history.commitOnce("addModulator", (d) => {
      d.modulators.push({
        id: "m1",
        enabled: true,
        sourceId: "s1",
        target: "boxScale",
        depth: 0.5,
        responsiveness: 0.5,
      });
    });
    tick(5);
    history.record("param:boxScale", (d) => {
      d.params.boxScale = 75; // further drag movement after the structural edit
    });
    history.endDrag();

    expect(getDoc().params.boxScale).toBe(75);
    expect(getDoc().modulators).toHaveLength(1);

    // Entries, top-down:
    //   3) post-commit drag segment: boxScale 60 -> 75
    //   2) structural commitOnce:    modulators [] -> [m1]
    //   1) pre-commit drag segment:  boxScale 40 -> 60
    // Undo #1: peel the post-commit drag segment.
    history.undo();
    expect(getDoc().params.boxScale).toBe(60);
    expect(getDoc().modulators).toHaveLength(1); // modulator untouched

    // Undo #2: peel the structural edit ONLY — boxScale must stay at 60.
    history.undo();
    expect(getDoc().modulators).toHaveLength(0);
    expect(getDoc().params.boxScale).toBe(60); // drag NOT reverted by this undo

    // Undo #3: peel the pre-commit drag segment.
    history.undo();
    expect(getDoc().params.boxScale).toBe(40);
    expect(getDoc().modulators).toHaveLength(0);
    expect(history.canUndo()).toBe(false);
  });
});

describe("undo / redo navigation", () => {
  it("moves entries between stacks and restores snapshots in order", () => {
    const { history, getDoc, tick } = setup();

    history.record("param:boxScale", (d) => {
      d.params.boxScale = 41;
    });
    tick(COALESCE_MS + 1);
    history.record("param:boxWidth", (d) => {
      d.params.boxWidth = 2;
    });

    history.undo();
    expect(getDoc().params.boxWidth).toBe(1.5);
    expect(history.canRedo()).toBe(true);

    history.redo();
    expect(getDoc().params.boxWidth).toBe(2);
    expect(history.canRedo()).toBe(false);
  });

  it("a new edit after undo clears the redo stack", () => {
    const { history, getDoc, tick } = setup();

    history.record("param:boxScale", (d) => {
      d.params.boxScale = 41;
    });
    tick(COALESCE_MS + 1);
    history.record("param:boxWidth", (d) => {
      d.params.boxWidth = 2;
    });

    history.undo(); // boxWidth edit now redoable
    expect(history.canRedo()).toBe(true);

    history.record("param:mergeDistance", (d) => {
      d.params.mergeDistance = 50;
    });
    expect(history.canRedo()).toBe(false); // redo branch discarded

    history.redo(); // no-op now
    expect(getDoc().params.mergeDistance).toBe(50);
    expect(getDoc().params.boxWidth).toBe(1.5); // the discarded redo did not re-apply
  });
});

describe("MAX_DEPTH trimming", () => {
  it(`caps the undo stack at ${MAX_DEPTH}: 105 distinct entries trim the oldest`, () => {
    const { history, getDoc, tick } = setup();
    const total = MAX_DEPTH + 5; // 105

    // 105 distinct labels => 105 separate entries, oldest 5 trimmed to cap at 100.
    for (let i = 0; i < total; i++) {
      tick(COALESCE_MS + 1); // distinct labels anyway; keep windows clean
      history.record(`param:edit${i}`, (d) => {
        d.params.boxScale = i + 1; // 1..105
      });
    }

    expect(getDoc().params.boxScale).toBe(total); // 105

    expect(history.canUndo()).toBe(true);
    for (let i = 0; i < MAX_DEPTH; i++) {
      expect(history.canUndo()).toBe(true);
      history.undo();
    }
    // After 100 undos the stack is empty (oldest 5 were trimmed, never recorded).
    expect(history.canUndo()).toBe(false);

    // Stack held exactly the most-recent 100 entries: entry #6 (boxScale 6) was
    // the oldest survivor, so the final undo landed on its `before` = 5.
    expect(getDoc().params.boxScale).toBe(5);
  });
});

describe("writeback no-phantom (Risk #1)", () => {
  it("undo() does not grow the undo stack when writeback re-records a no-op", () => {
    const { history, getDoc } = setup();

    history.record("param:boxScale", (d) => {
      d.params.boxScale = 41;
    });
    expect(history.canUndo()).toBe(true);

    // Edge C echo: writeback re-enters record() with the SAME value (the no-op
    // the epoch guard + before===after guard must swallow).
    const writeback = vi.fn((doc: ProjectDoc) => {
      history.record("param:boxScale", (d) => {
        d.params.boxScale = doc.params.boxScale; // identical => no-op guard fires
      });
    });
    history.writeback = writeback;

    history.undo();

    expect(writeback).toHaveBeenCalledTimes(1);
    expect(writeback).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ boxScale: 40 }),
      })
    );
    // The phantom must not have repopulated the undo stack.
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true); // the genuine edit is redoable
    expect(getDoc().params.boxScale).toBe(40);
  });
});
