/** Regression coverage for the .nodeflow serialization layer (schema.ts):
 *  round-trip fidelity, tolerant deserialization, envelope-vs-bare acceptance,
 *  and the (currently identity) v1 migration ladder. Asserts the REAL behavior
 *  of the current implementation — see FOUNDATION-SPEC §2.5. */

import { describe, it, expect } from "vitest";
import {
  serializeProject,
  deserializeProject,
  NODEFLOW_VERSION,
} from "./schema";
import { createDefaultDoc } from "../store/store";
import type { ProjectDoc } from "../store/types";

const PROJECT_DOC_KEYS: (keyof ProjectDoc)[] = [
  "schemaVersion",
  "params",
  "macros",
  "modSources",
  "modulators",
  "source",
  "export",
];

describe("schema round-trip", () => {
  it("serialize then deserialize a default doc deep-equals the original", () => {
    const doc = createDefaultDoc();
    const file = serializeProject(doc);
    expect(deserializeProject(file)).toEqual(doc);
  });

  it("round-trips a richly populated doc (modulators, file source, custom params)", () => {
    const doc: ProjectDoc = {
      schemaVersion: 1,
      params: {
        ...createDefaultDoc().params,
        motionThreshold: 0.07,
        boxScale: 73,
        boxShape: "diamond",
        connectorStyle: "straight",
        effect: "halftone",
        mono: true,
      },
      macros: {
        responsiveness: 0.8,
        density: 0.2,
        boldness: 0.9,
        size: 0.5,
      },
      modSources: [
        {
          id: "src_abc",
          kind: "audio",
          audio: { mediaId: "m1", fileName: "kick.wav", duration: 3.5 },
        },
      ],
      modulators: [
        {
          id: "mod_xyz",
          enabled: true,
          sourceId: "src_abc",
          target: "boxScale",
          depth: 0.6,
          responsiveness: 0.4,
          channel: "low",
        },
      ],
      source: {
        kind: "file",
        fileName: "clip.mp4",
        w: 1920,
        h: 1080,
        duration: 12.34,
      },
      export: {
        exportScale: 2,
        exportFps: 60,
        exportSeconds: 10,
        exportBitrateMbps: 24,
      },
    };
    const file = serializeProject(doc);
    expect(deserializeProject(file)).toEqual(doc);
  });

  it("serialized envelope carries schemaVersion === NODEFLOW_VERSION and the doc verbatim", () => {
    const doc = createDefaultDoc();
    const file = serializeProject(doc);
    expect(file.format).toBe("nodeflow");
    expect(file.schemaVersion).toBe(NODEFLOW_VERSION);
    expect(file.doc).toEqual(doc);
  });

  it("attaches audioEnvelopes only when non-empty", () => {
    const doc = createDefaultDoc();
    expect(serializeProject(doc).audioEnvelopes).toBeUndefined();
    expect(serializeProject(doc, {}).audioEnvelopes).toBeUndefined();
    expect(serializeProject(doc, { m1: "AAAA" }).audioEnvelopes).toEqual({
      m1: "AAAA",
    });
  });
});

describe("schema tolerance", () => {
  it("deserialize({}) fills all 6 ProjectDoc data keys (+ version) from defaults without throwing", () => {
    const out = deserializeProject({});
    for (const key of PROJECT_DOC_KEYS) {
      expect(out[key]).toBeDefined();
    }
    expect(out.schemaVersion).toBe(NODEFLOW_VERSION);
    // collections default to empty arrays
    expect(out.modSources).toEqual([]);
    expect(out.modulators).toEqual([]);
    // params/macros/export fall back to their default shapes
    expect(out.params).toMatchObject(createDefaultDoc().params);
    expect(out.macros).toMatchObject(createDefaultDoc().macros);
    expect(out.export).toMatchObject(createDefaultDoc().export);
    // source coerces to a valid generated source
    expect(out.source.kind).toBe("generated");
  });

  it("deserialize(partial junk) fills gaps, drops unknown keys, and keeps valid fields", () => {
    const out = deserializeProject({
      params: { motionThreshold: 0.099, bogusKey: "drop me" },
      macros: { boldness: 0.7 },
      modulators: "not an array",
      modSources: [{ id: "ok", kind: "audio" }, { junk: true }],
      source: { kind: "webcam", w: 640, h: 480 },
      somethingUnknown: 42,
    });
    // valid scalar survives
    expect(out.params.motionThreshold).toBe(0.099);
    // unknown nested key is dropped
    expect("bogusKey" in out.params).toBe(false);
    // missing macro keys filled from defaults; provided one kept
    expect(out.macros.boldness).toBe(0.7);
    expect(out.macros.responsiveness).toBe(0.5);
    // non-array modulators coerced to []
    expect(out.modulators).toEqual([]);
    // only the valid modSource survives the filter
    expect(out.modSources).toEqual([{ id: "ok", kind: "audio" }]);
    // source coerced, valid fields retained
    expect(out.source).toEqual({ kind: "webcam", w: 640, h: 480 });
    // top-level unknown keys never appear on the doc
    expect("somethingUnknown" in out).toBe(false);
  });

  it("rejects a non-object input by falling back entirely to defaults", () => {
    for (const bad of [null, undefined, 42, "string", [1, 2, 3]]) {
      const out = deserializeProject(bad);
      for (const key of PROJECT_DOC_KEYS) {
        expect(out[key]).toBeDefined();
      }
      expect(out.schemaVersion).toBe(NODEFLOW_VERSION);
    }
  });

  it("wrong-typed scalar params fall back to the default (type-checked fill)", () => {
    const out = deserializeProject({
      params: { motionThreshold: "0.5", maxBlobs: null, boxShape: 12 },
    });
    const defaults = createDefaultDoc().params;
    expect(out.params.motionThreshold).toBe(defaults.motionThreshold);
    expect(out.params.maxBlobs).toBe(defaults.maxBlobs);
    expect(out.params.boxShape).toBe(defaults.boxShape);
  });
});

describe("schema envelope vs bare doc", () => {
  it("accepts a full NodeflowFile envelope", () => {
    const doc = createDefaultDoc();
    const file = serializeProject(doc);
    expect(deserializeProject(file)).toEqual(doc);
  });

  it("accepts a bare ProjectDoc", () => {
    const doc = createDefaultDoc();
    expect(deserializeProject(doc)).toEqual(doc);
  });

  it("envelope and bare doc yield identical results for the same doc", () => {
    const doc = createDefaultDoc();
    const fromEnvelope = deserializeProject(serializeProject(doc));
    const fromBare = deserializeProject(doc);
    expect(fromEnvelope).toEqual(fromBare);
  });
});

describe("schema migration ladder", () => {
  it("is identity for a v1 doc (envelope schemaVersion)", () => {
    const doc = createDefaultDoc();
    const file = serializeProject(doc);
    expect(file.schemaVersion).toBe(1);
    expect(deserializeProject(file)).toEqual(doc);
  });

  it("is identity for a v1 doc carrying schemaVersion on the doc itself", () => {
    const doc = createDefaultDoc();
    expect(deserializeProject(doc).schemaVersion).toBe(NODEFLOW_VERSION);
  });

  it("missing schemaVersion is treated as the current version (no migration)", () => {
    const doc = createDefaultDoc();
    const { schemaVersion: _drop, ...noVersion } = doc;
    void _drop;
    const out = deserializeProject(noVersion);
    expect(out.schemaVersion).toBe(NODEFLOW_VERSION);
    expect(out).toEqual(doc);
  });
});
