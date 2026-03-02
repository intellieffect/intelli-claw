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
  replyTo?: unknown;
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

// --- Backfill from API ---

const BACKFILL_KEY = "intelli-claw-backfill-done";

/** Check if backfill has been done for a session key + sessionId combo */
export function isBackfillDone(sessionKey: string, sessionId: string): boolean {
  try {
    const done = JSON.parse(localStorage.getItem(BACKFILL_KEY) || "{}");
    return !!done[`${sessionKey}:${sessionId}`];
  } catch {
    return false;
  }
}

/** Mark backfill as done */
export function markBackfillDone(sessionKey: string, sessionId: string): void {
  try {
    const done = JSON.parse(localStorage.getItem(BACKFILL_KEY) || "{}");
    done[`${sessionKey}:${sessionId}`] = Date.now();
    localStorage.setItem(BACKFILL_KEY, JSON.stringify(done));
  } catch { /* ignore */ }
}

/** Backfill messages from API server for a specific session log */
export async function backfillFromApi(
  sessionKey: string,
  sessionId: string,
  apiBase: string,
  agentId: string,
): Promise<StoredMessage[]> {
  if (isBackfillDone(sessionKey, sessionId)) return [];

  try {
    const res = await fetch(
      `${apiBase}/api/session-history/${encodeURIComponent(agentId)}?sessionId=${encodeURIComponent(sessionId)}`,
    );
    if (!res.ok) return [];

    const data = await res.json();
    const messages: StoredMessage[] = (data.messages || []).map(
      (m: { id: string; role: string; content: string; timestamp: string }) => ({
        sessionKey,
        id: `log-${sessionId.slice(0, 8)}-${m.id}`,
        role: m.role as StoredMessage["role"],
        content: m.content,
        timestamp: m.timestamp,
      }),
    );

    if (messages.length > 0) {
      await saveMessages(sessionKey, messages);
    }
    markBackfillDone(sessionKey, sessionId);
    return messages;
  } catch (e) {
    console.warn("[message-store] Backfill failed:", e);
    return [];
  }
}
