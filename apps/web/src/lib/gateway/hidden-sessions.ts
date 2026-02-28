const STORAGE_KEY = "awf:hidden-sessions";

function load(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function save(keys: string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
}

export function getHiddenSessions(): Set<string> {
  return new Set(load());
}

export function hideSession(key: string): void {
  const keys = load();
  if (!keys.includes(key)) {
    keys.push(key);
    save(keys);
  }
}

export function unhideSession(key: string): void {
  save(load().filter((k) => k !== key));
}

export function isSessionHidden(key: string): boolean {
  return load().includes(key);
}
