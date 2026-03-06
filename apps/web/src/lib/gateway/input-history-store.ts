/**
 * Input History Store — IndexedDB-based chat input history (#161).
 *
 * Persists user-typed messages per session key so the user can recall
 * previous inputs with Arrow Up / Down, similar to a terminal shell.
 *
 * - Session-scoped: each sessionKey has its own ring of entries.
 * - Capped: only the most recent MAX_ENTRIES_PER_SESSION are kept.
 * - Deduped: consecutive identical inputs are not stored twice.
 */

const DB_NAME = "intelli-claw-input-history";
const DB_VERSION = 1;
const STORE_NAME = "inputs";

/** Maximum entries per session to prevent unbounded growth */
export const MAX_ENTRIES_PER_SESSION = 50;

export interface InputEntry {
  /** Session key (e.g. "agent:iclaw:main") */
  sessionKey: string;
  /** Auto-increment id (set by IndexedDB) */
  id?: number;
  /** The raw input text */
  text: string;
  /** When the input was sent (epoch ms) */
  sentAt: number;
}

// --- IndexedDB helpers ---

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("bySessionKey", "sessionKey", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// --- Public API ---

/**
 * Push a new input entry. Skips if:
 * - text is empty/whitespace-only
 * - text is identical to the most recent entry for this session
 *
 * Automatically trims entries beyond MAX_ENTRIES_PER_SESSION.
 */
export async function pushInput(
  sessionKey: string,
  text: string,
): Promise<void> {
  const trimmed = text.trim();
  if (!sessionKey || !trimmed) return;

  const db = await openDB();
  try {
    // Read existing entries to check for duplicate & enforce cap
    const entries = await _getAllForSession(db, sessionKey);

    // Skip consecutive duplicate
    if (entries.length > 0 && entries[entries.length - 1].text === trimmed) {
      db.close();
      return;
    }

    // Insert new entry
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.add({ sessionKey, text: trimmed, sentAt: Date.now() } satisfies Omit<InputEntry, "id">);

      // Evict oldest if over cap
      const excess = entries.length + 1 - MAX_ENTRIES_PER_SESSION;
      if (excess > 0) {
        for (let i = 0; i < excess; i++) {
          if (entries[i].id != null) {
            store.delete(entries[i].id!);
          }
        }
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Get all input entries for a session, sorted oldest → newest (by id asc).
 */
export async function getInputHistory(
  sessionKey: string,
): Promise<InputEntry[]> {
  if (!sessionKey) return [];
  const db = await openDB();
  try {
    return await _getAllForSession(db, sessionKey);
  } finally {
    db.close();
  }
}

/**
 * Clear all input history for a session.
 */
export async function clearInputHistory(
  sessionKey: string,
): Promise<void> {
  if (!sessionKey) return;
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
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
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

// --- Internal ---

function _getAllForSession(
  db: IDBDatabase,
  sessionKey: string,
): Promise<InputEntry[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const index = tx.objectStore(STORE_NAME).index("bySessionKey");
    const req = index.getAll(sessionKey);
    req.onsuccess = () => {
      const entries = (req.result as InputEntry[]) || [];
      // Sort by auto-increment id (oldest first)
      entries.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
      resolve(entries);
    };
    req.onerror = () => reject(req.error);
  });
}
