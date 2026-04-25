export function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") {
    return fallback;
  }

  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson<T>(key: string, value: T): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(value));
}

export function scopedKey(tenantId: string, userId: string, resource: string): string {
  return `ajo:${tenantId}:${userId}:${resource}`;
}

export function clearScopedWorkspace(tenantId: string, userId: string): void {
  if (typeof window === "undefined") {
    return;
  }

  const prefix = `ajo:${tenantId}:${userId}:`;
  Object.keys(window.localStorage)
    .filter((key) => key.startsWith(prefix))
    .forEach((key) => window.localStorage.removeItem(key));
}
