/** `.nodeflow` project file format: serialization, tolerant deserialization,
 *  and the forward-only migration ladder. The file embeds only metadata — never
 *  raw media — so a generated source round-trips exactly and a file source carries
 *  enough to drive a re-link flow on open. */

import { DEFAULT_EXPORT, DEFAULT_PARAMS } from "../params";
import type { ExportSettings, Params } from "../params";
import type {
  MacroState,
  ModSource,
  Modulator,
  ProjectDoc,
  SourceMeta,
} from "../store/types";

export const NODEFLOW_VERSION = 1;

const APP_NAME = "node-flow" as const;
const APP_VERSION = "0.1.0";

export interface NodeflowFile {
  format: "nodeflow";
  schemaVersion: number;
  app: { name: "node-flow"; version: string };
  savedAt: string; // ISO
  doc: ProjectDoc;
  /** mediaId -> base64 Float32 envelope. Small; lets preview work pre-relink. */
  audioEnvelopes?: Record<string, string>;
  // raw media is NEVER embedded — only metadata + a re-link flow
}

/** Macro positions match the Leva panel's initial values (controls.ts:54-113). */
const DEFAULT_MACROS: MacroState = {
  responsiveness: 0.5,
  density: 0.5,
  boldness: 0.5,
  size: 0.4,
};

const DEFAULT_SOURCE: SourceMeta = {
  kind: "generated",
};

export function serializeProject(
  doc: ProjectDoc,
  envelopes?: Record<string, string>
): NodeflowFile {
  return {
    format: "nodeflow",
    schemaVersion: NODEFLOW_VERSION,
    app: { name: APP_NAME, version: APP_VERSION },
    savedAt: new Date().toISOString(),
    doc,
    ...(envelopes && Object.keys(envelopes).length
      ? { audioEnvelopes: envelopes }
      : {}),
  };
}

/* ----------------------------- migration ladder ----------------------------- */

type RawDoc = Record<string, unknown>;

/** Forward-only migrations keyed by the version they upgrade FROM.
 *  v1 is the current schema, so the ladder is identity today; future schema
 *  bumps register a `migrations[1] = (raw) => ...` to lift v1 docs to v2. */
const migrations: Record<number, (raw: RawDoc) => RawDoc> = {};

function migrate(raw: RawDoc, fromVersion: number): RawDoc {
  let doc = raw;
  let v = fromVersion;
  while (v < NODEFLOW_VERSION && migrations[v]) {
    doc = migrations[v](doc);
    v += 1;
  }
  return doc;
}

/* ------------------------------- coercion ----------------------------------- */

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Fill any missing/wrong-typed key from `defaults`, type-checked per key.
 *  Unknown extra keys are dropped — only the default's shape survives. */
function fillFrom<T extends object>(raw: unknown, defaults: T): T {
  const src = isObject(raw) ? raw : {};
  const out = {} as Record<string, unknown>;
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const fallback = (defaults as Record<string, unknown>)[key as string];
    const candidate = src[key as string];
    out[key as string] =
      candidate !== undefined && typeof candidate === typeof fallback
        ? candidate
        : fallback;
  }
  return out as T;
}

function coerceMods(raw: unknown): Modulator[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidModulator);
}

function isValidModulator(m: unknown): m is Modulator {
  return (
    isObject(m) &&
    typeof m.id === "string" &&
    typeof m.enabled === "boolean" &&
    typeof m.sourceId === "string" &&
    typeof m.target === "string" &&
    typeof m.depth === "number" &&
    typeof m.responsiveness === "number"
  );
}

function coerceModSources(raw: unknown): ModSource[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidModSource);
}

function isValidModSource(s: unknown): s is ModSource {
  return isObject(s) && typeof s.id === "string" && typeof s.kind === "string";
}

function coerceSource(raw: unknown): SourceMeta {
  if (!isObject(raw)) return { ...DEFAULT_SOURCE };
  const kind =
    raw.kind === "file" || raw.kind === "webcam" || raw.kind === "generated"
      ? raw.kind
      : "generated";
  const meta: SourceMeta = { kind };
  if (typeof raw.fileName === "string") meta.fileName = raw.fileName;
  if (typeof raw.w === "number") meta.w = raw.w;
  if (typeof raw.h === "number") meta.h = raw.h;
  if (typeof raw.duration === "number" || raw.duration === null)
    meta.duration = raw.duration;
  return meta;
}

/** Tolerant: accepts a bare `ProjectDoc`, a full `NodeflowFile`, or partial junk;
 *  fills every gap from `DEFAULT_*`; runs the migration ladder. Never throws on
 *  shape — only a non-object input is rejected upstream. */
export function deserializeProject(raw: unknown): ProjectDoc {
  const root = isObject(raw) ? raw : {};
  // Unwrap a NodeflowFile envelope; otherwise treat the object as the doc itself.
  const wrapped = isObject(root.doc) ? (root.doc as RawDoc) : (root as RawDoc);
  const fromVersion =
    typeof root.schemaVersion === "number"
      ? root.schemaVersion
      : typeof wrapped.schemaVersion === "number"
        ? (wrapped.schemaVersion as number)
        : NODEFLOW_VERSION;

  const doc = migrate(wrapped, fromVersion);

  return {
    schemaVersion: NODEFLOW_VERSION,
    params: fillFrom<Params>(doc.params, DEFAULT_PARAMS),
    macros: fillFrom<MacroState>(doc.macros, DEFAULT_MACROS),
    modSources: coerceModSources(doc.modSources),
    modulators: coerceMods(doc.modulators),
    source: coerceSource(doc.source),
    export: fillFrom<ExportSettings>(doc.export, DEFAULT_EXPORT),
  };
}
