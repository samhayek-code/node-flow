/** Project persistence: IndexedDB autosave + a recents shelf, plus File System
 *  Access save/open with universal fallbacks (<a download> + hidden file input).
 *  Raw IDB, no library. Every IDB path is promisified and degrades to null/no-op
 *  when IndexedDB is unavailable (private mode, SSR, blocked storage). */

import { deserializeProject, serializeProject } from "./schema";
import type { NodeflowFile } from "./schema";
import type { ProjectDoc } from "../store/types";
import { supports } from "../util/browser";

const DB_NAME = "nodeflow";
const DB_VERSION = 1;
const STORE_CURRENT = "current";
const STORE_RECENT = "recent";
const CURRENT_KEY = "autosave";
const AUTOSAVE_DEBOUNCE_MS = 800;
const RECENT_LIMIT = 12;
const FILE_EXT = ".nodeflow";

export interface RecentEntry {
  id: string;
  name: string;
  savedAt: number;
  thumbnail?: string;
}

interface RecentRecord extends RecentEntry {
  file: NodeflowFile;
}

/* ------------------------------- IndexedDB ---------------------------------- */

function hasIDB(): boolean {
  return typeof indexedDB !== "undefined";
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (!hasIDB()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_CURRENT))
        db.createObjectStore(STORE_CURRENT);
      if (!db.objectStoreNames.contains(STORE_RECENT))
        db.createObjectStore(STORE_RECENT);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function reqResult<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T
): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = await fn(store);
    if (mode === "readwrite") await txDone(tx);
    return result;
  } catch {
    return null;
  }
}

/* ------------------------------- autosave ----------------------------------- */

/** Persist the current doc to IDB, debounced. Returns an unsubscribe that flushes
 *  any pending write so a final edit isn't lost on teardown. No-op without IDB. */
export function startAutosave(getDoc: () => ProjectDoc): () => void {
  if (!hasIDB()) return () => {};

  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const flush = () => {
    timer = null;
    if (disposed) return;
    const file = serializeProject(getDoc());
    void withStore(STORE_CURRENT, "readwrite", (s) => s.put(file, CURRENT_KEY));
  };

  const schedule = () => {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
  };

  // Persist only on actual edits (pokeAutosave -> trigger). We deliberately do NOT
  // schedule an immediate write on start: that would clobber a just-restored
  // session and, under React StrictMode's mount/unmount/mount, flush defaults
  // over saved work before the restore reads it.
  const trigger = schedule;
  autosaveTriggers.add(trigger);

  return () => {
    if (disposed) return;
    disposed = true;
    autosaveTriggers.delete(trigger);
    if (timer) {
      clearTimeout(timer);
      // Flush the in-flight edit synchronously-ish before releasing.
      disposed = false;
      flush();
      disposed = true;
    }
  };
}

/** Registered debounce triggers. The store calls `pokeAutosave()` on each
 *  history commit so coalescing debounces the write for free (§2.8). */
const autosaveTriggers = new Set<() => void>();

export function pokeAutosave(): void {
  for (const trigger of autosaveTriggers) trigger();
}

export async function loadAutosave(): Promise<ProjectDoc | null> {
  const raw = await withStore<unknown>(STORE_CURRENT, "readonly", (s) =>
    reqResult(s.get(CURRENT_KEY))
  );
  if (!raw) return null;
  try {
    return deserializeProject(raw);
  } catch {
    return null;
  }
}

/* -------------------------------- recents ----------------------------------- */

export async function listRecent(limit = RECENT_LIMIT): Promise<RecentEntry[]> {
  const records = await withStore<RecentRecord[]>(
    STORE_RECENT,
    "readonly",
    (s) => reqResult(s.getAll() as IDBRequest<RecentRecord[]>)
  );
  if (!records) return [];
  return records
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, limit)
    .map(({ id, name, savedAt, thumbnail }) => ({
      id,
      name,
      savedAt,
      thumbnail,
    }));
}

export async function putRecent(
  file: NodeflowFile,
  thumbnail?: string
): Promise<void> {
  const savedAt = Date.parse(file.savedAt) || Date.now();
  const id = `${savedAt}-${Math.random().toString(36).slice(2, 8)}`;
  const record: RecentRecord = {
    id,
    name: file.doc.source.fileName ?? "Untitled",
    savedAt,
    thumbnail,
    file,
  };
  await withStore(STORE_RECENT, "readwrite", async (s) => {
    s.put(record, id);
    // Prune to the most recent N.
    const all =
      (await reqResult(s.getAll() as IDBRequest<RecentRecord[]>)) ?? [];
    all
      .sort((a, b) => b.savedAt - a.savedAt)
      .slice(RECENT_LIMIT)
      .forEach((stale) => s.delete(stale.id));
  });
}

/* -------------------------- File System Access ------------------------------ */

interface FsWindow extends Window {
  showSaveFilePicker?: (options?: unknown) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (options?: unknown) => Promise<FileSystemFileHandle[]>;
}

const PICKER_TYPES = [
  {
    description: "Node-Flow Project",
    accept: { "application/json": [FILE_EXT] },
  },
];

function suggestedName(file: NodeflowFile): string {
  const base = (file.doc.source.fileName ?? "untitled").replace(/\.[^.]+$/, "");
  return `${base || "untitled"}${FILE_EXT}`;
}

/** Save via the File System Access picker when available; otherwise trigger an
 *  anchor download. Both write the same serialized JSON blob. */
export async function saveProjectToDisk(file: NodeflowFile): Promise<void> {
  const json = JSON.stringify(file, null, 2);
  const blob = new Blob([json], { type: "application/json" });

  if (supports.fsAccess()) {
    const w = window as FsWindow;
    try {
      const handle = await w.showSaveFilePicker!({
        suggestedName: suggestedName(file),
        types: PICKER_TYPES,
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      // User aborted the picker — don't fall back to a surprise download.
      if (err instanceof DOMException && err.name === "AbortError") return;
      // Any other failure: fall through to the download path.
    }
  }

  downloadBlob(blob, suggestedName(file));
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Open via the File System Access picker when available; otherwise a hidden
 *  file input. Returns a tolerant-deserialized `ProjectDoc`. Rejects only on a
 *  genuine read error — a cancelled picker/input rejects with "cancelled". */
export async function openProjectFromDisk(): Promise<ProjectDoc> {
  let text: string;

  if (supports.fsAccess()) {
    const w = window as FsWindow;
    try {
      const [handle] = await w.showOpenFilePicker!({
        types: PICKER_TYPES,
        multiple: false,
      });
      const fileObj = await handle.getFile();
      text = await fileObj.text();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error("cancelled");
      }
      throw err;
    }
  } else {
    text = await readViaHiddenInput();
  }

  return deserializeProject(JSON.parse(text));
}

function readViaHiddenInput(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = `${FILE_EXT},application/json`;
    input.style.display = "none";

    // `cancel` fires in modern browsers when the dialog is dismissed; older
    // browsers leave the input empty with no event, so this can hang there —
    // acceptable for a one-shot import dialog.
    const cleanup = () => {
      input.removeEventListener("change", onChange);
      input.removeEventListener("cancel", onCancel);
      input.remove();
    };
    const onChange = () => {
      const file = input.files?.[0];
      cleanup();
      if (!file) {
        reject(new Error("cancelled"));
        return;
      }
      file.text().then(resolve, reject);
    };
    const onCancel = () => {
      cleanup();
      reject(new Error("cancelled"));
    };

    input.addEventListener("change", onChange);
    input.addEventListener("cancel", onCancel);
    document.body.appendChild(input);
    input.click();
  });
}
