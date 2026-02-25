/**
 * Topic Store — IndexedDB-based session history tracker.
 *
 * Tracks sessionId changes per session key so we can detect resets,
 * display session boundaries, and group sessions into "topics".
 */

const DB_NAME = "intelli-claw-topics";
const DB_VERSION = 1;
const STORE_NAME = "topics";

export interface TopicEntry {
  /** Session key (e.g. "agent:main:main") */
  sessionKey: string;
  /** Internal session UUID from gateway */
  sessionId: string;
  /** When this session started */
  startedAt: number;
  /** When this session was replaced (reset) */
  endedAt?: number;
  /** Label snapshot at the time */
  label?: string;
  /** Summary of conversation before reset */
  summary?: string;
  /** Message count */
  messageCount?: number;
  /** Token count */
  totalTokens?: number;
}

// --- IndexedDB helpers (mirrors device-identity.ts pattern) ---

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // Compound key: [sessionKey, sessionId]
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: ["sessionKey", "sessionId"],
        });
        store.createIndex("byKey", "sessionKey", { unique: false });
        store.createIndex("byStartedAt", ["sessionKey", "startedAt"], { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const req = fn(tx.objectStore(STORE_NAME));
        req.onsuccess = () => {
          db.close();
          resolve(req.result);
        };
        req.onerror = () => {
          db.close();
          reject(req.error);
        };
      }),
  );
}

// --- Public API ---

/** Get all topic entries for a session key, sorted by startedAt desc */
export async function getTopicHistory(sessionKey: string): Promise<TopicEntry[]> {
  const db = await openDB();
  return new Promise<TopicEntry[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const index = tx.objectStore(STORE_NAME).index("byKey");
    const req = index.getAll(sessionKey);
    req.onsuccess = () => {
      db.close();
      const entries = (req.result as TopicEntry[]) || [];
      entries.sort((a, b) => b.startedAt - a.startedAt);
      resolve(entries);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

/** Track a new sessionId for a session key */
export async function trackSessionId(
  sessionKey: string,
  sessionId: string,
  meta?: Partial<TopicEntry>,
): Promise<void> {
  const entry: TopicEntry = {
    sessionKey,
    sessionId,
    startedAt: Date.now(),
    ...meta,
  };
  await withStore("readwrite", (store) => store.put(entry));
}

/** Mark a session as ended (replaced by reset) */
export async function markSessionEnded(
  sessionKey: string,
  sessionId: string,
  extra?: { summary?: string; messageCount?: number; totalTokens?: number },
): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get([sessionKey, sessionId]);
    getReq.onsuccess = () => {
      const existing = getReq.result as TopicEntry | undefined;
      if (existing) {
        existing.endedAt = Date.now();
        if (extra?.summary) existing.summary = extra.summary;
        if (extra?.messageCount != null) existing.messageCount = extra.messageCount;
        if (extra?.totalTokens != null) existing.totalTokens = extra.totalTokens;
        const putReq = store.put(existing);
        putReq.onsuccess = () => {
          db.close();
          resolve();
        };
        putReq.onerror = () => {
          db.close();
          reject(putReq.error);
        };
      } else {
        db.close();
        resolve(); // nothing to update
      }
    };
    getReq.onerror = () => {
      db.close();
      reject(getReq.error);
    };
  });
}

/** Get the currently tracked sessionId for a session key (most recent entry without endedAt) */
export async function getCurrentSessionId(sessionKey: string): Promise<string | null> {
  const entries = await getTopicHistory(sessionKey);
  const current = entries.find((e) => !e.endedAt);
  return current?.sessionId ?? null;
}

/** Count previous sessions (ended) for a session key */
export async function getTopicCount(sessionKey: string): Promise<number> {
  const entries = await getTopicHistory(sessionKey);
  return entries.length;
}
