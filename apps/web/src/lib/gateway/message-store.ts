/**
 * Message Store — IndexedDB-based local message persistence.
 *
 * Saves chat messages locally so they survive gateway compaction.
 * On refresh, local messages are merged with gateway history to
 * restore the full conversation.
 */

const DB_NAME = "intelli-claw-messages";
const DB_VERSION = 1;
const STORE_NAME = "messages";

export interface StoredMessage {
  /** Composite key: sessionKey + id */
  sessionKey: string;
  id: string;
  role: "user" | "assistant" | "system" | "session-boundary";
  content: string;
  timestamp: string;
  toolCalls?: unknown[];
  attachments?: unknown[];
  oldSessionId?: string;
  newSessionId?: string;
}

// --- IndexedDB helpers ---

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: ["sessionKey", "id"],
        });
        store.createIndex("bySessionKey", "sessionKey", { unique: false });
        store.createIndex("byTimestamp", ["sessionKey", "timestamp"], {
          unique: false,
        });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// --- Public API ---

/** Save multiple messages for a session key (upsert) */
export async function saveMessages(
  sessionKey: string,
  messages: StoredMessage[],
): Promise<void> {
  if (messages.length === 0) return;
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const msg of messages) {
      store.put({ ...msg, sessionKey });
    }
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/** Get all locally stored messages for a session key, sorted by timestamp asc */
export async function getLocalMessages(
  sessionKey: string,
): Promise<StoredMessage[]> {
  const db = await openDB();
  return new Promise<StoredMessage[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const index = tx.objectStore(STORE_NAME).index("bySessionKey");
    const req = index.getAll(sessionKey);
    req.onsuccess = () => {
      db.close();
      const entries = (req.result as StoredMessage[]) || [];
      entries.sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
      resolve(entries);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

/** Clear all messages for a session key */
export async function clearMessages(sessionKey: string): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("bySessionKey");
    const req = index.openCursor(sessionKey);
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
